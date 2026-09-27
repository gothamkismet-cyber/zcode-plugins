// steam-workshop MCP server for ZCode.
// Newline-delimited JSON-RPC over stdio, matching the official MCP SDK stdio
// transport used by ZCode's client (same framing as the plugin-creator scaffold).
// Zero dependencies; Node >= 24 recommended (--use-system-ca flag is passed by
// .mcp.json because TLS interception by local proxies breaks fetch otherwise).
//
// v0.2.0: RimWorld mod code inspection - locate local workshop content,
// download via steamcmd as fallback, analyze mod structure and integration
// points (About.xml, loadFolders, MayRequire, PatchOperations, Harmony), read
// and grep files inside a mod folder with path containment.

import { createInterface } from "node:readline";
import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve, relative, isAbsolute, extname, basename } from "node:path";

const NAME = "steam-workshop";
const VERSION = "0.2.0";
const UA = "Mozilla/5.0 (compatible; zcode-steam-workshop/0.2.0)";
const COOKIE = "Steam_Language=english";
const CONFIG_PATH = join(homedir(), ".zcode", "steam-workshop.json");
const TIMEOUT_MS = 20000;
const STEAMCMD_TIMEOUT_MS = 600000;

const TEXT_EXTS = new Set([".xml", ".cs", ".json", ".txt", ".md", ".lua", ".py", ".vdf", ".ini", ".cfg", ".yaml", ".yml", ".h", ".hpp", ".cpp", ".log", ".version"]);

