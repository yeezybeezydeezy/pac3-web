// Valve KeyValues parser (used by .vmt materials). Keys are lowercased.

function tokenize(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c <= ' ') { i++; continue; }
    if (c === '{' || c === '}') { out.push(c); i++; continue; }
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < n && text[j] !== '"') { if (text[j] === '\\' && j + 1 < n) { s += text[j + 1] === 'n' ? '\n' : text[j + 1]; j += 2; } else s += text[j++]; }
      out.push({ s });
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < n && text[j] > ' ' && text[j] !== '{' && text[j] !== '}' && text[j] !== '"') j++;
    out.push({ s: text.slice(i, j) });
    i = j;
    if (out.length > 200000) throw new Error('KeyValues too large');
  }
  return out;
}

/** Returns { name, value } where value is an object of lowercase keys -> string | object. */
export function parseKeyValues(text) {
  const toks = tokenize(String(text).replace(/^﻿/, ''));
  let i = 0;
  const block = (depth) => {
    if (depth > 32) throw new Error('KeyValues nested too deeply');
    const obj = Object.create(null);
    while (i < toks.length && toks[i] !== '}') {
      const k = toks[i++];
      if (typeof k !== 'object') continue;
      const key = k.s.toLowerCase();
      const v = toks[i++];
      if (v === '{') { obj[key] = block(depth + 1); i++; }
      else if (v && typeof v === 'object') {
        // conditional suffix like [$WIN32] after a value
        if (toks[i] && typeof toks[i] === 'object' && /^\[.*\]$/.test(toks[i].s)) i++;
        if (!(key in obj)) obj[key] = v.s;
      }
    }
    return obj;
  };
  const name = toks[0] && typeof toks[0] === 'object' ? toks[0].s : '';
  i = 1;
  if (toks[i] === '{') { i++; return { name: name.toLowerCase(), value: block(0) }; }
  return { name: name.toLowerCase(), value: Object.create(null) };
}

/** Parses a Source vector string like "[1 0.5 0.2]" or "{255 128 0}" into floats 0..1+. */
export function parseVmtVector(s) {
  if (s == null) return null;
  const str = String(s).trim();
  const nums = str.replace(/[[\]{}]/g, ' ').trim().split(/\s+/).map(Number);
  if (!nums.length || nums.some((x) => !Number.isFinite(x))) { const n = Number(str); return Number.isFinite(n) ? [n, n, n] : null; }
  const v = nums.length === 1 ? [nums[0], nums[0], nums[0]] : nums.slice(0, 3);
  return str.startsWith('{') ? v.map((x) => x / 255) : v;
}
