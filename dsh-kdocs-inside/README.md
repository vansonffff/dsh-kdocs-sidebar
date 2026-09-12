# dsh-kdocs-inside — 金山文档右栏插件 for DeepSeek Harness

> 在 DSH 右侧边栏里**浏览、预览、引用**你的金山文档云盘；Agent 也能通过 4 个只读工具直接读正文。

**版本 0.2.0**（首个公开发布版） · 需要 DSH ≥ `0.1.5-rc.1` · Node ≥ 22.19 · [MIT](LICENSE)

---

## ⚠️ 前置条件：装本插件之前，你必须先能跑通 `kdocs-cli`

**本插件不自带、也不代管金山文档的登录凭据。** 它调用金山官方的命令行工具 `kdocs-cli`
（`auth status` / `auth login` / `auth logout`），由那个 CLI 把 Token 存进**操作系统的钥匙串**。
插件从不读取、存储或转发你的 Token —— 连 spawn 子进程时的 stdin 都是关闭的。

所以安装分三步，**第 1 步不做，插件装上也是空的**：

| # | 要装的东西 | 谁提供的 | 检查命令 |
|---|---|---|---|
| 1 | **kdocs-cli**，并已登录 | 金山办公官方（不是本项目） | `kdocs-cli auth status` → `"authenticated": true` |
| 2 | **DeepSeek Harness（DSH）** | DSH 官方 | `dsh --version` |
| 3 | **本插件** | 本项目 | 右栏出现「金山文档」 |

---

## 第 1 步：安装并登录 kdocs-cli

