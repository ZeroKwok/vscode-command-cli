import * as http from 'node:http';
import { URL } from 'node:url';
import * as vscode from 'vscode';

const CONFIG_SECTION = 'vscodeCommandCli';
const HOST = '127.0.0.1';

let server: http.Server | undefined;
let output: vscode.OutputChannel;
let currentPort: number | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
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
  currentPort = port;

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

  if (requestUrl.pathname !== '/execute') {
    sendJson(response, 404, { ok: false, error: 'Route not found. Use /execute?command=<commandId>.' });
    return;
  }

  try {
    const body = request.method === 'POST' ? await readJsonBody(request) : {};
    const command = getStringParam(requestUrl, body, 'command');
    const args = getArgs(requestUrl, body);

    if (!command) {
      sendJson(response, 400, { ok: false, error: 'Missing required parameter: command.' });
      return;
    }

    log(`Executing command: ${command}${args.length > 0 ? ` args=${JSON.stringify(args)}` : ''}`);
    await vscode.commands.executeCommand(command, ...args);
    sendJson(response, 200, { ok: true, command });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Execution failed: ${message}`);
    sendJson(response, 500, { ok: false, error: message });
  }
}

function getPort(): number {
  const configuredPort = vscode.workspace.getConfiguration(CONFIG_SECTION).get<number>('serverPort', 3005);

  if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
    return 3005;
  }

  return configuredPort;
}

function serverUrl(): string {
  return `http://${HOST}:${currentPort ?? getPort()}`;
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

function getArgs(url: URL, body: Record<string, unknown>): unknown[] {
  const bodyArgs = body.args;

  if (Array.isArray(bodyArgs)) {
    return bodyArgs;
  }

  const queryArgs = url.searchParams.get('args');
  if (!queryArgs) {
    return [];
  }

  const parsed = JSON.parse(queryArgs) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('The args parameter must be a JSON array.');
  }

  return parsed;
}
