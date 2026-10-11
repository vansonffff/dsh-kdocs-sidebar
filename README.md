# 金山文档 for DeepSeek Harness

在 DSH 右侧栏浏览金山云文档、阅读和引用正文，并提供四个只读 Agent 工具。

当前 Latest：**dsh-kdocs-inside 0.4.6-rc.1**。版本号保留 rc.1；该 GitHub Release 已按用户要求正式发布并设为 Latest，以下实测范围与待验项目继续适用。

| 插件 | 版本 | 功能 |
|---|---|---|
| [dsh-kdocs-inside](dsh-kdocs-inside) | 0.4.6-rc.1 | CLI 配置、团队/个人文件列表、搜索、官方 PDF 预览、文本阅读及引用、只读工具 |
| [kdocs-settings](kdocs-settings) | 0.2.1 | 可选的 CLI 状态分区，本次未修改 |

## 预览方式

DSH 桌面端 PDF 预览使用 DSH 内置文件阅读器，无需安装额外 PDF 插件。原生 PDF 通过金山官方接口下载后在本机临时缓存；Word、PPT 先转换为 PDF 再预览。预览文件不会上传到第三方服务。

桌面端默认点击 PDF、DOC、DOCX、PPT、PPTX，在同一窗口的右侧栏打开官方文件 Tab。右击“文本阅读”保留 KDocs 划选引用；Web 保持金山 iframe。表格不纳入 PDF 转换，`.pof` 不视为 PDF。

如果本机已启用旧 `dsh-pdf-viewer`，DSH 的阅读器选择菜单可能显示两个同名 PDF 选项，旧扩展可能优先接管渲染。停用它即可使用官方内置阅读器；本 RC 的代码及包依赖均已移除对旧插件的依赖。

## 安装 RC

宿主核心 peer 最低范围为 `>=0.2.0-rc.2`，Node ≥22.19。macOS 实测宿主为 0.2.0-rc.2，后续版本仍需对应验收。

先通过[金山官方 CLI 指引](https://github.com/kdocs-app/kdocs-skill)安装并登录 `kdocs-cli`：

```sh
kdocs-cli auth login
kdocs-cli auth status
```

从 [v0.4.6-rc.1 发行版](https://github.com/vansonffff/dsh-kdocs-sidebar/releases/tag/v0.4.6-rc.1)下载 `dsh-kdocs-inside-0.4.6-rc.1.tgz`，在 DSH 插件管理页添加本地安装包。CLI Profile 可用官方入口安装下载的 TGZ：

```sh
dsh plugin --profile <你的Profile> add <下载的TGZ路径>
```

安装或升级后完整退出并重新启动 DSH。CLI 配置入口为“插件 → dsh-kdocs-inside”，支持路径设置、自动检测和连接检查。此 RC 不发布 npm。

## 验证边界

- macOS 真 Electron 已验证：关闭旧 Viewer 并冷启动后的真实 PDF/DOCX、同一右栏、多页滚动、缩放、文字复制、标签复用及缓存刷新。
- 完整测试 311 项，309 通过；2 项为开发前已有的云盘根目录 Word 样本缺失失败。本轮新增13项全部通过。
- Windows、其他宿主版本、真实 PPT/PPTX、全新桌面组合安装，以及退出整个 DSH 后磁盘清理回读仍待实机验收。
- 缓存清理钩子与单测已通过；异常退出遗留缓存在下次首次准备预览时按归属、原 Host 进程退出及创建超过24小时的条件回收。

具体配置与缓存保护见 [插件说明](dsh-kdocs-inside/README.md)。

## 许可

[MIT](LICENSE)。本仓库保留发行源码，不包含开发测试、客户材料、凭据或本机验收截图；PDF 阅读器由 DSH 宿主提供。
