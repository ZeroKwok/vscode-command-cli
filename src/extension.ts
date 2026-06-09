import * as http from 'node:http';
import { URL } from 'node:url';
import * as vscode from 'vscode';

const CONFIG_SECTION = 'vscodeCommandCli';
const HOST = '127.0.0.1';
const PORT_ENV = 'VSCODE_COMMAND_CLI_PORT';
const URL_ENV = 'VSCODE_COMMAND_CLI_URL';

let server: http.Server | undefined;
let output: vscode.OutputChannel;
let currentPort: number | undefined;
let extensionContext: vscode.ExtensionContext;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extensionContext = context;
  output = vscode.window.createOutputChannel('VS Code Command CLI');
  context.subscriptions.push(output);

  context.subscriptions.push(
    vscode.commands.registerCommand('vscodeCommandCli.restartServer', async () => {
      await restartServer();
      vscode.window.showInformationMessage(`VS Code Command CLI server is listening on ${serverUrl()}`);
    }),
    vscode.commands.registerCommand('vscodeCommandCli.showServerInfo', () => {
      vscode.window.showInformationMessage(
        server ? `VS Code Command CLI server is listening on ${serverUrl()}` : 'VS Code Command CLI server is not running.'
      );
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration(`${CONFIG_SECTION}.serverPort`)) {
        await restartServer();
      }
    }),
    {
      dispose: () => {
        void stopServer();
      }
    }
  );

  await startServer();
}

export async function deactivate(): Promise<void> {
  await stopServer();
}

async function restartServer(): Promise<void> {
  await stopServer();
  await startServer();
}

async function startServer(): Promise<void> {
  const port = getPort();
  currentPort = undefined;

  server = http.createServer((request, response) => {
    void handleRequest(request, response);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server?.listen(port, HOST, () => resolve());
      server?.once('error', reject);
    });
  } catch (error) {
    server = undefined;
    const message = getServerErrorMessage(error, port);
    log(message);
    vscode.window.showErrorMessage(`VS Code Command CLI: ${message}`);
    return;
  }

  currentPort = getListeningPort(server) ?? port;
  updateTerminalEnvironment();
  log(`Server started at ${serverUrl()}`);

  server.on('error', (error: NodeJS.ErrnoException) => {
    const message = getServerErrorMessage(error, port);
    log(message);
    vscode.window.showErrorMessage(`VS Code Command CLI: ${message}`);
  });
}

async function stopServer(): Promise<void> {
  const serverToClose = server;
  server = undefined;
  currentPort = undefined;
  clearTerminalEnvironment();

  if (!serverToClose) {
    return;
  }

  await new Promise<void>((resolve) => {
    serverToClose.close(() => resolve());
  });

  log('Server stopped');
}

