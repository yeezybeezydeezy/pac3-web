// Model part: built-in primitives or a glTF/GLB/OBJ URL. Material/clip/halo children modify it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { MovablePart, applyBlend, BLEND_MODES } from './movable.js';
import { prop, registerPart } from '../core/part.js';
import { getTexture, SURFACE_TEXTURES } from '../core/textures.js';
import { isUrl, setColor, fixUrl } from '../core/util.js';
import { sourceParams, applySourceShading, clearSourceShading } from '../source/shading.js';
import { textureFrame } from '../source/assets.js';
import { loadSourceModel, isSourceModelRef, isModelPackUrl, resolveModelRef, skinMaterial, parseModelModifiers, bodygroupModel, bodygroupList } from '../source/assets.js';

const TAU = Math.PI * 2;

function extrude(shape, depth = 2) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.4, bevelSize: 0.35, bevelSegments: 3, curveSegments: 20 });
  g.center();
  g.computeVertexNormals();
  return g;
}
function poly(points) { const s = new THREE.Shape(); points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath(); return s; }

const PRIMITIVES = {
  cube: () => new THREE.BoxGeometry(8, 8, 8),
  sphere: () => new THREE.SphereGeometry(4, 32, 20),
  hemisphere: () => new THREE.SphereGeometry(4, 32, 12, 0, TAU, 0, Math.PI / 2),
  cylinder: () => new THREE.CylinderGeometry(4, 4, 8, 32),
  cone: () => new THREE.ConeGeometry(4, 8, 32),
  pyramid: () => new THREE.ConeGeometry(4, 8, 4).rotateY(Math.PI / 4),
  capsule: () => new THREE.CapsuleGeometry(2.5, 5, 8, 20),
  torus: () => new THREE.TorusGeometry(4, 1.2, 16, 48),
  torusknot: () => new THREE.TorusKnotGeometry(3, 0.9, 128, 16),
  ring: () => new THREE.RingGeometry(3, 4, 48),
  disc: () => new THREE.CircleGeometry(4, 48),
  plane: () => new THREE.PlaneGeometry(8, 8),
  tetrahedron: () => new THREE.TetrahedronGeometry(4),
  octahedron: () => new THREE.OctahedronGeometry(4),
  dodecahedron: () => new THREE.DodecahedronGeometry(4),
  icosahedron: () => new THREE.IcosahedronGeometry(4),
  diamond: () => new THREE.OctahedronGeometry(4).scale(0.8, 1.4, 0.8),
  crystal: () => new THREE.LatheGeometry([[0, -6], [2.4, -3], [2.4, 3], [0, 6]].map(([x, y]) => new THREE.Vector2(x, y)), 6),
  wedge: () => extrude(poly([[-4, -4], [4, -4], [-4, 4]]), 8),
  star: () => extrude(poly(Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? 1.8 : 4.4, a = (i / 10) * TAU + Math.PI / 2; return [Math.cos(a) * r, Math.sin(a) * r]; })), 1.6),
  arrow: () => extrude(poly([[-4, -1.2], [1, -1.2], [1, -3], [4.5, 0], [1, 3], [1, 1.2], [-4, 1.2]]), 1.6),
  heart: () => {
    const s = new THREE.Shape();
    s.moveTo(0, -4); s.bezierCurveTo(-5, -0.5, -4.5, 4, -2, 4); s.bezierCurveTo(-0.8, 4, -0.2, 3, 0, 2.3);
    s.bezierCurveTo(0.2, 3, 0.8, 4, 2, 4); s.bezierCurveTo(4.5, 4, 5, -0.5, 0, -4);
    return extrude(s, 1.8);
  },
  gear: () => {
    const pts = [];
    for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU, r = Math.floor(i / 2) % 2 ? 3.2 : 4.2; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    const s = poly(pts);
    const hole = new THREE.Path(); hole.absarc(0, 0, 1.2, 0, TAU, true); s.holes.push(hole);
    return extrude(s, 1.5);
  },
};
export const PRIMITIVE_NAMES = Object.keys(PRIMITIVES);
const FLAT = new Set(['ring', 'disc', 'plane', 'hemisphere']);
const SPECIAL = ['wireframe', 'chrome', 'glass', 'glow', 'toon', 'normals'];
const geoCache = new Map();
function getGeometry(name) {
  if (!geoCache.has(name)) geoCache.set(name, PRIMITIVES[name]());
  return geoCache.get(name);
}

