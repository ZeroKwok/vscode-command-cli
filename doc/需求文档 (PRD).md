# 需求文档 (PRD)：VS Code Command CLI 扩展

## 1. 项目背景与目标

VS Code 原生命令行工具 `code` 主要用于打开文件和文件夹，无法直接从外部终端触发 VS Code 内部命令，例如 `workbench.action.showCommands`、`git.openRepository` 等。

本项目目标是开发一个轻量级 VS Code 扩展，通过在 VS Code 扩展宿主内启动本地 HTTP 服务，桥接终端和 VS Code Command API，让用户可以在 Git Bash、PowerShell、macOS Terminal 等终端中调用 VS Code 内部命令。

核心目标：

- 允许终端通过 HTTP 请求触发 VS Code command。
- 支持多个 VS Code 实例同时运行，避免固定端口冲突。
- 支持将当前实例的服务地址注入到新建集成终端环境变量，优先照顾 Git Bash 使用体验。
- 保持实现轻量，不引入 Express 等大型 HTTP 框架。

## 2. 核心功能需求

### 2.1 后台本地服务

- 扩展激活后自动启动一个本地 HTTP 服务。
- 服务只监听 `127.0.0.1`，不暴露到外部网络。
- 默认端口配置为 `0`，表示由操作系统自动分配可用端口。
- 用户可以在 VS Code Settings 中将端口固定为具体值，例如 `3005`。
- 当 VS Code 窗口关闭或扩展停用时，服务应自动关闭并释放端口。
- 当固定端口被占用时，扩展应显示错误提示并写入日志，不应导致 VS Code 崩溃。

### 2.2 终端环境变量注入

扩展启动 HTTP 服务并确定实际监听端口后，应通过 VS Code `EnvironmentVariableCollection` 给后续新建的集成终端注入：

- `VSCODE_COMMAND_CLI_PORT`: 当前 VS Code 窗口监听的端口。
- `VSCODE_COMMAND_CLI_URL`: 当前 VS Code 窗口的完整服务地址，例如 `http://127.0.0.1:51234`。

约束：

- 环境变量只要求影响新建终端。
- 已经打开的终端不需要自动更新。
- Git Bash 是主要使用场景，helper 脚本应优先读取 `VSCODE_COMMAND_CLI_URL`。

### 2.3 通用命令执行 API

服务需要暴露通用 API：

- `GET /execute?command=<commandId>`
- `GET /execute/<commandId>`
- `POST /execute`

内部执行逻辑：

```typescript
vscode.commands.executeCommand(command, ...args);
```

设计原则：

- 插件只负责把 URL 或 POST body 中的参数转发给 VS Code command。
- 插件不针对某个命令做特化逻辑。
- 插件不校验参数是否适用于目标命令；参数合法性由 VS Code command 自身决定。

### 2.4 GET 参数规则

命令 ID 可以通过以下任一方式传入：

```bash
curl --get --data-urlencode "command=workbench.action.showCommands" "$VSCODE_COMMAND_CLI_URL/execute"
```

```bash
curl --get "$VSCODE_COMMAND_CLI_URL/execute/workbench.action.showCommands"
```

位置参数通过重复的 `arg` 参数传入，顺序保持不变：

```bash
curl --get \
  --data-urlencode "command=git.openRepository" \
  --data-urlencode "arg=fsPath:H:\Sandbox\Development\todolist" \
  "$VSCODE_COMMAND_CLI_URL/execute"
```

参数前缀规则：

- 默认值：字符串。
- `fsPath:<path>`：去掉前缀后作为路径字符串传递。
- `fileUri:<path>`：转换为 `vscode.Uri.file(path)`。
- `uri:<uri>`：转换为 `vscode.Uri.parse(uri)`。
- `json:<json>`：转换为 JSON 值。

其他 query 参数在没有 `arg` 或 `args` 时，可作为单个对象参数透传。

### 2.5 POST 参数规则

`POST /execute` 支持 JSON body：

```json
{
  "command": "git.openRepository",
  "args": ["H:\\Sandbox\\Development\\todolist"]
}
```

当需要传递 VS Code `Uri` 时，支持特殊对象：

