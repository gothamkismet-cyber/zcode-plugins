# desktop-bridge（桌面桥）

通过 MCP 给 ZCode 五个触达 Windows 桌面的工具：`clipboard_read` / `clipboard_write` / `notify` / `open_path` / `sys_info`。零第三方依赖，全部走系统原生能力（PowerShell 5.1 + WinRT 通知）。

## 工具一览

| 工具 | 作用 | 实现 |
| --- | --- | --- |
| `clipboard_read` | 读剪贴板文本（非文本剪贴板返回空） | `Get-Clipboard` |
| `clipboard_write` | 写剪贴板（文本经 stdin 原始 UTF-8 流传入） | `Set-Clipboard` |
| `notify` | Windows toast 弹窗通知（标题+正文） | WinRT `ToastNotificationManager` |
| `open_path` | 打开 URL/文件夹/文件 | `Start-Process` + node 层护栏 |
| `sys_info` | 系统信息 JSON（系统/内存/CPU/磁盘） | `Get-CimInstance` |

## 安全护栏

- `open_path` 拒绝可执行类扩展名（.exe/.bat/.cmd/.ps1/.msi/.lnk 等 26 种）——用默认程序打开它们等于运行程序。
- `open_path` 只允许 `http/https` URL 和本地路径；`file://`、自定义协议一律拒绝（防提示注入拉起任意协议处理器）。
- 通知标题限 64 字、正文限 300 字；剪贴板内容只在工具结果里返回一次，不做持久化。

## 设计说明

- 没有做"任务完成自动通知"的 Stop 钩子：ZCode 的 Stop 事件每轮回复都会触发，挂钩子会通知轰炸。改为模型主动调 `notify`（技能里约定长任务收尾时调用）。
- 所有 .ps1 刻意纯 ASCII：PowerShell 5.1 读无 BOM 脚本按 ANSI 代码页解码，非 ASCII 字面量会乱码；中文内容经 UTF-16 命令行参数或原始 UTF-8 流跨越进程边界，不经脚本文件。

## 平台

仅 Windows（PowerShell 5.1 系统自带；toast 需 Windows 10/11）。Node ≥ 18（建议 24）。

## 验证状态（2026-09-27，本机实测）

- MCP 全链路 + 5 工具：剪贴板中英文往返、通知 API 调用成功、临时文件夹打开、sys_info JSON 解析、护栏拒绝路径（exe/file:// 协议）全部通过。
- **未验证**：toast 实际弹窗的视觉效果（API 成功 ≠ 一定可见，专注助手会折叠）；`notify` 在锁屏/全屏场景的表现。