function readConfig() {
  const raw = {};
  try {
    if (existsSync(CONFIG_PATH)) Object.assign(raw, JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
  } catch {
    // malformed config: fall back to defaults, keep apiKey from env
  }
  return {
    apiKey: (process.env.STEAM_API_KEY || "").trim() || (typeof raw.steamApiKey === "string" ? raw.steamApiKey.trim() : "") || null,
    steamcmdPath: typeof raw.steamcmdPath === "string" ? raw.steamcmdPath : null,
    steamPath: typeof raw.steamPath === "string" ? raw.steamPath : null,
    downloadRoot: typeof raw.downloadRoot === "string" ? raw.downloadRoot : join(homedir(), ".zcode", "steam-workshop-downloads"),
    steamLibraries: Array.isArray(raw.steamLibraries) ? raw.steamLibraries.filter((v) => typeof v === "string") : [],
  };
}

function jsonOut(obj) {
  return JSON.stringify(obj, null, 1);
}

async function httpText(url, init = {}) {
  const headers = { "User-Agent": UA, Cookie: COOKIE, ...(init.headers || {}) };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, headers, signal: controller.signal });
    return { status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function cleanDescription(s, cap = 1500) {
  const text = decodeEntities(String(s || ""))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > cap ? text.slice(0, cap) + " …[截断]" : text;
}

function iso(ts) {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

// ---------------------------------------------------------------------------
// Steam libraries & mod resolution
// ---------------------------------------------------------------------------

function isNonEmptyDir(p) {
  try {
    return statSync(p).isDirectory() && readdirSync(p).length > 0;
  } catch {
    return false;
  }
}

function steamRootCandidates(cfg) {
  const list = [cfg.steamPath];
  if (process.platform === "win32") {
    list.push(join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Steam"));
    list.push(join(process.env.ProgramFiles || "C:\\Program Files", "Steam"));
  } else if (process.platform === "darwin") {
    list.push(join(homedir(), "Library", "Application Support", "Steam"));
  } else {
    list.push(
      join(homedir(), ".steam", "steam"),
      join(homedir(), ".local", "share", "Steam"),
      join(homedir(), "Steam"),
      join(homedir(), ".var", "app", "com.valvesoftware.Steam", ".steam", "steam")
    );
  }
  return [...new Set(list.filter(Boolean))];
}

function findSteamLibraries(cfg) {
  const roots = new Set();
  for (const p of cfg.steamLibraries) roots.add(resolve(p));
  for (const steamRoot of steamRootCandidates(cfg)) {
    const vdf = join(steamRoot, "steamapps", "libraryfolders.vdf");
    try {
      if (!existsSync(vdf)) continue;
      const text = readFileSync(vdf, "utf8");
      for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) roots.add(resolve(m[1].replace(/\\\\/g, "\\")));
      roots.add(resolve(steamRoot)); // the Steam install itself is always a library
    } catch {
      // unreadable vdf: skip this candidate
    }
  }
  return [...roots];
}

function findSteamcmd(cfg) {
  const candidates = [];
  if (cfg.steamcmdPath) candidates.push(cfg.steamcmdPath);
  if (process.env.STEAMCMD_PATH) candidates.push(process.env.STEAMCMD_PATH);
  if (process.platform === "win32") {
    candidates.push(join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Steam", "steamcmd.exe"));
    for (const dir of (process.env.PATH || "").split(";")) {
      if (dir.trim()) candidates.push(join(dir.trim(), "steamcmd.exe"));
    }
  } else {
    for (const dir of (process.env.PATH || "").split(":")) {
      if (dir.trim()) candidates.push(join(dir.trim(), "steamcmd"));
    }
    candidates.push(join(homedir(), "steamcmd", "steamcmd.sh"));
    candidates.push("/usr/local/bin/steamcmd");
    candidates.push("/opt/homebrew/bin/steamcmd");
  }
  for (const p of candidates) {
    try {
      if (existsSync(p)) return { exe: p, prefix: p.endsWith(".sh") ? ["bash"] : [] };
    } catch {
      // skip unreadable candidate
    }
  }
  return null;
}

function findLocalMod(appid, id, libraries) {
  for (const lib of libraries) {
    const p = join(lib, "steamapps", "workshop", "content", String(appid), String(id));
    if (isNonEmptyDir(p)) return p;
  }
  return null;
}

async function steamcmdDownload(appid, id, cfg) {
  const steamcmd = findSteamcmd(cfg);
  if (!steamcmd) {
    throw new Error(
      "找不到 steamcmd，无法下载。安装：developer.valvesoftware.com/wiki/SteamCMD（Windows 下载解压后把 steamcmd.exe 路径写进配置 steamcmdPath；Linux/macOS 见同页，macOS 也可 brew install steamcmd）。也可以先在 Steam 里订阅该物品走本地路径。"
    );
  }
  await mkdir(cfg.downloadRoot, { recursive: true });
  const args = [...steamcmd.prefix, "+force_install_dir", cfg.downloadRoot, "+login", "anonymous", "+workshop_download_item", String(appid), String(id), "+quit"];
  const child = spawn(steamcmd.exe, args, { shell: false });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const exitCode = await new Promise((res, rej) => {
    const t = setTimeout(() => {
      child.kill();
      rej(new Error("steamcmd 下载超时（10 分钟）。重试会续传；特大 mod 建议直接在 Steam 客户端订阅后走本地路径。"));
    }, STEAMCMD_TIMEOUT_MS);
    child.on("exit", (c) => {
      clearTimeout(t);
      res(c);
    });
    child.on("error", (e) => {
      clearTimeout(t);
      rej(e);
    });
  });
  const dest = join(cfg.downloadRoot, "steamapps", "workshop", "content", String(appid), String(id));
  if (!isNonEmptyDir(dest)) {
    const tail = out.slice(-600).replace(/\s+/g, " ").trim();
    if (/No subscription|Not logged in|ERROR.*login/i.test(out)) {
      throw new Error(`steamcmd 拒绝下载（该游戏或物品不支持匿名下载）：${tail}。处理：在 Steam 客户端登录并订阅，或运行一次 steamcmd 交互式 login 缓存账号。`);
    }
    throw new Error(`steamcmd 下载未产出内容（exit=${exitCode}）：${tail}`);
  }
  return { path: dest, from: "steamcmd" };
}

async function resolveModPath(args, prefer = "auto") {
  const direct = typeof args.path === "string" && args.path.trim();
  if (direct) {
    const p = resolve(args.path.trim());
    if (!isNonEmptyDir(p)) throw new Error(`目录不存在或为空：${p}`);
    return { path: p, from: "local-path" };
  }
  const appid = Number(args.appid);
  const id = Number(args.publishedfileid ?? args.id);
  if (!Number.isInteger(appid) || appid <= 0 || !Number.isInteger(id) || id <= 0) {
    throw new Error("需要 path（本地 mod 目录），或 appid + publishedfileid（两个整数）。");
  }
  const cfg = readConfig();
  const libraries = findSteamLibraries(cfg);
  // prefer="download" means a forced fresh copy: bypass local and cache entirely.
  const local = prefer === "download" ? null : findLocalMod(appid, id, libraries);
  if (local) return { path: local, from: "local-workshop" };
  const cached = prefer === "download" ? null : findLocalMod(appid, id, [cfg.downloadRoot]);
  if (cached) return { path: cached, from: "download-cache" };
  if (prefer === "local") {
    throw new Error(
      `本机 Steam 库和下载缓存都没有 appid=${appid} 的物品 ${id}。已扫描库：${libraries.join(" ; ") || "（无，检查 ~/.zcode/steam-workshop.json 的 steamLibraries）"}。处理：Steam 订阅后重试、配置 steamLibraries、或允许 steamcmd 下载（prefer=auto/download）。`
    );
  }
  return steamcmdDownload(appid, id, cfg);
}

// ---------------------------------------------------------------------------
// Filesystem helpers (containment, caps, text sniffing)
// ---------------------------------------------------------------------------

function isInsideRoot(root, target) {
  const rel = relative(resolve(root), resolve(target));
  if (rel === "") return true;
  if (isAbsolute(rel) || rel.startsWith("..")) return false;
  // Windows case-insensitivity: compare lowercased absolute prefixes as fallback
  const a = resolve(root).toLowerCase();
  const b = resolve(target).toLowerCase();
  return b === a || b.startsWith(a + "\\") || b.startsWith(a + "/");
}

function walkFiles(root, cap = 4000) {
  const acc = [];
  const stack = [root];
  while (stack.length && acc.length < cap) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (acc.length >= cap) break;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        acc.push({ dir: full });
        stack.push(full);
      } else if (e.isFile()) {
        let size = 0;
        try {
          size = statSync(full).size;
        } catch {}
        acc.push({ file: full, size });
      }
    }
  }
  return acc;
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function readTextFile(file, maxBytes = 300000) {
  let size = 0;
  try {
    size = statSync(file).size;
  } catch {}
  // Partial read: never buffer the whole file just to cap the bytes we keep.
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(Math.min(size || maxBytes, maxBytes));
    const read = readSync(fd, buf, 0, buf.length, 0);
    const capped = buf.subarray(0, read);
    if (looksBinary(capped)) return { error: "二进制文件，拒绝读取" };
    return { text: capped.toString("utf8"), truncated: size > maxBytes, size };
  } finally {
    closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// RimWorld mod parsing
// ---------------------------------------------------------------------------

function tagInner(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : null;
}

function parseLiList(block) {
  if (!block) return [];
  return [...block.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1].trim()).filter(Boolean);
}

function parseAboutXml(xml) {
  const depsBlock = tagInner(xml, "modDependencies");
  const deps = depsBlock
    ? [...depsBlock.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => ({
        packageId: (m[1].match(/<packageId(?:\s[^>]*)?>([\s\S]*?)<\/packageId>/i)?.[1] || "").trim(),
        isOptional: /<isOptional(?:\s[^>]*)?>\s*true/i.test(m[1]),
        displayName: (m[1].match(/<displayName(?:\s[^>]*)?>([\s\S]*?)<\/displayName>/i)?.[1] || "").trim() || undefined,
      }))
    : [];
  return {
    name: tagInner(xml, "name"),
    author: tagInner(xml, "author"),
    packageId: tagInner(xml, "packageId"),
    supportedVersions: parseLiList(tagInner(xml, "supportedVersions")),
    modDependencies: deps,
    loadBefore: parseLiList(tagInner(xml, "loadBefore")),
    loadAfter: parseLiList(tagInner(xml, "loadAfter")),
    describedTitle: tagInner(xml, "descriptiveName") || undefined,
  };
}

function parseLoadFolders(xml) {
  const entries = [];
  for (const m of xml.matchAll(/<(v\d[\w.]*)>([\s\S]*?)<\/\1>/g)) {
    for (const li of m[2].matchAll(/<li([^>]*)>([\s\S]*?)<\/li>/g)) {
      const attrs = li[1] || "";
      entries.push({
        version: m[1],
        folder: li[2].trim(),
        ifModActive: attrs.match(/ifModActive="([^"]+)"/)?.[1] || null,
        ifModNotActive: attrs.match(/ifModNotActive="([^"]+)"/)?.[1] || null,
      });
    }
  }
  return entries;
}

