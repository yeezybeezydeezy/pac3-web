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
import { readZip } from './zip.js';
import { fixUrl } from '../core/util.js';

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
/** A model link that PAC3 treats as a zipped .mdl ("URL model"): any http(s) link that is not .obj/.glb/.gltf. */
export const isModelPackUrl = (s) => typeof s === 'string' && /^https?:/i.test(s.trim()) && !/\.(obj|glb|gltf)([?#]|$)/i.test(s.trim());
/** A Source model from mounted content or from a zip link. */
export const isSourceModelRef = (s) => isSourceModelPath(s) || isModelPackUrl(s);

const MAX_DOWNLOAD = 200 * 1024 * 1024;
async function fetchBytes(url) {
  const r = await fetch(fixUrl(url));
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (Number(r.headers.get('content-length')) > MAX_DOWNLOAD) throw new Error('Download is larger than 200 MB');
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD) throw new Error('Download is larger than 200 MB');
  return bytes;
}

// ---------- model packs: .zip links holding an .mdl and its files (PAC3 "URL models") ----------
// Each pack gets its own folder, models/pac_url/<id>/ and materials/pac_url/<id>/, and files are found
// by name wherever they sit in the zip (like PAC3). Its materials point at the pack's own textures.
const packs = new Map(); // id -> Map(file name -> zip entry)
const packLoads = new Map(); // url -> Promise<model path>
const PACK_PATH = /^(?:models|materials)\/pac_url\/([a-z0-9]+)\/(?:.*\/)?([^/]+)$/;
const fileName = (p) => String(p).replace(/\\/g, '/').split('/').pop().toLowerCase();
function hashId(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
/** Reads a game path from a model pack or the mounted folders. */
async function readAsset(path) {
  const m = PACK_PATH.exec(path);
  if (!m) return vfs.read(path);
  const e = packs.get(m[1]) && packs.get(m[1]).get(m[2]);
  return e ? e.read() : null;
}
/** Downloads a zip model link (once) and returns the path of its .mdl, e.g. models/pac_url/1x2y3z/hat.mdl. */
export function loadModelPack(url) {
  url = fixUrl(url);
  if (packLoads.has(url)) return packLoads.get(url);
  const p = (async () => {
    const files = new Map();
    for (const e of readZip(await fetchBytes(url))) if (!files.has(fileName(e.name))) files.set(fileName(e.name), e);
    const mdl = [...files.keys()].find((n) => n.endsWith('.mdl'));
    if (!mdl) throw new Error('The zip archive has no .mdl model in it');
    const id = hashId(url);
    packs.set(id, files);
    return `models/pac_url/${id}/${mdl}`;
  })();
  packLoads.set(url, p);
  p.catch(() => packLoads.delete(url));
  return p;
}
/** Game model path for a model reference: zip links are downloaded first. */
export const resolveModelRef = async (ref) => (isModelPackUrl(ref) ? loadModelPack(ref) : ref);
/** Texture parameters of a pack material that name one of the pack's .vtf files point at that file. */
function packMaterial(id, params) {
  const files = packs.get(id);
  for (const [k, v] of Object.entries(params)) {
    if (typeof v !== 'string' || !k.startsWith('$')) continue;
    const n = fileName(v).replace(/\.vtf$/, '');
    if (files.has(`${n}.vtf`)) params[k] = `pac_url/${id}/${n}`;
  }
  return params;
}

// ---------- materials (.vmt) ----------
const vmtCache = new Map();
export function loadVmt(path, depth = 0) {
  const key = isUrl(path) ? path : normPath(path);
  if (vmtCache.has(key)) return vmtCache.get(key);
  const p = (async () => {
    const pack = PACK_PATH.exec(key);
    const bytes = isUrl(key) ? await fetchBytes(key) : await readAsset(key);
    if (!bytes) {
      // a pack with a texture but no material for it: use the texture as is (PAC3 does the same)
      const n = pack && fileName(key).replace(/\.vmt$/, '');
      if (n && packs.get(pack[1]).has(`${n}.vtf`)) return { shader: 'vertexlitgeneric', params: { $basetexture: `pac_url/${pack[1]}/${n}` } };
      return null;
    }
    const kv = parseKeyValues(textDecoder.decode(bytes));
    if (pack && kv.value && typeof kv.value === 'object') packMaterial(pack[1], kv.value);
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
  for (const t of tries) { const b = await readAsset(t); if (b) return { bytes: b, ext: t.endsWith('.vtf') ? 'vtf' : 'img' }; }
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
      if (img.frames > 1) tex.userData.frameSource = { bytes: got.bytes, linear };
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
/**
 * One frame of an animated .vtf (frame = $frame / $detailframe value; wraps like PAC3: |frame| mod frames).
 * Frames are decoded once, on first use.
 */
export function textureFrame(tex, frame) {
  const n = tex && tex.userData.frames;
  if (!n || n < 2 || !tex.userData.frameSource) return tex;
  const i = Math.floor(Math.abs(Number(frame) || 0)) % n;
  if (i === 0) return tex;
  const list = (tex.userData.frameTex ||= []);
  if (!list[i]) {
    const { bytes, linear } = tex.userData.frameSource;
    const img = decodeVTF(bytes, { frame: i });
    list[i] = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    fillTexture(list[i], { data: img.rgba, width: img.width, height: img.height }, linear);
  }
  return list[i];
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
    params: p, // every $parameter, for Source shading (shading.js)
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
    const pack = PACK_PATH.exec(key);
    if (!vfs.mounted && !pack) throw new Error('Mount your Garry\'s Mod folder (File → Game content) to load .mdl models');
    const base = key.replace(/\.mdl$/, '');
    const mdl = await readAsset(`${base}.mdl`);
    if (!mdl) throw new Error(pack ? `${fileName(key)} is missing from the downloaded zip` : `Model not found in mounted content: ${key}`);
    const vvd = await readAsset(`${base}.vvd`);
    const vtx = (await readAsset(`${base}.dx90.vtx`)) || (await readAsset(`${base}.dx80.vtx`)) || (await readAsset(`${base}.sw.vtx`));
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
      // a pack's own materials first, then the game's (a pack model may use stock materials)
      const cands = [...(pack ? [`materials/pac_url/${pack[1]}/${fileName(parsed.mdl.textures[i])}.vmt`] : []), ...materialPaths(parsed.mdl, i)];
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
    const mdl = await readAsset(key);
    if (!mdl) throw new Error(`Animations not found: ${key}`);
    const ani = await readAsset(key.replace(/\.mdl$/, '.ani'));
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
