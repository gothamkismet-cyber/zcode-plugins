// desktop-bridge MCP server for ZCode.
// Newline-delimited JSON-RPC over stdio, matching the official MCP SDK stdio
// transport used by ZCode's client. Windows-only: tools shell out to
// PowerShell 5.1 helper scripts (.ps1 kept pure ASCII; content crosses the
// process boundary via UTF-16 argv or raw UTF-8 stdin/stdout streams, never
// via BOM-less file encodings).

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, isAbsolute, resolve } from "node:path";

const NAME = "desktop-bridge";
const VERSION = "0.1.0";
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

// Opening a file with its default app is arbitrary code execution for these
// extensions; the open tool refuses them and suggests opening the folder.
const DENY_EXTS = new Set([
  ".exe", ".bat", ".cmd", ".com", ".scr", ".pif", ".vbs", ".vbe", ".js", ".jse",
  ".wsf", ".wsh", ".ps1", ".psm1", ".psd1", ".msi", ".msp", ".mst", ".hta",
  ".cpl", ".jar", ".lnk", ".url", ".reg", ".appx", ".msix",
]);

function runPs(script, args = [], input = null, timeoutMs = 15000) {
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(SCRIPTS_DIR, script), ...args],
    { input: input === null ? undefined : input, timeout: timeoutMs, encoding: "utf8", windowsHide: true },
  );
  return {
    status: r.status,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
    error: r.error,
  };
}

function psFailure(r, label) {
  const reason = r.error?.message || r.stderr || `exit=${r.status}`;
  return `desktop-bridge 出错（${label}）：${reason}`;
}

// --- macOS / Linux implementations (spawn native commands directly) ---

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

function runCmd(cmd, args, input = null, timeoutMs = 10000) {
  const r = spawnSync(cmd, args, { input: input === null ? undefined : input, timeout: timeoutMs, encoding: "utf8", windowsHide: true });
  return {
    status: r.status,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
    error: r.error,
    missing: Boolean(r.error && r.error.code === "ENOENT"),
  };
}

function unixClipboardRead() {
  if (IS_MAC) {
    const r = runCmd("pbpaste", [], null, 5000);
    return r.status === 0 ? r.stdout : null;
  }
  const candidates = process.env.WAYLAND_DISPLAY
    ? [["wl-paste", []], ["xclip", ["-selection", "clipboard", "-o"]], ["xsel", ["--clipboard", "--output"]]]
    : [["xclip", ["-selection", "clipboard", "-o"]], ["xsel", ["--clipboard", "--output"]], ["wl-paste", []]];
  for (const [cmd, args] of candidates) {
    const r = runCmd(cmd, args, null, 5000);
    if (r.status === 0 && !r.missing) return r.stdout;
  }
  return null;
}