function mayRequiresIn(xml) {
  const plain = new Set();
  const anyOf = new Set();
  for (const m of xml.matchAll(/MayRequire="([^"]+)"/g)) plain.add(m[1].trim());
  for (const m of xml.matchAll(/MayRequireAnyOf="([^"]+)"/g)) {
    for (const part of m[1].split(",")) if (part.trim()) anyOf.add(part.trim());
  }
  return { plain: [...plain], anyOf: [...anyOf] };
}

function analyzeContentRoot(rootDir, warnings, sectionsOnly = null) {
  const result = {
    root: rootDir,
    defsByType: {},
    defNamesSample: [],
    mayRequire: {},
    mayRequireAnyOf: {},
    patchOperations: {},
    patchSuccessAlways: 0,
    patchFiles: 0,
    defFiles: 0,
    assemblies: [],
    assemblyMarkers: {},
    sourceFiles: 0,
    harmonyPatches: [],
    staticConstructorOnStartup: 0,
    modClasses: [],
    defOfClasses: [],
    languages: [],
  };
  const entries = walkFiles(rootDir, 4000);
  const files = entries.filter((e) => e.file);
  // With loadFolders layouts, Source/Assemblies/Languages live at the mod root
  // while Defs/Patches live in version folders; sectionsOnly restricts a root
  // scan to those so content folders are not double-counted.
  const wants = (rel) => !sectionsOnly || sectionsOnly.has(rel.split(/[\\/]/)[0]);
  let textBudget = 3 * 1024 * 1024;

  for (const f of files) {
    const rel = relative(rootDir, f.file);
    const ext = extname(f.file).toLowerCase();
    if (ext === ".dll" && wants(rel)) result.assemblies.push({ file: rel, size: f.size });
  }
  const dirsTop = {};
  for (const f of files) {
    const top = relative(rootDir, f.file).split(/[\\/]/)[0];
    dirsTop[top] = (dirsTop[top] || 0) + 1;
  }
  result.topLevelFiles = dirsTop;

  const languagesDir = join(rootDir, "Languages");
  try {
    if (statSync(languagesDir).isDirectory()) result.languages = readdirSync(languagesDir).filter((d) => !d.startsWith("."));
  } catch {}

  // Assemblies: binary marker scan (best-effort heuristic, first 4MB each)
  for (const a of result.assemblies.slice(0, 10)) {
    try {
      const buf = readFileSync(join(rootDir, a.file)).subarray(0, 4 * 1024 * 1024);
      const s = buf.toString("latin1");
      result.assemblyMarkers[a.file] = {
        HarmonyPatch: s.includes("HarmonyPatch"),
        StaticConstructorOnStartup: s.includes("StaticConstructorOnStartup"),
        ModExtension: s.includes("ModExtension"),
      };
    } catch {}
  }

  for (const f of files) {
    const ext = extname(f.file).toLowerCase();
    if (!TEXT_EXTS.has(ext) || f.size > 2 * 1024 * 1024) continue;
    const rel = relative(rootDir, f.file).replace(/\\/g, "/");
    if (!wants(relative(rootDir, f.file))) continue;
    const inDefs = /(^|\/)Defs(\/|$)/i.test(rel);
    const inPatches = /(^|\/)Patches(\/|$)/i.test(rel);
    if (ext === ".cs") {
      result.sourceFiles++;
      if (textBudget <= 0) continue;
      let text;
      try {
        text = readFileSync(f.file, "utf8");
      } catch {
        continue;
      }
      textBudget -= text.length;
      for (const m of text.matchAll(/\[HarmonyPatch\b([^\]]*)\]/g)) {
        if (result.harmonyPatches.length < 40) {
          result.harmonyPatches.push({ file: rel, annotation: m[1].replace(/\s+/g, " ").trim().slice(0, 200) });
        }
      }
      if (/\[StaticConstructorOnStartup\]/.test(text)) result.staticConstructorOnStartup++;
      for (const m of text.matchAll(/class\s+(\w+)\s*:\s*Mod\b/g)) if (result.modClasses.length < 10) result.modClasses.push(m[1]);
      for (const m of text.matchAll(/class\s+(\w*DefOf)\b/g)) if (result.defOfClasses.length < 10) result.defOfClasses.push(m[1]);
      continue;
    }
    if (ext !== ".xml") continue;
    let xml;
    try {
      xml = readFileSync(f.file, "utf8");
    } catch {
      continue;
    }
    if (inDefs) {
      result.defFiles++;
      for (const m of xml.matchAll(/<(\w+Def)[\s>]/g)) result.defsByType[m[1]] = (result.defsByType[m[1]] || 0) + 1;
      for (const m of xml.matchAll(/<defName>([^<]{1,120})<\/defName>/g)) {
        if (result.defNamesSample.length < 300) result.defNamesSample.push(m[1].trim());
      }
    }
    if (inPatches) {
      result.patchFiles++;
      for (const m of xml.matchAll(/Class="(PatchOperation\w*)"/g)) result.patchOperations[m[1]] = (result.patchOperations[m[1]] || 0) + 1;
      if (/<success>\s*Always\s*<\/success>/i.test(xml)) result.patchSuccessAlways++;
    }
    if (inDefs || inPatches) {
      const mr = mayRequiresIn(xml);
      for (const pkg of mr.plain) {
        result.mayRequire[pkg] = result.mayRequire[pkg] || [];
        if (result.mayRequire[pkg].length < 6) result.mayRequire[pkg].push(rel);
      }
      for (const pkg of mr.anyOf) {
        result.mayRequireAnyOf[pkg] = result.mayRequireAnyOf[pkg] || [];
        if (result.mayRequireAnyOf[pkg].length < 6) result.mayRequireAnyOf[pkg].push(rel);
      }
    }
  }
  if (entries.length >= 4000) warnings.push("文件数超上限 4000，结构扫描被截断（不影响 About/loadFolders 解析）");
  if (textBudget <= 0) warnings.push("C#/文本扫描达到 3MB 预算上限，部分源码未扫描");
  return result;
}

