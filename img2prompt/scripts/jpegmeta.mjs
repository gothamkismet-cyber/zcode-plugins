// JPEG metadata parser for img2prompt: SOF dimensions + minimal EXIF
// (IFD0: Make/Model/DateTime/Orientation; ExifIFD: ExposureTime/FNumber/
// ISO/FocalLength/LensModel/DateTimeOriginal). Intentionally small - enough
// to inform photo prompts, not a full EXIF toolkit.

const IFD0_TAGS = {
  0x010f: { name: "make", type: "ascii" },
  0x0110: { name: "model", type: "ascii" },
  0x0132: { name: "dateTime", type: "ascii" },
  0x0112: { name: "orientation", type: "short" },
  0x011a: { name: "xResolution", type: "rational" },
};

const EXIF_TAGS = {
  0x829a: { name: "exposureTime", type: "rational" },
  0x829d: { name: "fNumber", type: "rational" },
  0x8827: { name: "iso", type: "short" },
  0x9003: { name: "dateTimeOriginal", type: "ascii" },
  0x920a: { name: "focalLength", type: "rational" },
  0xa434: { name: "lensModel", type: "ascii" },
};

export function parseJpeg(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let off = 2;
  let width = 0;
  let height = 0;
  const exif = {};
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = buf[off + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan
    if (off + 4 > buf.length) break;
    const len = buf.readUInt16BE(off + 2);
    if (len < 2) break;
    const seg = buf.subarray(off + 4, Math.min(off + 2 + len, buf.length));
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && seg.length >= 5) {
      height = seg.readUInt16BE(1);
      width = seg.readUInt16BE(3);
    }
    if (marker === 0xe1 && seg.length > 6 && seg.toString("ascii", 0, 4) === "Exif") {
      try {
        Object.assign(exif, parseExifTiff(seg.subarray(6)));
      } catch {
        // malformed EXIF: leave empty
      }
    }
    off += 2 + len;
  }
  return { width, height, exif };
}

function parseExifTiff(tiff) {
  const out = {};
  if (tiff.length < 8) return out;
  const little = tiff.toString("ascii", 0, 2) === "II";
  const u16 = (b, p) => (little ? b.readUInt16LE(p) : b.readUInt16BE(p));
  const u32 = (b, p) => (little ? b.readUInt32LE(p) : b.readUInt32BE(p));
  if (u16(tiff, 2) !== 42) return out;

  const readValue = (tiff, valOff, type, count) => {
    const readAscii = () => {
      const raw = tiff.subarray(valOff, valOff + count);
      const z = raw.indexOf(0);
      return raw.toString("utf8", 0, z < 0 ? undefined : z).trim();
    };
    switch (type) {
      case 2:
        return readAscii();
      case 3:
        return u16(tiff, valOff);
      case 4:
        return u32(tiff, valOff);
      case 5: {
        const num = u32(tiff, valOff);
        const den = u32(tiff, valOff + 4);
        return den === 0 ? null : num / den;
      }
      default:
        return null;
    }
  };

  const readIfd = (off, dict) => {
    if (off + 2 > tiff.length) return;
    const count = u16(tiff, off);
    for (let i = 0; i < count; i++) {
      const e = off + 2 + i * 12;
      if (e + 12 > tiff.length) break;
      const tag = u16(tiff, e);
      const type = u16(tiff, e + 2);
      const num = u32(tiff, e + 4);
      const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
      const byteLen = (sizes[type] || 1) * num;
      const valOff = byteLen <= 4 ? e + 8 : u32(tiff, e + 8);
      if (tag === 0x8769) {
        readIfd(u32(tiff, e + 8), EXIF_TAGS);
        continue;
      }
      const def = dict[tag];
      if (!def) continue;
      const v = readValue(tiff, valOff, type, num);
      if (v !== null && v !== undefined && v !== "") out[def.name] = v;
    }
  };

  readIfd(u32(tiff, 4), IFD0_TAGS);
  if (out.exposureTime !== undefined) {
    const t = out.exposureTime;
    out.exposureTime = t >= 1 ? `${t}s` : `1/${Math.round(1 / t)}s`;
  }
  if (out.fNumber !== undefined) out.fNumber = `f/${Math.round(out.fNumber * 10) / 10}`;
  if (out.focalLength !== undefined) out.focalLength = `${Math.round(out.focalLength)}mm`;
  return out;
}
