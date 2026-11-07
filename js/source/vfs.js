// Virtual file system over the user's local game folders. Files are read on this machine only;
// nothing is uploaded. Supports folders (File System Access API, drag and drop, or <input webkitdirectory>),
// VPK archives, Workshop .gma files and legacy LZMA-compressed _legacy.bin items.
import { parseVpkDir, indexGma } from './archives.js';
import { normPath } from './binary.js';

const readBlob = async (blob, offset = 0, length = blob.size - offset) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());

/** Loose files below a directory handle; directory listings are cached and case-insensitive. */
class FolderMount {
  constructor(handle, label) { this.kind = 'folder'; this.handle = handle; this.label = label; this.dirs = new Map(); }
  async _dirHandle(dir) {
    let h = this.handle;
    if (!dir) return h;
    let cur = '';
    for (const seg of dir.split('/')) {
      const listing = await this._listOnly(cur, h);
      const e = listing.get(seg);
      if (!e || e.kind !== 'directory') return null;
      h = e;
      cur = cur ? `${cur}/${seg}` : seg;
    }
    return h;
  }
  async _listOnly(dir, h) {
    if (this.dirs.has(dir)) return this.dirs.get(dir);
    const p = (async () => { const map = new Map(); for await (const [name, e] of h.entries()) map.set(name.toLowerCase(), e); return map; })();
    this.dirs.set(dir, p);
    return p;
  }
  async entry(path) {
    const i = path.lastIndexOf('/');
    const dir = i < 0 ? '' : path.slice(0, i), name = path.slice(i + 1);
    const dh = await this._dirHandle(dir);
    if (!dh) return null;
    const e = (await this._listOnly(dir, dh)).get(name);
    return e && e.kind === 'file' ? e : null;
  }
  async read(path) { const e = await this.entry(path); return e ? new Uint8Array(await (await e.getFile()).arrayBuffer()) : null; }
  async list(dir) {
    const dh = await this._dirHandle(dir);
    if (!dh) return null;
    const out = { dirs: [], files: [] };
    for (const [n, e] of await this._listOnly(dir, dh)) (e.kind === 'directory' ? out.dirs : out.files).push(n);
    return out;
  }
}

/** Loose files from an <input webkitdirectory> FileList (fallback for browsers without the FS Access API). */
class FileListMount {
  constructor(files, prefix, label) {
    this.kind = 'folder'; this.label = label; this.files = new Map();
    for (const [p, f] of files) if (p.startsWith(prefix)) this.files.set(p.slice(prefix.length), f);
  }
  async read(path) { const f = this.files.get(path); return f ? readBlob(f) : null; }
  async list(dir) { return listFromKeys(this.files.keys(), dir); }
  keys() { return this.files.keys(); }
}

/**
 * A dropped FileSystemEntry (DataTransferItem.webkitGetAsEntry) in the shape of a File System Access
 * handle, so dropped folders mount exactly like picked ones and are read lazily. "transient": entries
 * only live until the page is reloaded, so they are never saved for the next visit.
 */
export function entryToHandle(entry) {
  if (entry.isFile) return { kind: 'file', name: entry.name, getFile: () => new Promise((res, rej) => entry.file(res, rej)) };
  return {
    kind: 'directory', name: entry.name, transient: true,
    async *entries() {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) return;
        for (const e of batch) yield [e.name, entryToHandle(e)];
      }
    },
  };
}

class VpkMount {
  constructor(label, dirFile, index, archiveFile) { this.kind = 'vpk'; this.label = label; this.dirFile = dirFile; this.index = index; this.archiveFile = archiveFile; }
  get size() { return this.index.entries.size; }
  async read(path) {
    const e = this.index.entries.get(path);
    if (!e) return null;
    let data;
    if (!e.length) data = new Uint8Array(0);
    else if (e.archive === 0x7fff) data = await readBlob(this.dirFile, this.index.dataOffset + e.offset, e.length);
    else { const f = await this.archiveFile(e.archive); if (!f) throw new Error(`Missing VPK archive ${e.archive}`); data = await readBlob(f, e.offset, e.length); }
    if (!e.preload) return data;
    const out = new Uint8Array(e.preload.length + data.length);
    out.set(e.preload); out.set(data, e.preload.length);
    return out;
  }
  async list(dir) { return listFromKeys(this.index.entries.keys(), dir); }
  keys() { return this.index.entries.keys(); }
}

class GmaMount {
  constructor(label, blob, index) { this.kind = 'gma'; this.label = label; this.blob = blob; this.index = index; }
  get size() { return this.index.entries.size; }
  async read(path) { const e = this.index.entries.get(path); return e ? readBlob(this.blob, e.offset, e.length) : null; }
  async list(dir) { return listFromKeys(this.index.entries.keys(), dir); }
  keys() { return this.index.entries.keys(); }
}

