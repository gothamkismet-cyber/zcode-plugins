---
name: session-memory
description: Cross-session memory management for the session-memory plugin. Use when the user says 记住/记一下/保存到记忆/你记得吗/查看记忆/整理记忆 or "remember"/"save to memory", wants key points, decisions, preferences or progress persisted across sessions, or asks to review and clean up session memory.
---

# 会话记忆（session-memory）

ZCode 每个会话默认互不相通。本插件把长期有效的要点存进 Markdown 文件，SessionStart 钩子在每次会话开始时自动把记忆注入上下文，所以"读记忆"不用再读文件；"写记忆"才需要动文件。

## 两个记忆文件

| 文件 | 路径 | 放什么 |
| --- | --- | --- |
| 项目记忆 | `<当前工作区>/.zcode/memory.md` | 项目决定、约定、进度、踩过的坑 |
| 全局记忆 | `~/.zcode/memory/GLOBAL.md`（Windows 即 `C:\Users\<用户名>\.zcode\memory\GLOBAL.md`） | 跨项目的用户级偏好 |

- 会话开头注入的 `[session-memory]` 段落就是这两个文件的当前内容。
- 写记忆前必须先 Read 原文件再 Edit/Write，避免覆盖别人的内容。
- 文件不存在时直接创建；项目记忆首行为 `# 项目记忆`，全局记忆首行为 `# 全局记忆`。文件编码用 UTF-8。

## 什么时候写

- 用户明确说"记住""记一下""以后都这样"。
- 用户做出长期有效的决定：技术选型、命名约定、目录偏好、回复语言偏好。
- 排障中发现的、换个会话还会踩的环境坑。
- 不写：一次性任务细节、聊天过程，以及**任何密钥/token/密码/私密地址——绝对禁止**。

## 怎么写（保持精炼）

- 每条一行：`- [YYYY-MM-DD] 分类: 内容`，分类用 决定 / 偏好 / 约定 / 进度 / 坑。
- 合并同类项、改写过期条目、删掉失效条目。记忆是提纯摘要，不是流水账。
- 归属判断：只跟当前项目有关 → 项目记忆；跨项目仍成立的用户偏好 → 全局记忆；拿不准就放项目记忆，并告诉用户写到了哪里。
- 单文件超过约 150 行时，主动向用户提出清理（合并、或移到项目正式文档）。

## 配套命令

- `/remember <要点>`：快速写入（默认项目记忆；要点里写明"全局"则写全局记忆）。
- `/memory`：查看两份记忆并给出清理建议。
