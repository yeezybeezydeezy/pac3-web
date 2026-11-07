// Procedural textures (generated on canvases) plus URL textures. Single entry point: getTexture().
import * as THREE from 'three';
import { isUrl, fixUrl } from './util.js';
import { getSourceTexture, isGamePath } from '../source/assets.js';

const cache = new Map();
const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');

function canvas(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}
function radial(ctx, s, stops) {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
}
function starPath(ctx, cx, cy, points, outer, inner) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer, a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}
// Deterministic PRNG so generated textures look the same every load.
function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

const SPRITES = {
  glow: () => { const [c, x] = canvas(); radial(x, 128, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,.7)'], [1, 'rgba(255,255,255,0)']]); return c; },
  soft: () => { const [c, x] = canvas(); radial(x, 128, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]); return c; },
  dot: () => { const [c, x] = canvas(); x.fillStyle = '#fff'; x.beginPath(); x.arc(64, 64, 56, 0, 7); x.fill(); return c; },
  ring: () => { const [c, x] = canvas(); x.strokeStyle = '#fff'; x.lineWidth = 10; x.shadowColor = '#fff'; x.shadowBlur = 12; x.beginPath(); x.arc(64, 64, 46, 0, 7); x.stroke(); return c; },
  star: () => { const [c, x] = canvas(); x.fillStyle = '#fff'; x.shadowColor = '#fff'; x.shadowBlur = 10; starPath(x, 64, 66, 5, 54, 22); x.fill(); return c; },
  spark: () => {
    const [c, x] = canvas(); radial(x, 128, [[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,255,255,.6)'], [0.4, 'rgba(255,255,255,0)']]);
    x.globalCompositeOperation = 'lighter';
    for (const [w, h] of [[128, 6], [6, 128]]) { const g = x.createLinearGradient(64 - w / 2, 64 - h / 2, 64 + w / 2, 64 + h / 2); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(64 - w / 2, 64 - h / 2, w, h); }
    return c;
  },
  flare: () => {
    const [c, x] = canvas(256); radial(x, 256, [[0, 'rgba(255,255,255,1)'], [0.1, 'rgba(255,255,255,.5)'], [0.5, 'rgba(255,255,255,0)']]);
    const r = rng(7); x.globalCompositeOperation = 'lighter'; x.translate(128, 128);
    for (let i = 0; i < 24; i++) { x.rotate((Math.PI * 2) / 24 + r() * 0.1); const len = 60 + r() * 68; const g = x.createLinearGradient(0, 0, len, 0); g.addColorStop(0, 'rgba(255,255,255,.6)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, -1.2, len, 2.4); }
    return c;
  },
  smoke: () => {
    const [c, x] = canvas(); const r = rng(3);
    for (let i = 0; i < 26; i++) { const px = 30 + r() * 68, py = 30 + r() * 68, rad = 14 + r() * 26; const g = x.createRadialGradient(px, py, 0, px, py, rad); g.addColorStop(0, 'rgba(255,255,255,.22)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); }
    return c;
  },
  heart: () => {
    const [c, x] = canvas(); x.fillStyle = '#fff'; x.shadowColor = '#fff'; x.shadowBlur = 8; x.beginPath();
    x.moveTo(64, 108); x.bezierCurveTo(10, 72, 14, 22, 42, 22); x.bezierCurveTo(56, 22, 62, 32, 64, 40); x.bezierCurveTo(66, 32, 72, 22, 86, 22); x.bezierCurveTo(114, 22, 118, 72, 64, 108); x.fill(); return c;
  },
  square: () => { const [c, x] = canvas(); x.fillStyle = '#fff'; x.beginPath(); x.roundRect(12, 12, 104, 104, 14); x.fill(); return c; },
  plus: () => { const [c, x] = canvas(); x.fillStyle = '#fff'; x.fillRect(52, 12, 24, 104); x.fillRect(12, 52, 104, 24); return c; },
  bubble: () => { const [c, x] = canvas(); radial(x, 128, [[0, 'rgba(255,255,255,0.05)'], [0.8, 'rgba(255,255,255,.25)'], [0.9, 'rgba(255,255,255,.9)'], [1, 'rgba(255,255,255,0)']]); x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.ellipse(44, 40, 12, 7, -0.6, 0, 7); x.fill(); return c; },
  lightning: () => { const [c, x] = canvas(); x.fillStyle = '#fff'; x.shadowColor = '#fff'; x.shadowBlur = 10; x.beginPath(); for (const [px, py] of [[72, 8], [34, 70], [60, 70], [48, 120], [96, 52], [68, 52], [84, 8]]) x.lineTo(px, py); x.fill(); return c; },
};

const SURFACES = {
  checker: () => { const [c, x] = canvas(); for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = (i + j) % 2 ? '#fff' : '#9a9a9a'; x.fillRect(i * 16, j * 16, 16, 16); } return c; },
  grid: () => { const [c, x] = canvas(); x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128); x.strokeStyle = '#555'; x.lineWidth = 2; for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * 16, 0); x.lineTo(i * 16, 128); x.moveTo(0, i * 16); x.lineTo(128, i * 16); x.stroke(); } return c; },
  stripes: () => { const [c, x] = canvas(); x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#777'; for (let i = -128; i < 256; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 16, 0); x.lineTo(i + 16 + 128, 128); x.lineTo(i + 128, 128); x.fill(); } return c; },
  noise: () => { const [c, x] = canvas(64); const d = x.createImageData(64, 64); const r = rng(11); for (let i = 0; i < d.data.length; i += 4) { const v = 150 + r() * 105; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } x.putImageData(d, 0, 0); return c; },
  bricks: () => { const [c, x] = canvas(); x.fillStyle = '#ccc'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#fff'; for (let row = 0; row < 8; row++) for (let col = -1; col < 4; col++) x.fillRect(col * 32 + (row % 2) * 16 + 2, row * 16 + 2, 28, 12); return c; },
  dots: () => { const [c, x] = canvas(); x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#888'; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.beginPath(); x.arc(16 + i * 32 + (j % 2) * 16, 16 + j * 32, 7, 0, 7); x.fill(); } return c; },
  camo: () => { const [c, x] = canvas(); x.fillStyle = '#bbb'; x.fillRect(0, 0, 128, 128); const r = rng(5); for (const col of ['#888', '#fff', '#666']) for (let i = 0; i < 14; i++) { x.fillStyle = col; x.beginPath(); x.ellipse(r() * 128, r() * 128, 8 + r() * 16, 5 + r() * 10, r() * 3, 0, 7); x.fill(); } return c; },
  scales: () => { const [c, x] = canvas(); x.fillStyle = '#777'; x.fillRect(0, 0, 128, 128); for (let row = 0; row < 9; row++) for (let col = -1; col < 5; col++) { const cx = col * 32 + (row % 2) * 16, cy = row * 16; const g = x.createRadialGradient(cx, cy - 4, 2, cx, cy, 17); g.addColorStop(0, '#fff'); g.addColorStop(1, '#999'); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, 16, 0, Math.PI); x.fill(); } return c; },
  rainbow: () => { const [c, x] = canvas(); const g = x.createLinearGradient(0, 0, 128, 0); ['#f33', '#fb3', '#ff3', '#3f5', '#3cf', '#53f', '#f3f', '#f33'].forEach((col, i, a) => g.addColorStop(i / (a.length - 1), col)); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return c; },
};

const TRAILS = {
  laser: () => { const [c, x] = canvas(64); const g = x.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return c; },
  plain: () => { const [c, x] = canvas(16); x.fillStyle = '#fff'; x.fillRect(0, 0, 16, 16); return c; },
  dashes: () => { const [c, x] = canvas(64); x.fillStyle = '#fff'; x.fillRect(0, 16, 32, 32); return c; },
  arrows: () => { const [c, x] = canvas(64); x.fillStyle = '#fff'; x.beginPath(); x.moveTo(8, 8); x.lineTo(40, 32); x.lineTo(8, 56); x.lineTo(20, 32); x.fill(); return c; },
};

export const SPRITE_TEXTURES = Object.keys(SPRITES);
export const SURFACE_TEXTURES = Object.keys(SURFACES);
export const TRAIL_TEXTURES = [...Object.keys(TRAILS), 'smoke', 'glow', 'rainbow', 'stripes'];
export const ALL_TEXTURES = [...SPRITE_TEXTURES, ...SURFACE_TEXTURES, ...Object.keys(TRAILS)];
const GENERATORS = { ...SPRITES, ...SURFACES, ...TRAILS };

/**
 * Returns a shared texture for a generated name, an image URL, a .vtf URL or a game material/texture
 * path (resolved from mounted game folders). Null for empty/unknown names.
 */
export function getTexture(name, opts = {}) {
  name = String(name || '').trim();
  if (!name) return null;
  if (/\.vtf(\?|#|$)/i.test(name) || isGamePath(name)) return getSourceTexture(name, opts);
  if (cache.has(name)) return cache.get(name);
  let tex = null;
  if (isUrl(name)) {
    tex = loader.load(fixUrl(name, 'image'), undefined, undefined, () => console.warn('[pac3] failed to load texture', name.slice(0, 120)));
  } else if (Object.hasOwn(GENERATORS, name.toLowerCase())) {
    tex = new THREE.CanvasTexture(GENERATORS[name.toLowerCase()]());
  } else return null;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  cache.set(name, tex);
  return tex;
}
