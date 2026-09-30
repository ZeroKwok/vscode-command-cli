import * as http from 'node:http';
import { URL } from 'node:url';
import * as vscode from 'vscode';

const CONFIG_SECTION = 'vscodeCommandCli';
const EXECUTE_PATH = '/v1/execute';
const MAX_PAYLOAD_LENGTH = 64 * 1024;
const MAX_REPLY_LENGTH = 1024 * 1024;

let output: vscode.OutputChannel;

interface ExecuteRequest {
  command: string;
  args: unknown[];
  reply?: ReplyTarget;
}

interface ReplyTarget {
  requestId: string;
  token: string;
  url: string;
}

interface CommandReply {
  version: 1;
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('VS Code Command CLI');
  context.subscriptions.push(output);

  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: async (uri) => {
        await handleUri(uri);
      }
    }),
    vscode.commands.registerCommand('vscodeCommandCli.showUriInfo', async () => {
      const endpoint = uriEndpoint(context.extension.id);
      await vscode.env.clipboard.writeText(endpoint);
      void vscode.window.showInformationMessage('VS Code Command CLI URI endpoint copied to the clipboard.');
    })
  );

  log(`URI handler ready: ${uriEndpoint(context.extension.id)}`);
}

async function handleUri(uri: vscode.Uri): Promise<void> {
  let request: ExecuteRequest | undefined;

  try {
    if (uri.path !== EXECUTE_PATH) {
      throw new Error(`Unsupported URI path: ${uri.path}`);
    }

    request = parseExecuteRequest(uri);
    const args = reviveCommandArgs(request.args);
    log(`Executing command: ${request.command}${args.length > 0 ? ` args=${JSON.stringify(request.args)}` : ''}`);
    const result = await vscode.commands.executeCommand(request.command, ...args);
    if (request.reply) {
      await sendReply(request.reply, {
        version: 1,
        requestId: request.reply.requestId,
        ok: true,
        result: serializeCommandResult(result)
      });
    }
    log(`Command completed: ${request.command}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (request?.reply) {
      try {
        await sendReply(request.reply, {
          version: 1,
          requestId: request.reply.requestId,
          ok: false,
          error: message
        });
      } catch (replyError) {
        const replyMessage = replyError instanceof Error ? replyError.message : String(replyError);
        log(`Failed to send command reply: ${replyMessage}`);
      }
    }
    log(`URI request failed: ${message}`);
    void vscode.window.showErrorMessage(`VS Code Command CLI: ${message}`);
  }
}

function uriEndpoint(extensionId: string): string {
  return `${vscode.env.uriScheme}://${extensionId}${EXECUTE_PATH}`;
}

function parseExecuteRequest(uri: vscode.Uri): ExecuteRequest {
  const payload = new URLSearchParams(uri.query).get('p');

  if (!payload) {
    throw new Error('Missing required URI parameter: p.');
  }

  if (payload.length > MAX_PAYLOAD_LENGTH) {
    throw new Error('URI payload exceeds the maximum supported size.');
  }

  if (!/^[A-Za-z0-9_-]+$/.test(payload)) {
    throw new Error('URI payload must be Base64URL encoded.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('URI payload is not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('URI payload must be a JSON object.');
  }

  const record = parsed as Record<string, unknown>;
  const command = typeof record.command === 'string' ? record.command.trim() : '';
  if (!command) {
    throw new Error('URI payload is missing a valid command.');
  }

  if (record.args !== undefined && !Array.isArray(record.args)) {
    throw new Error('URI payload args must be a JSON array.');
  }

  return { command, args: record.args ?? [], reply: parseReplyTarget(record.reply) };
}

function parseReplyTarget(value: unknown): ReplyTarget | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('URI payload reply must be a JSON object.');
  }

  const reply = value as Record<string, unknown>;
  const requestId = typeof reply.requestId === 'string' ? reply.requestId : '';
  const token = typeof reply.token === 'string' ? reply.token : '';
  const callbackUrl = typeof reply.url === 'string' ? reply.url : '';

  if (!/^[A-Za-z0-9_-]{16,}$/.test(requestId) || !/^[A-Za-z0-9_-]{16,}$/.test(token)) {
    throw new Error('URI payload reply contains an invalid request ID or token.');
  }

  let target: URL;
  try {
    target = new URL(callbackUrl);
  } catch {
    throw new Error('URI payload reply contains an invalid callback URL.');
  }

  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port) {
    throw new Error('URI payload reply callback must use a 127.0.0.1 HTTP URL with an explicit port.');
  }

  return { requestId, token, url: callbackUrl };
}

async function sendReply(target: ReplyTarget, reply: CommandReply): Promise<void> {
  const body = JSON.stringify(reply);
  if (Buffer.byteLength(body) > MAX_REPLY_LENGTH) {
    throw new Error('Command result exceeds the maximum callback response size.');
  }

  await new Promise<void>((resolve, reject) => {
    const request = http.request(
      target.url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'X-VSCode-Command-CLI-Token': target.token
        },
        timeout: 5000
      },
      (response) => {
        response.resume();
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          resolve();
          return;
        }

        reject(new Error(`Callback server returned HTTP ${response.statusCode ?? 0}.`));
      }
    );

    request.once('error', reject);
    request.once('timeout', () => request.destroy(new Error('Callback request timed out.')));
    request.end(body);
  });
}

function serializeCommandResult(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value ?? null;
  }

  if (value instanceof vscode.Uri) {
    return { $uri: value.toString(true) };
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeCommandResult(item, seen));
  }

  if (typeof value !== 'object') {
    throw new Error(`Command result type ${typeof value} cannot be returned through the CLI.`);
  }

  if (seen.has(value)) {
    throw new Error('Command result contains a circular reference.');
  }

  seen.add(value);
  const serialized = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, serializeCommandResult(item, seen)])
  );
  seen.delete(value);
  return serialized;
}

function reviveCommandArgs(args: unknown[]): unknown[] {
  return args.map((arg) => reviveCommandArg(arg));
}

function reviveCommandArg(arg: unknown): unknown {
  if (typeof arg === 'string') {
    return reviveStringArg(arg);
  }

  if (Array.isArray(arg)) {
    return arg.map((item) => reviveCommandArg(item));
  }

  if (!arg || typeof arg !== 'object') {
    return arg;
  }

  const record = arg as Record<string, unknown>;
  if (typeof record.$uri === 'string') {
    return vscode.Uri.parse(record.$uri, true);
  }

  if (typeof record.$fsPath === 'string') {
    return vscode.Uri.file(record.$fsPath);
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, reviveCommandArg(value)])
  );
}

function reviveStringArg(value: string): unknown {
  if (value.startsWith('fsPath:')) {
    return value.slice('fsPath:'.length);
  }

  if (value.startsWith('fileUri:')) {
    return vscode.Uri.file(value.slice('fileUri:'.length));
  }

  if (value.startsWith('uri:')) {
    return vscode.Uri.parse(value.slice('uri:'.length), true);
  }

  if (value.startsWith('json:')) {
    return reviveCommandArg(JSON.parse(value.slice('json:'.length)));
  }

  return value;
}

function isLogEnabled(): boolean {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>('enableLog', true);
}

function log(message: string): void {
  if (isLogEnabled()) {
    output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}
