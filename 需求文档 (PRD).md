# 🛠️ 需求文档 (PRD)：VS Code Command CLI 扩展

## 1. 项目背景与目标

当前 VS Code 原生 CLI (`code` 命令) 仅支持打开文件和文件夹，无法直接从外部系统命令行（如 Git Bash, macOS Terminal）触发 VS Code 内部的面板命令（例如 `git.openRepository`）。
本项目的目标是开发一个 VS Code 扩展，通过**在后台运行轻量级本地 HTTP 服务**的机制，桥接系统命令行与 VS Code 内部命令 API，实现“在终端控制 VS Code 面板指令”的功能。

---

## 2. 核心功能需求

### 功能一：后台本地服务器 (Background Local Server)

* **启动时机**：当 VS Code 激活（Activation）时，插件自动在后台启动一个轻量级的 HTTP 服务器。
* **默认配置**：默认监听本地 `127.0.0.1`，默认端口为 `3005`（端口可在 VS Code Settings 中自定义，避免冲突）。
* **生命周期**：随着 VS Code 窗口的关闭，服务器自动关闭并释放端口。

### 功能二：命令触发接口 (Command Execution API)

* 服务器需要暴露一个专用的 API 路由：`POST /execute` 或 `GET /execute`。
* **请求参数**：接受一个名为 `command` 的参数（字符串类型），对应 VS Code 的内部 Command ID（例如 `git.openRepository`）。
* **内部执行**：服务器解析到参数后，调用 VS Code 插件核心 API：

```typescript
vscode.commands.executeCommand(commandId, ...args);
```

* **响应状态**：
* 执行成功：返回 HTTP 200 及成功状态。
* 命令不存在/执行失败：返回 HTTP 500 及错误日志。

### 功能三：提供终端客户端脚本 (CLI Client Helper)

* 在插件的根目录或文档中，提供一个简单的 Shell 脚本（或给用户的 `alias` 示例），方便用户在 Git Bash 中一键调用。
* **终端调用示例**：

```bash
curl -X POST http://127.0.0.1:3005/execute?command=git.openRepository

```

---

## 3. 技术方案与依赖

* **开发语言**：TypeScript / JavaScript
* **VS Code API 核心方法**：`vscode.commands.executeCommand`
* **依赖库**：为了保持插件极简和轻量，尽量使用 Node.js 原生的 `http` 模块创建服务器，避免引入庞大的 `express` 依赖。

---

## 4. 扩展配置项 (package.json - Contributions)

允许用户在 VS Code 设置中调整以下参数：

* `vscodeCommandCli.serverPort`: 整数型，默认值 `3005`，代表服务监听的端口。
* `vscodeCommandCli.enableLog`: 布尔型，默认 `true`，是否在 VS Code 输出面板（Output Channel）打印请求日志。

---

## 5. 验收标准 (Acceptance Criteria)

1. **基础验证**：启动 VS Code 后，使用 `curl` 运行 `curl http://127.0.0.1:3005/execute?command=workbench.action.showCommands`，VS Code 应立即弹出命令面板。
2. **目标验证**：在 Git Bash 中运行 `curl http://127.0.0.1:3005/execute?command=git.openRepository`，VS Code 应弹出选择 Git 仓库的对话框。
3. **异常处理**：若传入不存在的命令（如 `invalid.command`），终端应能收到错误反馈，且 VS Code 自身不崩溃。
