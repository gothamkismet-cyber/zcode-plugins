---
description: 把图片转成生图提示词（SD tag 式 / 自然语言 / Midjourney / 负面提示词 + 图生图参数建议）
---

对下面这个图片执行 img2prompt 流程：

$ARGUMENTS

要求：

1. 参数为空时，先问用户要图片的本地路径或 URL，不要凭空编造。
2. 先调 `image_meta` 工具查嵌入参数；命中 AI 生成参数（SD/ComfyUI/NovelAI）就直接复刻原始提示词并说明来源。
3. 没有嵌入参数时用 Read 看图，按技能里的八维框架分析。
4. 按技能要求输出四种格式（SD tag 式、自然语言、Midjourney、负面提示词）和图生图重绘幅度/分辨率建议；推测内容明确标注。
