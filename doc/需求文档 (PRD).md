# 需求文档 (PRD)：VS Code Command CLI

## 1. 目标

提供一个终端到 VS Code Command API 的客户端协议，使命令始终投递给最前方的 VS Code 窗口，并支持可选的结果返回。

系统由两部分组成：

- VS Code 扩展：注册扩展专属 URI Handler，在目标窗口执行命令。
- `code-cli.exe`：Go 实现的跨平台客户端，统一负责命令编码、URI 唤起、等待与回调验证。

不再由 VS Code 实例监听端口，也不通过 `EnvironmentVariableCollection` 将端口注入集成终端。

`Justfile` 是用户的统一入口，提供 `check`、`build`、`install`、`build-extension`、`install-extension` 和 `build-cli`。构建产物统一位于项目 `bin`：`code-cli.exe` 和 `vscode-command-cli.vsix`。`install` 仅通过 `VSCODE_CLI`（默认 `code`）安装 VSIX，不复制 CLI 到项目外部。

## 2. 传输协议

### 2.1 命令投递

```text
code-cli.exe -> vscode://zero.vscode-command-cli/v1/execute?p=<Base64URL JSON>
```

URI 使用 VS Code 的系统级路由。多个窗口存在时，最前方窗口处理 URI；同一请求不广播。

JSON 载荷：

```json
{
  "version": 1,
  "command": "git.openRepository",
  "args": ["fsPath:H:\\Sandbox\\Development\\todolist"]
}
```

### 2.2 可选结果回调

调用 `code-cli.exe --wait` 时，客户端临时在 `127.0.0.1:0` 启动 HTTP callback server，并将以下对象加入 URI 载荷：

```json
{
  "reply": {
    "requestId": "base64url-random-id",
    "token": "base64url-random-token",
    "url": "http://127.0.0.1:51234/v1/result/<requestId>"
  }
}
```

扩展等待执行完成：

```typescript
const result = await vscode.commands.executeCommand(command, ...args);
```

随后仅向该 URL POST 一次结果：

```json
{
  "version": 1,
  "requestId": "base64url-random-id",
  "ok": true,
  "result": {}
}
```

失败时返回 `ok: false` 和 `error`。客户端校验 URL 路径、随机 token、请求 ID 和协议版本后关闭监听器。

CLI 对用户输出时封装为两层。只有成功收到有效扩展回调时才包含 `vscode`：

```json
{
  "cli": { "ok": true },
  "vscode": { "ok": true, "result": {} }
}
```

命令没有返回值时省略 `vscode.result`。如果 CLI 无法打开 URI、无法创建 callback 或等待超时，则只输出 `cli` 层错误：

```json
{
  "cli": {
    "ok": false,
    "error": { "code": "timeout", "message": "Timed out after 15s." }
  }
}
```

### 2.3 安全约束

- 扩展只接受回调到 `http://127.0.0.1:<port>` 的显式端口地址，避免 URI 请求将扩展用作任意网络访问代理。
- 客户端使用加密随机的请求 ID 与 token；无效或重复回调被拒绝。
- 结果最大为 1 MiB。
- 扩展不提供长期运行的 HTTP 服务。

## 3. CLI 行为

```text
code-cli [--wait] [--timeout 15s] [--uri-scheme vscode] <vscode.commandId> [arg...]
```

- 默认模式：打开 URI 后立即退出。
- `--wait`：等待命令完成并输出分层 JSON 结果；不设置 `--timeout` 时无限等待。
- `--timeout`：仅在 `--wait` 下生效；超时时只返回 CLI 层错误。
- `--uri-scheme`：支持 Stable 的 `vscode` 与 Insiders 的 `vscode-insiders`。

其他快捷脚本不应实现 JSON、Base64URL、操作系统 URL 调用或 HTTP 回调；它们只需调用 `code-cli`。

## 4. 参数与结果

输入字符串继续支持：

- `fsPath:<path>`
- `fileUri:<path>`
- `uri:<uri>`
- `json:<json>`

扩展把 `{ "$fsPath": "..." }` 和 `{ "$uri": "..." }` 还原为 VS Code `Uri`。

返回值必须可序列化为 JSON。`vscode.Uri` 返回 `{ "$uri": "..." }`；循环引用与不可序列化值会作为客户端可见错误返回。

## 5. 限制

- 目标始终是最前方 VS Code 窗口，不能指定后台窗口。
- `--wait` 只适用于本地扩展宿主。Remote/SSH/WSL 扩展宿主无法直接访问调用方本机 `127.0.0.1` callback。
- URI 不适合大载荷或流式结果；这类需求应使用独立 broker。

## 6. 验收标准

1. `code-cli.exe workbench.action.showCommands` 在最前方 VS Code 窗口打开命令面板。
2. 多窗口情况下，同一请求仅由最前方窗口处理。
3. `--wait` 创建随机本地 callback，在命令完成后输出 `cli` 与 `vscode` 分层 JSON，并停止监听。
4. 无效 token、错误路径、重复 callback 和超时均返回 CLI 层错误，不执行额外操作。
5. `code-git-open.sh` 等快捷脚本可复用同一个 `code-cli.exe`。
6. `npm run compile`、`npm run lint`、`npm run build:client` 和 `npm run test:client` 全部通过。
