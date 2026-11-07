// Small shared helpers.
import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function uid() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function deepClone(v) {
  if (Array.isArray(v)) return v.map(deepClone);
  if (v && typeof v === 'object') return structuredClone(v);
  return v;
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  return false;
}

// Only these URL schemes may be used for loading assets.
export const isUrl = (s) => typeof s === 'string' && /^(https?:|data:|blob:)/i.test(s.trim());

const _euler = new THREE.Euler();
// PAC-style angles [pitch, yaw, roll] in degrees -> quaternion.
export function anglesToQuat(a, q = new THREE.Quaternion()) {
  _euler.set(a[0] * DEG, a[1] * DEG, a[2] * DEG, 'YXZ');
  return q.setFromEuler(_euler);
}
export function quatToAngles(q) {
  _euler.setFromQuaternion(q, 'YXZ');
  return [_euler.x / DEG, _euler.y / DEG, _euler.z / DEG];
}

// Colors are stored as sRGB floats 0..1.
export function setColor(color, rgb, mul = 1) {
  return color.setRGB(rgb[0] * mul, rgb[1] * mul, rgb[2] * mul, THREE.SRGBColorSpace);
}
export const rgbToHex = (c) => '#' + c.map((x) => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
export const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

// Tiny DOM builder. Text is always set via textContent, never parsed as HTML.
export function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k.includes('-') || k === 'list' || k === 'for') e.setAttribute(k, v === true ? '' : v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}

export function downloadText(filename, text, type = 'application/json') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function readFileAs(file, as = 'text') {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    if (as === 'dataurl') r.readAsDataURL(file); else r.readAsText(file);
  });
}