```json
{
  "command": "vscode.open",
  "args": [
    {
      "$fsPath": "H:\\Sandbox\\Development\\todolist\\README.md"
    }
  ]
}
```

特殊对象规则：

- `{ "$fsPath": "..." }` 转换为 `vscode.Uri.file(...)`。
- `{ "$uri": "..." }` 转换为 `vscode.Uri.parse(...)`。

### 2.6 Helper 脚本

扩展需要提供简单的终端 helper 脚本：

- `scripts/vscode-command-cli.sh`
- `scripts/vscode-command-cli.ps1`

脚本行为：

- 优先读取 `VSCODE_COMMAND_CLI_URL`。
- 如果没有 URL，则读取 `VSCODE_COMMAND_CLI_PORT` 并拼接 `http://127.0.0.1:<port>`。
- 如果两个环境变量都不存在，则回退到 `http://127.0.0.1:3005`。

Git Bash 示例：

```bash
./scripts/vscode-command-cli.sh workbench.action.showCommands
./scripts/vscode-command-cli.sh git.openRepository 'fsPath:H:\Sandbox\Development\todolist'
```

PowerShell 示例：

```powershell
.\scripts\vscode-command-cli.ps1 workbench.action.showCommands
.\scripts\vscode-command-cli.ps1 git.openRepository "fsPath:H:\Sandbox\Development\todolist"
```

## 3. 配置项

在 `package.json` 的 `contributes.configuration` 中提供：

- `vscodeCommandCli.serverPort`
  - 类型：number
  - 默认值：`0`
  - 范围：`0` 到 `65535`
  - 含义：HTTP 服务端口。`0` 表示动态端口。

- `vscodeCommandCli.enableLog`
  - 类型：boolean
  - 默认值：`true`
  - 含义：是否在 Output Channel 中输出请求和服务生命周期日志。

## 4. 技术方案

- 开发语言：TypeScript。
- VS Code API：`vscode.commands.executeCommand`、`vscode.ExtensionContext.environmentVariableCollection`。
- HTTP 服务：Node.js 原生 `http` 模块。
- 不引入 Express。
- 打包工具：`@vscode/vsce`。
- 输出文件：`out/extension.js`。

## 5. 验收标准

1. 启动扩展后，Output Channel 能看到服务启动日志，且日志包含实际监听 URL。
2. 在 Extension Development Host 中新建 Git Bash 终端后，能读取到：

   ```bash
   echo "$VSCODE_COMMAND_CLI_URL"
   echo "$VSCODE_COMMAND_CLI_PORT"
   ```

3. 在新建 Git Bash 中运行以下命令，VS Code 应弹出命令面板：

   ```bash
   curl --get --data-urlencode "command=workbench.action.showCommands" "$VSCODE_COMMAND_CLI_URL/execute"
   ```

4. 在新建 Git Bash 中运行以下命令，VS Code 应打开指定 Git 仓库，而不是弹出目录选择对话框：

   ```bash
   curl --get \
     --data-urlencode "command=git.openRepository" \
     --data-urlencode "arg=fsPath:H:\Sandbox\Development\todolist" \
     "$VSCODE_COMMAND_CLI_URL/execute"
   ```

5. 同时启动多个 VS Code 实例时，默认动态端口不应冲突。
6. 如果用户将 `vscodeCommandCli.serverPort` 固定为已被占用的端口，扩展应提示错误，不应导致 VS Code 崩溃。
7. 传入不存在的命令，例如 `invalid.command`，终端应收到 JSON 错误响应，VS Code 不应崩溃。
8. 执行 `npm run compile` 应通过。
9. 执行 `npm run package` 应生成 VSIX，且 VSIX 中只包含运行所需文件。

## 6. 打包与发布要求

- `package.json` 应包含基本扩展元数据，例如 `name`、`displayName`、`description`、`version`、`publisher`、`license`、`engines`。
- 项目应包含 `LICENSE`。
- `.vscodeignore` 应排除源码、开发配置、PRD、source map、已有 VSIX 等非运行必要文件。
- 如果没有真实 repository 地址，本地打包脚本可使用 `vsce package --allow-missing-repository`。
