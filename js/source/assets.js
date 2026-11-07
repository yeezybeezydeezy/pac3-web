// three.js side of Source asset loading: textures (.vtf / .vmt), materials, models (.mdl) and sounds,
// read from the user's mounted folders (vfs) or from URLs. Source axes (X fwd, Y left, Z up) are
// converted to ours (X left, Y up, Z fwd) with ours = (src.y, src.z, src.x).
import * as THREE from 'three';
import { VFS } from './vfs.js';
import { decodeVTF } from './vtf.js';
import { parseKeyValues, parseVmtVector } from './keyvalues.js';
import { parseSourceModel, materialPaths } from './mdl.js';
import { normPath } from './binary.js';
import { parseAnimModel } from './anim.js';

export const vfs = new VFS();
const isUrl = (s) => /^(https?:|data:|blob:)/i.test(s);
const textDecoder = new TextDecoder('latin1');

export const toOurs = (v) => [v[1], v[2], v[0]];
/** Source quaternion (x,y,z,w) -> ours. The axis permutation is a proper rotation. */
export const quatToOurs = (q) => new THREE.Quaternion(q[1], q[2], q[0], q[3]);
/** Source 3x4 row-major matrix -> our Matrix4. */
export function mat34ToOurs(m) {
  const s = new THREE.Matrix4().set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], 0, 0, 0, 1);
  const P = new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1);
  return P.clone().multiply(s).multiply(P.clone().transpose());
}

/** Is this an asset path that should be resolved from game content? */
export const isGamePath = (s) => typeof s === 'string' && !isUrl(s) && /[\\/]/.test(s);
export const isSourceModelPath = (s) => typeof s === 'string' && /\.mdl$/i.test(s.trim()) && !isUrl(s.trim());

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// ---------- materials (.vmt) ----------
const vmtCache = new Map();
export function loadVmt(path, depth = 0) {
  const key = isUrl(path) ? path : normPath(path);
  if (vmtCache.has(key)) return vmtCache.get(key);
  const p = (async () => {
    const bytes = isUrl(key) ? await fetchBytes(key) : await vfs.read(key);
    if (!bytes) return null;
    const kv = parseKeyValues(textDecoder.decode(bytes));
    if (kv.name === 'patch' && kv.value.include && depth < 4) {
      const base = await loadVmt(kv.value.include, depth + 1);
      const params = Object.assign(Object.create(null), base ? base.params : {});
      for (const blk of ['insert', 'replace']) if (kv.value[blk] && typeof kv.value[blk] === 'object') Object.assign(params, kv.value[blk]);
      return { shader: base ? base.shader : 'vertexlitgeneric', params };
    }
    return { shader: kv.name, params: kv.value };
  })().catch((e) => { console.warn('[pac3] vmt', key, e); return null; });
  vmtCache.set(key, p);
  return p;
}

// ---------- textures ----------
const texCache = new Map();
function glowPixels(n = 32) {
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
    const o = (y * n + x) * 4;
    d[o] = d[o + 1] = d[o + 2] = 255;
    d[o + 3] = Math.max(0, 1 - r) ** 2 * 255;
  }
  return { data: d, width: n, height: n };
}
function fillTexture(tex, img, linear) {
  tex.image = img;
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.dispose();
  tex.needsUpdate = true;
}