function listFromKeys(keys, dir) {
  const pre = dir ? `${dir}/` : '';
  const dirs = new Set(), files = [];
  for (const k of keys) {
    if (!k.startsWith(pre)) continue;
    const rest = k.slice(pre.length);
    const i = rest.indexOf('/');
    if (i < 0) files.push(rest); else dirs.add(rest.slice(0, i));
  }
  return dirs.size || files.length ? { dirs: [...dirs], files } : null;
}

// ---------- persistence of granted folder handles (IndexedDB) ----------
const DB = 'pac3web', STORE = 'handles';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
  });
}

export class VFS {
  constructor() {
    this.mounts = [];
    this.roots = []; // {id, name, handle?, state: 'mounted'|'needs-permission'|'error', mountCount, message}
    this.listeners = new Set();
    this.pending = 0;
    this._worker = null;
  }
  get supported() { return typeof window !== 'undefined' && 'showDirectoryPicker' in window; }
  get mounted() { return this.mounts.length > 0; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _changed() { for (const fn of this.listeners) fn(); }

  async read(path) {
    path = normPath(path);
    for (const m of this.mounts) {
      try { const d = await m.read(path); if (d) return d; } catch (e) { console.warn('[pac3] read failed', m.label, path, e); }
    }
    return null;
  }
  async list(dir) {
    dir = normPath(dir).replace(/\/$/, '');
    const dirs = new Set(), files = new Set();
    for (const m of this.mounts) {
      try { const l = await m.list(dir); if (l) { l.dirs.forEach((d) => dirs.add(d)); l.files.forEach((f) => files.add(f)); } } catch { /* unreadable */ }
    }
    return { dirs: [...dirs].sort(), files: [...files].sort() };
  }
  /** Searches indexed archives (and fallback file lists) for paths containing every word. */
  search(query, filter = () => true, limit = 300) {
    const words = normPath(query).split(/\s+/).filter(Boolean);
    const out = new Set();
    for (const m of this.mounts) {
      if (!m.keys) continue;
      for (const k of m.keys()) {
        if (words.every((w) => k.includes(w)) && filter(k)) { out.add(k); if (out.size >= limit) return [...out]; }
      }
    }
    return [...out];
  }

  // ---------- mounting ----------
  async pickFolder() {
    const handle = await window.showDirectoryPicker({ id: 'pac3-game', mode: 'read' });
    await this.addRoot(handle, true);
  }
  async addRoot(handle, persist) {
    if (this.roots.some((r) => r.handle && r.name === handle.name && r.state === 'mounted')) return;
    const root = { id: `${handle.name}-${Date.now()}`, name: handle.name, handle, transient: !!handle.transient, state: 'mounting', mountCount: 0, message: '' };
    this.roots.push(root);
    this._changed();
    try {
      root.mountCount = await this._detect(handle, handle.name);
      root.state = 'mounted';
      root.message = root.mountCount ? '' : 'No game content found in this folder';
      if (persist) await this._persist();
    } catch (e) { root.state = 'error'; root.message = e.message; }
    this._changed();
  }
  /**
   * Mounts folders (or .gma files) dragged onto the page. Call webkitGetAsEntry() inside the drop
   * event and pass the entries here; they stay readable after the event.
   */
  async addEntries(entries) {
    for (const entry of entries) {
      const handle = entryToHandle(entry);
      if (entry.isDirectory) { await this.addRoot(handle, false); continue; }
      const root = { id: `${entry.name}-${Date.now()}`, name: entry.name, transient: true, state: 'mounting', mountCount: 0, message: '' };
      this.roots.push(root);
      this._changed();
      root.mountCount = await this._mountGma(handle, entry.name);
      root.state = root.mountCount ? 'mounted' : 'error';
      if (!root.mountCount) root.message = 'Not a readable .gma file';
      this._changed();
    }
  }
  async addFileList(fileList) {
    const files = new Map();
    let top = '';
    for (const f of fileList) { const p = normPath(f.webkitRelativePath || f.name); files.set(p, f); top ||= p.split('/')[0]; }
    // a whole steamapps folder: keep Garry's Mod and its Workshop items, not every other game's content
    const keys = [...files.keys()];
    if (keys.some((p) => /(^|\/)common\/garrysmod\//.test(p))) {
      for (const p of keys) if ((/(^|\/)common\//.test(p) && !/(^|\/)common\/garrysmod\//.test(p)) || /(^|\/)workshop\/content\/(?!4000\/)/.test(p)) files.delete(p);
    }
    const root = { id: `${top}-${Date.now()}`, name: top, transient: true, state: 'mounting', mountCount: 0, message: '' };
    this.roots.push(root);
    this._changed();
    try {
      let n = 0, skipped = 0;
      const prefixes = new Set(), legacy = [];
      for (const p of files.keys()) {
        const m = /^(.*?)(models|materials|sound)\//.exec(p);
        if (m) prefixes.add(m[1]);
        // one unreadable archive should not stop the rest from mounting
        try {
          if (/\.gma$/.test(p)) { this._push(new GmaMount(p, files.get(p), await indexGma((o, l) => readBlob(files.get(p), o, l), files.get(p).size))); n++; }
          else if (/_dir\.vpk$/.test(p)) { await this._mountVpkFromFiles(p, files); n++; }
          else if (/_legacy\.bin$/.test(p)) legacy.push({ e: { getFile: async () => files.get(p) }, label: `${p} (legacy)` });
        } catch (err) { skipped++; console.warn('[pac3] skipped', p, err); }
      }
      if (skipped) root.message = `${skipped} unreadable archive(s) skipped`;
      for (const pre of prefixes) { this._push(new FileListMount(files, pre, `${top}/${pre}`)); n++; }
      if (legacy.length) this._decompressLegacy(legacy);
      root.mountCount = n;
      root.state = 'mounted';
    } catch (e) { root.state = 'error'; root.message = e.message; }
    this._changed();
  }
  async _mountVpkFromFiles(p, files) {
    const dirFile = files.get(p);
    const base = p.replace(/_dir\.vpk$/, '');
    const index = parseVpkDir(await readBlob(dirFile));
    this._push(new VpkMount(p.split('/').pop(), dirFile, index, async (i) => files.get(`${base}_${String(i).padStart(3, '0')}.vpk`)));
  }

  _push(m) {
    // loose folders and addons take priority over base-game VPKs, like Garry's Mod
    const firstVpk = this.mounts.findIndex((x) => x.kind === 'vpk');
    if (m.kind === 'vpk' || firstVpk < 0) this.mounts.push(m);
    else this.mounts.splice(firstVpk, 0, m);
  }

  async _children(h) { const out = new Map(); for await (const [n, e] of h.entries()) out.set(n.toLowerCase(), e); return out; }

  /** Recognizes the folder that was picked and mounts what it contains. Returns mount count. */
  async _detect(h, label, depth = 0) {
    const kids = await this._children(h);
    const dir = (n) => { const e = kids.get(n); return e && e.kind === 'directory' ? e : null; };
    let n = 0;
    if (dir('steamapps')) return this._detect(dir('steamapps'), `${label}/steamapps`, depth + 1);
    if (dir('common') && depth < 3) {
      const gm = await this._children(dir('common'));
      if (gm.get('garrysmod')) n += await this._detect(gm.get('garrysmod'), `${label}/common/GarrysMod`, depth + 1);
      const ws = dir('workshop');
      if (ws) { const c = (await this._children(ws)).get('content'); const w = c && (await this._children(c)).get('4000'); if (w) n += await this._mountWorkshop(w, 'workshop'); }
      return n;
    }
    if (dir('garrysmod')) {
      const inner = await this._children(dir('garrysmod'));
      if (inner.get('garrysmod') && inner.get('garrysmod').kind === 'directory') return this._detect(dir('garrysmod'), `${label}/GarrysMod`, depth + 1);
      n += await this._mountGameDir(dir('garrysmod'), `${label}/garrysmod`);
      const se = dir('sourceengine');
      if (se) n += await this._mountVpks(se, `${label}/sourceengine`);
      return n;
    }
    if (kids.has('gameinfo.txt') || kids.has('garrysmod_dir.vpk')) return this._mountGameDir(h, label);
    if (label === '4000' || label === 'content' || [...kids.values()].some((e) => e.kind === 'directory' && /^\d{6,}$/.test(e.name))) {
      if (kids.get('4000')) return this._mountWorkshop(kids.get('4000'), 'workshop');
      return this._mountWorkshop(h, label);
    }
    // a plain content folder, an addon folder, or a folder of .gma files
    if (dir('models') || dir('materials') || dir('sound')) { this._push(new FolderMount(h, label)); n++; }
    for (const [name, e] of kids) if (e.kind === 'file' && name.endsWith('.gma')) n += await this._mountGma(e, `${label}/${name}`);
    if (!n && depth === 0) for (const [name, e] of kids) if (e.kind === 'directory' && depth < 2) n += await this._detect(e, `${label}/${name}`, depth + 1);
    return n;
  }
  async _mountGameDir(g, label) {
    let n = 0;
    this._push(new FolderMount(g, label)); n++;
    const kids = await this._children(g);
    const addons = kids.get('addons');
    if (addons && addons.kind === 'directory') {
      for (const [name, e] of await this._children(addons)) {
        if (e.kind === 'directory') { this._push(new FolderMount(e, `addons/${name}`)); n++; }
        else if (name.endsWith('.gma')) n += await this._mountGma(e, `addons/${name}`);
      }
    }
    // what servers sent: Workshop addons (cache/workshop/*.gma) and FastDL files (download/)
    const cache = kids.get('cache');
    const cws = cache && cache.kind === 'directory' ? (await this._children(cache)).get('workshop') : null;
    if (cws && cws.kind === 'directory') for (const [name, e] of await this._children(cws)) if (e.kind === 'file' && name.endsWith('.gma')) n += await this._mountGma(e, `cache/workshop/${name}`);
    const dl = kids.get('download');
    if (dl && dl.kind === 'directory') { this._push(new FolderMount(dl, `${label}/download`)); n++; }
    n += await this._mountVpks(g, label);
    return n;
  }
  async _mountVpks(h, label) {
    let n = 0;
    const kids = await this._children(h);
    for (const [name, e] of kids) {
      if (e.kind !== 'file' || !name.endsWith('_dir.vpk')) continue;
      const base = name.slice(0, -8);
      const dirFile = await e.getFile();
      try {
        const index = parseVpkDir(await readBlob(dirFile));
        this._push(new VpkMount(`${label}/${name}`, dirFile, index, async (i) => { const a = kids.get(`${base}_${String(i).padStart(3, '0')}.vpk`); return a ? a.getFile() : null; }));
        n++;
      } catch (err) { console.warn('[pac3] bad vpk', name, err); }
    }
    return n;
  }
  async _mountGma(handle, label) {
    try {
      const f = await handle.getFile();
      this._push(new GmaMount(label, f, await indexGma((o, l) => readBlob(f, o, l), f.size)));
      return 1;
    } catch (err) { console.warn('[pac3] bad gma', label, err); return 0; }
  }
  async _mountWorkshop(h, label) {
    let n = 0;
    const legacy = [];
    for (const [id, item] of await this._children(h)) {
      if (item.kind !== 'directory') continue;
      for (const [name, e] of await this._children(item)) {
        if (e.kind !== 'file') continue;
        if (name.endsWith('.gma')) n += await this._mountGma(e, `workshop/${id}`);
        else if (name.endsWith('_legacy.bin')) legacy.push({ e, label: `workshop/${id} (legacy)` });
      }
    }
    if (legacy.length) this._decompressLegacy(legacy);
    return n;
  }
  /** Legacy Workshop items are LZMA-compressed GMAs; decompress them one by one in a worker. */
  async _decompressLegacy(items) {
    this.pending += items.length;
    this._changed();
    for (const { e, label } of items) {
      try {
        const f = await e.getFile();
        if (f.size > 300e6) throw new Error('too large');
        const buf = await f.arrayBuffer();
        this._worker ||= new Worker(new URL('./lzma-worker.js', import.meta.url), { type: 'module' });
        const out = await new Promise((resolve, reject) => {
          this._worker.onmessage = (m) => (m.data.error ? reject(new Error(m.data.error)) : resolve(m.data.bytes));
          this._worker.postMessage({ bytes: buf }, [buf]);
        });
        const blob = new Blob([out]);
        this._push(new GmaMount(label, blob, await indexGma((o, l) => readBlob(blob, o, l), blob.size)));
      } catch (err) { console.warn('[pac3] legacy workshop item failed', label, err); }
      this.pending--;
      this._changed();
    }
  }

  async _persist() {
    if (!('indexedDB' in window)) return;
    const handles = this.roots.filter((r) => r.handle && !r.transient && r.state === 'mounted').map((r) => r.handle);
    try { await idbDo('readwrite', (s) => s.put(handles, 'roots')); } catch (e) { console.warn('[pac3] could not remember folders', e); }
  }
  async forget(root) {
    this.roots = this.roots.filter((r) => r !== root);
    await this._persist();
    location.reload();
  }
  /** Re-mounts folders granted on a previous visit. Folders needing a click are listed as 'needs-permission'. */
  async restore() {
    if (!this.supported || !('indexedDB' in window)) return;
    let handles = [];
    try { handles = (await idbDo('readonly', (s) => s.get('roots'))) || []; } catch { return; }
    for (const h of handles) {
      let perm = 'prompt';
      try { perm = await h.queryPermission({ mode: 'read' }); } catch { /* old browser */ }
      if (perm === 'granted') await this.addRoot(h, false);
      else { this.roots.push({ id: `${h.name}-saved`, name: h.name, handle: h, state: 'needs-permission', mountCount: 0, message: 'Click to reconnect' }); this._changed(); }
    }
  }
  /** Must be called from a click. */
  async reconnect(root) {
    if ((await root.handle.requestPermission({ mode: 'read' })) !== 'granted') return;
    this.roots = this.roots.filter((r) => r !== root);
    await this.addRoot(root.handle, false);
  }
}
