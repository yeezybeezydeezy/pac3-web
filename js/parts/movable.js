// Base for parts that exist in 3D space: attaches to a bone (or the nearest movable
// ancestor), applies Position/Angles then PositionOffset/AngleOffset, and can aim.
import * as THREE from 'three';
import { Part, prop } from '../core/part.js';
import { anglesToQuat } from '../core/util.js';

const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _d = new THREE.Vector3();

export class MovablePart extends Part {
  static movable = true;
  static props = [
    prop('Bone', 'bone', 'head', { group: 'orientation', help: 'Bone to attach to when there is no movable parent.' }),
    prop('Position', 'vector', [0, 0, 0], { group: 'orientation' }),
    prop('Angles', 'angle', [0, 0, 0], { group: 'orientation', help: 'pitch, yaw, roll in degrees' }),
    prop('PositionOffset', 'vector', [0, 0, 0], { group: 'orientation', help: 'Applied after Angles (moves along the rotated axes).' }),
    prop('AngleOffset', 'angle', [0, 0, 0], { group: 'orientation' }),
    prop('EyeAngles', 'boolean', false, { group: 'orientation', help: 'Point forward (+Z) where the owner is looking.' }),
    prop('AimPart', 'part', '', { group: 'orientation', help: 'Point forward (+Z) at another part.' }),
  ];

  constructor(world) {
    super(world);
    this.node = new THREE.Group();
    this.offset = new THREE.Group();
    this.node.add(this.offset);
    this.node.userData.part = this;
    this.node.visible = false;
    this.applyTransform();
  }

  /** Where children attach. */
  get childAnchor() { return this.offset; }
  getAnchorFor(_child) { return this.childAnchor; }
  /** Object the transform gizmo manipulates (writes Position/Angles). */
  get gizmoTarget() { return this.node; }

  findAnchor() {
    for (let p = this.parent; p; p = p.parent) if (p.constructor.movable) return p.getAnchorFor(this);
    const root = this.getRoot();
    if (root.rootAnchor) return root.rootAnchor;
    return inSourceSpace(this) ? this.world.avatar.getBone(this.Bone) : this.world.avatar.getWebFrame(this.Bone);
  }
  /** Bone names valid for this part's Bone property. */
  getBoneOptions() {
    for (let p = this.parent; p; p = p.parent) if (p.constructor.movable) return p.getChildBoneNames ? p.getChildBoneNames() : [];
    return this.getRoot().rootAnchor ? [] : this.world.avatar.getBoneNames();
  }
  attach() {
    const a = this.findAnchor();
    if (a && this.node.parent !== a) a.add(this.node);
  }

  applyTransform() {
    this.node.position.fromArray(this.Position);
    anglesToQuat(this.Angles, this.node.quaternion);
    this.offset.position.fromArray(this.PositionOffset);
    anglesToQuat(this.AngleOffset, this.offset.quaternion);
  }

  onPropChanged(name) {
    if (name === 'Position' || name === 'Angles' || name === 'PositionOffset' || name === 'AngleOffset') this.applyTransform();
    else if (name === 'Bone' && this.inWorld) this.attach();
  }
  onShow() { this.node.visible = true; }
  onHide() { this.node.visible = false; }

  getWorldPosition(out = new THREE.Vector3()) { return this.offset.getWorldPosition(out); }
  getWorldForward(out = new THREE.Vector3()) { return out.set(0, 0, 1).transformDirection(this.offset.matrixWorld); }

  update() {
    if (this.hiddenNow) return;
    const aim = this.AimPart ? this.world.getPart(this.AimPart) : null;
    if (!this.EyeAngles && !(aim && aim.getWorldPosition)) return;
    if (aim && aim.getWorldPosition) aim.getWorldPosition(_p);
    else {
      this.world.player.getEyeDir(_d);
      this.world.avatar.getBone('eyes').getWorldPosition(_p);
      _p.addScaledVector(_d, 10000);
    }
    this.node.lookAt(_p);
    this.node.quaternion.multiply(anglesToQuat(this.Angles, _q));
    this.node.updateMatrixWorld(true);
  }

  destroy() { this.node.removeFromParent(); }
}

/** True when the part belongs to an outfit whose top-level group uses Source (PAC3) bone axes. */
export function inSourceSpace(part) { return part.getRoot().CoordinateSpace === 'source'; }

// Common appearance helpers for drawable parts.
export function applyBlend(material, name) {
  material.blending = name === 'additive' ? THREE.AdditiveBlending : name === 'multiply' ? THREE.MultiplyBlending : name === 'subtractive' ? THREE.SubtractiveBlending : THREE.NormalBlending;
  // three.js requires premultiplied alpha for multiply/subtractive blending
  material.premultipliedAlpha = name === 'multiply' || name === 'subtractive';
}
export const BLEND_MODES = ['normal', 'additive', 'multiply', 'subtractive'];