`kdocs-cli` 是金山办公为 AI Agent 提供的官方工具（参见官方仓库
[kdocs-app/kdocs-skill](https://github.com/kdocs-app/kdocs-skill)，即「金山文档官方 Skill」）。

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/kdocs-app/kdocs-skill/master/scripts/setup.sh -o /tmp/setup.sh && bash /tmp/setup.sh
```

**Windows（PowerShell）** —— 官方仓库 `scripts/` 下另有 `setup.ps1`：

```powershell
irm https://raw.githubusercontent.com/kdocs-app/kdocs-skill/master/scripts/setup.ps1 -OutFile $env:TEMP\setup.ps1
powershell -ExecutionPolicy Bypass -File $env:TEMP\setup.ps1
```

**任意平台（已有 Node.js）** —— 官方仓库 `scripts/` 下的 `setup.cjs`。

> 上面三段脚本文件名取自官方仓库（`scripts/setup.sh` / `setup.ps1` / `setup.cjs` 均存在）；
> 其中 macOS/Linux 的一行命令经过实测，Windows 与 Node 两条是官方提供的等价入口。

安装脚本会自己检测 CPU 架构、从 CDN 下载对应的 zip、校验 SHA256，并放进
`~/.local/bin`（Windows 是 `%LOCALAPPDATA%\kdocs-cli\`）同时加进 PATH。

### 然后登录

```bash
kdocs-cli auth login      # 浏览器 OAuth：它把授权链接打印到终端，你在浏览器里打开并授权
```

> `auth login` **不会**自己弹浏览器，它打印链接后阻塞等待（本插件的等待上限是 5.5 分钟）。
> 在浏览器里点了「取消」，服务端会结束这次授权，CLI 随即退出 —— 想继续就**重新执行一次**。

没有浏览器（服务器 / 容器 / CI），或者 `auth login` 反复失败时，用官方的兜底流程拿 Token：

1. 浏览器打开 <https://www.kdocs.cn/latest>（已登录 WPS **个人**账号）
2. 右上角个人头像旁的主菜单 → 「金山文档Skill」入口 → 复制 Token
3. 存进钥匙串（**Token 走 stdin，不要写进命令行参数**）：

```bash
kdocs-cli auth set-token -
```

（官方文档要求 Token 不得出现在对话、日志、命令输出或任何文件里；本插件遵守这条，
所以你在 DSH 的设置面板里也不会看到 Token 的明文。）

### 自检

```bash
kdocs-cli auth status
```

```json
{
  "authenticated": true,
  "keychain": { "available": true, "backend": "system keychain", "consistent": true },
  "source": "system keychain"
}
```

`authenticated: true` 就绪。本插件只读 `authenticated` / `source` / `keychain` 三个字段。

---

## 第 2 步：安装 DSH

```bash
npm install -g @deepseek-ai/dsh
```

（DSH 是公开的 npm 包；本插件针对 `0.1.5-rc` 系列编写。）

## 第 3 步：安装本插件

```bash
# 从 npm（推荐，便于升级）
dsh plugin --profile web add dsh-kdocs-inside

# 或者本地源码（在本包目录里；link: 让改动立即生效）
dsh plugin --profile web add link:$PWD

# 装完启动
dsh web
```

> **从 GitHub 直接装**需要本包位于**仓库根**（`dsh plugin … add github:owner/repo` 装的是仓库根）。
> 本包在发布仓库里是子目录，所以走 GitHub 时请用独立仓库，或改用 npm。

**装完必须重启 `dsh web`，然后在浏览器里重新加载页面。** 插件的 host 半边是在装配时定死的，
只刷新浏览器不会生效。

卸载：

```bash
dsh plugin --profile web remove dsh-kdocs-inside
```

> 卸载后请**硬刷新浏览器**（macOS `Cmd+Shift+R`）。已经打开的页面把插件的前端模块留在内存里了，
> 重启服务端不会把它卸掉 —— 否则你会看到"卸载了但界面还在"。

---

## 它提供了什么

| 面 | 你会看到的东西 |
|---|---|
| **右栏面板** | 「金山文档」文件树：我的云文档 / 星标 / 最近 / 共享给我 / 我分享的 / 回收站，逐层懒加载、可搜索、可加载更多 |
| **预览 Tab** | 点开文档默认内嵌 **WPS 原版查看器**，也可以切到「文本」模式读抽取出来的正文 |
| **引用到对话** | 把文档（或文件夹）的 `dsh-resource://kdocs/file/<driveId>/<fileId>` 地址写进输入框，接着说你要做什么 |
| **Agent 工具** | `kdocs_list` / `kdocs_search` / `kdocs_stat` / `kdocs_read` —— **四个全是只读** |
| **资源地址** | `dsh-resource://kdocs/…`，DSH 里任何认这个地址的位置都能直接引用 |

### 引用：能引什么，目前不能引什么

三个入口，边界不一样：

| 入口 | 在哪里 | 写进输入框的内容 |
|---|---|---|
| 引用到对话 | 面板里**右键任意一行** —— 文件、**文件夹**都可以 | `📄金山文档「<名称>」 dsh-resource://kdocs/file/<driveId>/<fileId>` |
| 引用到对话 | 预览 Tab 头部的按钮 | 同上（整篇文档） |
| 引用选中片段 | **只在预览的「文本」模式下**：用鼠标划选正文，出现浮动按钮 | 文档地址 + `选中的片段：` + 摘录 |

**目前做不到：文档内部（正文里）的文字级引用。** 预览默认的「原版」内嵌的是 WPS 在线编辑器，
它在一个**跨域 iframe** 里 —— 插件读不到里面的选区，所以那种情况下只能引用整篇文档，或引用某个文件夹。

文字级引用只在「文本」模式（插件自己渲染的正文）里可用，而且有两条限制：
摘录**超过 800 字会被丢弃**（只留文档地址）；原版模式下的选择不会被捕获。


### 和"工具型插件 / skill"的区别

有些同类插件只在服务端注册一批工具（manifest 里只有 `dsh.bundle.patch`，没有 `dsh.client`），
形态上更接近一份 skill：Agent 能调，但界面上什么都看不见。
本包**有浏览器半边**（`dsh.client.platform: web` + 一个客户端 bundle）：右栏面板、预览 Tab、
引用入口都在真实页面里渲染。工具只是它的第四个面，不是全部。

### 只读边界

四个 Agent 工具全部只读。本插件不会创建、修改或删除你的任何云文档。
预览 Tab 里的「原版」是 WPS 自己的在线编辑器，你在里面编辑是 WPS 的行为，与插件无关。

---

## 首次打开会看到什么

- **已登录**：右栏出现「金山文档」，展开就是你的云盘。
- **未登录 / 没装 CLI**：面板会直接给出安装与登录命令（三平台都写了），照着做即可。
  登录完成后回面板点一下「重试」（认证状态有 10 秒缓存，不会立刻自动刷新）。

---

## 换环境要不要重新登录？

**判定规则：凭据属于「这台机器 + 这个系统用户」的钥匙串，不属于 DSH，也不属于这个插件目录。**

| 场景 | 要重新登录吗 |
|---|---|
| 重启 DSH / 重启电脑 / 重装插件 / 重新 clone 仓库 / 新建 profile | ❌ 不用 |
| 换电脑、换系统用户、重装系统 | ✅ 要 |
| Docker / CI / 远程服务器 / WSL | ✅ 要 |
| Token 过期、被踢下线、主动 `auth logout` | ✅ 要 |

重新登录就是再跑一次 `kdocs-cli auth login`（无浏览器环境见上文 `auth set-token`）。

---

## 常见问题

**右栏没有「金山文档」**
依次确认：`dsh plugin --profile web why dsh-kdocs-inside` 能看到这个包 → 重启过 `dsh web` →
浏览器重新加载过页面。

**面板说未登录，但我终端里明明是登录的**
① 面板的认证状态有 10 秒缓存，点「重试」；② CLI 不在默认路径 —— 设 `KDOCS_CLI_DIR`
指向它所在目录（默认探测 `~/.local/bin/kdocs-cli`，Windows 是 `%LOCALAPPDATA%\kdocs-cli\kdocs-cli.exe`，
再退到 PATH）。

**报 `未找到 kdocs-cli`**
没装 CLI，或装在非标准位置。回到第 1 步，或设 `KDOCS_CLI_DIR`。

**企业账号登录一直转圈或失败**
金山官方明确说明：`kdocs-cli` 只支持 **WPS 个人账号**。企业账号请退出浏览器里的企业登录、
换成个人账号再授权，或改用官方的 [WPS365 CLI](https://github.com/wps365-open/cli)。
不要在同一个企业账号状态下反复重试。

**想升级 CLI**
`kdocs-cli upgrade`（自动备份旧版本，失败可 `kdocs-cli upgrade --rollback`；
旧版本在 `~/.kdocs-cli/backup/`）。若输出格式变化导致面板异常，先跑 `kdocs-cli auth status`
看是否仍含 `authenticated` 字段。

**面板/预览白屏**
先确认改完代码或重装插件后**重启过实例**（这是这类问题最常见的原因）；仍不行请在 issue 里附上
浏览器控制台报错。

---

## 配置

在 DSH profile 的 patch 层按行 id `dsh-kdocs-inside` 覆盖（`config` 是整体替换）：

```yaml
- id: dsh-kdocs-inside
  config:
    pageSize: 50
    maxContentBytes: 262144
```

| 键 | 默认 | 含义 |
|---|---|---|
| `defaultTimeoutMs` | `60000` | 列表 / 搜索 / stat 上限 |
| `readTimeoutMs` | `180000` | 正文抽取上限 |
| `loginTimeoutMs` | `330000` | 浏览器 OAuth 往返上限 |
| `maxContentBytes` | `524288` | 单篇正文预算，超出按行截断（`truncated: true`） |
| `statusTtlMs` | `10000` | 认证状态缓存 |
| `pageSize` | `100` | 每页条数（CLI 允许 1–500） |

---

## 配套插件

**`kdocs-settings`** 给 DSH 设置页加一个「金山文档 (kdocs)」分区，提供
**OAuth 登录 / 刷新状态 / 退出登录**按钮（在设置页点一下就完成 `auth login`，不用回终端）。

**它是可选的** —— 不装它，只要你在终端里跑过 `kdocs-cli auth login`，本插件一样能用。
它和本包放在同一个发布仓库里（`../kdocs-settings`），也可以单独安装。

---

## 兼容性与版本

- 本插件的客户端半边使用 DSH 在 `0.1.5-rc` 期提供的接口，DSH 升级到新 RC 时可能需要同步更新。
  升级 DSH 前，建议先在另一个 profile 里验证：`dsh --profile test web`。
- 依赖面全部公开可解析：`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-typert-protocol`
  （`^0.1.5-rc.1`）。
- 版本停在 `0.x` 是刻意的：它依赖的 DSH 客户端接口仍在 RC 通道，声称 1.0 会是虚假的稳定性承诺。

## License

[MIT](LICENSE)
