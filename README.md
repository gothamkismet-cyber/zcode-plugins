# ZCode 插件集（zcode-plugins）

为 ZCode 桌面版开发的能力增强插件，本仓库同时是一个 ZCode 插件市场：把仓库地址添加进 ZCode 即可直接安装里面的插件，无需手动拷贝文件。

## 插件一览

### 会话记忆（session-memory）v0.2.0

给 ZCode 补上跨会话记忆——每个新会话默认是失忆的，本插件让长期有效的要点跨会话存活：

- 会话启动钩子自动把记忆注入上下文；没有记忆文件时零输出、零上下文占用
- 项目记忆 `<工作区>/.zcode/memory.md`（可提交 git）+ 全局记忆 `~/.zcode/memory/GLOBAL.md`
- `/remember <要点>` 快速记录，`/memory` 查看与清理，配套记忆管理技能约束写入格式（带日期分类、过期改写、密钥密码拒收）

详见 [plugins/session-memory/README.md](plugins/session-memory/README.md)

### Steam 创意工坊（steam-workshop）v0.3.0

通过 MCP 给 ZCode 加 7 个工具，覆盖"查、取、析"三件事：

- **查**：`workshop_search` 关键词搜索（通用所有游戏）、`workshop_details` 物品详情（订阅数/大小/更新时间/标签/合集展开）、`workshop_status` 自检
- **取**：`workshop_download` 自动定位本机 Steam 库已有内容，缺了用 steamcmd 匿名下载
- **析**：`mod_analyze` / `mod_read_file` / `mod_grep` 对已下载 mod 做 RimWorld 深度代码分析——About.xml 依赖与加载顺序、loadFolders 条件加载、XML 里的 MayRequire 联动点、C# Harmony 补丁目标、PatchOperation 统计，服务 mod 兼容适配开发

搜索和详情不需要 Steam 账号，也不需要 API key；详情接口走官方免 key 通道。

详见 [plugins/steam-workshop/README.md](plugins/steam-workshop/README.md)

### 桌面桥（desktop-bridge）v0.2.0

让 ZCode 够得着桌面（Windows / macOS / Linux），5 个零依赖 MCP 工具：

- `clipboard_read` / `clipboard_write`：剪贴板读写——你说"看我复制的内容"，模型直接读
- `notify`：Windows 系统通知弹窗（长任务收尾提醒）
- `open_path`：打开网页/文件夹/文件（护栏：拒绝可执行扩展名和非 http/https 协议）
- `sys_info`：系统信息（系统版本/内存/CPU/磁盘剩余空间）

详见 [plugins/desktop-bridge/README.md](plugins/desktop-bridge/README.md)

### 图片转生图提示词（img2prompt）v0.1.0

把任意图片转成高质量生图提示词，核心是"先查嵌入参数，再看图分析"：

- `image_meta` 工具：提取 AI 图片内嵌的**原始生成参数**（SD/A1111/Forge 的 prompt/负面词/Steps/Sampler/CFG/Seed、ComfyUI workflow、NovelAI）和 JPEG EXIF（相机/曝光）——命中即直接复刻，比看图猜准得多
- `img2prompt` 技能 + `/img2prompt <图片>` 命令：八维视觉分析框架（主体/风格/构图/光影/色彩/氛围/质感/质量词）→ 四种输出（SD tag 式、自然语言、Midjourney 带 `--ar`、负面提示词）+ 图生图重绘幅度与分辨率建议

详见 [plugins/img2prompt/README.md](plugins/img2prompt/README.md)

## 安装方法

### 方法一：把本仓库添加为插件市场（推荐）

1. 打开 ZCode 的 **插件市场** 页面
2. 点 **添加 → 添加插件市场**
3. 输入 `gothamkismet-cyber/zcode-plugins`（或完整地址 `https://github.com/gothamkismet-cyber/zcode-plugins`）
4. 进 **个人** 页找到四个插件，逐个点 **安装**
5. 会话记忆装完即生效（新会话开始加载）；Steam 创意工坊装完建议重启 ZCode 让 MCP 服务器完成连接

### 方法二：本地目录市场（离线/开发）

克隆或下载本仓库后，在 **插件市场 → 添加 → 添加插件市场** 里粘贴仓库根目录（含 `marketplace.json` 的那一层），其余步骤同上。

## 使用前提

- ZCode 桌面版（带插件市场功能）
- 三个插件都依赖 `node` 在 PATH（Node ≥ 18，建议 24；命令行 `node --version` 可查）
- 桌面桥在 Linux 需要剪贴板/通知工具（xclip 或 wl-clipboard、libnotify），缺失时报错提示安装；macOS 开箱即用
- 想用 steam-workshop 的 mod 下载功能时才需要安装 steamcmd（各平台安装见其 README）；只搜索、看详情、分析本机已有 mod 不需要

## 可选配置（Steam 创意工坊）

配置文件：`C:\Users\<用户名>\.zcode\steam-workshop.json`

```json
{
  "steamApiKey": "配了搜索直接返回订阅数等全字段（steamcommunity.com/dev/apikey 免费申请）",
  "steamcmdPath": "C:\\steamcmd\\steamcmd.exe（要用下载功能时装）",
  "steamLibraries": ["D:\\SteamLibrary"]
}
```

所有配置均可选；不配置时插件以降级模式工作（搜索返回 id+标题，再用详情接口补全）。配置放在用户目录，插件源码不含任何凭据。

## 更新插件

本仓库内容更新后：**市场页齿轮 → 市场源 → 找到本市场 → 刷新该市场**，再进插件详情点 **更新**（GitHub 源拉取的是仓库最新内容，版本号以各插件 manifest 为准）。

## 验证状态与已知限制

- 已实测（Windows 开发机）：详情接口免 key、免 key 搜索解析、MCP 会话全链路、RimWorld mod 分析、桌面桥五工具全链路（2026-09）
- macOS/Linux：适配代码已实现并通过 Windows 侧回归测试，**未实机测试**；首次使用遇缺依赖按错误提示安装即可
- steamcommunity 部分网络环境需代理；带 API key 的搜索路径未实测（无 key）
