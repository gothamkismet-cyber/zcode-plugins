// session-memory plugin - SessionStart hook (cross-platform, Node >= 18).
// Loads global + project memory files and emits {"additionalContext": "..."}
// on stdout. JSON.stringify handles all escaping natively; stdout is UTF-8.
// Any failure exits 0 silently - a memory hook must never break session start.

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PerFileCap = 8000;

function readMemoryFile(path) {
  if (!path) return null;
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return null;
  } catch {
    return null;
  }
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  if (!content || !content.trim()) return null;
  content = content.replace(/\r\n/g, "\n").trim();
  if (content.length > PerFileCap) {
    content = content.slice(0, PerFileCap) + `\n[session-memory] file truncated at ${PerFileCap} chars - run /memory to clean it up`;
  }
  return content;
}

try {
  const globalPath = join(homedir(), ".zcode", "memory", "GLOBAL.md");
  const projectDir = process.env.ZCODE_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR;
  const projectPath = projectDir ? join(projectDir, ".zcode", "memory.md") : null;

  const sections = [];
  const global = readMemoryFile(globalPath);
  const project = readMemoryFile(projectPath);
  if (global) sections.push("== global memory ==\n" + global);
  if (project) sections.push("== project memory ==\n" + project);

  if (sections.length > 0) {
    const header =
      "[session-memory] Loaded saved memory below. When the user asks to remember something or makes a long-term decision, update the matching file (rewrite stale entries instead of appending forever; never store secrets).\n" +
      "Memory files:\n" +
      "- global (all projects): " + globalPath + "\n" +
      "- project (this workspace): " + (projectPath ?? "(not available)");
    process.stdout.write(JSON.stringify({ additionalContext: header + "\n\n" + sections.join("\n\n") }));
  }
} catch {
  // swallow: empty output is valid and keeps the session clean
}
