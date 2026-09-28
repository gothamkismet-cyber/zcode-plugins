// PNG metadata parser for img2prompt.
// Reads IHDR dimensions and all text chunks (tEXt / zTXt / iTXt) - AI image
// generators (A1111/Forge, ComfyUI, NovelAI) embed their generation parameters
// in these chunks. CRCs are not validated (we only read, never render).

import { inflateSync } from "node:zlib";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function parsePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  let off = 8;
  let width = 0;
  let height = 0;
  const texts = {};
  const chunkTypes = new Set();
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    chunkTypes.add(type);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR" && len >= 8) {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === "tEXt") {
      const z = data.indexOf(0);
      if (z > 0) {
        // A1111 & friends write UTF-8 into tEXt despite the latin1 spec.
        texts[data.toString("latin1", 0, z)] = data.toString("utf8", z + 1);
      }
    } else if (type === "zTXt") {
      const z = data.indexOf(0);
      if (z > 0 && data[z + 1] === 0) {
        try {
          texts[data.toString("latin1", 0, z)] = inflateSync(data.subarray(z + 2)).toString("utf8");
        } catch {
          // malformed compressed chunk: skip
        }
      }
    } else if (type === "iTXt") {
      const z = data.indexOf(0);
      if (z > 0) {
        const key = data.toString("latin1", 0, z);
        let p = z + 1;
        const compFlag = data[p];
        p += 2; // skip compression flag + method
        const langEnd = data.indexOf(0, p);
        if (langEnd < 0) continue;
        p = langEnd + 1;
        const transEnd = data.indexOf(0, p);
        if (transEnd < 0) continue;
        p = transEnd + 1;
        let val = data.subarray(p);
        if (compFlag === 1) {
          try {
            val = inflateSync(val);
          } catch {
            continue;
          }
        }
        texts[key] = val.toString("utf8");
      }
    }
    off += 12 + len;
    if (type === "IEND") break;
  }
  return { width, height, texts, chunkTypes: [...chunkTypes] };
}
