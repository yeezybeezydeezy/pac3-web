// Minimal .zip reader for downloaded model packs (PAC3 "URL models"): stored and deflated entries,
// read from the central directory. Untrusted input: entry count and sizes are limited.
const MAX_ENTRIES = 4096;
const MAX_TOTAL = 512 * 1024 * 1024;

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Returns [{ name, size, read(): Promise<Uint8Array> }] for the files (not folders) in a zip archive. */
export function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // end of central directory: last 0x06054b50 within the final 64 KB (comment may follow it)
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip archive (is the link a web page instead of the file?)');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff) throw new Error('ZIP64 archives are not supported');
  if (count > MAX_ENTRIES) throw new Error(`Zip archive has more than ${MAX_ENTRIES} files`);
  const out = [];
  let total = 0;
  const latin1 = new TextDecoder('latin1'), utf8 = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip archive');
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = ((flags & 0x800) ? utf8 : latin1).decode(bytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error('Encrypted zip archives are not supported');
    if (method !== 0 && method !== 8) throw new Error(`Unsupported zip compression (method ${method}) for ${name}`);
    total += size;
    if (total > MAX_TOTAL) throw new Error('Zip archive unpacks to more than 512 MB');
    if (local + 30 > bytes.length || dv.getUint32(local, true) !== 0x04034b50) throw new Error('Corrupt zip archive');
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    if (start + csize > bytes.length) throw new Error('Corrupt zip archive');
    const raw = bytes.subarray(start, start + csize);
    let cached = null;
    out.push({
      name, size,
      read() {
        cached ||= (method === 0 ? Promise.resolve(raw) : inflateRaw(raw)).then((d) => {
          if (d.length !== size) throw new Error(`Corrupt zip entry ${name}`);
          return d;
        });
        return cached;
      },
    });
  }
  return out;
}
