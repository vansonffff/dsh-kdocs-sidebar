# 金山文档 for DeepSeek Harness

把金山文档（WPS 云文档）接进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）：
在**右侧边栏**里浏览和预览你的云盘，把文档引用进对话，也能让 Agent 直接读正文。

| 插件 | 版本 | 你会得到什么 |
|---|---|---|
| [`dsh-kdocs-inside`](dsh-kdocs-inside) | 0.2.0 | 右栏「金山文档」面板（六个视图 + 搜索）、预览 Tab（WPS 原版 / 文本两档）、引用到对话、4 个只读 Agent 工具 |
| [`kdocs-settings`](kdocs-settings) | 0.1.1 | DSH 设置页里的「金山文档 (kdocs)」分区：OAuth 登录 / 刷新状态 / 退出登录（**可选**，你也可以只在终端里登录） |

---

## 先决条件（不满足的话，插件装上也是空的）

这两个插件都**不携带、也不代管**金山文档的登录凭据。它们驱动金山官方的命令行工具 `kdocs-cli`，
Token 由那个 CLI 存进**操作系统的钥匙串** —— 插件从不读取、存储或转发你的 Token。

所以按顺序做三件事：

**1. 装 `kdocs-cli`**（金山办公官方，不是本项目）

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/kdocs-app/kdocs-skill/master/scripts/setup.sh -o /tmp/setup.sh && bash /tmp/setup.sh
```

Windows 用同一个官方仓库 `scripts/` 下的 `setup.ps1`（PowerShell），已有 Node.js 可用 `setup.cjs`。

**2. 登录**

```bash
kdocs-cli auth login      # 它把授权链接打印到终端，你在浏览器里打开并授权
```

**3. 自检**

```bash
kdocs-cli auth status     # 期望看到 "authenticated": true
```

还要有 DSH 本体（`npm install -g @deepseek-ai/dsh`，需 ≥ `0.1.5-rc.1`）与 Node ≥ 22.19。

> 三平台安装命令、无浏览器环境（服务器 / 容器）怎么拿 Token、企业账号为什么不支持，
> 都在 [`dsh-kdocs-inside/README.md`](dsh-kdocs-inside/README.md) 里。

## 安装

```bash
# 右栏面板 + 预览 + 引用 + 工具
dsh plugin --profile web add dsh-kdocs-inside

# 设置页里的登录入口（可选）
dsh plugin --profile web add kdocs-settings

dsh web
```

**装完必须重启 `dsh web`，并重新加载浏览器页面。**

## 用起来是什么样

- 右栏出现「金山文档」：我的云文档 / 星标 / 最近 / 共享给我 / 我分享的 / 回收站，逐层展开、可搜索；
- 点开任何文档 → 预览 Tab 默认内嵌 WPS 原版查看器，也可以切「文本」模式读正文；
- 在面板里**右键任意一行（文件或文件夹）**→「引用到对话」，地址就写进输入框；
- Agent 侧有 4 个只读工具：`kdocs_list` / `kdocs_search` / `kdocs_stat` / `kdocs_read`。

**引用能力的边界**（别被"划选"两个字误导）：文档**正文内部**的文字级引用目前做不到 ——
预览默认的「原版」是跨域 iframe，插件读不到里面的选区。文字级引用只在「文本」模式下可用，
且摘录超过 800 字会被丢弃。详见
[`dsh-kdocs-inside/README.md`](dsh-kdocs-inside/README.md)。

## 换机器要不要重新登录

凭据属于「这台机器 + 这个系统用户」的钥匙串：重启 DSH、重装插件、重新 clone 本仓库都**不用**重登；
换电脑、换系统用户、Docker / CI / 远程服务器则**需要**。

## 许可

[MIT](LICENSE) —— 两个插件都是。

---

<sub>本仓库是发布源码：不含开发测试与里程碑记录。</sub>
