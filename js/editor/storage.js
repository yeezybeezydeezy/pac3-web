// Browser saves, autosave and compressed share links. All reads are wrapped: storage may be unavailable.
const AUTOSAVE = 'pac3web.autosave';
const SAVES = 'pac3web.saves';
const SETTINGS = 'pac3web.settings';
const MAX_SHARE_BYTES = 20e6;

function readJSON(key, fallback) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}
function writeRaw(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

export const storage = {
  autosave(str) { return writeRaw(AUTOSAVE, str); },
  loadAutosave() { try { const s = localStorage.getItem(AUTOSAVE); return s ? JSON.parse(s) : null; } catch { return null; } },
  listSaves() {
    const all = readJSON(SAVES, {});
    return Object.entries(all).map(([name, v]) => ({ name, time: v.time || 0, size: (v.data || '').length })).sort((a, b) => b.time - a.time);
  },
  save(name, str) { const all = readJSON(SAVES, {}); all[name] = { time: Date.now(), data: str }; return writeRaw(SAVES, JSON.stringify(all)); },
  load(name) { const v = readJSON(SAVES, {})[name]; return v ? JSON.parse(v.data) : null; },
  remove(name) { const all = readJSON(SAVES, {}); delete all[name]; writeRaw(SAVES, JSON.stringify(all)); },
  settings() { return readJSON(SETTINGS, {}); },
  saveSettings(s) { writeRaw(SETTINGS, JSON.stringify(s)); },
};

function toB64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64Url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function encodeShare(str) {
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return toB64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

/** Decompresses a share string, refusing anything that inflates past MAX_SHARE_BYTES. */
export async function decodeShare(code) {
  const stream = new Blob([fromB64Url(code)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_SHARE_BYTES) { reader.cancel(); throw new Error('Shared outfit is too large'); }
    chunks.push(value);
  }
  return JSON.parse(new TextDecoder().decode(await new Blob(chunks).arrayBuffer()));
}
