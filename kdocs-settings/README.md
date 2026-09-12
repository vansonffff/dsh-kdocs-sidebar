# kdocs-settings — 金山文档设置分区 for DeepSeek Harness

> 在 DSH 设置页里加一个「金山文档 (kdocs)」分区：**OAuth 登录 / 刷新状态 / 退出登录**，
> 以及可选的「粘贴 API Token」。不用回终端就能完成授权。

**版本 0.1.1** · 需要 DSH ≥ `0.1.5-rc.1` · Node ≥ 22.19 · [MIT](LICENSE)

---

## 它做什么

| 面板元素 | 行为 |
|---|---|
| 状态徽标 | 「已认证 / 未认证」——只要 `kdocs-cli` 报告有效凭据就显示已认证 |
| **OAuth 登录** | 在你的机器上执行 `kdocs-cli auth login`，把打印出来的授权链接用默认浏览器打开 |
| **刷新状态** | 重新读取 DSH 凭据面里这两个 ref 的配置状态（**不含**重新探测 CLI，见「已知限制」） |
| **退出登录** | 清除 `KDOCS_TOKEN`，并执行 `kdocs-cli auth logout`（从系统钥匙串移除 Token） |
| 粘贴 API Token | 可选的兜底登录方式；Token 以 **stdin** 交给 `kdocs-cli auth set-token -`，永不进 argv |

它只做**凭据这一件事**：云盘的浏览、预览、引用与 Agent 工具在
[`dsh-kdocs-inside`](../dsh-kdocs-inside) 里。两者可以各自单独安装。

## 前置条件

和主插件一样：**先有金山官方的 `kdocs-cli`**。

- 安装：官方仓库 [kdocs-app/kdocs-skill](https://github.com/kdocs-app/kdocs-skill) 的
  `scripts/setup.sh`（macOS/Linux）/ `setup.ps1`（Windows）/ `setup.cjs`（Node）
- 自检：`kdocs-cli auth status` → `"authenticated": true`

本插件**不携带** `kdocs-cli`，也不自己存 Token —— Token 属于系统钥匙串，由 CLI 管理。

> 如果你已经在终端里登录过，这个插件就是**可选**的：它只是把同一件事搬到设置页。

## 安装

```bash
# 从 npm
dsh plugin --profile web add kdocs-settings

# 或本地源码（在本包目录里）
dsh plugin --profile web add link:$PWD

dsh web
```

**装完必须重启 `dsh web`。** host 半边在装配时定死，只刷新浏览器不生效。

卸载：

```bash
dsh plugin --profile web remove kdocs-settings
```

> 卸载后请**硬刷新浏览器**：已打开的页面会把前端模块留在内存里，重启服务端不会把它卸掉。

## 安全模型

- **Token 永不进入 argv**：`auth set-token` 从 stdin 读取（命令行参数对本机任何进程可见，
  官方文档也明确禁止 Token 出现在命令行、日志或文件里）。
- **Token 永不回读**：DSH 的凭据面只回答"某个 ref 是否已配置"（`describe()` 从不返回值），
  所以这个面板显示不了 Token 内容 —— 这是设计，不是缺陷。
- **插件自己不落盘 Token**：所有写入都交给 `kdocs-cli`，由它存进系统钥匙串。

## 已知限制：刷新状态按钮

「刷新状态」重新读取的是 **DSH 凭据面里的 ref**（一次 `credentials.describe`），
它**不会**重新执行 `kdocs-cli auth status`。因此：

- 状态没变化时点它，界面不会有任何变化 —— 这是正常的，不是按钮坏了；
- 权威的 CLI 探测发生在 **DSH 启动后约 3 秒**、以及**每次登录结束时**；
- 后果：如果 Token 在别处失效（过期、被踢下线），徽标可能仍显示「已认证」，
  直到你重新登录、改 Token 或重启 DSH。

> 本版本实测确认：点击该按钮会发出且仅发出一次 `POST /api/credentials/describe`，
> 宿主侧的凭据文件不会被改写（即没有触碰 CLI）。

## 与 DSH 版本的兼容性

- 0.1.1 适配 DSH `0.1.5-rc.1` 的 `remote.credentials` 命名空间服务。
- 0.1.0 用的是已经消失的 `ctx.get("connection").api.credentials`，在 0.1.5 上会**静默失效**
  （面板报 `Cannot read properties of undefined (reading 'credentials')`，按钮点了没反应）。
  请使用 0.1.1 或更高版本。
- DSH 客户端接口仍在 RC 通道，升级 DSH 后如遇异常，请附上浏览器控制台报错提 issue。

## License

[MIT](LICENSE)
