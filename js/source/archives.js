// VPK (Valve pak) and GMA (Garry's Mod addon) indexes. Pure functions over bytes.
import { Reader, normPath } from './binary.js';

const VPK_SIG = 0x55aa1234;

/**
 * Parses a *_dir.vpk file. Returns entries keyed by lowercase path:
 * { archive (index, 0x7fff = inside the dir file), offset, length, preload (Uint8Array|null) }.
 */
export function parseVpkDir(bytes) {
  const r = new Reader(bytes);
  if (r.u32() !== VPK_SIG) throw new Error('Not a VPK directory file');
  const version = r.u32();
  const treeSize = r.u32();
  if (version === 2) r.pos += 16;
  else if (version !== 1) throw new Error(`Unsupported VPK version ${version}`);
  const headerSize = r.pos;
  const treeEnd = headerSize + treeSize;
  const entries = new Map();
  for (;;) {
    const ext = r.str();
    if (!ext) break;
    for (;;) {
      const dir = r.str();
      if (!dir) break;
      for (;;) {
        const name = r.str();
        if (!name) break;
        r.u32(); // crc
        const preloadBytes = r.u16();
        const archive = r.u16();
        const offset = r.u32();
        const length = r.u32();
        if (r.u16() !== 0xffff) throw new Error('Corrupt VPK directory entry');
        const preload = preloadBytes ? r.slice(r.pos, preloadBytes) : null;
        r.pos += preloadBytes;
        const path = normPath(`${dir === ' ' ? '' : `${dir}/`}${name}${ext === ' ' ? '' : `.${ext}`}`);
        entries.set(path, { archive, offset, length, preload });
      }
    }
    if (r.pos > treeEnd) throw new Error('Corrupt VPK tree');
  }
  return { entries, dataOffset: treeEnd };
}

/**
 * Parses a GMA header and file table. `bytes` may be just the start of the file;
 * throws RangeError if more bytes are needed.
 * Returns { name, entries: Map(path -> {offset, length}) } with absolute offsets.
 */
export function parseGma(bytes) {
  const r = new Reader(bytes);
  if (r.fixedStr(0, 4) !== 'GMAD') throw new Error('Not a GMA file');
  r.pos = 4;
  const version = r.u8();
  r.pos += 16; // steamid, timestamp
  if (version > 1) while (r.str()) { /* required content list */ }
  const name = r.str();
  r.str(); // description (JSON)
  r.str(); // author
  r.i32(); // addon version
  const files = [];
  for (;;) {
    const num = r.u32();
    if (num === 0) break;
    const path = normPath(r.str());
    const length = r.u64();
    r.u32(); // crc
    files.push({ path, length });
  }
  let offset = r.pos;
  const entries = new Map();
  for (const f of files) { entries.set(f.path, { offset, length: f.length }); offset += f.length; }
  return { name, entries };
}

/**
 * Indexes a GMA of any size by reading only its header region.
 * read(offset, length) -> Promise<Uint8Array>; size = total file size.
 */
export async function indexGma(read, size) {
  for (let n = Math.min(size, 1 << 18); ; n = Math.min(size, n * 4)) {
    try {
      return parseGma(await read(0, n));
    } catch (e) {
      if (!(e instanceof RangeError) || n >= size) throw e;
    }
  }
}
