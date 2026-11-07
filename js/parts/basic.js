// group, info, bone, entity, material, clip, halo
import * as THREE from 'three';
import { Part, prop, registerPart } from '../core/part.js';
import { MovablePart, inSourceSpace } from './movable.js';
import { SHADINGS, resolveMaterialList } from './model.js';
import { SURFACE_TEXTURES } from '../core/textures.js';
import { anglesToQuat, setColor } from '../core/util.js';
import { SHADER_PARAMS, SHADERS, sourceParams } from '../source/shading.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();

export class GroupPart extends Part {
  static className = 'group';
  static icon = '🌐';
  static category = 'generic';
  static description = 'Organizes parts. Outfits start with a group; hiding it hides everything inside.';
  static props = [
    prop('CoordinateSpace', 'enum', 'web', { group: 'other', options: ['web', 'source'], help: 'On a top-level group: "source" means bone-attached parts use Garry\'s Mod bone axes (set by the PAC3 importer).' }),
  ];
  onPropChanged(name) { if (name === 'CoordinateSpace' && this.inWorld) this.traverse((p) => p.attach && p.attach()); }
}
registerPart(GroupPart);

export class InfoPart extends Part {
  static className = 'info';
  static icon = 'ℹ️';
  static category = 'generic';
  static description = 'Holds notes for people reading your outfit. Does nothing on its own.';
  static props = [prop('Text', 'text', '')];
}
registerPart(InfoPart);

/** Modifies one avatar bone; children attach to that bone. */
export class BonePart extends Part {
  static className = 'bone';
  static icon = '🦴';
  static category = 'model';
  static movable = true;
  static priority = 0;
  static description = 'Moves, rotates, scales or hides a bone of the player model. Children attach to that bone.';
  static props = [
    prop('Bone', 'bone', 'head', { group: 'orientation' }),
    prop('Position', 'vector', [0, 0, 0], { group: 'orientation' }),
    prop('Angles', 'angle', [0, 0, 0], { group: 'orientation' }),
    prop('Size', 'number', 1, { group: 'orientation', step: 0.05 }),
    prop('Scale', 'vector', [1, 1, 1], { group: 'orientation', step: 0.05 }),
    prop('ScaleChildren', 'boolean', false, { group: 'orientation', help: 'Kept for PAC3 compatibility: bones below this one always scale with it here.' }),
    prop('HideMesh', 'boolean', false, { group: 'appearance', help: 'Hide this bone (and what hangs from it) by shrinking it, like PAC3.' }),
    prop('FollowPart', 'part', '', { group: 'other', help: 'Make the bone follow another part (e.g. a jiggle).' }),
  ];
  getAnchorFor() { return inSourceSpace(this) ? this.world.avatar.getBone(this.Bone) : this.world.avatar.getWebFrame(this.Bone); }
  getChildBoneNames() { return []; }
  getBoneOptions() { return this.world.avatar.getBoneNames(); }
  attach() { /* children attach through getAnchorFor */ }
  onPropChanged(name) { if (name === 'Bone' && this.inWorld) for (const c of this.children) c.traverse((p) => p.attach && p.attach()); }
  update() {
    if (this.hiddenNow) return;
    const av = this.world.avatar;
    const b = av.getBone(this.Bone);
    if (!b || b === av.root) { this.status = `No bone "${this.Bone}"`; return; }
    this.status = '';
    const follow = this.FollowPart ? this.world.getPart(this.FollowPart) : null;
    if (follow && follow.offset && b.parent) {
      b.parent.updateWorldMatrix(true, false);
      _m.copy(b.parent.matrixWorld).invert().multiply(follow.offset.matrixWorld);
      _m.decompose(b.position, b.quaternion, _s);
    } else {
      // "source" outfits use the bone's own (ValveBiped) axes, like PAC3; "web" outfits use avatar-aligned axes
      const F = inSourceSpace(this) ? null : av.getWebFrameQuat(this.Bone);
      _v.fromArray(this.Position);
      if (F) _v.applyQuaternion(F);
      b.position.add(_v.applyQuaternion(b.quaternion));
      anglesToQuat(this.Angles, _q);
      if (F) _q.premultiply(F).multiply(_q2.copy(F).invert());
      b.quaternion.multiply(_q);
    }
    const s = this.Size;
    b.scale.multiply(_v.set(s * this.Scale[0], s * this.Scale[1], s * this.Scale[2]));
    if (this.HideMesh) b.scale.setScalar(1e-4);
  }
}
registerPart(BonePart);

