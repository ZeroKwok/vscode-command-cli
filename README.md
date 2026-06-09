# VS Code Command CLI

一个轻量级 VS Code 扩展：在扩展激活后启动本地 HTTP 服务，让终端可以通过 `curl` 触发 VS Code 内部命令。

## 功能

- 默认监听 `127.0.0.1` 的动态端口，避免多个 VS Code 实例端口冲突
- 暴露 `GET /execute?command=<commandId>` 和 `POST /execute`
- 内部调用 `vscode.commands.executeCommand(command, ...args)`
- 支持把端口和服务地址注入到 VS Code 新建终端的环境变量
- 支持在 VS Code Settings 中配置固定端口和日志
- 随 VS Code 扩展宿主关闭自动释放端口

## 配置项

- `vscodeCommandCli.serverPort`: 服务端口，默认 `0`。`0` 表示由系统自动分配可用端口；如果你想固定端口，可以设置为 `3005` 等具体端口。
- `vscodeCommandCli.enableLog`: 是否写入 Output Channel，默认 `true`。

## 终端环境变量

扩展启动服务后，会给 VS Code 后续新建的集成终端注入：

- `VSCODE_COMMAND_CLI_PORT`: 当前窗口实际监听端口
- `VSCODE_COMMAND_CLI_URL`: 当前窗口服务地址，例如 `http://127.0.0.1:51234`

注意：VS Code 的环境变量集合只影响新建终端。已经打开的终端不会自动获得新变量，需要关闭后重新创建。Git Bash 也一样，只要是 VS Code 里新开的 Git Bash 终端，就会拿到这些变量。

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

4. 在 Extension Development Host 中新建一个 Git Bash 终端，确认环境变量：

   ```bash
   echo "$VSCODE_COMMAND_CLI_URL"
   echo "$VSCODE_COMMAND_CLI_PORT"
   ```

5. 验证命令面板：

   ```bash
   curl --get --data-urlencode "command=workbench.action.showCommands" "$VSCODE_COMMAND_CLI_URL/execute"
   ```

## 通用参数转发

插件只做一件事：从 URL 或 POST body 中读出 VS Code command id 和参数，然后调用：

```typescript
vscode.commands.executeCommand(command, ...args)
```

插件不会判断参数对这个命令是否合法。

### GET 写法

无参数命令：

```bash
curl --get --data-urlencode "command=workbench.action.showCommands" "$VSCODE_COMMAND_CLI_URL/execute"
```

带位置参数。多个 `arg` 会按 URL 中出现的顺序传入：

```bash
curl --get \
  --data-urlencode "command=git.openRepository" \
  --data-urlencode "arg=fsPath:H:\Sandbox\Development\todolist" \
  "$VSCODE_COMMAND_CLI_URL/execute"
```

也可以把命令 ID 放在路径里：

```bash
curl --get \
  --data-urlencode "arg=fsPath:H:\Sandbox\Development\todolist" \
  "$VSCODE_COMMAND_CLI_URL/execute/git.openRepository"
```

如果你手动配置了固定端口，也可以直接写完整 URL：

```bash
curl --get \
  --data-urlencode "command=workbench.action.showCommands" \
  "http://127.0.0.1:3005/execute"
```

### 参数类型

URL 参数默认作为字符串传递。特殊前缀会转换参数：

- `fsPath:<path>`: 去掉前缀后作为路径字符串传递
- `fileUri:<path>`: 转成 `vscode.Uri.file(path)`
- `uri:<uri>`: 转成 `vscode.Uri.parse(uri)`
- `json:<json>`: 转成 JSON 值

例如打开指定 Git 仓库：

```bash
curl --get \
  --data-urlencode "command=git.openRepository" \
  --data-urlencode "arg=fsPath:H:\Sandbox\Development\todolist" \
  "$VSCODE_COMMAND_CLI_URL/execute"
```

`git.openRepository` 需要的是路径字符串，所以这里使用 `fsPath:` 或直接传路径都可以；不要使用 `fileUri:`。

### POST 写法

也可以传 JSON body：

```bash
curl -X POST "$VSCODE_COMMAND_CLI_URL/execute" \
  -H "Content-Type: application/json" \
  -d '{"command":"git.openRepository","args":["H:\\Sandbox\\Development\\todolist"]}'
```

如果某个命令需要 VS Code `Uri`，可以传：

```bash
curl -X POST "$VSCODE_COMMAND_CLI_URL/execute" \
  -H "Content-Type: application/json" \
  -d '{"command":"vscode.open","args":[{"$fsPath":"H:\\Sandbox\\Development\\todolist\\README.md"}]}'
```

## Helper 脚本

Git Bash / macOS / Linux:

```bash
./scripts/vscode-command-cli.sh workbench.action.showCommands
./scripts/vscode-command-cli.sh git.openRepository 'fsPath:H:\Sandbox\Development\todolist'
```

PowerShell:

```powershell
.\scripts\vscode-command-cli.ps1 workbench.action.showCommands
.\scripts\vscode-command-cli.ps1 git.openRepository "fsPath:H:\Sandbox\Development\todolist"
```

脚本会优先读取 `VSCODE_COMMAND_CLI_URL`，其次读取 `VSCODE_COMMAND_CLI_PORT`，最后才回退到 `http://127.0.0.1:3005`。

## 打包

```bash
npm run package
```

生成的 `.vsix` 可以通过 VS Code 的 `Extensions: Install from VSIX...` 安装。