function unixClipboardWrite(text) {
  if (IS_MAC) {
    const r = runCmd("pbcopy", [], text, 5000);
    return r.status === 0 ? { ok: true } : { error: r.error?.message || r.stderr || `exit=${r.status}` };
  }
  const candidates = process.env.WAYLAND_DISPLAY
    ? [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]]
    : [["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]], ["wl-copy", []]];
  for (const [cmd, args] of candidates) {
    const r = runCmd(cmd, args, text, 5000);
    if (r.status === 0 && !r.missing) return { ok: true };
  }
  return { error: `没有可用的剪贴板工具（尝试过 ${candidates.map(([c]) => c).join(" / ")}）。Linux 需要安装 xclip / xsel（X11）或 wl-clipboard（Wayland）。` };
}

function unixNotify(title, message) {
  if (IS_MAC) {
    // JSON.stringify yields a valid escaped AppleScript double-quoted string.
    const esc = (s) => JSON.stringify(s);
    return runCmd("osascript", ["-e", `display notification ${esc(message)} with title ${esc(title)}`], null, 10000);
  }
  return runCmd("notify-send", [title, message], null, 10000);
}

function openTarget(target) {
  return IS_WIN ? runPs("open.ps1", ["-Target", target], null, 15000) : runCmd(IS_MAC ? "open" : "xdg-open", [target], null, 15000);
}

function unixSysInfo() {
  const kToGb = (k) => Math.round(((Number(k) * 1024) / 1073741824) * 10) / 10;
  const disks = [];
  const df = runCmd("df", ["-k"], null, 8000);
  if (df.status === 0) {
    for (const line of df.stdout.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 6) continue;
      const [fsName, totalK, , availK, , mount] = cols;
      if (!mount || !mount.startsWith("/")) continue;
      if (/^(tmpfs|devtmpfs|udev|overlay|squashfs|efivarfs|shm)/.test(fsName) || fsName.startsWith("/dev/loop")) continue;
      if (IS_MAC && mount !== "/" && !mount.startsWith("/System/Volumes") && !mount.startsWith("/Volumes")) continue;
      disks.push({ mount, total_gb: kToGb(totalK), free_gb: kToGb(availK) });
    }
  }
  let osName = process.platform;
  let osVersion = os.release();
  if (IS_MAC) {
    const sw = runCmd("sw_vers", ["-productVersion"], null, 5000);
    if (sw.status === 0) {
      osName = "macOS";
      osVersion = sw.stdout;
    }
  } else {
    try {
      const pretty = readFileSync("/etc/os-release", "utf8").match(/^PRETTY_NAME="?([^"\n]+)"?/m);
      if (pretty) {
        osName = "Linux";
        osVersion = pretty[1];
      }
    } catch {
      // no os-release: keep uname-based fallback
    }
  }
  return {
    host: os.hostname(),
    user: os.userInfo().username,
    os: osName,
    os_version: osVersion,
    cpu_arch: process.arch,
    ram_total_gb: Math.round((os.totalmem() / 1073741824) * 10) / 10,
    ram_free_gb: Math.round((os.freemem() / 1073741824) * 10) / 10,
    uptime_hours: Math.round((os.uptime() / 3600) * 10) / 10,
    disks,
  };
}

function clipText(args) {
  const t = args.text ?? args.content;
  if (typeof t !== "string") return null;
  return t;
}

async function doClipboardRead() {
  if (!IS_WIN) {
    const text = unixClipboardRead();
    if (text === null) {
      return "desktop-bridge 出错（读取剪贴板）：没有可用的剪贴板工具。Linux 需要安装 xclip / xsel（X11）或 wl-clipboard（Wayland）。";
    }
    return JSON.stringify({ text, length: text.length, empty: text.length === 0 });
  }
  const r = runPs("clipboard-read.ps1", [], null, 10000);
  if (r.status !== 0) return psFailure(r, "读取剪贴板");
  return JSON.stringify({ text: r.stdout, length: r.stdout.length, empty: r.stdout.length === 0 });
}

async function doClipboardWrite(args) {
  const text = clipText(args);
  if (text === null) throw new Error("text 必填（字符串）。");
  if (!IS_WIN) {
    const r = unixClipboardWrite(text);
    if (r.error) return `desktop-bridge 出错（写入剪贴板）：${r.error}`;
    return JSON.stringify({ ok: true, length: text.length });
  }
  const r = runPs("clipboard-write.ps1", [], text, 10000);
  if (r.status !== 0) return psFailure(r, "写入剪贴板");
  return JSON.stringify({ ok: true, length: text.length });
}

async function doNotify(args) {
  const message = String(args.message ?? "").trim();
  const title = (String(args.title ?? "ZCode").trim() || "ZCode").slice(0, 64);
  if (!message) return "message 必填（通知正文）。";
  if (!IS_WIN) {
    const r = unixNotify(title, message.slice(0, 300));
    if (r.status !== 0) {
      const hint = r.missing ? "（macOS 用内置 osascript；Linux 需安装 libnotify 提供 notify-send）" : "";
      return `desktop-bridge 出错（系统通知）：${r.error?.message || r.stderr || `exit=${r.status}`}${hint}`;
    }
    return JSON.stringify({ ok: true, note: "通知命令执行成功；若系统开了勿扰/专注模式，弹窗可能被折叠。" });
  }
  const r = runPs("notify.ps1", ["-Title", title, "-Message", message.slice(0, 300)], null, 15000);
  if (r.status !== 0) return psFailure(r, "系统通知");
  return JSON.stringify({ ok: true, note: "通知 API 调用成功；若系统开了专注助手/勿扰，弹窗可能被折叠。" });
}

