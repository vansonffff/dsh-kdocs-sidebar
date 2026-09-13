# dsh-kdocs-inside — 金山文档 for DeepSeek Harness

> 在 DSH 右侧边栏里**浏览、预览、引用**你的金山文档云盘；Agent 也能通过 4 个只读工具直接读正文。

需要 DSH ≥ `0.1.5`（实测于 `0.1.5-rc.1`）· Node ≥ 22.19

**版本变动请看 [`CHANGELOG.md`](CHANGELOG.md)**；本文件只介绍这个项目本身。

本插件是 `dsh-kdocs` 的核心包。仓库里的 `kdocs/` 目录名与包名 `dsh-kdocs-inside`
不一致是历史原因，包名不再变动。


---

## 它是什么

一个把金山文档接进 DSH 的**能力 seam**：对外只注册一个 `kdocs` 服务、一个
`remote.kdocs` 命名空间、一个 `dsh-resource://kdocs/` 资源协议，
以及右栏的一个面板与一个预览 tab。

**四层各自的读写边界**（不要笼统说"只读"）：

| 层 | 边界 |
|---|---|
| **Agent 工具**（4 个） | **只读** |
| **Provider / Remote** | 含一项显式写入：`rename` |
| **「原版」嵌入的 iframe** | 金山文档自己的**可写编辑器**，可能被人工编辑 |
| **预览的「文本」模式** | **只读**（由 CLI 抽取） |

---

## ⚠️ 前置条件：装本插件之前，你必须先能跑通 `kdocs-cli`

**本插件不自带、也不代管金山文档的登录凭据。** 它调用金山官方的命令行工具 `kdocs-cli`
（`auth status` / `auth login` / `auth logout`），由那个 CLI 把 Token 存进**操作系统的密钥链**。
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

> 上面三段脚本文件名取自官方仓库；其中 macOS/Linux 的一行命令经过实测，Windows 与 Node
> 两条是官方提供的等价入口。

安装脚本会自己检测 CPU 架构、从 CDN 下载对应的 zip、校验 SHA256，并放进
`~/.local/bin`（Windows 是 `%LOCALAPPDATA%\kdocs-cli\`）同时加进 PATH。

### 然后登录

```bash
kdocs-cli auth login      # 它把授权链接打印到终端，你在浏览器里打开并授权
```

> `auth login` **不会**自己弹浏览器，它打印链接后阻塞等待（本插件的等待上限是 5.5 分钟）。
> 在浏览器里点了「取消」，服务端会结束这次授权，CLI 随即退出 —— 想继续就**重新执行一次**。

没有浏览器（服务器 / 容器 / CI），或者 `auth login` 反复失败时，用官方的兜底流程拿 Token：

1. 浏览器打开 <https://www.kdocs.cn/latest>（已登录 WPS **个人**账号）
2. 右上角个人头像旁的主菜单 → 「金山文档Skill」入口 → 复制 Token
3. 存进密钥链（**Token 走 stdin，不要写进命令行参数**）：

```bash
kdocs-cli auth set-token -
```

（官方文档要求 Token 不得出现在对话、日志、命令输出或任何文件里；本插件遵守这条，
所以 DSH 里也没有任何界面能显示 Token 明文 —— 包括可选的 `kdocs-settings` 状态面板。）

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

`authenticated: true` 就绪。

---

## 第 2 步：安装 DSH

```bash
npm install -g @deepseek-ai/dsh
```

（DSH 是公开的 npm 包；本插件针对 `0.1.5` 系的客户端接口编写。）

## 第 3 步：安装本插件

```bash
# 从 npm（推荐，便于升级）
dsh plugin --profile web add dsh-kdocs-inside

# 或者本地开发（在插件目录里）
dsh plugin --profile web add link:$PWD

# 装完启动
dsh web
```

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
| **引用到对话** | 预览里「引用到对话」或划选后「引用选中片段」→ 输入框写入 `dsh-resource://kdocs/file/<driveId>/<fileId>` |
| **手动重命名** | 在 Sidebar 里由你主动触发，用于人工版本管理（见下文） |
| **Agent 工具** | `kdocs_list` / `kdocs_search` / `kdocs_stat` / `kdocs_read` —— **四个全是只读** |
| **资源地址** | `dsh-resource://kdocs/…`，DSH 里任何认这个地址的位置都能直接引用 |

### 和"工具型插件 / skill"的区别

有些同类插件只在服务端注册一批工具（manifest 里只有 `dsh.bundle.patch`，没有 `dsh.client`），
形态上更接近一份 skill：Agent 能调，但界面上什么都看不见。
本包**有浏览器半边**（`dsh.client.platform: web` + 一个客户端 bundle）：右栏面板、预览 Tab、
划选引用都在真实页面里渲染。工具只是它的第四个面，不是全部。

### 只读边界

四个 Agent 工具全部只读：`kdocs_list`、`kdocs_search`、`kdocs_stat`、`kdocs_read`
不会创建、编辑、覆盖或删除金山文档正文。

右栏同样以浏览、预览、引用为主，只额外提供一项**由用户主动触发**的文件管理能力：重命名。

**但请注意，这不等于"运行 DSH 的 Agent 一定只有只读权限"。** 这个插件依赖 `kdocs-cli`，
而 `kdocs-cli` 自己具备创建、上传、修改、移动等写入能力；如果 Agent 有权执行命令，
它可以绕开本插件的只读工具，直接调用 CLI。权限是两层的：

