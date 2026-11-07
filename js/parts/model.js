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
import { isUrl, setColor } from '../core/util.js';

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
export function loadModelAsset(url) {
  if (assetCache.has(url)) return assetCache.get(url);
  const p = isObj(url)
    ? objLoader.loadAsync(url).then((scene) => ({ scene, animations: [], unitScale: 1 }))
    : gltfLoader.loadAsync(url).then((g) => ({ scene: g.scene, animations: g.animations || [], unitScale: 39.37 })); // glTF is in meters
  p.catch(() => assetCache.delete(url));
  assetCache.set(url, p);
  return p;
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
    prop('Model', 'asset', 'cube', { options: PRIMITIVE_NAMES, accept: '.glb,.gltf,.obj', help: 'Primitive name, or a URL to a .glb/.gltf/.obj file.' }),
    prop('Size', 'number', 1, { group: 'orientation', step: 0.05 }),
    prop('Scale', 'vector', [1, 1, 1], { group: 'orientation', step: 0.05 }),
    prop('Color', 'color', [1, 1, 1], { group: 'appearance' }),
    prop('Brightness', 'number', 1, { group: 'appearance', min: 0, step: 0.05 }),
    prop('Alpha', 'number', 1, { group: 'appearance', min: 0, max: 1, step: 0.02 }),
    prop('Material', 'asset', '', { group: 'appearance', options: ['', ...SPECIAL, ...SURFACE_TEXTURES], accept: 'image/*', help: 'Texture name or image URL, or a special look: wireframe, chrome, glass, glow, toon, normals.' }),
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
  getAnchorFor(child) { return (child.Bone && this.modelBones[child.Bone.toLowerCase()]) || this.childAnchor; }

  _applyScale() { const s = this.Size; this.content.scale.set(s * this.Scale[0], s * this.Scale[1], s * this.Scale[2]); }

  _clear() {
    for (const s of this.slots) { const m = s.get(); if (m && m.dispose) m.dispose(); if (s.texClone) s.texClone.dispose(); }
    this.slots = [];
    this.modelBones = {};
    this.mixer = null;
    this.content.clear();
  }

  _addMesh(mesh) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((om, i) => {
      const orig = { map: (om && om.map) || null, color: om && om.color ? om.color.clone() : new THREE.Color(1, 1, 1), flat: !!mesh.userData.flat };
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
    if (!isUrl(name)) { this.status = name ? `Unknown model "${name.slice(0, 60)}"` : ''; return; }
    this.status = 'Loading model…';
    loadModelAsset(name).then((asset) => {
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
    if (name === 'Model') this._load();
    else if (name === 'Size' || name === 'Scale') this._applyScale();
    else this._dirty = true;
  }

  _apply() {
    this._dirty = false;
    const mp = this.children.find((c) => c.className === 'material' && !c.hiddenNow);
    const clips = this.children.filter((c) => c.className === 'clip' && !c.hiddenNow).map((c) => c.plane);
    const kw = this.Material.trim().toLowerCase();
    const special = SPECIAL.includes(kw) ? kw : '';
    const texName = mp && mp.BaseTexture ? mp.BaseTexture : special ? '' : this.Material;
    const overrideTex = getTexture(texName);
    let shading = this.NoLighting || special === 'glow' ? 'unlit' : special === 'toon' ? 'toon' : special === 'normals' ? 'normals' : 'standard';
    if (mp && mp.Shading !== 'default') shading = mp.Shading;
    const Cls = MAT_CLASSES[shading];
    let alpha = this.Alpha * (mp ? mp.Alpha : 1);
    if (special === 'glass') alpha *= 0.35;
    const transparent = alpha < 1 || this.Translucent || this.BlendMode !== 'normal';
    const rep = this.TextureScale * (mp ? mp.TextureScale : 1);
    const scroll = mp ? mp.scroll : null;

    for (const slot of this.slots) {
      let m = slot.get();
      if (!m || m.constructor !== Cls) { if (m && m.dispose) m.dispose(); m = new Cls(); slot.set(m); slot.sig = ''; }
      let tex = overrideTex || slot.orig.map;
      if (tex && (rep !== 1 || (scroll && (scroll[0] || scroll[1])))) {
        if (!tex.image) this._dirty = true; // not loaded yet: retry next frame
        else {
          if (slot.texSrc !== tex) { if (slot.texClone) slot.texClone.dispose(); slot.texClone = tex.clone(); slot.texSrc = tex; }
          slot.texClone.repeat.set(rep, rep);
          slot.texClone.offset.set(scroll ? scroll[0] : 0, scroll ? scroll[1] : 0);
          tex = slot.texClone;
        }
      }
      if ('map' in m) m.map = tex || null;
      if (m.color) {
        setColor(m.color, this.Color, this.Brightness);
        if (!overrideTex) m.color.multiply(slot.orig.color);
        if (mp) m.color.multiply(setColor(_c, mp.Color));
      }
      if (m.isMeshStandardMaterial) {
        m.roughness = mp ? mp.Roughness : special === 'chrome' ? 0.08 : special === 'glass' ? 0.04 : this.Roughness;
        m.metalness = mp ? mp.Metalness : special === 'chrome' ? 1 : this.Metalness;
        if (mp) setColor(m.emissive, mp.Emissive, mp.EmissiveIntensity); else m.emissive.setRGB(0, 0, 0);
      }
      if ('flatShading' in m) m.flatShading = !!(mp && mp.FlatShading);
      m.wireframe = special === 'wireframe' || !!(mp && mp.Wireframe);
      m.opacity = alpha;
      m.transparent = transparent;
      applyBlend(m, this.BlendMode);
      m.depthTest = !this.IgnoreZ;
      m.depthWrite = !transparent;
      m.side = this.Invert ? THREE.BackSide : this.NoCulling || slot.orig.flat ? THREE.DoubleSide : THREE.FrontSide;
      m.clippingPlanes = clips.length ? clips : null;
      m.clipShadows = true;
      const sig = `${!!m.map}|${m.flatShading}|${clips.length}|${m.premultipliedAlpha}|${m.side}|${m.transparent}`;
      if (sig !== slot.sig) { slot.sig = sig; m.needsUpdate = true; }
      slot.mesh.renderOrder = this.IgnoreZ ? 1000 : transparent ? 1 : 0;
      slot.mesh.castShadow = alpha >= 0.5 && shading !== 'unlit';
    }
  }

  update(dt) {
    super.update(dt);
    if (this._dirty) this._apply();
    if (this.mixer && this.PlayAnimation && !this.hiddenNow) this.mixer.update(dt);
  }

  destroy() { this._loadToken++; this._clear(); super.destroy(); }
}
registerPart(ModelPart);
