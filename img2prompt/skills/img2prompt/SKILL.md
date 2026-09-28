---
name: img2prompt
description: Image-to-prompt (图生图提示词/反推提示词). Use when the user says 图片转提示词/图生图提示词/反推提示词/以图生图/复刻这张图的提示词, gives an image and wants generation prompts for Stable Diffusion / Midjourney / 即梦 / DALL-E style models, or wants to know what prompt generated an AI image. Provides image_meta tool + structured prompting workflow.
---

# 图片转生图提示词（img2prompt）

把任意图片转成高质量的生图提示词。核心原则：**先查嵌入参数，再看图分析**——AI 生成的图片经常在文件里带着原始提示词，直接复刻比看图猜准得多。

## 标准流程

1. **调 `image_meta`**（本地路径或 URL 均可）：
   - 命中 `generator: stable-diffusion/comfyui/novelai` → 拿到了原始 prompt/negative/settings，**直接复刻**，向用户说明"这是图里嵌的原始参数"。
   - 命中 `photo`（EXIF 相机参数）→ 记下焦距/光圈/曝光，用于写实方向的提示词。
   - `unknown` → 走第 2 步视觉分析。
2. **视觉分析**：用 Read 工具看图，按八维框架逐项提取——
   - 主体（谁/什么，动作，穿着，表情）
   - 风格媒介（照片/赛璐璐/厚涂/水彩/3D 渲染/像素…）
   - 构图视角（景别、机位角度、透视）
   - 光照（方向、软硬、色调、特殊光源）
   - 色彩（主色、配色方案、饱和度倾向）
   - 氛围情绪
   - 细节质感（材质、纹理、笔触）
   - 质量词（按目标模型习惯补）
3. **输出四种格式**（用户没指定就全给，代码块分列）：
   - **SD/通用 tag 式**：英文逗号分隔，重要词加 `(word:1.2)` 权重，质量词前置
   - **自然语言段**：中文或英文连贯描述（即梦/DALL·E 类模型友好）
   - **Midjourney 式**：英文短语 + 尾部 `--ar 宽:高 --v 7` 等参数建议
   - **负面提示词**：通用负面（lowres, bad anatomy…）+ 按图推断要避免的点
4. **图生图参数建议**：按用户目的给重绘幅度——微调 0.30-0.45、保持构图大改细节 0.50-0.65、仅借鉴构图 0.70-0.85；分辨率建议原图比例就近取 64 的倍数。

## 诚实规则

- 推测与事实分开：视觉推断的细节在自然语言版里可以用"看起来"，在 tag 式里直接给词，但要向用户说明哪些是推断。
- 不编造图中不存在的元素；用户要"脑补增强"时明确标注哪些是新增。
- 嵌入参数里的提示词原样呈现（包括可能存在的低质量词），可以附加你的优化建议但别混淆"原始"和"优化"。
