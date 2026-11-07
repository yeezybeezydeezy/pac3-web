// Parser for PAC3's saved outfits: Lua table literals with Vector()/Angle()/Color() values.
// Data only — nothing is executed. Untrusted input: size and depth are limited.

const MAX_LEN = 50e6;
const MAX_DEPTH = 200;

export function parseLuaData(text) {
  const s = String(text);
  if (s.length > MAX_LEN) throw new Error('Outfit file too large');
  let i = 0;
  const err = (m) => { const line = s.slice(0, i).split('\n').length; throw new Error(`${m} (line ${line})`); };
  const ws = () => {
    for (;;) {
      const c = s.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) { i++; continue; }
      if (s[i] === '-' && s[i + 1] === '-') {
        if (s[i + 2] === '[' && s[i + 3] === '[') { const e = s.indexOf(']]', i + 4); i = e < 0 ? s.length : e + 2; }
        else { while (i < s.length && s[i] !== '\n') i++; }
        continue;
      }
      break;
    }
  };
  const string = () => {
    const q = s[i++];
    let out = '';
    while (i < s.length && s[i] !== q) {
      if (s[i] === '\\') {
        const n = s[i + 1];
        const esc = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", a: '\x07', b: '\b', f: '\f', v: '\v', 0: '\0' };
        if (/\d/.test(n)) { const m = /^\d{1,3}/.exec(s.slice(i + 1)); out += String.fromCharCode(Number(m[0]) & 255); i += 1 + m[0].length; continue; }
        if (n === '\n') { out += '\n'; i += 2; continue; }
        out += esc[n] ?? n; i += 2; continue;
      }
      out += s[i++];
    }
    if (s[i] !== q) err('Unterminated string');
    i++;
    return out;
  };
  const longString = () => {
    const m = /^\[(=*)\[/.exec(s.slice(i, i + 64));
    const close = `]${m[1]}]`;
    const start = i + m[0].length;
    const e = s.indexOf(close, start);
    if (e < 0) err('Unterminated long string');
    i = e + close.length;
    return s.slice(start, e).replace(/^\r?\n/, '');
  };
  const number = () => {
    const m = /^-?(0x[0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?|inf|nan)/.exec(s.slice(i, i + 64));
    if (!m) err('Bad number');
    i += m[0].length;
    const v = m[0].toLowerCase().includes('inf') ? (m[0].startsWith('-') ? -Infinity : Infinity) : m[0].includes('nan') ? NaN : Number(m[0]);
    return v;
  };
  const value = (depth) => {
    if (depth > MAX_DEPTH) err('Nested too deeply');
    ws();
    const c = s[i];
    if (c === '{') return table(depth + 1);
    if (c === '"' || c === "'") return string();
    if (c === '[' && /^\[=*\[/.test(s.slice(i, i + 64))) return longString();
    if (c === '-' || c === '.' || (c >= '0' && c <= '9')) return number();
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i, i + 64));
    if (!m) err(`Unexpected "${c}"`);
    i += m[0].length;
    const w = m[0];
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'nil') return null;
    ws();
    if (s[i] === '(') {
      i++;
      const args = [];
      ws();
      while (s[i] !== ')') { args.push(value(depth + 1)); ws(); if (s[i] === ',') i++; ws(); if (i >= s.length) err('Unterminated call'); }
      i++;
      const n = args.map(Number);
      if (w === 'Vector') return { $type: 'Vector', v: [n[0] || 0, n[1] || 0, n[2] || 0] };
      if (w === 'Angle') return { $type: 'Angle', v: [n[0] || 0, n[1] || 0, n[2] || 0] };
      if (w === 'Color') return { $type: 'Color', v: [n[0] || 0, n[1] || 0, n[2] || 0, n[3] ?? 255] };
      return { $type: w, v: args };
    }
    return { $type: 'name', v: w };
  };
  const fields = (depth, closer) => {
    const t = new Map();
    let n = 1;
    for (;;) {
      ws();
      if (i >= s.length) { if (closer) err('Unterminated table'); break; }
      if (s[i] === closer) { i++; break; }
      let key;
      if (s[i] === '[' && !/^\[=*\[/.test(s.slice(i, i + 64))) {
        i++;
        key = value(depth);
        ws();
        if (s[i] !== ']') err('Expected ]');
        i++; ws();
        if (s[i] !== '=') err('Expected =');
        i++;
        t.set(key, value(depth));
      } else {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/.exec(s.slice(i, i + 128));
        if (m) { i += m[0].length; t.set(m[1], value(depth)); }
        else t.set(n++, value(depth));
      }
      ws();
      if (s[i] === ',' || s[i] === ';') i++;
    }
    return t;
  };
  const table = (depth) => { i++; return toJs(fields(depth, '}')); };
  // Maps with keys 1..n become arrays.
  const toJs = (map) => {
    const keys = [...map.keys()];
    if (keys.length && keys.every((k, idx) => k === idx + 1)) return keys.map((k) => map.get(k));
    const o = Object.create(null);
    for (const [k, v] of map) o[String(k)] = v;
    return o;
  };
  ws();
  // PAC3 files are either a bare field list ("[1] = {...}") or a single table.
  if (s[i] === '{') { const v = value(0); ws(); if (i >= s.length) return v; }
  i = 0;
  return toJs(fields(0, null));
}