function analyzeMod({ path: modPath, from, prefer }) {
  const warnings = [];
  const aboutCandidates = ["About/About.xml", "About/AboutEnglish.xml"].map((p) => join(modPath, p));
  let aboutXmlPath = aboutCandidates.find((p) => existsSync(p)) || null;
  if (!aboutXmlPath) {
    try {
      const aboutDir = join(modPath, "About");
      if (statSync(aboutDir).isDirectory()) {
        const anyXml = readdirSync(aboutDir).find((n) => n.toLowerCase().endsWith(".xml") && !n.toLowerCase().includes("backstories"));
        if (anyXml) aboutXmlPath = join(aboutDir, anyXml);
      }
    } catch {}
  }

  let loadFoldersXml = null;
  for (const p of [join(modPath, "loadFolders.xml"), join(modPath, "About", "loadFolders.xml")]) {
    if (existsSync(p)) {
      loadFoldersXml = readTextFile(p, 200000);
      if (loadFoldersXml.text) loadFoldersXml = loadFoldersXml.text;
      else loadFoldersXml = null;
      break;
    }
  }

  let contentRoots = ["."];
  let conditionalFolders = [];
  if (loadFoldersXml) {
    const parsed = parseLoadFolders(loadFoldersXml);
    conditionalFolders = parsed.filter((e) => e.ifModActive || e.ifModNotActive);
    const names = [...new Set(parsed.map((e) => e.folder))];
    if (names.length) contentRoots = names;
  } else {
    const versionDirs = [];
    try {
      for (const e of readdirSync(modPath, { withFileTypes: true })) {
        if (e.isDirectory() && /^\d+(\.\d+)*$/.test(e.name)) versionDirs.push(e.name);
      }
    } catch {}
    if (versionDirs.length) contentRoots = versionDirs;
  }

  const about = aboutXmlPath ? parseAboutXml(readTextFile(aboutXmlPath, 200000).text || "") : null;
  const roots = contentRoots.map((r) => (r === "." ? modPath : join(modPath, r))).filter((p) => isNonEmptyDir(p));
  const perRoot = roots.map((r) => analyzeContentRoot(r, warnings));
  let rootExtra = null;
  if (loadFoldersXml) {
    rootExtra = analyzeContentRoot(modPath, warnings, new Set(["Source", "Assemblies", "Languages"]));
  }

  const mergeUnique = (arr, cap = 60) => [...new Set(arr)].slice(0, cap);
  const merged = {
    contentRoots: roots,
    defsByType: {},
    patchOperations: {},
    mayRequire: {},
    mayRequireAnyOf: {},
    assemblies: [],
    harmonyPatches: [],
  };
  for (const r of perRoot) {
    for (const [k, v] of Object.entries(r.defsByType)) merged.defsByType[k] = (merged.defsByType[k] || 0) + v;
    for (const [k, v] of Object.entries(r.patchOperations)) merged.patchOperations[k] = (merged.patchOperations[k] || 0) + v;
    for (const [k, v] of Object.entries(r.mayRequire)) merged.mayRequire[k] = mergeUnique([...(merged.mayRequire[k] || []), ...v], 8);
    for (const [k, v] of Object.entries(r.mayRequireAnyOf)) merged.mayRequireAnyOf[k] = mergeUnique([...(merged.mayRequireAnyOf[k] || []), ...v], 8);
    merged.assemblies.push(...r.assemblies);
    merged.harmonyPatches.push(...r.harmonyPatches);
  }
  if (rootExtra) {
    merged.assemblies.push(...rootExtra.assemblies);
    merged.harmonyPatches.push(...rootExtra.harmonyPatches);
  }

  return jsonOut({
    path: modPath,
    source: from,
    isRimWorldStyle: Boolean(aboutXmlPath),
    about: about || null,
    loadFolders: loadFoldersXml ? parseLoadFolders(loadFoldersXml) : null,
    contentRoots: roots,
    integrationPoints: {
      modDependencies: about?.modDependencies ?? [],
      loadBefore: about?.loadBefore ?? [],
      loadAfter: about?.loadAfter ?? [],
      mayRequire: merged.mayRequire,
      mayRequireAnyOf: merged.mayRequireAnyOf,
      conditionalFolders,
      harmonyPatches: merged.harmonyPatches,
    },
    structure: {
      defsByType: merged.defsByType,
      patchOperations: merged.patchOperations,
      patchSuccessAlways: perRoot.reduce((n, r) => n + r.patchSuccessAlways, 0),
      assemblies: merged.assemblies.slice(0, 20),
      assemblyMarkers: Object.fromEntries(perRoot.flatMap((r) => Object.entries(r.assemblyMarkers)).concat(rootExtra ? Object.entries(rootExtra.assemblyMarkers) : [])),
      sourceFiles: perRoot.reduce((n, r) => n + r.sourceFiles, 0) + (rootExtra?.sourceFiles || 0),
      staticConstructorOnStartup: perRoot.reduce((n, r) => n + r.staticConstructorOnStartup, 0) + (rootExtra?.staticConstructorOnStartup || 0),
      modClasses: mergeUnique(perRoot.flatMap((r) => r.modClasses).concat(rootExtra?.modClasses || [])),
      defOfClasses: mergeUnique(perRoot.flatMap((r) => r.defOfClasses).concat(rootExtra?.defOfClasses || [])),
      languages: mergeUnique(perRoot.flatMap((r) => r.languages).concat(rootExtra?.languages || [])),
      defNamesSample: mergeUnique(perRoot.flatMap((r) => r.defNamesSample), 300),
      topLevelFiles: Object.fromEntries(roots.map((r, i) => [contentRoots[i] ?? basename(r), perRoot[i].topLevelFiles])),
    },
    warnings,
    hints: {
      联动适配: "mayRequire/mayRequireAnyOf/conditionalFolders 是这个 mod 声明的可选联动；harmonyPatches 是它改游戏行为的注入点；modDependencies/loadAfter 决定加载顺序。写兼容补丁时对照这些点。",
      仅DLL: merged.assemblies.length && !(rootExtra?.sourceFiles || 0) && !perRoot.some((r) => r.sourceFiles) ? "该 mod 只有 DLL 没有源码；assemblyMarkers 是二进制特征启发式。深度分析需先用 ILSpy/dnSpy 反编译。": undefined,
    },
  });
}

