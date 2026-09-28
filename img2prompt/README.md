# img2prompt（图片转生图提示词）

给 ZCode 加"看图出提示词"的结构化能力：`image_meta` MCP 工具提取图片嵌入元数据 + `img2prompt` 技能/`/img2prompt` 命令定义完整工作流。

## 为什么它"强化"

普通做法是让模型看图猜提示词。本插件先查文件里嵌的**原始生成参数**——SD/A1111/Forge 的 PNG `parameters` 块、ComfyUI 的 `prompt`/`workflow` JSON、NovelAI 的 Description/Comment，命中就直接复刻原始正向/负面提示词和 Steps/Sampler/CFG/Seed/Model，比猜测准一个量级。查不到（真实照片、被剥离元数据的图）才走视觉分析。

## 组成

| 部件 | 作用 |
| --- | --- |
| `image_meta`（MCP） | PNG 文本块（tEXt/zTXt/iTXt，支持压缩）解析 + A1111 参数结构化拆分 + JPEG EXIF（相机/曝光/焦距）+ 尺寸；支持本地路径和 http/https URL |
| `img2prompt` 技能 | 八维视觉分析框架 → 四种输出格式（SD tag 式 / 自然语言 / Midjourney 带 `--ar` / 负面提示词）+ 图生图重绘幅度与分辨率建议 |
| `/img2prompt <路径>` | 命令直呼 |

零第三方依赖：PNG/zlib 解析用 Node 内置，EXIF 是精简自研解析器（Make/Model/DateTime/Orientation/ExposureTime/FNumber/ISO/FocalLength/LensModel）。

## 平台

Node ≥ 18（建议 24），全平台通用。

## 验证状态（2026-09-27）

- 单元测试：合成 A1111 参数 PNG（prompt/negative/settings 全字段拆分）、合成 EXIF TIFF（曝光/光圈/ISO/镜头）、真实 JPEG（System.Drawing 生成，尺寸解析）。
- MCP 端到端：握手、tools/list、image_meta 全路径、错误路径（不支持的格式、缺参数）。
- **未实测**：真实相机 JPEG 的 EXIF（用合成 TIFF 验证的解析器）、ComfyUI 真实 workflow JSON 的提取体验、URL 拉取（代码路径与本地共用）。
