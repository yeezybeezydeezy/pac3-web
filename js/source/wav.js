// WAV decoder for PCM (8/16/24/32-bit, float) and Microsoft ADPCM, which many Source sounds use
// and browsers cannot decode. Returns { sampleRate, channels: Float32Array[] } or null if not WAV.
import { Reader } from './binary.js';

const ADAPT = [230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230];
const COEF = [[256, 0], [512, -256], [0, 0], [192, 64], [240, 0], [460, -208], [392, -232]];

export function decodeWav(bytes) {
  const r = new Reader(bytes);
  if (bytes.length < 12 || r.fixedStr(0, 4) !== 'RIFF' || r.fixedStr(8, 4) !== 'WAVE') return null;
  let fmt = null, data = null;
  for (let p = 12; p + 8 <= bytes.length;) {
    const id = r.fixedStr(p, 4), size = r.u32(p + 4), body = p + 8;
    if (id === 'fmt ') {
      fmt = { tag: r.u16(body), channels: r.u16(body + 2), rate: r.u32(body + 4), align: r.u16(body + 12), bits: r.u16(body + 14) };
      if (fmt.tag === 2 && size >= 20) {
        const n = r.u16(body + 18), nc = r.u16(body + 20);
        fmt.coef = [];
        for (let i = 0; i < nc; i++) fmt.coef.push([r.i16(body + 22 + i * 4), r.i16(body + 24 + i * 4)]);
        fmt.samplesPerBlock = n;
      }
      if (fmt.tag === 0xfffe && size >= 26) fmt.tag = r.u16(body + 24); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === 'data') data = bytes.subarray(body, Math.min(bytes.length, body + size));
    p = body + size + (size & 1);
  }
  if (!fmt || !data || !fmt.channels || fmt.channels > 8) return null;
  const nch = fmt.channels;
  if (fmt.tag === 1 || fmt.tag === 3) {
    const bps = fmt.bits / 8, frames = Math.floor(data.length / (bps * nch));
    const out = Array.from({ length: nch }, () => new Float32Array(frames));
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < nch; c++) {
        const o = (i * nch + c) * bps;
        let v;
        if (fmt.tag === 3) v = bps === 8 ? dv.getFloat64(o, true) : dv.getFloat32(o, true);
        else if (bps === 1) v = (data[o] - 128) / 128;
        else if (bps === 2) v = dv.getInt16(o, true) / 32768;
        else if (bps === 3) v = ((data[o] | (data[o + 1] << 8) | (data[o + 2] << 16)) << 8 >> 8) / 8388608;
        else v = dv.getInt32(o, true) / 2147483648;
        out[c][i] = v;
      }
    }
    return { sampleRate: fmt.rate, channels: out };
  }
  if (fmt.tag === 2) return decodeMsAdpcm(data, fmt);
  return null;
}

function decodeMsAdpcm(data, fmt) {
  const nch = fmt.channels, align = fmt.align, coef = fmt.coef && fmt.coef.length ? fmt.coef : COEF;
  const spb = fmt.samplesPerBlock || ((align - 7 * nch) * 8) / (4 * nch) + 2;
  const blocks = Math.ceil(data.length / align);
  const out = Array.from({ length: nch }, () => new Float32Array(blocks * spb));
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let w = 0;
  for (let b = 0; b < blocks; b++) {
    const base = b * align;
    if (base + 7 * nch > data.length) break;
    const pred = [], delta = [], s1 = [], s2 = [];
    for (let c = 0; c < nch; c++) pred[c] = coef[Math.min(data[base + c], coef.length - 1)];
    for (let c = 0; c < nch; c++) delta[c] = dv.getInt16(base + nch + c * 2, true);
    for (let c = 0; c < nch; c++) s1[c] = dv.getInt16(base + nch * 3 + c * 2, true);
    for (let c = 0; c < nch; c++) s2[c] = dv.getInt16(base + nch * 5 + c * 2, true);
    for (let c = 0; c < nch; c++) { out[c][w] = s2[c] / 32768; out[c][w + 1] = s1[c] / 32768; }
    let n = 2;
    const end = Math.min(data.length, base + align);
    let ch = 0;
    for (let p = base + 7 * nch; p < end; p++) {
      for (const nib of [data[p] >> 4, data[p] & 15]) {
        const c = ch;
        const signed = nib & 8 ? nib - 16 : nib;
        let s = ((s1[c] * pred[c][0] + s2[c] * pred[c][1]) >> 8) + signed * delta[c];
        s = Math.max(-32768, Math.min(32767, s));
        s2[c] = s1[c]; s1[c] = s;
        delta[c] = Math.max(16, (ADAPT[nib] * delta[c]) >> 8);
        if (w + n < out[c].length) out[c][w + n] = s / 32768;
        ch = (ch + 1) % nch;
        if (ch === 0) n++;
      }
    }
    w += Math.min(spb, n);
  }
  return { sampleRate: fmt.rate, channels: out.map((a) => a.subarray(0, w)) };
}