// ---- external model loading (cached per URL) ----
const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
const gltfLoader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder).setCrossOrigin('anonymous');
const objLoader = new OBJLoader();
const assetCache = new Map();
const isObj = (url) => /\.obj(\?|#|$)/i.test(url) || /^data:model\/obj/i.test(url);
export function loadModelAsset(url, forceObj = false) {
  url = fixUrl(url);
  const key = `${forceObj ? 'obj|' : ''}${url}`;
  if (assetCache.has(key)) return assetCache.get(key);
  const p = forceObj || isObj(url)
    ? objLoader.loadAsync(url).then((scene) => ({ scene, animations: [], unitScale: 1 }))
    : gltfLoader.loadAsync(url).then((g) => ({ scene: g.scene, animations: g.animations || [], unitScale: 39.37 })); // glTF is in meters
  p.catch(() => assetCache.delete(key));
  assetCache.set(key, p);
  return p;
}

/**
 * PAC3 "Materials" list: one entry per material slot, separated by ";". Each entry is the Name of a
 * material part in the same outfit, a texture path/URL, or empty / no_material / null.
 * Returns [{part} | {texture} | null] by slot index.
 */
export function resolveMaterialList(part, list) {
  if (!list || !list.trim()) return [];
  let named = null;
  return list.split(';').map((raw) => {
    const e = raw.trim();
    if (!e || e === 'no_material' || e === 'null') return null;
    if (!named) {
      named = new Map();
      part.getRoot().traverse((p) => { if (p.className === 'material' && p.Name && !p.hiddenNow) named.set(p.Name.toLowerCase(), p); });
    }
    const mp = named.get(e.toLowerCase());
    return mp ? { part: mp } : { texture: e };
  });
}

const MAT_CLASSES = { standard: THREE.MeshStandardMaterial, unlit: THREE.MeshBasicMaterial, toon: THREE.MeshToonMaterial, normals: THREE.MeshNormalMaterial };
export const SHADINGS = Object.keys(MAT_CLASSES);
const _c = new THREE.Color();

export class ModelPart extends MovablePart {
  static className = 'model';
  static icon = '🧊';
  static category = 'model';
  static description = 'Displays a 3D model: a built-in primitive or a glTF/GLB/OBJ file from a URL or upload.';
  static props = [
    prop('Model', 'asset', 'cube', { options: PRIMITIVE_NAMES, accept: '.glb,.gltf,.obj', browse: 'model', help: 'Primitive name, a URL to a .glb/.gltf/.obj file, or a game model path like models/player/items/humans/top_hat.mdl (needs mounted game content).' }),
    prop('Size', 'number', 1, { group: 'orientation', step: 0.05 }),
    prop('Scale', 'vector', [1, 1, 1], { group: 'orientation', step: 0.05 }),
    prop('Color', 'color', [1, 1, 1], { group: 'appearance' }),
    prop('Brightness', 'number', 1, { group: 'appearance', min: 0, step: 0.05 }),
    prop('Alpha', 'number', 1, { group: 'appearance', min: 0, max: 1, step: 0.02 }),
    prop('Material', 'asset', '', { group: 'appearance', options: ['', ...SPECIAL, ...SURFACE_TEXTURES], accept: 'image/*,.vtf', browse: 'material', help: 'Texture name or image URL, or a special look: wireframe, chrome, glass, glow, toon, normals.' }),
    prop('Skin', 'number', 0, { group: 'appearance', min: 0, integer: true, help: 'Material set of a Source (.mdl) model.' }),
    prop('ModelModifiers', 'bodygroups', '', { group: 'appearance', help: 'Bodygroups (and skin) of a Source model, PAC3 style: "head=1;skin=2;".' }),
    prop('Materials', 'string', '', { group: 'appearance', help: 'Per material slot, separated by ";": the Name of a material part in this outfit, a texture path/URL, or no_material (PAC3 style).' }),
    prop('TextureScale', 'number', 1, { group: 'appearance', step: 0.1 }),
    prop('Roughness', 'number', 0.55, { group: 'appearance', min: 0, max: 1, step: 0.02 }),
    prop('Metalness', 'number', 0, { group: 'appearance', min: 0, max: 1, step: 0.02 }),
    prop('NoLighting', 'boolean', false, { group: 'appearance', help: 'Fullbright: ignore scene lighting.' }),
    prop('NoCulling', 'boolean', false, { group: 'appearance', help: 'Draw both sides of faces.' }),
    prop('Invert', 'boolean', false, { group: 'appearance', help: 'Draw only the inside faces.' }),
    prop('Translucent', 'boolean', false, { group: 'appearance' }),
    prop('BlendMode', 'enum', 'normal', { group: 'appearance', options: BLEND_MODES }),
    prop('IgnoreZ', 'boolean', false, { group: 'appearance', help: 'Draw on top of everything.' }),
    prop('PlayAnimation', 'boolean', true, { group: 'other', help: 'Loop the first animation of a glTF model.' }),
  ];

  constructor(world) {
    super(world);
    this.content = new THREE.Group();
    this.offset.add(this.content);
    this.slots = [];
    this.modelBones = {};
    this.meshVersion = 0;
    this._loadToken = 0;
    this._dirty = true;
    this._applyScale();
    this._load();
  }

  getChildBoneNames() { return Object.keys(this.modelBones); }
  /** Bodygroups of the loaded Source model, for the editor. */
  getBodygroups() { return this.sourceModel && isSourceModelRef(this.Model) ? bodygroupList(this.sourceModel) : []; }
  getAnchorFor(child) { return (child.Bone && this.modelBones[child.Bone.toLowerCase()]) || this.childAnchor; }

  _applyScale() { const s = this.Size; this.content.scale.set(s * this.Scale[0], s * this.Scale[1], s * this.Scale[2]); }

  _clear() {
    for (const s of this.slots) { const m = s.get(); if (m && m.dispose) m.dispose(); if (s.texClone) s.texClone.dispose(); }
    this.slots = [];
    this.modelBones = {};
    this.mixer = null;
    this.content.clear();
  }

  /** extra: Source material description (name, normalMap, alphaTest, translucent, additive, doubleSide, unlit, selfIllum, color). */
  _addMesh(mesh, extra = null) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((om, i) => {
      const orig = {
        map: (om && om.map) || null, normalMap: (om && om.normalMap) || null,
        color: om && om.color ? om.color.clone() : new THREE.Color(1, 1, 1), flat: !!mesh.userData.flat,
        name: ((om && om.name) || '').toLowerCase(),
        index: extra && extra.index != null ? extra.index : this.slots.length,
      };
      if (extra) {
        Object.assign(orig, { map: extra.map || null, normalMap: extra.normalMap || null, name: extra.name || '', alphaTest: extra.alphaTest || 0, translucent: !!extra.translucent, additive: !!extra.additive, doubleSide: !!extra.doubleSide, unlit: !!extra.unlit, selfIllum: !!extra.selfIllum, source: true });
        // the .vmt's own Source shading (detail layer, self-illumination, phong…)
        if (extra.params) orig.src = sourceParams((k) => extra.params[`$${k}`], { shader: extra.shader, vmt: true });
        orig.color = extra.color ? new THREE.Color().setRGB(extra.color[0], extra.color[1], extra.color[2], THREE.SRGBColorSpace) : new THREE.Color(1, 1, 1);
      }
      const slot = Array.isArray(mesh.material)
        ? { mesh, orig, get: () => mesh.material[i], set: (m) => { mesh.material[i] = m; } }
        : { mesh, orig, get: () => mesh.material, set: (m) => { mesh.material = m; } };
      slot.set(new THREE.MeshStandardMaterial());
      this.slots.push(slot);
    });
    mesh.userData.part = this;
    mesh.castShadow = mesh.receiveShadow = true;
  }

  _load() {
    const token = ++this._loadToken;
    this._clear();
    const name = this.Model.trim();
    const key = name.toLowerCase();
    this.meshVersion++;
    this._dirty = true;
    if (Object.hasOwn(PRIMITIVES, key)) {
      const mesh = new THREE.Mesh(getGeometry(key), null);
      mesh.userData.flat = FLAT.has(key);
      this._addMesh(mesh);
      this.content.add(mesh);
      this.status = '';
      return;
    }
    if (isSourceModelRef(name)) {
      this.status = isModelPackUrl(name) ? 'Downloading model…' : 'Loading model…';
      resolveModelRef(name).then(loadSourceModel).then((asset) => {
        if (token !== this._loadToken) return;
        this.sourceModel = asset.mdl;
        const mods = parseModelModifiers(this.ModelModifiers);
        const skin = mods.skin ?? this.Skin;
        for (const g of asset.geoms) {
          if (g.model !== bodygroupModel(asset.mdl, g.bodyPart, mods)) continue;
          const mesh = new THREE.Mesh(g.geometry, null);
          const index = skinMaterial(asset.mdl, g.material, skin);
          this._addMesh(mesh, { ...(asset.descs[index] || { name: '' }), index });
          this.content.add(mesh);
        }
        this.status = '';
        this.meshVersion++;
        this._dirty = true;
      }).catch((err) => { if (token === this._loadToken) this.status = String(err.message || err).slice(0, 200); });
      return;
    }
    // PAC3 marks OBJ links without a .obj extension as objhttp://… or obj:http…
    const objUrl = /^obj:?(?=https?:)/i.test(name) ? name.replace(/^obj:?/i, '') : null;
    if (!isUrl(name) && !objUrl) { this.status = name ? `Unknown model "${name.slice(0, 60)}"` : ''; return; }
    this.status = 'Loading model…';
    loadModelAsset(objUrl || name, !!objUrl).then((asset) => {
      if (token !== this._loadToken) return;
      const obj = SkeletonUtils.clone(asset.scene);
      obj.scale.setScalar(asset.unitScale);
      obj.traverse((o) => {
        if (o.isMesh) this._addMesh(o);
        if (o.isBone && o.name) this.modelBones[o.name.toLowerCase()] = o;
      });
      if (asset.animations.length) {
        this.mixer = new THREE.AnimationMixer(obj);
        this.mixer.clipAction(asset.animations[0]).play();
      }
      this.content.add(obj);
      this.status = '';
      this.meshVersion++;
      this._dirty = true;
      if (this.inWorld) for (const c of this.children) if (c.attach) c.attach();
    }).catch((err) => { if (token === this._loadToken) this.status = `Failed to load model: ${err.message || err}`.slice(0, 200); });
  }

  markDirty() { this._dirty = true; }

  onPropChanged(name, old) {
    super.onPropChanged(name, old);
    if (name === 'Model' || ((name === 'Skin' || name === 'ModelModifiers') && isSourceModelRef(this.Model))) this._load();
    else if (name === 'Size' || name === 'Scale') this._applyScale();
    else this._dirty = true;
  }

  _apply() {
    this._dirty = false;
    const mps = this.children.filter((c) => c.className === 'material' && !c.hiddenNow);
    const clips = this.children.filter((c) => c.className === 'clip' && !c.hiddenNow).map((c) => c.plane);
    const kw = this.Material.trim().toLowerCase();
    const special = SPECIAL.includes(kw) ? kw : '';
    const baseTex = special ? null : getTexture(this.Material);
    const slotList = resolveMaterialList(this, this.Materials);
    this._namedMats = slotList.some((e) => e && e.part);

    for (const slot of this.slots) {
      const o = slot.orig;
      const entry = slotList[o.index] || null;
      const mp = mps.find((p) => p.matches(o.name)) || (entry && entry.part) || null;
      // Source shading: a material part with a Shader, else the game material's own (.vmt) settings
      const P = mp ? mp.sourceParams() : special ? null : o.src || null;
      const srcBase = P && P.base ? textureFrame(P.base, P.baseFrame) : null;
      const overrideTex = srcBase || (mp && !P && mp.BaseTexture ? getTexture(mp.BaseTexture) : null) || (entry && entry.texture ? getTexture(entry.texture) : null) || baseTex;
      let shading = this.NoLighting || special === 'glow' || o.unlit || (P && P.unlit) ? 'unlit' : special === 'toon' ? 'toon' : special === 'normals' ? 'normals' : 'standard';
      if (mp && !P && mp.Shading !== 'default') shading = mp.Shading;
      const Cls = MAT_CLASSES[shading];
      let alpha = this.Alpha * (P ? P.alpha : mp ? mp.Alpha : 1);
      if (special === 'glass') alpha *= 0.35;
      const blend = this.BlendMode === 'normal' && (P ? P.additive : o.additive) ? 'additive' : this.BlendMode;
      const transparent = alpha < 1 || this.Translucent || blend !== 'normal' || !!(P ? P.translucent : o.translucent);
      const rep = this.TextureScale * (mp ? mp.TextureScale : 1);
      const scroll = mp ? mp.scroll : null;

      let m = slot.get();
      if (!m || m.constructor !== Cls) { if (m && m.dispose) m.dispose(); m = new Cls(); slot.set(m); slot.sig = ''; }
      let tex = overrideTex || o.map;
      if (tex && tex.userData.pending) this._dirty = true; // game texture still decoding: re-apply later
      if (tex && (rep !== 1 || (scroll && (scroll[0] || scroll[1])))) {
        if (!tex.image) this._dirty = true; // not loaded yet: retry next frame
        else {
          if (slot.texSrc !== tex || slot.texVer !== tex.version) { if (slot.texClone) slot.texClone.dispose(); slot.texClone = tex.clone(); slot.texSrc = tex; slot.texVer = tex.version; }
          slot.texClone.repeat.set(rep, rep);
          slot.texClone.offset.set(scroll ? scroll[0] : 0, scroll ? scroll[1] : 0);
          tex = slot.texClone;
        }
      }
      if ('map' in m) m.map = tex || null;
      const nrm = P && mp ? (P.bump ? textureFrame(P.bump, P.bumpFrame) : null) : P && P.bump ? textureFrame(P.bump, P.bumpFrame) : mp && mp.BumpMap ? getTexture(mp.BumpMap, { linear: true }) : o.normalMap;
      if ('normalMap' in m) {
        m.normalMap = shading === 'standard' ? nrm || null : null;
        if (m.normalMap && (o.source || (mp && mp.BumpMap))) m.normalScale.set(1, -1); // Source normal maps are DirectX style
      }
      if (m.color) {
        setColor(m.color, this.Color, this.Brightness);
        if (P) m.color.multiply(_c.setRGB(P.color[0], P.color[1], P.color[2], THREE.SRGBColorSpace));
        else {
          if (!overrideTex) m.color.multiply(o.color);
          if (mp) m.color.multiply(setColor(_c, mp.Color));
        }
      }
      if (m.isMeshStandardMaterial && !P) {
        m.roughness = mp ? mp.Roughness : special === 'chrome' ? 0.08 : special === 'glass' ? 0.04 : this.Roughness;
        m.metalness = mp ? mp.Metalness : special === 'chrome' ? 1 : this.Metalness;
        if (mp) setColor(m.emissive, mp.Emissive, mp.EmissiveIntensity); else if (o.selfIllum) m.emissive.setRGB(1, 1, 1); else m.emissive.setRGB(0, 0, 0);
        m.emissiveMap = o.selfIllum && !mp ? tex || null : null;
      }
      if ('flatShading' in m) m.flatShading = !!(mp && mp.FlatShading);
      m.wireframe = special === 'wireframe' || !!(mp && mp.Wireframe) || !!(P && P.wireframe);
      m.opacity = alpha;
      m.transparent = transparent;
      m.alphaTest = P ? (P.alphatest ? P.alphatestref : 0) : o.alphaTest || 0;
      applyBlend(m, blend);
      m.depthTest = !this.IgnoreZ && !(P && P.ignorez);
      m.depthWrite = !transparent || !!m.alphaTest;
      m.side = this.Invert ? THREE.BackSide : this.NoCulling || o.flat || (P ? P.nocull : o.doubleSide) ? THREE.DoubleSide : THREE.FrontSide;
      if (P && (m.isMeshStandardMaterial || m.isMeshBasicMaterial)) {
        const d = applySourceShading(m, P);
        if (d && d.userData.pending) this._dirty = true;
        if (P.detail || (P.base && P.base.userData.frames > 1) || (P.bump && P.bump.userData.frames > 1)) this._dirty = true; // animated frames
      } else clearSourceShading(m);
      m.clippingPlanes = clips.length ? clips : null;
      m.clipShadows = true;
      const sig = `${!!m.map}|${!!m.normalMap}|${!!m.emissiveMap}|${m.alphaTest > 0}|${m.flatShading}|${clips.length}|${m.premultipliedAlpha}|${m.side}|${m.transparent}|${!!P}`;
      if (sig !== slot.sig) { slot.sig = sig; m.needsUpdate = true; }
      slot.mesh.renderOrder = this.IgnoreZ ? 1000 : transparent ? 1 : 0;
      slot.mesh.castShadow = alpha >= 0.5 && shading !== 'unlit';
    }
  }

  update(dt) {
    super.update(dt);
    if (this._dirty || this._namedMats) this._apply(); // named material parts can change (proxies) at any time
    if (this.mixer && this.PlayAnimation && !this.hiddenNow) this.mixer.update(dt);
  }

  destroy() { this._loadToken++; this._clear(); super.destroy(); }
}
registerPart(ModelPart);
