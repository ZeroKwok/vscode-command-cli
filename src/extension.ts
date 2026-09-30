import * as vscode from 'vscode';

const CONFIG_SECTION = 'vscodeCommandCli';
const EXECUTE_PATH = '/v1/execute';
const MAX_PAYLOAD_LENGTH = 64 * 1024;

let output: vscode.OutputChannel;

interface ExecuteRequest {
  command: string;
  args: unknown[];
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
  try {
    if (uri.path !== EXECUTE_PATH) {
      throw new Error(`Unsupported URI path: ${uri.path}`);
    }

    const request = parseExecuteRequest(uri);
    const args = reviveCommandArgs(request.args);
    log(`Executing command: ${request.command}${args.length > 0 ? ` args=${JSON.stringify(request.args)}` : ''}`);
    await vscode.commands.executeCommand(request.command, ...args);
    log(`Command completed: ${request.command}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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

  return { command, args: record.args ?? [] };
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
