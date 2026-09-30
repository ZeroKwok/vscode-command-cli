# VS Code Command CLI

A VS Code extension and Go client for triggering VS Code commands from a terminal. Requests are delivered through an extension-specific URI handler to the foremost VS Code window.

一个由 VS Code 扩展和 Go 客户端组成的命令行工具：终端请求通过扩展专属 URI Handler 投递给最前方的 VS Code 窗口。

## Quick Start

`Justfile` is the primary entry point:

```powershell
just
just check
just build
just install
```

`just build` writes both `bin\code-cli.exe` and `bin\vscode-command-cli.vsix`. `just install` only installs that VSIX through `code`; it does not copy the CLI outside this project. Reload VS Code windows after installation. Override the VS Code CLI when needed:

```powershell
$env:VSCODE_CLI = 'code-insiders'
just install
```

## Architecture

```text
code-cli.exe -> vscode://zero.vscode-command-cli/v1/execute -> foremost VS Code window
```

The extension does not listen on an HTTP port and does not inject terminal environment variables. The Go client encodes the command payload, opens the URI, and owns any temporary callback listener.

扩展不监听 HTTP 端口，也不注入终端环境变量。Go 客户端负责编码命令、打开 URI，并在需要返回值时临时创建回调监听器。

## Build The Client

Build the Windows client:

```powershell
just build-cli
```

This produces `bin\code-cli.exe`. Add `bin` to `PATH`, or point wrappers to it with `VSCODE_COMMAND_CLI_BIN`.

```powershell
$env:VSCODE_COMMAND_CLI_BIN = 'H:\Sandbox\Development\vscode-command-cli\bin\code-cli.exe'
```

The source is in `cli` and only uses the Go standard library. Build a client for another platform directly with `go build` and an appropriate output name.

## Usage

Send a one-way command:

```powershell
.\bin\code-cli.exe workbench.action.showCommands
.\bin\code-cli.exe git.openRepository "fsPath:H:\Sandbox\Development\todolist"
```

Wait for a JSON result:

```powershell
.\bin\code-cli.exe --wait some.extension.command 'json:{"foo":"bar"}'
```

`--wait` starts a temporary `127.0.0.1` callback server in `code-cli.exe`, embeds its URL, request ID, and random token in the URI request, then prints one JSON response to stdout. The extension POSTs the result to that callback after `executeCommand` completes. No VS Code instance port is exposed or injected.

Default timeout is 15 seconds. Override it when necessary:

```powershell
.\bin\code-cli.exe --wait --timeout 60s some.extension.command
```

The command result must be JSON-compatible. Returned `vscode.Uri` values are represented as `{ "$uri": "..." }`; circular objects, functions, symbols, and bigint values cannot be returned.

Stable VS Code uses the `vscode` URI scheme. Use `--uri-scheme vscode-insiders` or set `VSCODE_COMMAND_CLI_URI_SCHEME=vscode-insiders` for Insiders.

`scripts/code-git-open.sh` opens the Git repository at the current working directory. It checks `code-cli.exe` on `PATH` first, then this project's `bin\code-cli.exe`.

## Argument Rules

The first non-flag argument is the VS Code command ID; following arguments preserve their order. Strings support these conversion prefixes:

- `fsPath:<path>`: pass the path as a string after removing the prefix.
- `fileUri:<path>`: convert to `vscode.Uri.file(path)`.
- `uri:<uri>`: convert to `vscode.Uri.parse(uri)`.
- `json:<json>`: parse JSON and recursively restore URI marker objects.

Objects with `{ "$fsPath": "..." }` and `{ "$uri": "..." }` are restored to `vscode.Uri.file(...)` and `vscode.Uri.parse(...)` respectively.

## Multi-window Semantics

Each request is processed by the foremost VS Code window. It is not broadcast to every VS Code instance and is not pinned to the window that created an integrated terminal.

`--wait` is supported for local extension hosts. A VS Code Remote extension host cannot reach the local callback at `127.0.0.1`; use one-way mode or design a remote-aware broker for that scenario.

## Development And Verification

```powershell
just check
just build
```

Install the generated extension VSIX in a test VS Code instance, reload it, make that instance the foremost VS Code window, and run:

```powershell
.\bin\code-cli.exe workbench.action.showCommands
```

For a failing command or malformed payload, inspect the `VS Code Command CLI` output channel in the target window.

## Extension Packaging

```powershell
npm run package
```

Both build artifacts are in `bin`: `code-cli.exe` and `vscode-command-cli.vsix`.