async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  setCorsHeaders(response);

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: 'Only GET and POST are supported.' });
    return;
  }

  const requestUrl = new URL(request.url ?? '/', `http://${HOST}:${currentPort ?? getPort()}`);

  try {
    const body = request.method === 'POST' ? await readJsonBody(request) : {};

    if (requestUrl.pathname === '/execute' || requestUrl.pathname.startsWith('/execute/')) {
      await handleExecute(requestUrl, body, response);
      return;
    }

    sendJson(response, 404, {
      ok: false,
      error: 'Route not found. Use /execute?command=<commandId>&arg=<value> or /execute/<commandId>?arg=<value>.'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Request failed: ${message}`);
    sendJson(response, 500, { ok: false, error: message });
  }
}

async function handleExecute(
  requestUrl: URL,
  body: Record<string, unknown>,
  response: http.ServerResponse
): Promise<void> {
  const command = getCommand(requestUrl, body);
  const args = getArgs(requestUrl, body);

  if (!command) {
    sendJson(response, 400, { ok: false, error: 'Missing required parameter: command.' });
    return;
  }

  log(`Executing command: ${command}${args.length > 0 ? ` args=${JSON.stringify(args)}` : ''}`);
  await vscode.commands.executeCommand(command, ...args);
  sendJson(response, 200, { ok: true, command });
}

function getPort(): number {
  const configuredPort = vscode.workspace.getConfiguration(CONFIG_SECTION).get<number>('serverPort', 0);

  if (!Number.isInteger(configuredPort) || configuredPort < 0 || configuredPort > 65535) {
    return 0;
  }

  return configuredPort;
}

function serverUrl(): string {
  return `http://${HOST}:${currentPort ?? getPort()}`;
}

function getListeningPort(activeServer: http.Server): number | undefined {
  const address = activeServer.address();

  if (address && typeof address === 'object') {
    return address.port;
  }

  return undefined;
}

function updateTerminalEnvironment(): void {
  if (!currentPort) {
    return;
  }

  extensionContext.environmentVariableCollection.replace(PORT_ENV, String(currentPort));
  extensionContext.environmentVariableCollection.replace(URL_ENV, serverUrl());
  extensionContext.environmentVariableCollection.description = 'Exposes the VS Code Command CLI localhost server for newly created terminals.';
  log(`Terminal environment updated: ${PORT_ENV}=${currentPort}, ${URL_ENV}=${serverUrl()}`);
}

function clearTerminalEnvironment(): void {
  extensionContext.environmentVariableCollection.delete(PORT_ENV);
  extensionContext.environmentVariableCollection.delete(URL_ENV);
}

function getServerErrorMessage(error: unknown, port: number): string {
  const nodeError = error as NodeJS.ErrnoException;

  if (nodeError.code === 'EADDRINUSE') {
    return `Port ${port} is already in use. Change ${CONFIG_SECTION}.serverPort in VS Code Settings.`;
  }

  return `Server error: ${nodeError.message ?? String(error)}`;
}

function isLogEnabled(): boolean {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>('enableLog', true);
}

function log(message: string): void {
  if (isLogEnabled()) {
    output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

function setCorsHeaders(response: http.ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString('utf8').trim();
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return Object.fromEntries(new URLSearchParams(rawBody));
  }
}

function getStringParam(url: URL, body: Record<string, unknown>, name: string): string | undefined {
  const bodyValue = body[name];
  const value = typeof bodyValue === 'string' ? bodyValue : url.searchParams.get(name);
  return value?.trim() || undefined;
}

function getCommand(url: URL, body: Record<string, unknown>): string | undefined {
  const command = getStringParam(url, body, 'command');
  if (command) {
    return command;
  }

  if (!url.pathname.startsWith('/execute/')) {
    return undefined;
  }

  const encodedCommand = url.pathname.slice('/execute/'.length);
  return decodeURIComponent(encodedCommand).trim() || undefined;
}

function getArgs(url: URL, body: Record<string, unknown>): unknown[] {
  const bodyArgs = body.args;

  if (Array.isArray(bodyArgs)) {
    return reviveCommandArgs(bodyArgs);
  }

  const queryArgs = url.searchParams.get('args');
  if (queryArgs) {
    const parsed = JSON.parse(queryArgs) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('The args parameter must be a JSON array.');
    }

    return reviveCommandArgs(parsed);
  }

  const queryArgValues = url.searchParams.getAll('arg');
  if (queryArgValues.length > 0) {
    return queryArgValues.map((value) => reviveStringArg(value));
  }

  const params = getPassthroughParams(url);
  return Object.keys(params).length > 0 ? [params] : [];
}

function getPassthroughParams(url: URL): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  for (const [key, value] of url.searchParams) {
    if (key === 'command') {
      continue;
    }

    const existing = params[key];
    const revivedValue = reviveStringArg(value);

    if (existing === undefined) {
      params[key] = revivedValue;
    } else if (Array.isArray(existing)) {
      existing.push(revivedValue);
    } else {
      params[key] = [existing, revivedValue];
    }
  }

  return params;
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