/** Changes the player model itself. The last visible entity part wins. */
export class EntityPart extends Part {
  static className = 'entity';
  static icon = '🧍';
  static category = 'model';
  static priority = 0;
  static description = 'Changes the player model: use a Garry\'s Mod playermodel, color, transparency, size, material, or hide it. Material parts inside it restyle the playermodel\'s materials.';
  static props = [
    prop('Model', 'asset', '', { group: 'generic', browse: 'model', options: [], help: 'A playermodel .mdl from mounted game content (e.g. models/player/police.mdl). Empty = the mannequin.' }),
    prop('Skin', 'number', 0, { group: 'appearance', min: 0, integer: true }),
    prop('ModelModifiers', 'bodygroups', '', { group: 'appearance', help: 'Bodygroups (and skin) of the playermodel, PAC3 style: "head=1;skin=2;".' }),
    prop('Materials', 'string', '', { group: 'appearance', help: 'Per material slot, separated by ";": the Name of a material part in this outfit, a texture path/URL, or no_material (PAC3 style).' }),
    prop('HideEntity', 'boolean', false, { group: 'appearance', help: 'Hide the player model (attached parts stay visible).' }),
    prop('Color', 'color', [1, 1, 1], { group: 'appearance' }),
    prop('Brightness', 'number', 1, { group: 'appearance', min: 0, step: 0.05 }),
    prop('Alpha', 'number', 1, { group: 'appearance', min: 0, max: 1, step: 0.02 }),
    prop('Material', 'asset', '', { group: 'appearance', options: ['', ...SURFACE_TEXTURES], accept: 'image/*,.vtf', browse: 'material' }),
    prop('Wireframe', 'boolean', false, { group: 'appearance' }),
    prop('Size', 'number', 1, { group: 'orientation', min: 0.01, step: 0.05 }),
    prop('Scale', 'vector', [1, 1, 1], { group: 'orientation', step: 0.05 }),
  ];
  update() {
    if (this.hiddenNow) return;
    const materials = this.children.filter((c) => c.className === 'material' && !c.hiddenNow).map((m) => m.snapshot());
    const slots = resolveMaterialList(this, this.Materials).map((e) => (e ? (e.part ? e.part.snapshot() : { texture: e.texture }) : null));
    this.world.fx.entity = { model: this.Model.trim(), skin: this.Skin, modifiers: this.ModelModifiers, hide: this.HideEntity, color: this.Color, brightness: this.Brightness, alpha: this.Alpha, material: this.Material, wireframe: this.Wireframe, size: this.Size, scale: this.Scale, materials, slots };
    this.status = this.world.avatar.playerModelStatus || '';
  }
  getBodygroups() { return this.world.avatar.getBodygroups(); }
}
registerPart(EntityPart);

