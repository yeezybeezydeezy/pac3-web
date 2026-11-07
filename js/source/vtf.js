// VTF (Valve Texture Format) decoder -> RGBA8 pixels of the largest mip, first face/slice.
import { Reader } from './binary.js';

const F = {
  RGBA8888: 0, ABGR8888: 1, RGB888: 2, BGR888: 3, RGB565: 4, I8: 5, IA88: 6, P8: 7, A8: 8,
  RGB888_BLUE: 9, BGR888_BLUE: 10, ARGB8888: 11, BGRA8888: 12, DXT1: 13, DXT3: 14, DXT5: 15,
  BGRX8888: 16, BGR565: 17, BGRX5551: 18, BGRA4444: 19, DXT1_A: 20, BGRA5551: 21, UV88: 22,
  UVWQ8888: 23, RGBA16F: 24, RGBA16: 25, UVLX8888: 26,
};
const BPP = { 0: 4, 1: 4, 2: 3, 3: 3, 4: 2, 5: 1, 6: 2, 7: 1, 8: 1, 9: 3, 10: 3, 11: 4, 12: 4, 16: 4, 17: 2, 18: 2, 19: 2, 21: 2, 22: 2, 23: 4, 24: 8, 25: 8, 26: 4 };

function mipSize(fmt, w, h) {
  if (fmt === F.DXT1 || fmt === F.DXT1_A) return Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * 8;
  if (fmt === F.DXT3 || fmt === F.DXT5) return Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * 16;
  const b = BPP[fmt];
  if (!b) throw new Error(`Unsupported VTF format ${fmt}`);
  return w * h * b;
}

function c565(c, out, o) {
  out[o] = ((c >> 11) & 31) * 255 / 31;
  out[o + 1] = ((c >> 5) & 63) * 255 / 63;
  out[o + 2] = (c & 31) * 255 / 31;
}

function decodeDXT(src, w, h, fmt) {
  const out = new Uint8Array(w * h * 4);
  const bw = Math.max(1, Math.ceil(w / 4)), bh = Math.max(1, Math.ceil(h / 4));
  const blockBytes = fmt === F.DXT1 || fmt === F.DXT1_A ? 8 : 16;
  const pal = new Uint8Array(16);
  const alpha = new Uint8Array(16);
  let p = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++, p += blockBytes) {
      const cOff = blockBytes === 16 ? p + 8 : p;
      // alpha
      if (fmt === F.DXT5) {
        const a0 = src[p], a1 = src[p + 1];
        const ap = [a0, a1];
        if (a0 > a1) for (let i = 1; i < 7; i++) ap.push(((7 - i) * a0 + i * a1) / 7);
        else { for (let i = 1; i < 5; i++) ap.push(((5 - i) * a0 + i * a1) / 5); ap.push(0, 255); }
        let bits = 0, nb = 0, bi = p + 2;
        for (let i = 0; i < 16; i++) {
          while (nb < 3) { bits |= src[bi++] << nb; nb += 8; }
          alpha[i] = ap[bits & 7]; bits >>>= 3; nb -= 3;
        }
      } else if (fmt === F.DXT3) {
        for (let i = 0; i < 16; i++) alpha[i] = ((src[p + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
      }
      const c0 = src[cOff] | (src[cOff + 1] << 8), c1 = src[cOff + 2] | (src[cOff + 3] << 8);
      c565(c0, pal, 0); pal[3] = 255;
      c565(c1, pal, 4); pal[7] = 255;
      if (c0 > c1 || blockBytes === 16) {
        for (let k = 0; k < 3; k++) { pal[8 + k] = (2 * pal[k] + pal[4 + k]) / 3; pal[12 + k] = (pal[k] + 2 * pal[4 + k]) / 3; }
        pal[11] = pal[15] = 255;
      } else {
        for (let k = 0; k < 3; k++) { pal[8 + k] = (pal[k] + pal[4 + k]) / 2; pal[12 + k] = 0; }
        pal[11] = 255; pal[15] = fmt === F.DXT1_A || fmt === F.DXT1 ? 0 : 255;
      }
      const idx = src[cOff + 4] | (src[cOff + 5] << 8) | (src[cOff + 6] << 16) | (src[cOff + 7] << 24);
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
        if (x >= w || y >= h) continue;
        const ci = ((idx >>> (i * 2)) & 3) * 4, o = (y * w + x) * 4;
        out[o] = pal[ci]; out[o + 1] = pal[ci + 1]; out[o + 2] = pal[ci + 2];
        out[o + 3] = blockBytes === 16 ? alpha[i] : pal[ci + 3];
      }
    }
  }
  return out;
}

