// LZMA ("LZMA alone" .lzma stream) decoder, used for legacy Workshop *_legacy.bin addons.
// Written from the LZMA specification; decodes the whole stream into one output buffer.

const TOP = 1 << 24;
const PROB_INIT = 1024;

class RangeDecoder {
  constructor(buf, pos) {
    this.buf = buf;
    this.pos = pos;
    this.range = 0xffffffff;
    this.code = 0;
    if (buf[this.pos++] !== 0) throw new Error('Corrupt LZMA stream');
    for (let i = 0; i < 4; i++) this.code = this.code * 256 + buf[this.pos++];
    if (this.code === this.range) throw new Error('Corrupt LZMA stream');
  }
  normalize() {
    if (this.range < TOP) {
      this.range *= 256;
      this.code = this.code * 256 + (this.buf[this.pos++] | 0);
    }
  }
  bit(probs, i) {
    const v = probs[i];
    const bound = (this.range >>> 11) * v;
    let b;
    if (this.code < bound) { probs[i] = v + ((2048 - v) >>> 5); this.range = bound; b = 0; }
    else { probs[i] = v - (v >>> 5); this.code -= bound; this.range -= bound; b = 1; }
    this.normalize();
    return b;
  }
  direct(n) {
    let res = 0;
    for (; n > 0; n--) {
      this.range = this.range >>> 1;
      let b = 0;
      if (this.code >= this.range) { this.code -= this.range; b = 1; }
      res = res * 2 + b;
      this.normalize();
    }
    return res;
  }
  tree(probs, off, bits) {
    let m = 1;
    for (let i = 0; i < bits; i++) m = (m << 1) + this.bit(probs, off + m);
    return m - (1 << bits);
  }
  reverseTree(probs, off, bits) {
    let m = 1, sym = 0;
    for (let i = 0; i < bits; i++) { const b = this.bit(probs, off + m); m = (m << 1) + b; sym |= b << i; }
    return sym;
  }
}

function lenDecoder() {
  // [choice, choice2, low 16x8, mid 16x8, high 256]
  return new Uint16Array(2 + 128 + 128 + 256).fill(PROB_INIT);
}
function decodeLen(rc, p, posState) {
  if (rc.bit(p, 0) === 0) return rc.tree(p, 2 + posState * 8, 3);
  if (rc.bit(p, 1) === 0) return 8 + rc.tree(p, 130 + posState * 8, 3);
  return 16 + rc.tree(p, 258, 8);
}

/** Decompresses an LZMA-alone buffer (13 byte header). onProgress(fraction) is optional. */
export function lzmaDecompress(input, onProgress) {
  let d = input[0];
  if (d >= 9 * 5 * 5) throw new Error('Bad LZMA properties');
  const lc = d % 9; d = Math.floor(d / 9);
  const lp = d % 5; const pb = Math.floor(d / 5);
  let size = 0, known = false;
  for (let i = 12; i >= 5; i--) { size = size * 256 + input[i]; if (input[i] !== 0xff) known = true; }
  if (!known) throw new Error('LZMA streams without a size are not supported');
  if (size > 1.5e9) throw new Error('LZMA output too large');
  const out = new Uint8Array(size);
  const rc = new RangeDecoder(input, 13);

  const lit = new Uint16Array(0x300 << (lc + lp)).fill(PROB_INIT);
  const posSlot = new Uint16Array(4 * 64).fill(PROB_INIT);
  const posDec = new Uint16Array(1 + 114).fill(PROB_INIT);
  const align = new Uint16Array(16).fill(PROB_INIT);
  const isMatch = new Uint16Array(12 * 16).fill(PROB_INIT);
  const isRep = new Uint16Array(12).fill(PROB_INIT);
  const isRepG0 = new Uint16Array(12).fill(PROB_INIT);
  const isRepG1 = new Uint16Array(12).fill(PROB_INIT);
  const isRepG2 = new Uint16Array(12).fill(PROB_INIT);
  const isRep0Long = new Uint16Array(12 * 16).fill(PROB_INIT);
  const lenDec = lenDecoder(), repLenDec = lenDecoder();
  const pbMask = (1 << pb) - 1, lpMask = (1 << lp) - 1;

  let state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0, pos = 0;
  let nextReport = 1 << 22;
  while (pos < size) {
    const posState = pos & pbMask;
    if (rc.bit(isMatch, (state << 4) + posState) === 0) {
      const prev = pos > 0 ? out[pos - 1] : 0;
      const base = 0x300 * (((pos & lpMask) << lc) + (prev >> (8 - lc)));
      let sym = 1;
      if (state >= 7) {
        let match = out[pos - rep0 - 1];
        do {
          const mb = (match >> 7) & 1;
          match <<= 1;
          const b = rc.bit(lit, base + ((1 + mb) << 8) + sym);
          sym = (sym << 1) | b;
          if (mb !== b) break;
        } while (sym < 0x100);
      }
      while (sym < 0x100) sym = (sym << 1) | rc.bit(lit, base + sym);
      out[pos++] = sym & 0xff;
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
    } else {
      let len;
      if (rc.bit(isRep, state)) {
        if (pos === 0) throw new Error('Corrupt LZMA stream');
        if (rc.bit(isRepG0, state) === 0) {
          if (rc.bit(isRep0Long, (state << 4) + posState) === 0) {
            state = state < 7 ? 9 : 11;
            out[pos] = out[pos - rep0 - 1];
            pos++;
            continue;
          }
        } else {
          let dist;
          if (rc.bit(isRepG1, state) === 0) dist = rep1;
          else { if (rc.bit(isRepG2, state) === 0) dist = rep2; else { dist = rep3; rep3 = rep2; } rep2 = rep1; }
          rep1 = rep0;
          rep0 = dist;
        }
        len = decodeLen(rc, repLenDec, posState);
        state = state < 7 ? 8 : 11;
      } else {
        rep3 = rep2; rep2 = rep1; rep1 = rep0;
        len = decodeLen(rc, lenDec, posState);
        state = state < 7 ? 7 : 10;
        const slot = rc.tree(posSlot, (len < 3 ? len : 3) * 64, 6);
        if (slot < 4) rep0 = slot;
        else {
          const nd = (slot >> 1) - 1;
          let dist = (2 | (slot & 1)) * 2 ** nd;
          if (slot < 14) dist += rc.reverseTree(posDec, dist - slot, nd);
          else dist += rc.direct(nd - 4) * 16 + rc.reverseTree(align, 0, 4);
          rep0 = dist;
        }
        if (rep0 === 0xffffffff) break; // end marker
        if (rep0 >= pos) throw new Error('Corrupt LZMA stream');
      }
      len += 2;
      const end = Math.min(size, pos + len);
      const src = pos - rep0 - 1;
      for (let i = 0; pos < end; i++) out[pos++] = out[src + i];
    }
    if (onProgress && pos >= nextReport) { nextReport = pos + (1 << 22); onProgress(pos / size); }
  }
  return out;
}
