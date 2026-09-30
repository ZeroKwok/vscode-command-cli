# VS Code Command CLI

A lightweight VS Code extension that triggers VS Code commands from an external terminal through an extension-specific URI handler.

一个轻量级 VS Code 扩展：通过扩展专属 URI Handler，让外部终端触发当前最前方 VS Code 窗口中的内部命令。

## 工作方式

helper 脚本将命令 ID 和位置参数序列化为 JSON，并使用 Base64URL 编码为以下 URI：

```text
vscode://zero.vscode-command-cli/v1/execute?p=<Base64URL JSON>
```

操作系统将 URI 交给 VS Code；当存在多个 VS Code 窗口时，由最前方窗口中的扩展处理。扩展随即调用：

```typescript
vscode.commands.executeCommand(command, ...args)
```

该机制不启动 HTTP 服务、不监听端口，也不向集成终端注入环境变量。调用是异步单向的：脚本成功打开 URI 不代表目标命令一定执行成功；执行日志和错误显示在目标 VS Code 窗口的 `VS Code Command CLI` 输出通道中。

## 参数规则

脚本的第一个参数是 VS Code command ID，后续参数按顺序作为 command arguments 传递。字符串参数兼容以下转换前缀：

- `fsPath:<path>`: 去掉前缀后作为路径字符串传递。
- `fileUri:<path>`: 转换为 `vscode.Uri.file(path)`。
- `uri:<uri>`: 转换为 `vscode.Uri.parse(uri)`。
- `json:<json>`: 解析为 JSON 值。

例如，`git.openRepository` 需要路径字符串，因此使用 `fsPath:` 或直接传入路径；它不应接收 `fileUri:`。

## Helper 脚本

Git Bash / macOS / Linux：

```bash
./scripts/vscode-command-cli.sh workbench.action.showCommands
./scripts/vscode-command-cli.sh git.openRepository 'fsPath:H:\Sandbox\Development\todolist'
./scripts/vscode-command-cli.sh myPlugin.handleMessage 'json:{"foo":"bar"}'
```

Shell 脚本使用 `node` 将命令和参数编码为 Base64URL，因此要求 `node` 在 `PATH` 中。

PowerShell：

```powershell
.\scripts\vscode-command-cli.ps1 workbench.action.showCommands
.\scripts\vscode-command-cli.ps1 git.openRepository "fsPath:H:\Sandbox\Development\todolist"
.\scripts\vscode-command-cli.ps1 myPlugin.handleMessage 'json:{"foo":"bar"}'
```

Stable VS Code 默认使用 `vscode` URI scheme。若使用 VS Code Insiders，可通过参数或环境变量指定 `vscode-insiders`：

```powershell
.\scripts\vscode-command-cli.ps1 workbench.action.showCommands -UriScheme vscode-insiders
```

```bash
VSCODE_COMMAND_CLI_URI_SCHEME=vscode-insiders ./scripts/vscode-command-cli.sh workbench.action.showCommands
```

URI 的 authority 固定为扩展 ID `zero.vscode-command-cli`。使用命令面板中的 `VS Code Command CLI: Copy URI Endpoint` 可以复制当前 VS Code 发行版对应的 URI endpoint。

## 多窗口语义

消息始终发送到最前方的 VS Code 窗口，而非启动脚本的集成终端所属窗口。这个语义同时适用于 VS Code 集成终端和外部终端；不会向多个 VS Code 实例广播。

URI Handler 不提供 HTTP 风格的同步响应，也不适合传输很大的载荷。需要同步结果、或必须路由到后台指定窗口的场景，需要另行设计带实例标识的通信协议。

## 本地开发和调试

1. 安装依赖：

   ```bash
   npm install
   ```

2. 编译：

   ```bash
   npm run compile
   ```

3. 在 VS Code 中打开本目录，按 `F5` 并选择 `Run Extension`，启动 Extension Development Host。

4. 使 Extension Development Host 成为最前方窗口，再从任意终端运行：

   ```bash
   ./scripts/vscode-command-cli.sh workbench.action.showCommands
   ```

   或：

   ```powershell
   .\scripts\vscode-command-cli.ps1 workbench.action.showCommands
   ```

5. 验证命令面板在最前方的 Extension Development Host 中打开。传入错误的 URI payload 或命令参数时，在该窗口的 `VS Code Command CLI` 输出通道中查看错误。

## 配置项

- `vscodeCommandCli.enableLog`: 是否写入 `VS Code Command CLI` 输出通道，默认 `true`。

## 打包

```bash
npm run package
```

生成的 `.vsix` 可以通过 VS Code 的 `Extensions: Install from VSIX...` 安装。