function half(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
  if (e === 0) return s * 6.1e-5 * (f / 1024);
  if (e === 31) return f ? 0 : s * 65504;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

function decodeRaw(src, w, h, fmt) {
  const n = w * h, out = new Uint8Array(n * 4);
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let r = 0, g = 0, b = 0, a = 255;
    switch (fmt) {
      case F.RGBA8888: r = src[o]; g = src[o + 1]; b = src[o + 2]; a = src[o + 3]; break;
      case F.ABGR8888: a = src[o]; b = src[o + 1]; g = src[o + 2]; r = src[o + 3]; break;
      case F.ARGB8888: a = src[o]; r = src[o + 1]; g = src[o + 2]; b = src[o + 3]; break;
      case F.BGRA8888: b = src[o]; g = src[o + 1]; r = src[o + 2]; a = src[o + 3]; break;
      case F.BGRX8888: b = src[o]; g = src[o + 1]; r = src[o + 2]; break;
      case F.UVWQ8888: case F.UVLX8888: r = src[o]; g = src[o + 1]; b = src[o + 2]; a = src[o + 3]; break;
      case F.RGB888: case F.RGB888_BLUE: r = src[i * 3]; g = src[i * 3 + 1]; b = src[i * 3 + 2]; break;
      case F.BGR888: case F.BGR888_BLUE: b = src[i * 3]; g = src[i * 3 + 1]; r = src[i * 3 + 2]; break;
      case F.I8: r = g = b = src[i]; break;
      case F.A8: r = g = b = 255; a = src[i]; break;
      case F.P8: r = g = b = src[i]; break;
      case F.IA88: r = g = b = src[i * 2]; a = src[i * 2 + 1]; break;
      case F.UV88: r = src[i * 2]; g = src[i * 2 + 1]; b = 255; break;
      case F.RGB565: case F.BGR565: {
        const c = dv.getUint16(i * 2, true);
        const hi = ((c >> 11) & 31) * 255 / 31, mid = ((c >> 5) & 63) * 255 / 63, lo = (c & 31) * 255 / 31;
        if (fmt === F.RGB565) { r = lo; g = mid; b = hi; } else { r = hi; g = mid; b = lo; }
        break;
      }
      case F.BGRA4444: { const c = dv.getUint16(i * 2, true); b = (c & 15) * 17; g = ((c >> 4) & 15) * 17; r = ((c >> 8) & 15) * 17; a = ((c >> 12) & 15) * 17; break; }
      case F.BGRX5551: case F.BGRA5551: { const c = dv.getUint16(i * 2, true); b = (c & 31) * 255 / 31; g = ((c >> 5) & 31) * 255 / 31; r = ((c >> 10) & 31) * 255 / 31; a = fmt === F.BGRA5551 ? (c >> 15 ? 255 : 0) : 255; break; }
      case F.RGBA16F: case F.RGBA16: {
        const rd = (k) => (fmt === F.RGBA16F ? half(dv.getUint16(i * 8 + k * 2, true)) : dv.getUint16(i * 8 + k * 2, true) / 65535);
        const tm = (x) => Math.min(255, Math.max(0, (x / (1 + x)) * 1.6 * 255)); // simple tonemap for HDR
        r = tm(rd(0)); g = tm(rd(1)); b = tm(rd(2)); a = Math.min(255, rd(3) * 255);
        if (fmt === F.RGBA16) { r = rd(0) * 255; g = rd(1) * 255; b = rd(2) * 255; }
        break;
      }
      default: throw new Error(`Unsupported VTF format ${fmt}`);
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
  }
  return out;
}

/** Decodes a VTF file. maxSize limits decoding to a smaller mip when the top mip is huge. */
export function decodeVTF(bytes, { frame = 0, maxSize = 2048 } = {}) {
  const r = new Reader(bytes);
  if (r.fixedStr(0, 4) !== 'VTF') throw new Error('Not a VTF file');
  const major = r.u32(4), minor = r.u32(8);
  if (major !== 7) throw new Error(`Unsupported VTF version ${major}.${minor}`);
  const headerSize = r.u32(12);
  const width = r.u16(16), height = r.u16(18), flags = r.u32(20);
  const frames = Math.max(1, r.u16(24)), firstFrame = r.u16(26);
  const fmt = r.i32(52), mips = Math.max(1, r.u8(56));
  const lowFmt = r.i32(57), lowW = r.u8(61), lowH = r.u8(62);
  const depth = minor >= 2 ? Math.max(1, r.u16(63)) : 1;
  const ENVMAP = 0x4000;
  const faces = flags & ENVMAP ? (minor < 5 && firstFrame !== 0xffff ? 7 : 6) : 1;
  let dataStart;
  if (minor >= 3) {
    const n = r.u32(68);
    for (let i = 0; i < n; i++) {
      const at = 80 + i * 8;
      if (r.u8(at) === 0x30 && r.u8(at + 1) === 0 && r.u8(at + 2) === 0) dataStart = r.u32(at + 4);
    }
    if (dataStart == null) throw new Error('VTF has no image data');
  } else {
    dataStart = headerSize + (lowFmt >= 0 && lowW && lowH ? mipSize(lowFmt, lowW, lowH) : 0);
  }
  // choose the largest mip not bigger than maxSize
  let mip = 0;
  while (mip < mips - 1 && Math.max(width >> mip, height >> mip) > maxSize) mip++;
  let off = dataStart;
  for (let m = mips - 1; m > mip; m--) off += mipSize(fmt, Math.max(1, width >> m), Math.max(1, height >> m)) * frames * faces * depth;
  const w = Math.max(1, width >> mip), h = Math.max(1, height >> mip);
  const one = mipSize(fmt, w, h);
  off += one * faces * depth * Math.min(frame, frames - 1);
  const src = r.slice(off, one);
  const rgba = fmt === F.DXT1 || fmt === F.DXT1_A || fmt === F.DXT3 || fmt === F.DXT5 ? decodeDXT(src, w, h, fmt) : decodeRaw(src, w, h, fmt);
  return { width: w, height: h, rgba, frames, flags, format: fmt };
}