- **本插件层** —— 只暴露只读工具，不通过它们修改正文；
- **CLI / Agent 运行环境层** —— CLI 能写，Agent 能不能写取决于 DSH 的命令执行权限。

换言之：**本插件不主动向 Agent 暴露写入工具，但它不是、也无法作为安全沙箱。**

预览 Tab 里的「原版」是 WPS 自己的在线编辑器，你在里面编辑是 WPS 的行为，与本插件无关。

### 手动重命名是干什么的

它只服务一件事：**AI 产出新文件之后，由人工检查并做版本命名。**

```text
重整计划草案.docx
→ AI / kdocs-cli 生成修订文件
→ 律师人工检查
→ Sidebar 手动重命名
→ 重整计划草案_20260913_AI修订.docx
→ 再次引用给 Agent 复核
```

重命名只在 Sidebar 里由用户点击触发，**不向 Agent 注册工具**，也没有删除、移动或批量重命名。
改名不会改变资源身份：地址始终是 `dsh-resource://kdocs/file/<driveId>/<fileId>`，
`<driveId>/<fileId>` 不变，只有显示名跟着变。

---

## 首次打开会看到什么

- **已登录**：右栏出现「金山文档」，展开就是你的云盘。
- **未登录 / 没装 CLI**：面板会直接给出安装与登录命令，照着做即可。
  登录完成后回面板点一下「重试」（认证状态有 10 秒缓存，不会立刻自动刷新）。

---

## 换环境要不要重新登录？

**判定规则：凭据属于「这台机器 + 这个系统用户」的密钥链，不属于 DSH，也不属于这个插件目录。**

| 场景 | 要重新登录吗 |
|---|---|
| 重启 DSH / 重启电脑 / 重装插件 / 重新 clone 仓库 / 新建 profile | ❌ 不用 |
| 换电脑、换系统用户、重装系统 | ✅ 要 |
| Docker / CI / 远程服务器 / WSL | ✅ 要 |
| Token 过期、被踢下线、主动 `auth logout` | ✅ 要 |

重新登录就是再跑一次 `kdocs-cli auth login`（无浏览器环境见上文 `auth set-token -`）。

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
金山官方说明 `kdocs-cli` 面向 **WPS 个人账号**；企业账号请使用相应的企业产品或官方工具。
不要在同一个企业账号状态下反复重试。

**想升级 CLI**
`kdocs-cli upgrade`（自动备份旧版本，失败可 `kdocs-cli upgrade --rollback`；
旧版本在 `~/.kdocs-cli/backup/`）。若输出格式变化导致面板异常，先跑 `kdocs-cli auth status`
看是否仍含 `authenticated` 字段。

**面板/预览白屏**
先确认改完代码或重装插件后**重启过实例**（这是这类问题最常见的原因）；仍不行请在 issue 里附上
浏览器控制台报错，以及 DSH、本插件、`kdocs-settings` 三个版本号。**不要附带 Token。**

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
| `loginTimeoutMs` | `330000` | 浏览器 OAuth 往返上限（Settings 不使用） |
| `maxContentBytes` | `524288` | 单篇正文预算，超出按行截断（`truncated: true`） |
| `statusTtlMs` | `10000` | 认证状态缓存 |
| `pageSize` | `100` | 每页条数（CLI 允许 1–500） |

---

## Agent 工具的输出契约

`kdocs_list` 与 `kdocs_search` 返回同一个分页结构：

```js
{
  entries,      // 本次调用返回的结果，每项一行文本
  pageCount,    // 本页数量，恒等于 entries.length
  nextCursor?,  // 只在还有下一页时出现
  total?        // 只有上游真实返回总数时才出现
}
```

`pageCount` 是**本页**数量，`total` 是**整个查询**的真实总数，两者不可互换。
`total` 只在显式请求且上游确实返回时出现 —— 不会用本页数量冒充总数。

`kdocs_stat` 返回元数据，不返回正文；`kdocs_read` 返回抽取后的正文，超出预算时
返回 `truncated: true`。

---

## 配套插件

**`kdocs-settings`**（另一个独立插件，单独安装）给 DSH 设置页加一个「金山文档」**只读状态分区**：
显示 CLI 是否安装、是否登录、版本、凭据来源和上次检查时间。

它**不**提供登录、Token 输入或退出登录 —— 那三件事都在终端完成（`kdocs-cli auth login` /
`kdocs-cli auth logout`）。不装它完全不影响本插件。

---

## 测试

本包以**发布镜像**的形式托管：仓库里只有插件本体（`client.js`、`src/`、配置与文档），
**不含测试套件与开发过程记录** —— 它们留在开发工作区，不随包、也不随仓库发布。

如果你要在本地验证这个插件，最直接的方式是把它装进一个 DSH profile，
然后在右栏打开「金山文档」面板：面板能列出你的云盘，就说明 CLI、凭据、
资源协议与 Host 半边这条链路都是通的。

---

## 兼容性与版本

- 本插件的客户端半边使用 DSH 在 `0.1.5` 系提供的接口（`remote.kdocs`、`sidebarRightTabs`
  等），DSH 升级到新 RC 时可能需要同步更新。升级 DSH 前，建议先在另一个 profile 里验证。
- 依赖面全部公开可解析：`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-typert-protocol`
  （`^0.1.5-rc.1`）。
- 版本变动见 [`CHANGELOG.md`](CHANGELOG.md)。

## License

MIT — 见 [LICENSE](LICENSE)（与 0.2.0 首发时的许可证一致）。
