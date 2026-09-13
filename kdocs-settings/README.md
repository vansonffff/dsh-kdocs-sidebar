# kdocs-settings

DeepSeek Harness 的可选插件：在 DSH 设置页加一个「金山文档 (kdocs)」**只读状态分区**。

**当前版本 v0.2.0** · 需要 DSH ≥ `0.1.5`（实测于 `0.1.5-rc.1`）· Node ≥ 22.19

它是 [`dsh-kdocs-inside`](../kdocs/README.md) 的**可选**配套插件。不装它，右栏、预览、引用和
Agent 工具都不受影响。

---

## 它做什么

只做一件事：显示核心插件上报的状态。

| 显示项 | 来源 |
|---|---|
| CLI 是否安装 | `KDocsStatus.cliAvailable` |
| 是否已登录 | `KDocsStatus.authenticated` |
| CLI 版本 | `KDocsStatus.cliVersion` |
| CLI 路径 | `KDocsStatus.cliPath` |
| 凭据来源 | `KDocsStatus.source`（如 `keychain`） |
| 系统钥匙串后端 | `KDocsStatus.keychainBackend` |
| 上次检查时间 | `KDocsStatus.checkedAt` |
| 失败原因 | 传输层错误，或 `KDocsStatus.reason` |
| 「刷新状态」按钮 | 再调一次 `remote.kdocs.status()` |

状态有四种，界面上互不混淆：

| 状态 | 判定 |
|---|---|
| 检查中 | 首次请求尚未返回 |
| CLI 未安装 | `cliAvailable === false`，并提示去装 CLI |
| 未登录 | CLI 可用但 `authenticated === false`，并给出 `kdocs-cli auth login` |
| 已登录 | `authenticated === true` |
| 检查失败 | 传输层或 Remote 调用失败（**不会**退化成"未登录"） |

## 它不做什么

这一版（0.2.0）把它从"认证管理器"收缩成了"状态面板"：

- **不发 OAuth 登录**；
- **不接收、不保存 Token**（`package.json` 里连凭据面依赖都没有）；
- **不执行退出登录**；
- **不读写 DSH Credentials**；
- **不自己探测或执行 `kdocs-cli`** —— 整套 CLI 访问只有一份，在 `dsh-kdocs-inside` 里。

需要登录、退出或换 Token，请在终端完成：

```bash
kdocs-cli auth login
kdocs-cli auth logout
kdocs-cli auth set-token -     # Token 走 stdin
```

## 数据从哪来

```text
kdocs-settings (client)
    ↓  remote.kdocs.status()
KDocsService
    ↓
KDocsCliProvider
    ↓  kdocs-cli auth status
```

Settings 不知道 CLI 叫什么、装在哪、怎么认证、输出长什么样。它只渲染 `KDocsStatus`。
**这也是这个包没有 host 半边的原因**：`dist/index.mjs` 只导出一个空的 `apply()`。

因为状态由核心 Provider 采集，而它默认缓存约 10 秒（`statusTtlMs`），所以：

- 「刷新状态」按钮**不保证**会重新执行 CLI；
- 连续点击刷新时，「上次检查」时间**不一定变化**，这是正常行为；
- 本版本没有"强制绕过缓存"的接口。

## 权限说明

状态面板本身没有任何写入能力：它只调 `remote.kdocs.status()`，一个只读方法。

需要分清的是两层：

- **插件层** —— `kdocs-settings` 只显示状态；核心插件的 4 个 Agent 工具也全部只读，
  不会创建、编辑或删除文档正文。
- **`kdocs-cli` / Agent 运行环境层** —— CLI 本身具备写入能力（创建、上传、修改、移动等）。
  如果 Agent 有权执行命令，它可以直接调用 CLI，而不经过这些只读工具。

也就是说，这两个插件都**不主动**向 Agent 暴露写入工具，但它们不是、也无法作为安全沙箱。
完整的权限说明见仓库根目录的 [`README.md`](../README.md)（npm 页面上该相对链接不可用，
请到仓库查看）。

## 安装

```sh
dsh plugin --profile web add kdocs-settings
```

然后**重启 `dsh web`**，并重新加载页面。分区出现在设置页，顺序值 `order: 35`。

卸载：

```sh
dsh plugin --profile web remove kdocs-settings
```

## 依赖关系

Settings 依赖核心插件提供的 `remote.kdocs` 命名空间服务。客户端半边用
`ctx.inject(['remote.kdocs'], …)` 等它出现，所以：

- **两个都装了** → 分区正常显示；
- **只装 Settings、没装核心插件** → 什么也不显示（不会报错、不会自己调 CLI）。

静态 `exports.inject` 只声明 `['slots', 'remote']`。`remote.kdocs` 是**命名空间服务**，
在 `apply` 里用 `ctx.inject` 等待它，这是本机实测过的写法（核心插件的客户端与
`dsh-apple-calendar` 同样如此），也能保证"只装 Settings"时不至于启动失败。

## 测试

```sh
node --test "test/*.test.mjs"
```

- `test/panel.test.mjs` —— 把 `dist/client.js` 当真脚本加载，注册进一个迷你 React 运行时，
  用替身 `remote.kdocs` 渲染四种状态，并驱动刷新按钮。还断言了"只读"这件事本身：
  面板里只能有一个按钮、没有输入框、不出现任何凭据引用、不出现第二个 CLI runner。
- `test/host.test.mjs` —— 断言 host 半边**没有任何副作用**：不 import、不开子进程、
  不读文件、不设 timer、不碰凭据；组合行也不声明 `inject`。

两个文件都做过负向对照：把 0.1.x 的凭据面重新塞回去，它们会失败。

## 布局

- `dist/index.mjs` —— host 半边（空的 `apply()`，见上文）。
- `dist/client.js` —— 浏览器半边，`window.__ModuleLoader__` 格式，手写产物、无构建步骤。
- `cordis.patch.yml` —— 组合插入行。

## License

与核心插件一致。
