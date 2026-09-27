---
name: desktop-bridge
description: Windows desktop access via MCP tools. Use when the user says 看我复制的/剪贴板/clipboard, 帮我复制/放到剪贴板, 做完提醒我/弹通知/notify, 帮我打开文件夹/网页/打开这个文件, or asks about 电脑配置/磁盘空间/系统信息. Provides clipboard_read / clipboard_write / notify / open_path / sys_info.
---

# 桌面桥（desktop-bridge）

通过 MCP 给 ZCode 五个触达 Windows 桌面的工具：`clipboard_read`、`clipboard_write`、`notify`、`open_path`、`sys_info`。全部零依赖、走系统原生能力。

## 什么时候用

| 场景 | 工具 |
| --- | --- |
| 用户说"看我复制的内容""我贴了一段在剪贴板" | `clipboard_read`（拿到后直接分析，别让用户再贴一遍） |
| 用户说"帮我复制""放进剪贴板""复制结果" | `clipboard_write`（把最终成果放进去，别贴中间过程） |
| 长任务（构建/下载/批量处理）完成、用户说"做完提醒我" | `notify` |
| 用户说"打开这个文件夹/帮我打开这个网页" | `open_path` |
| 用户问电脑配置、磁盘还剩多少、开机多久了 | `sys_info` |

## 使用守则

1. **剪贴板可能含敏感信息**（密码、token）：读了之后只处理用户要的那件事，不要把内容复述到无关回复或写进任何文件。
2. **notify 用于"值得打扰"的时刻**：长任务收尾、用户明确要求提醒。每轮都弹通知是骚扰。
3. **open_path 的护栏是刻意的**：可执行类扩展名（exe/bat/ps1 等）和非 http/https 协议会被拒绝——打开它们等于在你机器上运行程序。被拒绝时向用户说明原因，建议手动操作。
4. sys_info 的 JSON 直接转述关键字段即可（磁盘剩余、内存占用），别整段贴原始 JSON。
