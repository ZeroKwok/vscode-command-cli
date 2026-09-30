# 需求文档 (PRD)：VS Code Command CLI 扩展

## 1. 项目背景与目标

VS Code 原生命令行工具 `code` 主要用于打开文件和工作区，不能将任意参数直接分发给扩展命令。本扩展提供一个扩展专属 URI Handler，使 Git Bash、PowerShell、macOS Terminal 等终端可触发 VS Code 内部命令。

核心目标：

- 通过 `vscode://zero.vscode-command-cli/v1/execute` 协议入口触发 VS Code command。
- 多个 VS Code 实例同时存在时，只由最前方窗口处理消息。
- 不启动本地 HTTP 服务，不分配或扫描端口，不注入终端环境变量。
- 以 Base64URL JSON 载荷跨越 Shell 与 URI 的转义边界，并保持参数顺序和类型转换规则。

## 2. 核心功能需求

### 2.1 URI Handler

- 扩展注册唯一的 `vscode.window.registerUriHandler`。
- 扩展必须声明 `onUri` 激活事件，以便 URI 到达时尚未运行的扩展可以被激活。
- URI scheme 使用 `vscode.env.uriScheme`；Stable 通常为 `vscode`，Insiders 通常为 `vscode-insiders`。
- URI authority 必须为扩展 ID `zero.vscode-command-cli`。
- 仅处理路径 `/v1/execute`。
- 多窗口情况下使用 VS Code 的系统级路由语义：最前方窗口处理 URI，不广播。

### 2.2 载荷协议

请求 URI：

```text
vscode://zero.vscode-command-cli/v1/execute?p=<Base64URL JSON>
```

解码后的 JSON：

```json
{
  "command": "git.openRepository",
  "args": ["H:\\Sandbox\\Development\\todolist"]
}
```

约束：

- `command` 为非空字符串。
- `args` 缺失时视为空数组；存在时必须是数组。
- `p` 只允许未填充的 Base64URL 字符集，扩展限制载荷长度，拒绝非法 JSON。
- URI 调用是异步单向的，调用端不获得命令执行结果。

### 2.3 通用命令执行 API

内部执行逻辑：

```typescript
vscode.commands.executeCommand(command, ...args);
```

插件负责解码、结构校验和参数转换，不针对具体 VS Code command 做特化。

兼容的字符串参数前缀：

- `fsPath:<path>`：去掉前缀后作为路径字符串。
- `fileUri:<path>`：转换为 `vscode.Uri.file(path)`。
- `uri:<uri>`：转换为 `vscode.Uri.parse(uri)`。
- `json:<json>`：解析为 JSON 值，并递归执行 `Uri` 特殊对象转换。

特殊对象：

- `{ "$fsPath": "..." }` 转换为 `vscode.Uri.file(...)`。
- `{ "$uri": "..." }` 转换为 `vscode.Uri.parse(...)`。

### 2.4 Helper 脚本

扩展提供：

- `scripts/vscode-command-cli.sh`
- `scripts/vscode-command-cli.ps1`

脚本接受 `<vscode.commandId> [arg...]`，构造 JSON 载荷并交给操作系统打开 URI。它们不读取 `VSCODE_COMMAND_CLI_PORT`、`VSCODE_COMMAND_CLI_URL`，也不回退到任何 HTTP 地址。

Git Bash / macOS / Linux 脚本使用 `node` 编码 JSON；PowerShell 使用 .NET UTF-8 和 Base64 API。两者通过 `VSCODE_COMMAND_CLI_URI_SCHEME` 或 PowerShell `-UriScheme` 支持 Insiders。

## 3. 配置项

- `vscodeCommandCli.enableLog`
  - 类型：`boolean`
  - 默认值：`true`
  - 含义：是否在 `VS Code Command CLI` 输出通道中记录 URI 接收、命令执行与错误。

不再提供端口配置。

## 4. 技术方案

- 开发语言：TypeScript。
- VS Code API：`vscode.window.registerUriHandler`、`vscode.commands.executeCommand`、`vscode.env.uriScheme`。
- 不使用 Node.js HTTP 服务、`EnvironmentVariableCollection` 或 Express。
- 打包工具：`@vscode/vsce`。
- 输出文件：`out/extension.js`。

## 5. 验收标准

1. 扩展激活后，输出通道记录 URI endpoint 已就绪。
2. 从集成或外部终端调用 helper 脚本时，最前方 VS Code 窗口弹出命令面板。
3. 同时打开多个 VS Code 实例时，同一请求只由最前方窗口接收。
4. 使用 `fsPath:` 调用 `git.openRepository` 时，目标窗口打开指定 Git 仓库。
5. `json:`、`$fsPath` 与 `$uri` 参数能正确还原为预期类型。
6. 无效路径、无效 Base64URL 载荷、非法 JSON 或缺失 command 不导致 VS Code 崩溃，错误显示在目标窗口并记录到输出通道。
7. Helper 脚本不依赖端口或 `VSCODE_COMMAND_CLI_*` 环境变量。
8. 执行 `npm run compile` 通过。
9. 执行 `npm run package` 生成可安装的 VSIX。

## 6. 限制

- 不能要求消息回到启动脚本的某个特定后台 VS Code 窗口；目标始终是最前方窗口。
- 外部调用端不会同步取得 command 的返回值或异常。
- URI 不适合作为大载荷传输机制；大数据应改为文件引用或另行设计通信协议。
