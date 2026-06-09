# VS Code Command CLI

一个轻量级 VS Code 扩展：在扩展激活后启动本地 HTTP 服务，让外部终端可以通过 `curl` 触发 VS Code 内部命令。

## 功能

- 默认监听 `127.0.0.1:3005`
- 暴露 `GET /execute?command=<commandId>` 和 `POST /execute`
- 内部调用 `vscode.commands.executeCommand(commandId, ...args)`
- 支持在 VS Code Settings 中配置端口和日志
- 随 VS Code 扩展宿主关闭自动释放端口

## 配置项

- `vscodeCommandCli.serverPort`: 服务端口，默认 `3005`
- `vscodeCommandCli.enableLog`: 是否写入 Output Channel，默认 `true`

## 本地开发和调试

1. 安装依赖：

   ```bash
   npm install
   ```

2. 编译：

   ```bash
   npm run compile
   ```

3. 在 VS Code 中打开本目录，按 `F5`，选择 `Run Extension`。这会启动一个 Extension Development Host 窗口。

4. 在新窗口打开后，用终端验证：

   ```bash
   curl "http://127.0.0.1:3005/execute?command=workbench.action.showCommands"
   ```

   VS Code 应弹出命令面板。

5. 验证 Git 命令：

   ```bash
   curl "http://127.0.0.1:3005/execute?command=git.openRepository"
   ```

6. 验证异常处理：

   ```bash
   curl "http://127.0.0.1:3005/execute?command=invalid.command"
   ```

   终端会收到 JSON 错误响应，VS Code 不会崩溃。

## POST 示例

```bash
curl -X POST "http://127.0.0.1:3005/execute" \
  -H "Content-Type: application/json" \
  -d '{"command":"workbench.action.showCommands"}'
```

如果命令需要参数，可以传入 JSON 数组：

```bash
curl -X POST "http://127.0.0.1:3005/execute" \
  -H "Content-Type: application/json" \
  -d '{"command":"vscode.open","args":["file:///path/to/file.txt"]}'
```

## Helper 脚本

Git Bash / macOS / Linux:

```bash
./scripts/vscode-command-cli.sh workbench.action.showCommands
```

PowerShell:

```powershell
.\scripts\vscode-command-cli.ps1 -Command workbench.action.showCommands
```

也可以设置端口环境变量：

```bash
export VSCODE_COMMAND_CLI_PORT=3006
```

## 打包

安装依赖后运行：

```bash
npm run package
```

生成的 `.vsix` 可以通过 VS Code 的 `Extensions: Install from VSIX...` 安装。