async function textureBytes(ref) {
  if (isUrl(ref)) return { bytes: await fetchBytes(ref), ext: /\.vtf(\?|#|$)/i.test(ref) || ref.startsWith('data:application/octet-stream') ? 'vtf' : 'img' };
  const p = normPath(ref).replace(/^materials\//, '');
  const tries = [];
  if (/\.(vtf|png|jpg|jpeg)$/.test(p)) tries.push(`materials/${p}`);
  else tries.push(`materials/${p}.vtf`, `materials/${p}.png`);
  for (const t of tries) { const b = await vfs.read(t); if (b) return { bytes: b, ext: t.endsWith('.vtf') ? 'vtf' : 'img' }; }
  // maybe it is a material: use its $basetexture
  const vmt = await loadVmt(`materials/${p.replace(/\.vmt$/, '')}.vmt`);
  const bt = vmt && (vmt.params.$basetexture || vmt.params['$basetexture']);
  if (bt && normPath(bt) !== p) return textureBytes(bt);
  return null;
}

/**
 * Returns a texture immediately (a 1x1 white placeholder) and fills it once decoded.
 * ref: URL to a .vtf/image, or a game path ("models/foo/bar", "materials/x.vtf", a .vmt material).
 */
export function getSourceTexture(ref, { linear = false } = {}) {
  const key = `${linear ? 'L|' : ''}${ref}`;
  if (texCache.has(key)) return texCache.get(key);
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  tex.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  tex.userData.pending = true;
  texCache.set(key, tex);
  (async () => {
    const got = await textureBytes(ref);
    if (!got) throw new Error('not found');
    if (got.ext === 'vtf') {
      const img = decodeVTF(got.bytes);
      fillTexture(tex, { data: img.rgba, width: img.width, height: img.height }, linear);
      tex.userData.frames = img.frames;
    } else {
      const bmp = await createImageBitmap(new Blob([got.bytes]));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const x = c.getContext('2d');
      x.drawImage(bmp, 0, 0);
      fillTexture(tex, { data: new Uint8Array(x.getImageData(0, 0, bmp.width, bmp.height).data.buffer), width: bmp.width, height: bmp.height }, linear);
    }
  })().catch((e) => {
    tex.userData.failed = String(e.message || e);
    if (!vfs.mounted && !isUrl(ref)) texCache.delete(key); // retry after mounting
    fillTexture(tex, glowPixels(), linear);
  }).finally(() => { tex.userData.pending = false; if (tex.userData.onLoad) for (const fn of tex.userData.onLoad) fn(); });
  return tex;
}
/** Forget failed lookups (call after mounting new folders). */
export function clearFailedAssets() {
  for (const [k, t] of texCache) if (t.userData.failed) texCache.delete(k);
  for (const [k, p] of vmtCache) p.then((v) => { if (!v) vmtCache.delete(k); });
  for (const [k, p] of modelCache) p.catch(() => modelCache.delete(k));
}

/** Material settings for one model slot, from a .vmt. */
export async function materialDesc(vmtPath) {
  const vmt = await loadVmt(vmtPath);
  const name = vmtPath.split('/').pop().replace(/\.vmt$/, '');
  if (!vmt) return { name, missing: true };
  const p = vmt.params;
  const flag = (k) => p[k] != null && Number(p[k]) !== 0;
  const tint = parseVmtVector(p.$color2) || parseVmtVector(p.$color);
  return {
    name,
    shader: vmt.shader,
    map: p.$basetexture ? getSourceTexture(p.$basetexture) : null,
    normalMap: p.$bumpmap && !flag('$ssbump') ? getSourceTexture(p.$bumpmap, { linear: true }) : null,
    alphaTest: flag('$alphatest') ? Number(p.$alphatestreference || 0.5) || 0.5 : 0,
    translucent: flag('$translucent') || flag('$vertexalpha'),
    additive: flag('$additive'),
    doubleSide: flag('$nocull'),
    selfIllum: flag('$selfillum'),
    unlit: vmt.shader === 'unlitgeneric',
    phong: flag('$phong'),
    envmap: !!p.$envmap,
    color: tint ? tint.map((x) => Math.min(1, x)) : null,
    alpha: p.$alpha != null ? Number(p.$alpha) : 1,
  };
}

// ---------- models ----------
const modelCache = new Map();
/** Loads and converts an .mdl. Resolves to { mdl, geoms: [{geometry, material, bodyPart, model}], descs: Promise<desc>[] }. */
export function loadSourceModel(path) {
  const key = normPath(path);
  if (modelCache.has(key)) return modelCache.get(key);
  const p = (async () => {
    if (!vfs.mounted) throw new Error('Mount your Garry\'s Mod folder (File → Game content) to load .mdl models');
    const base = key.replace(/\.mdl$/, '');
    const mdl = await vfs.read(`${base}.mdl`);
    if (!mdl) throw new Error(`Model not found in mounted content: ${key}`);
    const vvd = await vfs.read(`${base}.vvd`);
    const vtx = (await vfs.read(`${base}.dx90.vtx`)) || (await vfs.read(`${base}.dx80.vtx`)) || (await vfs.read(`${base}.sw.vtx`));
    if (!vvd || !vtx) throw new Error(`Model is missing its .vvd/.vtx files: ${key}`);
    const parsed = parseSourceModel({ mdl, vvd, vtx });
    const geoms = parsed.meshes.map((m) => {
      const g = new THREE.BufferGeometry();
      const n = m.pos.length / 3;
      const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = m.pos[i * 3 + 1]; pos[i * 3 + 1] = m.pos[i * 3 + 2]; pos[i * 3 + 2] = m.pos[i * 3];
        nrm[i * 3] = m.nrm[i * 3 + 1]; nrm[i * 3 + 1] = m.nrm[i * 3 + 2]; nrm[i * 3 + 2] = m.nrm[i * 3];
      }
      const idx = new Uint32Array(m.index.length);
      for (let i = 0; i < idx.length; i += 3) { idx[i] = m.index[i]; idx[i + 1] = m.index[i + 2]; idx[i + 2] = m.index[i + 1]; }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(m.bones), 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(m.weights, 4));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      return { geometry: g, material: m.material, bodyPart: m.bodyPart, model: m.model };
    });
    const descs = parsed.mdl.textures.map(async (_, i) => {
      const cands = materialPaths(parsed.mdl, i);
      for (const c of cands) if (await loadVmt(c)) return materialDesc(c);
      return { name: parsed.mdl.textures[i].split(/[\\/]/).pop().toLowerCase(), missing: true };
    });
    return { mdl: parsed.mdl, geoms, descs: await Promise.all(descs) };
  })();
  modelCache.set(key, p);
  p.catch(() => modelCache.delete(key));
  return p;
}

/** Material slot index for a mesh with the given skin family. */
export function skinMaterial(mdl, meshMaterial, skin) {
  const fam = mdl.skins[Math.max(0, Math.min(mdl.skins.length - 1, skin | 0))];
  return fam && fam[meshMaterial] != null ? fam[meshMaterial] : meshMaterial;
}

/** PAC3 ModelModifiers ("skin=1;helmet=2;") -> { skin (or null), groups: Map(bodygroup name -> submodel index) }. */
export function parseModelModifiers(str) {
  const out = { skin: null, groups: new Map() };
  for (const kv of String(str || '').split(';')) {
    const i = kv.indexOf('=');
    if (i < 1) continue;
    const n = parseInt(kv.slice(i + 1), 10);
    if (!Number.isFinite(n)) continue;
    const key = kv.slice(0, i).trim().toLowerCase();
    if (key === 'skin') out.skin = n; else out.groups.set(key, n);
  }
  return out;
}
export function modelModifiersString(mods) {
  return [...(mods.skin != null ? [`skin=${mods.skin}`] : []), ...[...mods.groups].map(([k, v]) => `${k}=${v}`)].map((s) => `${s};`).join('');
}
/** Which submodel of a body part (bodygroup) to show. */
export function bodygroupModel(mdl, bodyPart, mods) {
  const bp = mdl.bodyParts && mdl.bodyParts[bodyPart];
  if (!bp) return 0;
  const v = mods.groups.get(bp.name.toLowerCase()) ?? 0;
  return Math.max(0, Math.min(bp.models.length - 1, v));
}
/** Bodygroups of a model for the editor: [{ name, models: [submodel names] }]. */
export function bodygroupList(mdl) {
  return (mdl.bodyParts || []).filter((b) => b.models.length > 1).map((b) => ({ name: b.name, models: b.models.map((m, i) => m.name || `#${i}`) }));
}

// ---------- animations ----------
const animCache = new Map();
/** Loads an animation model (e.g. models/m_anm.mdl + its .ani blocks) from mounted content. */
export function loadAnimSet(path) {
  const key = normPath(path);
  if (animCache.has(key)) return animCache.get(key);
  const p = (async () => {
    const mdl = await vfs.read(key);
    if (!mdl) throw new Error(`Animations not found: ${key}`);
    const ani = await vfs.read(key.replace(/\.mdl$/, '.ani'));
    return { path: key, ...parseAnimModel(mdl, ani) };
  })();
  animCache.set(key, p);
  p.catch(() => animCache.delete(key));
  return p;
}

// ---------- sounds ----------
/** Bytes for a game sound path like "ambient/alarms/klaxon1.wav" (with or without "sound/"). */
export async function readGameSound(path) {
  const p = normPath(path).replace(/^[\^)*#@<>!?$&~`+]+/, '');
  return (await vfs.read(p.startsWith('sound/') ? p : `sound/${p}`)) || (await vfs.read(p));
}

/** PAC3 / Garry's Mod friendly bone name for a model bone or attachment name. */
const BONE_REPLACEMENTS = [
  [/Anim_Attachment/g, 'attach'], [/RH/g, 'right hand'], [/LH/g, 'left hand'], [/_L_/g, ' left '], [/_R_/g, ' right '],
  [/[!-/:-@[-`{-~]/g, ' '], [/ValveBiped/g, ''], [/Bip01/g, ''], [/Neck1/g, 'neck'], [/Head1/g, 'head'], [/Toe0/g, 'toe'],
  [/lowerarm/g, 'lower arm'], [/Bip/g, ''], [/ R/g, ' right'], [/ L/g, ' left'],
];
export function friendlyBoneName(name) {
  let f = name;
  for (const [re, rep] of BONE_REPLACEMENTS) f = f.replace(re, rep);
  return f.trim().toLowerCase().replace(/(.*?)(\d+)/g, '$1 $2').replace(/\s+/g, ' ').trim();
}
