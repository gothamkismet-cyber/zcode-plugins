// img2prompt MCP server for ZCode.
// One solid tool: image_meta extracts embedded generation parameters from
// AI-generated images (A1111/Forge "parameters" tEXt, ComfyUI prompt/workflow,
// NovelAI Description/Comment) plus JPEG EXIF and basic dimensions, so the
// model can reproduce prompts exactly instead of guessing. Vision analysis
// itself stays with the host model (Read tool) - the skill defines that flow.

import { createInterface } from "node:readline";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePng } from "./pngmeta.mjs";
import { parseJpeg } from "./jpegmeta.mjs";

const NAME = "img2prompt";
const VERSION = "0.1.0";
const MAX_BYTES = 60 * 1024 * 1024;
const RAW_CAP = 6000;

function cap(s, n = RAW_CAP) {
  return String(s).length > n ? String(s).slice(0, n) + " …[截断]" : String(s);
}

async function loadBuffer(args) {
  const raw = String(args.path ?? args.url ?? "").trim();
  if (!raw) throw new Error("需要 path（本地图片路径）或 url（http/https 图片地址）。");
  if (/^https?:\/\//i.test(raw)) {
    const res = await fetch(raw, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`下载图片失败 HTTP ${res.status}`);
    return { buf: Buffer.from(await res.arrayBuffer()), source: raw };
  }
  // Windows drive letters ("C:/...") match the scheme regex but are absolute
  // paths, not URL schemes - exempt them like desktop-bridge does.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !isAbsolute(raw)) throw new Error("只支持 http/https URL 或本地路径。");
  const p = resolve(raw);
  let st;
  try {
    st = statSync(p);
  } catch {
    throw new Error(`文件不存在：${p}`);
  }
  if (!st.isFile()) throw new Error(`不是文件：${p}`);
  if (st.size > MAX_BYTES) throw new Error(`文件过大（${Math.round(st.size / 1048576)}MB，上限 60MB）。`);
  return { buf: readFileSync(p), source: p };
}

function detectGenerator(texts, exif) {
  const keys = Object.keys(texts).map((k) => k.toLowerCase());
  if (keys.includes("parameters")) return "stable-diffusion (A1111/Forge 参数)";
  if (keys.includes("prompt") && keys.includes("workflow")) return "comfyui";
  if (keys.some((k) => k.includes("novelai")) || (texts.Software || "").includes("NovelAI")) return "novelai";
  if (exif && (exif.make || exif.model)) return "photo";
  if (keys.length > 0) return "embedded-metadata";
  return "unknown";
}

// A1111 "parameters" value: prompt, optional "Negative prompt: ...", last line
// "Steps: .., Sampler: .., ..." settings. Split on the first occurrences.
function parseA1111(value) {
  const out = { prompt: "", negative: "", settings: {} };
  let rest = value;
  const negIdx = rest.indexOf("\nNegative prompt:");
  if (negIdx >= 0) {
    out.prompt = rest.slice(0, negIdx).trim();
    rest = rest.slice(negIdx + "\nNegative prompt:".length);
    const lineBreak = rest.indexOf("\n");
    out.negative = (lineBreak >= 0 ? rest.slice(0, lineBreak) : rest).trim();
    if (lineBreak >= 0) rest = rest.slice(lineBreak + 1);
  } else {
    const lineBreak = rest.indexOf("\n");
    if (lineBreak >= 0) {
      out.prompt = rest.slice(0, lineBreak).trim();
      rest = rest.slice(lineBreak + 1);
    } else {
      out.prompt = rest.trim();
      rest = "";
    }
  }
  const settingsLine = rest.trim();
  if (/^Steps:/i.test(settingsLine)) {
    for (const pair of settingsLine.split(/,\s*(?=[A-Za-z][A-Za-z0-9 ]*:)/)) {
      const c = pair.indexOf(":");
      if (c > 0) out.settings[pair.slice(0, c).trim()] = pair.slice(c + 1).trim();
    }
  } else if (settingsLine) {
    out.prompt += "\n" + settingsLine;
  }
  return out;
}

async function doImageMeta(args) {
  const { buf, source } = await loadBuffer(args);
  let base;
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) {
    const png = parsePng(buf);
    if (!png) throw new Error("无法解析 PNG 结构。");
    base = { format: "png", ...png };
  } else if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) {
    const jpg = parseJpeg(buf);
    if (!jpg) throw new Error("无法解析 JPEG 结构。");
    base = { format: "jpeg", ...jpg, texts: {} };
  } else {
    throw new Error("暂不支持该格式：目前解析 PNG（AI 生成参数）和 JPEG（EXIF）。GIF/WebP/AVIF 请先转存为 PNG 再试。");
  }

  const generator = detectGenerator(base.texts, base.exif);
  const result = {
    source,
    format: base.format,
    width: base.width,
    height: base.height,
    bytes: buf.length,
    generator,
  };

  if (base.format === "png") {
    result.textKeys = Object.keys(base.texts);
    if (base.texts.parameters !== undefined) {
      result.a1111 = parseA1111(base.texts.parameters);
      result.a1111.raw = cap(base.texts.parameters);
    }
    for (const key of ["prompt", "workflow", "Description", "Comment"]) {
      if (base.texts[key] !== undefined && result.a1111?.prompt !== base.texts[key]) {
        result[key] = cap(base.texts[key], key === "workflow" ? 4000 : RAW_CAP);
      }
    }
    if (generator === "comfyui") {
      result.hint = "ComfyUI 的 workflow/prompt 是节点 JSON；从中找 KSampler 节点的 positive/negative 文本框与 seed/steps/cfg。";
    }
  } else {
    result.exif = base.exif;
    if (Object.keys(base.exif).length === 0) result.hint = "无 EXIF 或未解析出字段（网络图常被剥离）；视觉分析交给模型。";
  }
  return JSON.stringify(result, null, 1);
}

const TOOLS = [
  {
    name: "image_meta",
    description:
      "提取图片的嵌入元数据：AI 生成图（SD/A1111/Forge、ComfyUI、NovelAI）PNG 里的原始生成参数（正向/负面提示词、Steps/Sampler/CFG/Seed/Model）、JPEG 的 EXIF（相机/曝光/焦距）、尺寸与文件信息。支持本地路径和 http/https URL。转生图提示词前先调它——能直接复刻原始提示词。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "本地图片路径（与 url 二选一）" },
        url: { type: "string", description: "http/https 图片地址" },
      },
    },
  },
];

async function callTool(params) {
  const { name, arguments: args = {} } = params || {};
  try {
    let text;
    if (name === "image_meta") text = await doImageMeta(args);
    else return { content: [{ type: "text", text: `未知工具：${name}` }], isError: true };
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const reason = err?.cause?.message || err?.message || String(err);
    return { content: [{ type: "text", text: `img2prompt 出错：${reason}` }], isError: true };
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