async function doOpenPath(args) {
  const target = String(args.target ?? "").trim();
  if (!target) throw new Error("target 必填（URL、文件夹或文件路径）。");
  if (/^https?:\/\//i.test(target)) {
    const r = openTarget(target);
    if (r.status !== 0) return psFailure(r, "打开 URL");
    return JSON.stringify({ ok: true, opened: target, kind: "url" });
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !isAbsolute(target)) {
    throw new Error(`已拒绝：只允许 http/https URL 或本地路径，不支持协议 ${target.split(":")[0]}://（防提示注入拉起任意处理器）。`);
  }
  const p = resolve(target);
  if (!existsSync(p)) throw new Error(`路径不存在：${p}`);
  let st;
  try {
    st = statSync(p);
  } catch (e) {
    throw new Error(`无法访问路径：${e.message}`);
  }
  if (st.isFile()) {
    const ext = extname(p).toLowerCase();
    if (DENY_EXTS.has(ext)) {
      throw new Error(`已拒绝：${ext} 是可执行类扩展名，打开它等于运行程序。如需要，请打开所在文件夹让你自己手动操作。`);
    }
  }
  const r = openTarget(p);
  if (r.status !== 0) return psFailure(r, "打开路径");
  return JSON.stringify({ ok: true, opened: p, kind: st.isDirectory() ? "folder" : "file" });
}

async function doSysInfo() {
  if (!IS_WIN) return JSON.stringify(unixSysInfo());
  const r = runPs("sysinfo.ps1", [], null, 20000);
  if (r.status !== 0) return psFailure(r, "系统信息");
  try {
    return JSON.stringify(JSON.parse(r.stdout));
  } catch {
    return `系统信息脚本输出异常：${r.stdout.slice(0, 200)}`;
  }
}

const TOOLS = [
  {
    name: "clipboard_read",
    description: "读取 Windows 剪贴板的文本内容（图片等非文本剪贴板返回空）。用户说\"看我复制的内容/把这段粘贴给你\"时用。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "clipboard_write",
    description: "把文本写入 Windows 剪贴板。用户说\"帮我复制这段/放到剪贴板\"时用。",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "要放入剪贴板的完整文本" } },
      required: ["text"],
    },
  },
  {
    name: "notify",
    description:
      "弹 Windows 系统通知（toast）。长任务（构建/下载/批量处理）完成后调用让用户知道；用户说\"做完提醒我\"时用它。勿扰模式下可能被折叠。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "通知标题，默认 ZCode，最长 64 字" },
        message: { type: "string", description: "通知正文，最长 300 字" },
      },
      required: ["message"],
    },
  },
  {
    name: "open_path",
    description:
      "用系统默认方式打开 URL（限 http/https）、文件夹或文件。安全护栏：拒绝可执行类扩展名（exe/bat/ps1 等）和非 http/https 协议。",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "https:// 网址、文件夹路径或文件路径" },
      },
      required: ["target"],
    },
  },
  {
    name: "sys_info",
    description: "查询本机系统信息：主机名/用户/系统版本/开机时长/CPU/内存/各磁盘剩余空间，JSON 返回。",
    inputSchema: { type: "object", properties: {} },
  },
];

async function callTool(params) {
  const { name, arguments: args = {} } = params || {};
  try {
    let text;
    if (name === "clipboard_read") text = await doClipboardRead();
    else if (name === "clipboard_write") text = await doClipboardWrite(args);
    else if (name === "notify") text = await doNotify(args);
    else if (name === "open_path") text = await doOpenPath(args);
    else if (name === "sys_info") text = await doSysInfo();
    else return { content: [{ type: "text", text: `未知工具：${name}` }], isError: true };
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const reason = err?.cause?.message || err?.message || String(err);
    return { content: [{ type: "text", text: `desktop-bridge 出错：${reason}` }], isError: true };
  }
}

createInterface({ input: process.stdin }).on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined || msg.id === null) return; // notification: no reply
  const send = (payload) => process.stdout.write(JSON.stringify(payload) + "\n");
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: NAME, version: VERSION },
      },
    });
  } else if (msg.method === "ping") {
    send({ jsonrpc: "2.0", id: msg.id, result: {} });
  } else if (msg.method === "tools/list") {
    send({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
  } else if (msg.method === "tools/call") {
    const result = await callTool(msg.params);
    send({ jsonrpc: "2.0", id: msg.id, result });
  } else {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
  }
});
