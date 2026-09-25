# 金山文档 for DeepSeek Harness

把金山文档（WPS 云文档）接进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）：
在**右侧边栏**里浏览和预览你的云盘，把文档引用进对话，也能让 Agent 直接读正文。
**Web 与官方桌面端（Electron）双端适配。**

| 插件 | 版本 | 你会得到什么 |
|---|---|---|
| [`dsh-kdocs-inside`](dsh-kdocs-inside) | 0.4.0 | 右栏「金山文档」面板（六个视图 + 搜索）、预览 Tab（web 内嵌在线编辑器 / 桌面端 PDF 导出预览 + 文本）、引用到对话、4 个只读 Agent 工具 |
| [`kdocs-settings`](kdocs-settings) | 0.2.1 | DSH 设置页里的「金山文档 (kdocs)」只读状态分区：CLI 是否安装 / 是否登录 / 版本（**可选**，登录仍在终端完成） |

---

## 双端行为一览（0.4.0 起）

同一份包装进 web profile 和官方桌面端，界面与能力一致，**只有「原版」预览按端分流**：

| | Web（浏览器） | 桌面端（Electron） |
|---|---|---|
| 「原版」预览 | 内嵌金山文档**在线编辑器**，可读可编辑 | **PDF 导出预览**（只读，内置 pdf.js 渲染） |
| 编辑文档 | 预览里直接编辑 | 点「在金山文档打开」跳系统浏览器 |
| 依赖的登录态 | 浏览器里的金山文档 web 会话 | kdocs-cli Token（密钥链），与网页登录无关 |

桌面端不走 iframe 的原因：应用内嵌的 Chromium profile 与系统浏览器不共享 cookie，
金山授权接口在该嵌入上下文拒绝签发授权码，会话无法建立。PDF 导出全程走 CLI Token，
是唯一不依赖网页会话的版式预览通道。

---

## 先决条件（不满足的话，插件装上也是空的）

这两个插件都**不携带、也不代管**金山文档的登录凭据。它们驱动金山官方的命令行工具 `kdocs-cli`，
Token 由那个 CLI 存进**操作系统的钥匙串** —— 插件从不读取、存储或转发你的 Token。

所以按顺序做三件事：

**1. 装 `kdocs-cli`**（金山办公官方，不是本项目）

两个官方获取入口：**金山文档官方页面**（kdocs.cn / 365.kdocs.cn 的「金山文档 Skill」入口，
页面内有下载与 Token 指引），或官方仓库
[kdocs-app/kdocs-skill](https://github.com/kdocs-app/kdocs-skill) 的安装脚本：

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

还要有 DSH 本体（`npm install -g @deepseek-ai/dsh`，需 ≥ `0.1.7-rc.1`）与 Node ≥ 22.19。

> 三平台安装命令、无浏览器环境（服务器 / 容器）怎么拿 Token、企业账号为什么不支持，
> 都在 [`dsh-kdocs-inside/README.md`](dsh-kdocs-inside/README.md) 里。

## 安装

```bash
# 右栏面板 + 预览 + 引用 + 工具
dsh plugin --profile web add dsh-kdocs-inside

# 设置页里的状态分区（可选）
dsh plugin --profile web add kdocs-settings

dsh web
```

**装完必须重启 `dsh web`，并重新加载浏览器页面。**

装进**官方桌面端**：桌面端 profile 由 Electron 应用独占管理，请在桌面端
「设置 → 插件」里填包名 `dsh-kdocs-inside` 直接安装（无需克隆本仓库）；
改动 host 半边后需重启应用。

## 用起来是什么样

- 右栏出现「金山文档」：我的云文档 / 星标 / 最近 / 共享给我 / 我分享的 / 回收站，逐层展开、可搜索；
- 点开任何文档 → 预览 Tab：web 端内嵌 WPS 在线编辑器，桌面端为 PDF 导出预览，
  两端都可以切「文本」模式读正文；
- 在面板里**右键任意一行（文件或文件夹）**→「引用到对话」，地址就写进输入框；
- Agent 侧有 4 个只读工具：`kdocs_list` / `kdocs_search` / `kdocs_stat` / `kdocs_read`。

**引用能力的边界**（别被"划选"两个字误导）：文档**正文内部**的文字级引用目前做不到 ——
web 端预览默认的「原版」是跨域 iframe，插件读不到里面的选区。文字级引用只在「文本」模式下可用，
且摘录超过 800 字会被丢弃。详见
[`dsh-kdocs-inside/README.md`](dsh-kdocs-inside/README.md)。

## 换机器要不要重新登录

凭据属于「这台机器 + 这个系统用户」的钥匙串：重启 DSH、重装插件、重新 clone 本仓库都**不用**重登；
换电脑、换系统用户、Docker / CI / 远程服务器则**需要**。

## 许可

[MIT](LICENSE) —— 两个插件都是。桌面端 PDF 渲染使用内置的
[pdf.js](https://github.com/mozilla/pdf.js)（Apache-2.0，见
[`dsh-kdocs-inside/vendor/pdfjs-LICENSE.txt`](dsh-kdocs-inside/vendor/pdfjs-LICENSE.txt)），
仅在桌面端首次预览时懒加载，web 端不会下载。

---

<sub>本仓库是发布源码：不含开发测试与里程碑记录。</sub>
