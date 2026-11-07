// Little-endian binary reader for Source engine formats. No DOM / three.js dependencies.
const latin1 = new TextDecoder('latin1');

export class Reader {
  constructor(bytes, offset = 0) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.pos = offset;
  }
  get length() { return this.bytes.length; }
  check(n, at = this.pos) { if (at < 0 || at + n > this.bytes.length) throw new RangeError('Unexpected end of file'); }
  u8(at) { const p = at ?? this.pos; this.check(1, p); if (at == null) this.pos += 1; return this.bytes[p]; }
  i8(at) { const p = at ?? this.pos; this.check(1, p); if (at == null) this.pos += 1; return this.view.getInt8(p); }
  u16(at) { const p = at ?? this.pos; this.check(2, p); if (at == null) this.pos += 2; return this.view.getUint16(p, true); }
  i16(at) { const p = at ?? this.pos; this.check(2, p); if (at == null) this.pos += 2; return this.view.getInt16(p, true); }
  u32(at) { const p = at ?? this.pos; this.check(4, p); if (at == null) this.pos += 4; return this.view.getUint32(p, true); }
  i32(at) { const p = at ?? this.pos; this.check(4, p); if (at == null) this.pos += 4; return this.view.getInt32(p, true); }
  f32(at) { const p = at ?? this.pos; this.check(4, p); if (at == null) this.pos += 4; return this.view.getFloat32(p, true); }
  u64(at) { const lo = this.u32(at); const hi = this.u32(at == null ? undefined : at + 4); return hi * 4294967296 + lo; }
  vec3(at) { const p = at ?? this.pos; const v = [this.f32(p), this.f32(p + 4), this.f32(p + 8)]; if (at == null) this.pos += 12; return v; }
  /** Null-terminated string (latin1). */
  str(at, max = 4096) {
    const p = at ?? this.pos;
    let end = p;
    const lim = Math.min(this.bytes.length, p + max);
    while (end < lim && this.bytes[end] !== 0) end++;
    if (end >= lim && end - p >= max) throw new RangeError('String too long');
    if (end >= this.bytes.length) throw new RangeError('Unterminated string');
    if (at == null) this.pos = end + 1;
    return latin1.decode(this.bytes.subarray(p, end));
  }
  fixedStr(at, len) { const s = latin1.decode(this.bytes.subarray(at, at + len)); const z = s.indexOf('\0'); return z >= 0 ? s.slice(0, z) : s; }
  slice(at, len) { this.check(len, at); return this.bytes.subarray(at, at + len); }
}

/** Normalizes a game path: lowercase, forward slashes, no leading slash or ./ */
export function normPath(p) {
  return String(p).replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.?\//, '').trim().toLowerCase();
}