/** Overrides the material of its parent model. */
export class MaterialPart extends Part {
  static className = 'material';
  static icon = '🎨';
  static category = 'modifiers';
  static description = 'Overrides the material of its parent model (or of the playermodel, inside an entity part). Simple settings (texture, color, emission, roughness, scrolling), or set Shader to use Source / PAC3 shader parameters: detail textures, self-illumination, phong, animated frames.';
  static props = [
    prop('Shader', 'enum', '', { options: SHADERS, help: 'Empty: the simple settings below. VertexLitGeneric / UnlitGeneric: the Source shader parameters (group "shader"), like PAC3\'s material_3d / material_2d.' }),
    ...SHADER_PARAMS.map(([n, t, d]) => prop(n, t, d, { group: 'shader', ...(t === 'asset' ? { accept: 'image/*,.vtf', browse: 'texture' } : {}), ...(t === 'number' && /frame|blendmode/.test(n) ? { step: 1 } : t === 'number' ? { step: 0.05 } : {}) })),
    prop('MaterialOverride', 'string', '', { help: 'Only affect materials with this name (comma separated), e.g. "helmet". Empty = all.' }),
    prop('Shading', 'enum', 'default', { options: ['default', ...SHADINGS] }),
    prop('BaseTexture', 'asset', '', { options: ['', ...SURFACE_TEXTURES], accept: 'image/*,.vtf', browse: 'texture', help: 'Texture name, image/.vtf URL, or a game texture path.' }),
    prop('BumpMap', 'asset', '', { accept: 'image/*,.vtf', browse: 'texture', help: 'Normal map: image/.vtf URL or a game texture path.' }),
    prop('Color', 'color', [1, 1, 1], { group: 'appearance' }),
    prop('Alpha', 'number', 1, { group: 'appearance', min: 0, max: 1, step: 0.02 }),
    prop('Emissive', 'color', [0, 0, 0], { group: 'appearance' }),
    prop('EmissiveIntensity', 'number', 1, { group: 'appearance', min: 0, step: 0.1 }),
    prop('Roughness', 'number', 0.55, { group: 'appearance', min: 0, max: 1, step: 0.02 }),
    prop('Metalness', 'number', 0, { group: 'appearance', min: 0, max: 1, step: 0.02 }),
    prop('Wireframe', 'boolean', false, { group: 'appearance' }),
    prop('FlatShading', 'boolean', false, { group: 'appearance' }),
    prop('TextureScale', 'number', 1, { group: 'texture', step: 0.1 }),
    prop('TextureScroll', 'vector', [0, 0, 0], { group: 'texture', step: 0.01, help: 'U/V offset (z unused).' }),
    prop('ScrollRate', 'vector', [0, 0, 0], { group: 'texture', step: 0.01, help: 'U/V scroll per second.' }),
  ];
  get scroll() {
    const t = this.world.time;
    return [this.TextureScroll[0] + this.ScrollRate[0] * t, this.TextureScroll[1] + this.ScrollRate[1] * t];
  }
  /** Normalized Source shading settings (Shader set), recomputed after property changes. */
  sourceParams() {
    if (!this.Shader) return null;
    if (!this._src) this._src = sourceParams((k) => this[k], { shader: this.Shader });
    return this._src;
  }
  /** Does this part apply to a material slot with the given name? */
  matches(name) {
    const want = this.MaterialOverride.trim().toLowerCase();
    if (!want || want === 'all') return true;
    const n = String(name || '').toLowerCase();
    return want.split(/[,;]/).some((w) => { w = w.trim(); return w && (n === w || n.endsWith(`/${w}`)); });
  }
  /** Plain values for the avatar (entity parent). */
  snapshot() {
    const o = { scroll: this.scroll, matches: (n) => this.matches(n) };
    for (const k of ['MaterialOverride', 'Shading', 'BaseTexture', 'BumpMap', 'Color', 'Alpha', 'Emissive', 'EmissiveIntensity', 'Roughness', 'Metalness', 'Wireframe', 'TextureScale', 'Shader']) o[k] = this[k];
    // plain values (they become part of the avatar's change key); the avatar rebuilds the shading from them
    if (this.Shader) { o.params = {}; for (const [n] of SHADER_PARAMS) o.params[n] = this[n]; }
    return o;
  }
  _dirtyParent() { if (this.parent && this.parent.markDirty) this.parent.markDirty(); if (this._lastParent && this._lastParent !== this.parent && this._lastParent.markDirty) this._lastParent.markDirty(); this._lastParent = this.parent; }
  attach() { this._dirtyParent(); }
  onPropChanged() { this._src = null; this._dirtyParent(); }
  onShow() { this._dirtyParent(); }
  onHide() { this._dirtyParent(); }
  destroy() { const p = this.parent; this.parent = null; this._dirtyParent(); if (p && p.markDirty) p.markDirty(); }
  update() { if (!this.hiddenNow && (this.ScrollRate[0] || this.ScrollRate[1])) this._dirtyParent(); }
  get status() { return (this.parent && (this.parent.className === 'model' || this.parent.className === 'entity')) || this.Name ? '' : 'Put this inside a model or entity part, or name it and list that name in the Materials of a model.'; }
  set status(_v) {}
}
registerPart(MaterialPart);