// ---------------------------------------------------------------------------
// Tools: search / details / status (v0.1.0 behavior, refactored config)
// ---------------------------------------------------------------------------

// Keyless search: the modern community browse page renders items with hashed
// CSS classes, but two anchors are stable: item links contain
// "sharedfiles/filedetails/?id=<ID>" and each item's preview image carries the
// title in its alt attribute. Sidebar/related items can leak in, so results are
// capped at 20 in document order.
function extractBrowseItems(html, cap = 20) {
  const re = /sharedfiles\/filedetails\/\?id=(\d+)"[\s\S]{0,3000}?alt="([^"]+)"/g;
  const seen = new Map();
  let m;
  while ((m = re.exec(html)) && seen.size < cap) {
    if (!seen.has(m[1])) seen.set(m[1], { publishedfileid: m[1], title: decodeEntities(m[2]) });
  }
  return [...seen.values()];
}

async function doSearch(args) {
  const query = String(args.query ?? "").trim();
  const appid = Number(args.appid);
  const page = Math.max(1, Number(args.page) || 1);
  if (!query) return "query 不能为空。";
  if (!Number.isInteger(appid) || appid <= 0) {
    return "appid 必须是游戏 AppID 整数（商店页 URL store.steampowered.com/app/<AppID>/ 里的数字；技能里有常用对照表）。";
  }

  const cfg = readConfig();
  if (cfg.apiKey) {
    const u = new URL("https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/");
    u.searchParams.set("key", cfg.apiKey);
    u.searchParams.set("appid", String(appid));
    u.searchParams.set("search_text", query);
    u.searchParams.set("query_type", "9"); // text search ranked by relevance
    u.searchParams.set("numperpage", "20");
    u.searchParams.set("page", String(page));
    u.searchParams.set("return_metadata", "true");
    const { status, text } = await httpText(u);
    if (status !== 200) {
      return `QueryFiles HTTP ${status}${status === 403 ? "（API key 无效或被拒）" : ""}：${text.slice(0, 200)}`;
    }
    const items = JSON.parse(text)?.response?.publishedfiledetails ?? [];
    return JSON.stringify({
      mode: "api",
      page,
      count: items.length,
      items: items.map((d) => ({
        publishedfileid: String(d.publishedfileid),
        title: d.title,
        subscriptions: d.subscriptions ?? null,
        favorited: d.favorited ?? null,
        file_size: d.file_size ?? null,
        time_updated: iso(d.time_updated),
        tags: (d.tags || []).map((t) => t.tag).slice(0, 8),
        url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${d.publishedfileid}`,
      })),
    });
  }

  const url =
    `https://steamcommunity.com/workshop/browse/?appid=${appid}` +
    `&searchtext=${encodeURIComponent(query)}&browsesort=textsearch&section=ReadyToUseItems&p=${page}`;
  const { status, text } = await httpText(url);
  if (status !== 200) {
    return `创意工坊搜索页 HTTP ${status}（本机可能无法直连 steamcommunity，需代理）`;
  }
  const items = extractBrowseItems(text);
  if (items.length === 0) {
    return JSON.stringify({ mode: "scrape", page, count: 0, items: [], note: "未解析到物品：可能确实无结果，也可能页面结构变化，可用 workshop_status 诊断。" });
  }
  return JSON.stringify({
    mode: "scrape",
    page,
    count: items.length,
    items,
    note: "免 key 降级模式：只有 id 和标题。把 id 传给 workshop_details 拿完整数据；要分析代码用 mod_analyze（appid + publishedfileid）。",
  });
}

async function doDetails(args) {
  const ids = [].concat(args.ids ?? args.id ?? [])
    .map((v) => parseInt(v, 10))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 20);
  if (ids.length === 0) return "ids 必须是 1-20 个创意工坊物品 ID（数字）。";

  const form = new URLSearchParams();
  form.set("itemcount", String(ids.length));
  ids.forEach((id, i) => form.set(`publishedfileids[${i}]`, String(id)));
  const { status, text } = await httpText(
    "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/",
    { method: "POST", body: form },
  );
  if (status !== 200) return `GetPublishedFileDetails HTTP ${status}：${text.slice(0, 200)}`;
  const list = JSON.parse(text)?.response?.publishedfiledetails;
  if (!Array.isArray(list)) return "接口响应缺少 publishedfiledetails 字段。";

  const items = list.map((d) => {
    if (d.result !== 1) {
      return { publishedfileid: String(d.publishedfileid), error: `查询失败 result=${d.result}（ID 不存在或非公开）` };
    }
    return {
      publishedfileid: String(d.publishedfileid),
      title: d.title,
      appid: d.appid,
      file_type: d.file_type, // 0=物品 2=合集
      creator: d.creator,
      creator_url: d.creator ? `https://steamcommunity.com/profiles/${d.creator}` : null,
      file_size: d.file_size,
      time_updated: iso(d.time_updated),
      subscriptions: d.subscriptions,
      favorited: d.favorited,
      lifetime_subscriptions: d.lifetime_subscriptions,
      views: d.views,
      tags: (d.tags || []).map((t) => t.tag),
      preview_url: d.preview_url,
      description: cleanDescription(d.description),
      children: Array.isArray(d.children) ? d.children.map((c) => String(c.publishedfileid)) : undefined,
      url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${d.publishedfileid}`,
    };
  });
  return jsonOut({ count: items.length, items });
}

async function doStatus() {
  const cfg = readConfig();
  const steamcmd = findSteamcmd(cfg);
  const checks = await Promise.allSettled([
    httpText("https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/", {
      method: "POST",
      body: new URLSearchParams({ itemcount: "1", "publishedfileids[0]": "818773962" }),
    }),
    httpText("https://steamcommunity.com/workshop/browse/?appid=294100&searchtext=mod&browsesort=textsearch&section=ReadyToUseItems"),
  ]);
  const fmt = (r, label) =>
    r.status === "fulfilled"
      ? { check: label, ok: r.value.status === 200, http_status: r.value.status }
      : { check: label, ok: false, error: String(r.reason?.cause?.message || r.reason?.message || r.reason) };
  return jsonOut({
    platform: process.platform,
    node_version: process.version,
    steam_api_key: { configured: Boolean(cfg.apiKey) },
    config_file: CONFIG_PATH,
    steam_libraries: findSteamLibraries(cfg),
    steamcmd: steamcmd ? { found: true, path: steamcmd.exe } : { found: false, how_to: "developer.valvesoftware.com/wiki/SteamCMD（Windows 下载解压；Linux/macOS 同页，macOS 可 brew install steamcmd），路径写进配置 steamcmdPath" },
    download_root: cfg.downloadRoot,
    checks: [
      fmt(checks[0], "详情接口 api.steampowered.com（免 key）"),
      fmt(checks[1], "搜索页 steamcommunity.com（免 key）"),
    ],
    hint: "fetch 报证书错误 → 需 --use-system-ca（.mcp.json 已带）；连接失败 → 本机需代理且让 ZCode 环境带 HTTPS_PROXY 变量。",
  });
}

// ---------------------------------------------------------------------------
// Tools: mod file access
// ---------------------------------------------------------------------------

function findModFile(modPath, relFile) {
  const target = resolve(modPath, relFile);
  if (!isInsideRoot(modPath, target)) throw new Error(`路径越界：${relFile} 不在 mod 目录内`);
  if (!existsSync(target) || !statSync(target).isFile()) throw new Error(`文件不存在：${relFile}`);
  return target;
}

async function doModReadFile(args) {
  const { path: modPath } = await resolveModPath(args);
  if (typeof args.file !== "string" || !args.file.trim()) return "file 必填（mod 目录内的相对路径，如 About/About.xml 或 1.5/Defs/Things/X.xml）。";
  const target = findModFile(modPath, args.file);
  const maxBytes = Math.min(Number(args.maxBytes) || 300000, 600000);
  const r = readTextFile(target, maxBytes);
  if (r.error) return r.error;
  return jsonOut({ file: args.file, bytes: r.size, truncated: r.truncated, content: r.text });
}

function globToRegExp(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${esc}$`, "i");
}

async function doModGrep(args) {
  const { path: modPath } = await resolveModPath(args);
  const pattern = String(args.pattern ?? "").trim();
  if (!pattern) return "pattern 必填。";
  let re;
  try {
    re = args.regex ? new RegExp(pattern, args.caseSensitive ? "g" : "gi") : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), args.caseSensitive ? "g" : "gi");
  } catch (e) {
    return `pattern 无效：${e.message}`;
  }
  const globRe = args.glob ? globToRegExp(String(args.glob)) : null;
  const files = walkFiles(modPath, 4000).filter((e) => e.file);
  const matches = [];
  let filesScanned = 0;
  let hitCap = false;
  for (const f of files) {
    if (matches.length >= 80) {
      hitCap = true;
      break;
    }
    const ext = extname(f.file).toLowerCase();
    if (!TEXT_EXTS.has(ext) || f.size > 2 * 1024 * 1024) continue;
    const rel = relative(modPath, f.file).replace(/\\/g, "/");
    if (globRe && !globRe.test(rel)) continue;
    let text;
    try {
      text = readFileSync(f.file, "utf8");
    } catch {
      continue;
    }
    filesScanned++;
    const lines = text.split(/\r?\n/);
    let perFile = 0;
    for (let i = 0; i < lines.length && perFile < 15 && matches.length < 80; i++) {
      re.lastIndex = 0;
      if (re.test(lines[i])) {
        matches.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 400) });
        perFile++;
      }
    }
  }
  if (matches.length >= 80) hitCap = true;
  return jsonOut({ pattern, matches, filesScanned, truncated: hitCap, hint: "只搜文本文件（xml/cs/json/lua 等），Assemblies 里的 DLL 不在内。" });
}

async function doModAnalyze(args) {
  const prefer = args.prefer === "local" || args.prefer === "download" ? args.prefer : "auto";
  const { path: modPath, from } = await resolveModPath(args, prefer);
  return analyzeMod({ path: modPath, from, prefer });
}

async function doWorkshopDownload(args) {
  const appid = Number(args.appid);
  const id = Number(args.publishedfileid ?? args.id);
  if (!Number.isInteger(appid) || appid <= 0 || !Number.isInteger(id) || id <= 0) {
    return "需要 appid + publishedfileid（两个整数）。";
  }
  const { path: modPath, from } = await resolveModPath({ appid, publishedfileid: id }, args.force ? "download" : "auto");
  const downloaded = from === "steamcmd";
  return jsonOut({
    path: modPath,
    from,
    downloaded,
    hint: downloaded ? "下载完成，可对 path 调 mod_analyze。" : "本地已有，未重复下载；可对 path 调 mod_analyze。",
  });
}

// ---------------------------------------------------------------------------
// MCP plumbing
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "workshop_search",
    description:
      "搜索 Steam 创意工坊物品。appid 必填（游戏 AppID）；有 API key 时返回订阅数/大小/更新时间/标签等全字段，无 key 时降级为只返回 id+标题（可再调 workshop_details 补全）。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        appid: { type: "integer", description: "游戏 AppID，如 RimWorld=294100" },
        page: { type: "integer", minimum: 1, description: "页码，默认 1，每页约 20 条" },
      },
      required: ["query", "appid"],
    },
  },
  {
    name: "workshop_details",
    description:
      "查询 1-20 个创意工坊物品的完整详情（标题/所属游戏/作者/文件大小/更新时间/订阅数/标签/简介/预览图）。免 key 可用；传合集 ID 会返回合集内物品 children 列表。",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: ["integer", "string"] },
          minItems: 1,
          maxItems: 20,
          description: "创意工坊物品 ID（sharedfiles/filedetails/?id= 后面的数字），1-20 个",
        },
      },
      required: ["ids"],
    },
  },
  {
    name: "workshop_download",
    description:
      "把创意工坊物品下载到本地缓存目录（steamcmd 匿名下载；部分游戏需要账号）。本地 Steam 库或缓存里已有就直接返回现路径不重复下载。成功后可对返回 path 调 mod_analyze。",
    inputSchema: {
      type: "object",
      properties: {
        appid: { type: "integer", description: "游戏 AppID" },
        publishedfileid: { type: "integer", description: "创意工坊物品 ID" },
        force: { type: "boolean", description: "true 时忽略本地已有，强制 steamcmd 重新下载" },
      },
      required: ["appid", "publishedfileid"],
    },
  },
  {
    name: "mod_analyze",
    description:
      "解析一个已下载 mod 的代码与结构（RimWorld 深度）：About.xml（packageId/modDependencies/loadBefore/loadAfter）、loadFolders 条件加载、Defs 类型统计与 defName、Patches 的 PatchOperation、XML 里 MayRequire/MayRequireAnyOf 联动点、C# 源码 Harmony 补丁目标、DLL 二进制特征。是做 mod 联动/兼容适配的第一步。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "本地 mod 目录（与 appid+publishedfileid 二选一）" },
        appid: { type: "integer", description: "游戏 AppID（与 publishedfileid 一起用）" },
        publishedfileid: { type: "integer", description: "创意工坊物品 ID" },
        prefer: { type: "string", enum: ["auto", "local", "download"], description: "auto=本地优先缺了下载；local=只找本地；download=强制下载" },
      },
    },
  },
  {
    name: "mod_read_file",
    description: "读取 mod 目录里的一个文本文件（XML/C#/JSON/lua 等，路径必须在 mod 目录内，二进制拒绝，默认上限 300KB）。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "本地 mod 目录（与 appid+publishedfileid 二选一）" },
        appid: { type: "integer", description: "游戏 AppID" },
        publishedfileid: { type: "integer", description: "创意工坊物品 ID" },
        file: { type: "string", description: "mod 目录内相对路径" },
        maxBytes: { type: "integer", description: "最大读取字节数，默认 300000，上限 600000" },
      },
      required: ["file"],
    },
  },
  {
    name: "mod_grep",
    description:
      "在整个 mod 目录的文本文件（xml/cs/json/lua 等）里搜索字符串或正则，返回 file:line:内容（最多 80 条）。适合找某个 defName/类名/ Harmony 目标在哪定义。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "本地 mod 目录（与 appid+publishedfileid 二选一）" },
        appid: { type: "integer", description: "游戏 AppID" },
        publishedfileid: { type: "integer", description: "创意工坊物品 ID" },
        pattern: { type: "string", description: "搜索内容" },
        regex: { type: "boolean", description: "把 pattern 当正则（默认 false = 普通字符串）" },
        caseSensitive: { type: "boolean", description: "默认不区分大小写" },
        glob: { type: "string", description: "文件名过滤，如 *.xml 或 Source/*.cs" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "workshop_status",
    description: "自检：API key/steamcmd/Steam 库路径状态，两条 Steam 数据通道连通性。搜索无结果、下载失败或怀疑网络问题时先用它。",
    inputSchema: { type: "object", properties: {} },
  },
];

async function callTool(params) {
  const { name, arguments: args = {} } = params || {};
  try {
    let text;
    if (name === "workshop_search") text = await doSearch(args);
    else if (name === "workshop_details") text = await doDetails(args);
    else if (name === "workshop_download") text = await doWorkshopDownload(args);
    else if (name === "mod_analyze") text = await doModAnalyze(args);
    else if (name === "mod_read_file") text = await doModReadFile(args);
    else if (name === "mod_grep") text = await doModGrep(args);
    else if (name === "workshop_status") text = await doStatus();
    else return { content: [{ type: "text", text: `未知工具：${name}` }], isError: true };
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const reason = err?.cause?.message || err?.message || String(err);
    return { content: [{ type: "text", text: `steam-workshop 出错：${reason}` }], isError: true };
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
