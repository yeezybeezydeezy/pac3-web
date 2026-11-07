// group, info, bone, entity, material, clip, halo
import * as THREE from 'three';
import { Part, prop, registerPart } from '../core/part.js';
import { MovablePart } from './movable.js';
import { SHADINGS } from './model.js';
import { SURFACE_TEXTURES } from '../core/textures.js';
import { anglesToQuat, setColor } from '../core/util.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();

export class GroupPart extends Part {
  static className = 'group';
  static icon = '🌐';
  static category = 'generic';
  static description = 'Organizes parts. Outfits start with a group; hiding it hides everything inside.';
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
    prop('ScaleChildren', 'boolean', false, { group: 'orientation', help: 'Also scale the bones below this one (e.g. the whole arm).' }),
    prop('HideMesh', 'boolean', false, { group: 'appearance', help: 'Hide the body segment of this bone.' }),
    prop('FollowPart', 'part', '', { group: 'other', help: 'Make the bone follow another part (e.g. a jiggle).' }),
  ];
  getAnchorFor() { return this.world.avatar.getBone(this.Bone); }
  getChildBoneNames() { return []; }
  getBoneOptions() { return this.world.avatar.getBoneNames(); }
  onPropChanged(name) { if (name === 'Bone' && this.inWorld) for (const c of this.children) c.traverse((p) => p.attach && p.attach()); }
  update() {
    if (this.hiddenNow) return;
    const av = this.world.avatar;
    const b = av.bones[this.Bone];
    if (!b) { this.status = `No bone "${this.Bone}"`; return; }
    this.status = '';
    const follow = this.FollowPart ? this.world.getPart(this.FollowPart) : null;
    if (follow && follow.offset && b.parent) {
      b.parent.updateWorldMatrix(true, false);
      _m.copy(b.parent.matrixWorld).invert().multiply(follow.offset.matrixWorld);
      _m.decompose(b.position, b.quaternion, _s);
    } else {
      _v.fromArray(this.Position).applyQuaternion(b.quaternion);
      b.position.add(_v);
      b.quaternion.multiply(anglesToQuat(this.Angles, _q));
    }
    const s = this.Size;
    const seg = av.segments[this.Bone];
    if (this.ScaleChildren) b.scale.multiply(_v.set(s * this.Scale[0], s * this.Scale[1], s * this.Scale[2]));
    else if (seg) seg.scale.multiply(_v.set(s * this.Scale[0], s * this.Scale[1], s * this.Scale[2]));
    if (seg && this.HideMesh) seg.visible = false;
  }
}
registerPart(BonePart);

/** Changes the player model itself. The last visible entity part wins. */
export class EntityPart extends Part {
  static className = 'entity';
  static icon = '🧍';
  static category = 'model';
  static priority = 0;
  static description = 'Changes the player model: color, transparency, size, material, or hides it completely.';
  static props = [
    prop('HideEntity', 'boolean', false, { group: 'appearance', help: 'Hide the player model (attached parts stay visible).' }),
    prop('Color', 'color', [1, 1, 1], { group: 'appearance' }),
    prop('Brightness', 'number', 1, { group: 'appearance', min: 0, step: 0.05 }),
    prop('Alpha', 'number', 1, { group: 'appearance', min: 0, max: 1, step: 0.02 }),
    prop('Material', 'asset', '', { group: 'appearance', options: ['', ...SURFACE_TEXTURES], accept: 'image/*' }),
    prop('Wireframe', 'boolean', false, { group: 'appearance' }),
    prop('Size', 'number', 1, { group: 'orientation', min: 0.01, step: 0.05 }),
    prop('Scale', 'vector', [1, 1, 1], { group: 'orientation', step: 0.05 }),
  ];
  update() {
    if (this.hiddenNow) return;
    this.world.fx.entity = { hide: this.HideEntity, color: this.Color, brightness: this.Brightness, alpha: this.Alpha, material: this.Material, wireframe: this.Wireframe, size: this.Size, scale: this.Scale };
  }
}
registerPart(EntityPart);

/** Overrides the material of its parent model. */
export class MaterialPart extends Part {
  static className = 'material';
  static icon = '🎨';
  static category = 'modifiers';
  static description = 'Overrides the parent model\'s material: texture, shading, emission, roughness, scrolling.';
  static props = [
    prop('Shading', 'enum', 'default', { options: ['default', ...SHADINGS] }),
    prop('BaseTexture', 'asset', '', { options: ['', ...SURFACE_TEXTURES], accept: 'image/*' }),
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
  _dirtyParent() { if (this.parent && this.parent.markDirty) this.parent.markDirty(); if (this._lastParent && this._lastParent !== this.parent && this._lastParent.markDirty) this._lastParent.markDirty(); this._lastParent = this.parent; }
  attach() { this._dirtyParent(); }
  onPropChanged() { this._dirtyParent(); }
  onShow() { this._dirtyParent(); }
  onHide() { this._dirtyParent(); }
  destroy() { const p = this.parent; this.parent = null; this._dirtyParent(); if (p && p.markDirty) p.markDirty(); }
  update() { if (!this.hiddenNow && (this.ScrollRate[0] || this.ScrollRate[1])) this._dirtyParent(); }
  get status() { return this.parent && this.parent.className === 'model' ? '' : 'Put this inside a model part.'; }
  set status(_v) {}
}
registerPart(MaterialPart);

/** Cuts its parent model along a plane; the blue (+Z) arrow points at the removed side. */
export class ClipPart extends MovablePart {
  static className = 'clip';
  static icon = '✂️';
  static category = 'modifiers';
  static description = 'Clips (cuts away) part of the parent model. Everything on the forward (+Z) side of the clip is hidden.';
  static removeProps = ['EyeAngles', 'AimPart'];
  constructor(world) { super(world); this.plane = new THREE.Plane(); }
  _dirtyParent() { for (const p of [this.parent, this._lastParent]) if (p && p.markDirty) p.markDirty(); this._lastParent = this.parent; }
  attach() { super.attach(); this._dirtyParent(); }
  onShow() { super.onShow(); this._dirtyParent(); }
  onHide() { super.onHide(); this._dirtyParent(); }
  destroy() { super.destroy(); const p = this.parent; this.parent = null; this._dirtyParent(); if (p && p.markDirty) p.markDirty(); }
  update() {
    this.offset.updateWorldMatrix(true, false);
    const n = this.getWorldForward(_v).negate();
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