/** Cuts its parent model along a plane, like PAC3: the side behind the blue (+Z) arrow is removed. */
export class ClipPart extends MovablePart {
  static className = 'clip';
  static icon = '✂️';
  static category = 'modifiers';
  static description = 'Clips (cuts away) part of the parent model. Everything behind the clip (opposite its forward +Z arrow) is hidden.';
  static removeProps = ['EyeAngles', 'AimPart'];
  constructor(world) { super(world); this.plane = new THREE.Plane(); }
  _dirtyParent() { for (const p of [this.parent, this._lastParent]) if (p && p.markDirty) p.markDirty(); this._lastParent = this.parent; }
  attach() { super.attach(); this._dirtyParent(); }
  onShow() { super.onShow(); this._dirtyParent(); }
  onHide() { super.onHide(); this._dirtyParent(); }
  destroy() { super.destroy(); const p = this.parent; this.parent = null; this._dirtyParent(); if (p && p.markDirty) p.markDirty(); }
  update() {
    this.offset.updateWorldMatrix(true, false);
    const n = this.getWorldForward(_v);
    this.plane.setFromNormalAndCoplanarPoint(n, this.getWorldPosition(new THREE.Vector3()));
  }
}
registerPart(ClipPart);

/** Outline glow around the parent model (inverted hull). */
export class HaloPart extends Part {
  static className = 'halo';
  static icon = '💫';
  static category = 'effects';
  static description = 'Draws a glowing outline around the parent model.';
  static props = [
    prop('Color', 'color', [1, 0.85, 0.3], { group: 'appearance' }),
    prop('Alpha', 'number', 0.8, { group: 'appearance', min: 0, max: 1, step: 0.02 }),
    prop('Width', 'number', 0.6, { group: 'appearance', step: 0.05 }),
    prop('Additive', 'boolean', true, { group: 'appearance' }),
    prop('IgnoreZ', 'boolean', false, { group: 'appearance' }),
  ];
  constructor(world) {
    super(world);
    this.uniforms = { haloWidth: { value: 0.6 } };
    this.material = new THREE.MeshBasicMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false });
    this.material.onBeforeCompile = (sh) => {
      sh.uniforms.haloWidth = this.uniforms.haloWidth;
      sh.vertexShader = 'uniform float haloWidth;\n' + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vec3( position ) + normalize( normal ) * haloWidth;');
    };
    this.material.customProgramCacheKey = () => 'pac-halo';
    this.hulls = [];
    this._ver = -1;
    this._applyMat();
  }
  _applyMat() {
    const m = this.material;
    setColor(m.color, this.Color);
    m.opacity = this.Alpha;
    m.blending = this.Additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.depthTest = !this.IgnoreZ;
    this.uniforms.haloWidth.value = this.Width;
  }
  onPropChanged() { this._applyMat(); }
  _clear() { for (const h of this.hulls) h.removeFromParent(); this.hulls = []; this._ver = -1; }
  attach() { this._clear(); }
  update() {
    const p = this.parent;
    if (!p || p.className !== 'model') { this.status = 'Put this inside a model part.'; this._clear(); return; }
    this.status = '';
    if (this._ver !== p.meshVersion) {
      this._clear();
      this._ver = p.meshVersion;
      for (const mesh of new Set(p.slots.map((s) => s.mesh))) {
        if (mesh.isSkinnedMesh) continue;
        const h = new THREE.Mesh(mesh.geometry, this.material);
        h.raycast = () => {};
        h.renderOrder = 2;
        mesh.add(h);
        this.hulls.push(h);
      }
    }
    for (const h of this.hulls) h.visible = !this.hiddenNow;
  }
  destroy() { this._clear(); this.material.dispose(); }
}
registerPart(HaloPart);
