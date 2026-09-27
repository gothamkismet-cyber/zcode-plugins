# session-memory（会话记忆）

给 ZCode 补上跨会话记忆能力：每个会话开始时自动加载记忆文件注入上下文；写入通过 `/remember`、`/memory` 命令和 `session-memory` 技能完成。

## 记忆存在哪里

- 项目记忆：`<工作区>/.zcode/memory.md`（跟项目走，可提交 git）
- 全局记忆：`~/.zcode/memory/GLOBAL.md`（跨项目用户偏好；卸载插件后文件仍在）

## 工作方式

- `hooks/load-memory.ps1`：SessionStart 钩子（process 型，无 shell，10 秒超时），读取上面两个文件（UTF-8），单文件超过 8000 字符截断，输出 `{"additionalContext": ...}` 注入对话。
- 两个记忆文件都不存在时零输出、零上下文占用。
- 匹配所有 SessionStart 来源：startup / resume / clear / compact。
- 钩子脚本刻意写成纯 ASCII 并把内容转义为 `\uXXXX` 输出，规避 Windows PowerShell 5.1 的 ANSI 代码页乱码问题。

## 平台限制

- 本版本钩子加载器用 Windows PowerShell 5.1（`powershell.exe`），仅支持 Windows。macOS/Linux 需另补一个 bash 版加载器。

## 验证状态

- 记忆文件请用 UTF-8 保存（ZCode 自带文件工具默认 UTF-8）。
- 实机验证方法：安装插件后新开会话，上下文开头应出现 `[session-memory]` 段落（需至少一个记忆文件存在）。
