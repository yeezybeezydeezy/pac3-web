// The rest of PAC3's part types. Gameplay parts (hitscan, damage_zone, health_modifier, force,
// physics, lock) act on the local player and world, since there is no server or other players here.
import * as THREE from 'three';
import { Part, prop, registerPart } from '../core/part.js';
import { MovablePart } from './movable.js';
import { ModelPart } from './model.js';
import { ParticlesPart } from './effects.js';
import { parseModelModifiers, modelModifiersString, friendlyBoneName } from '../source/assets.js';
import { parseLuaData } from '../source/luadata.js';
import { getTexture, SPRITE_TEXTURES } from '../core/textures.js';
import { anglesToQuat, setColor, DEG, clamp, deepClone } from '../core/util.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const NO_AIM = ['EyeAngles', 'AimPart'];
const partRef = (w, id) => (id ? w.getPart(id) : null);

/** Writes a property of another part while visible (like a proxy), restoring it when hidden. */
function overrideProp(part, target, name, value) {
  if (!target || !target.constructor.getProp(name)) return;
  if (target[name] !== value) target.setProxied(name, value);
  part._overrides ||= new Set();
  part._overrides.add(target);
}
function releaseOverrides(part, name) {
  for (const t of part._overrides || []) if (t.inWorld) t.restoreProxied(name);
  part._overrides = null;
}

// ---------------------------------------------------------------- animation
/** PAC3 keyframe bone animation (boneanimlib JSON: FrameData[{FrameRate, BoneInfo{bone: {MU,MR,MF,RU,RR,RF}}}]). */
export class CustomAnimationPart extends Part {
  static className = 'custom_animation';
  static icon = '🎞️';
  static category = 'model';
  static priority = 0;
  static description = 'Keyframed bone animation in PAC3\'s format, from Data (JSON) or a URL. Offsets are added to the animated bones.';
  static props = [
    prop('URL', 'string', '', { help: 'http(s) URL of a PAC3 animation (.txt JSON).' }),
    prop('Data', 'text', '', { help: 'PAC3 animation JSON (used when URL is empty).' }),
    prop('AnimationType', 'enum', 'sequence', { options: ['sequence', 'gesture', 'posture', 'stance'], help: 'sequence/stance loop, gesture plays once, posture holds the last frame.' }),
    prop('Interpolation', 'enum', 'cosine', { options: ['cosine', 'linear', 'cubic', 'none'] }),
    prop('Rate', 'number', 1, { step: 0.1 }),
    prop('BonePower', 'number', 1, { step: 0.05 }),
    prop('Offset', 'number', 0, { step: 0.1, help: 'Start this many frames in.' }),
    prop('StopOnHide', 'boolean', true),
    prop('StopOtherAnimations', 'boolean', false),
  ];
  constructor(world) { super(world); this.anim = null; this._token = 0; }
  onPropChanged(name) { if (name === 'URL' || name === 'Data') this._load(); }
  onAdded() { this._load(); }
  onShow() {
    this.frame = Math.max(0, Math.floor(this.Offset));
    this.delta = this.Offset % 1;
    this._started = true;
    this._stopped = false;
    if (this.StopOtherAnimations) for (const p of this.world.findPartsByClass('custom_animation')) if (p !== this) p._stopped = true;
  }
  _parse(text) {
    let d;
    try { d = JSON.parse(text); } catch { d = parseLuaData(text); }
    const frames = (Array.isArray(d.FrameData) ? d.FrameData : Object.values(d.FrameData || {})).slice(0, 4000).map((f) => ({
      rate: Math.max(0.01, Number(f.FrameRate) || 1),
      bones: Object.entries(f.BoneInfo || {}).slice(0, 256).map(([b, i]) => ({ name: String(b), mu: +i.MU || 0, mr: +i.MR || 0, mf: +i.MF || 0, ru: +i.RU || 0, rr: +i.RR || 0, rf: +i.RF || 0 })),
    }));
    if (!frames.length) throw new Error('no frames');
    return { frames, restart: Math.max(1, Math.min(frames.length, Number(d.RestartFrame) || 1)) - 1 };
  }
  async _load() {
    const token = ++this._token;
    this.anim = null;
    try {
      let text = this.Data;
      if (this.URL.trim()) {
        if (!/^https?:/i.test(this.URL.trim())) throw new Error('URL must be http(s)');
        this.status = 'Loading animation…';
        const r = await fetch(this.URL.trim());
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        text = (await r.text()).slice(0, 5e6);
      }
      if (!text.trim()) { this.status = 'Set Data or a URL.'; return; }
      const anim = this._parse(text);
      if (token !== this._token) return;
      this.anim = anim;
      this.status = '';
      this.frame = Math.max(0, Math.floor(this.Offset));
      this.delta = this.Offset % 1;
    } catch (e) { if (token === this._token) this.status = `Animation: ${e.message}`.slice(0, 160); }
  }
  update(dt) {
    const A = this.anim;
    // StopOnHide off: an animation that was started keeps playing after the part hides
    if (!A || this._stopped || (this.hiddenNow && (this.StopOnHide || !this._started))) return;
    const n = A.frames.length;
    // advance
    this.delta += dt * A.frames[Math.min(n - 1, this.frame)].rate * this.Rate;
    while (this.delta >= 1) {
      this.delta -= 1;
      this.frame++;
      if (this.frame >= n) {
        if (this.AnimationType === 'gesture') { this.frame = n; this.delta = 0; return; }
        if (this.AnimationType === 'posture') { this.frame = n - 1; this.delta = 1; break; }
        this.frame = A.restart;
      }
    }
    if (this.frame >= n) return;
    const cur = A.frames[this.frame], prev = A.frames[Math.max(0, this.frame - 1)];
    let t = this.AnimationType === 'posture' && this.frame === n - 1 ? 1 : this.delta;
    if (this.Interpolation === 'cosine' || this.Interpolation === 'cubic') t = (1 - Math.cos(t * Math.PI)) / 2;
    if (this.Interpolation === 'none') t = 1;
    const av = this.world.avatar;
    const p = this.BonePower;
    const prevMap = new Map(prev.bones.map((b) => [b.name, b]));
    for (const b of cur.bones) {
      const bone = av.getBone(friendlyBoneName(b.name));
      if (!bone || bone === av.root) continue;
      const a = prevMap.get(b.name) || ZERO;
      const L = (k) => (a[k] + (b[k] - a[k]) * t) * p;
      // Source bone axes: forward = our local Z, right = -our local X, up = our local Y
      _v.set(-L('mr'), L('mu'), L('mf')).applyQuaternion(bone.quaternion);
      bone.position.add(_v);
      bone.quaternion.multiply(anglesToQuat([L('rr'), L('ru'), L('rf')], _q));
    }
  }
}
const ZERO = { mu: 0, mr: 0, mf: 0, ru: 0, rr: 0, rf: 0 };
registerPart(CustomAnimationPart);

/** A layered sequence (plays once unless Loop). */
export class GesturePart extends Part {
  static className = 'gesture';
  static icon = '👋';
  static category = 'model';
  static description = 'Plays a gesture sequence (e.g. gesture_wave) on top of the current animation.';
  static props = [
    prop('GestureName', 'enum', 'gesture_wave', { sequence: true, options: ['gesture_wave', 'gesture_salute', 'gesture_bow', 'gesture_agree', 'gesture_disagree', 'gesture_becon', 'gesture_signal_forward', 'gesture_signal_halt', 'gesture_signal_group', 'gesture_item_give', 'gesture_item_drop', 'gesture_item_throw'], free: true }),
    prop('Loop', 'boolean', false),
    prop('SlotName', 'string', 'attackreload'),
    prop('SlotWeight', 'number', 1, { min: 0, max: 1, step: 0.05 }),
  ];
  get SequenceName() { return this.GestureName; }
  get Weight() { return this._done ? 0 : this.SlotWeight; }
  cycle(speed) {
    const x = this.timeShown() * speed;
    this._done = !this.Loop && x >= 1;
    return this.Loop ? x % 1 : Math.min(x, 1);
  }
  getSequenceOptions() { return this.world.avatar.getSequenceNames().filter((n) => /gesture|taunt|wave|salute/.test(n)); }
}
registerPart(GesturePart);

const HOLDTYPES = ['', 'normal', 'passive', 'pistol', 'revolver', 'smg', 'ar2', 'shotgun', 'rpg', 'crossbow', 'physgun', 'melee', 'melee2', 'knife', 'fist', 'grenade', 'slam', 'camera', 'magic', 'duel'];
const seqProp = (name, help) => prop(name, 'enum', '', { group: 'sequences', options: [''], free: true, sequence: true, help });
/**
 * Replaces the player's movement sequences (PAC3 property names: StandIdle, Walk, Run…), and/or
 * switches the whole set to another holdtype (idle_pistol, run_ar2…).
 */
export class HoldtypePart extends Part {
  static className = 'holdtype';
  static icon = '🤲';
  static category = 'model';
  static description = 'Replaces the player\'s movement sequences (idle, walk, run, crouch, jump, swim, noclip, sitting), or switches them all to a holdtype such as pistol or ar2.';
  static props = [
    prop('HoldType', 'enum', '', { options: HOLDTYPES, free: true, help: 'Use this holdtype\'s sequences (idle_<holdtype>, run_<holdtype>…). Empty = keep the weapon\'s.' }),
    seqProp('StandIdle'), seqProp('Walk'), seqProp('Run'), seqProp('CrouchIdle'), seqProp('CrouchWalk'), seqProp('Jump'),
    seqProp('SwimIdle'), seqProp('Swim'), seqProp('Air', 'While in the air.'), seqProp('Noclip', 'While flying (noclip movement).'), seqProp('Sitting'),
    seqProp('Fallback', 'Used when a state has no sequence of its own.'),
    seqProp('AttackStandPrimaryfire'), seqProp('AttackCrouchPrimaryfire'), seqProp('ReloadStand'), seqProp('ReloadCrouch'), seqProp('ActLand'), seqProp('ActRangeAttack1'),
    prop('AlternativeRate', 'boolean', false), prop('Override', 'boolean', false, { help: 'Ignore other holdtype parts.' }),
  ];
  getSequenceOptions() { return this.world.avatar.getSequenceNames(); }
  beforeAvatar(fx) {
    if (fx.holdtype && !this.Override) return; // the first visible part wins unless another overrides
    fx.holdtype = {
      type: this.HoldType,
      fallback: this.Fallback,
      seqs: { idle: this.StandIdle, walk: this.Walk, run: this.Run, crouch: this.CrouchIdle, crouch_walk: this.CrouchWalk, jump: this.Air || this.Jump, fly: this.Noclip || this.Swim, swim: this.Swim, sit: this.Sitting },
      fire: this.AttackStandPrimaryfire, fireCrouch: this.AttackCrouchPrimaryfire,
    };
  }
}
registerPart(HoldtypePart);

export class PoseParameterPart extends Part {
  static className = 'poseparameter';
  static icon = '🎚️';
  static category = 'model';
  static description = 'Sets a player pose parameter: move_x / move_y (-1…1) pick the movement blend, head_yaw / head_pitch / aim_yaw / aim_pitch (degrees) turn the head.';
  static props = [
    prop('PoseParameter', 'enum', 'head_yaw', { options: ['move_x', 'move_y', 'aim_pitch', 'aim_yaw', 'head_pitch', 'head_yaw', 'vertical_velocity'], free: true }),
    prop('Range', 'number', 0, { step: 1 }),
  ];
  beforeAvatar(fx) { fx.poseParams[this.PoseParameter] = this.Range; }
}
registerPart(PoseParameterPart);

export class FlexPart extends Part {
  static className = 'flex';
  static icon = '😐';
  static category = 'model';
  static description = 'Facial flex weight. Kept for PAC3 outfits; faces do not move yet because model flex (morph) data is not read.';
  static props = [prop('Flex', 'string', ''), prop('Weight', 'number', 0, { step: 0.05 }), prop('Additive', 'boolean', false), prop('RootOwner', 'boolean', false)];
  get status() { return 'Facial flexes are not supported yet.'; }
  set status(_v) {}
}
registerPart(FlexPart);
export class FaceposerPart extends Part {
  static className = 'faceposer';
  static icon = '🙂';
  static category = 'model';
  static description = 'Facial expression preset. Kept for PAC3 outfits; faces do not move yet because model flex (morph) data is not read.';
  static props = [prop('Preset', 'string', ''), prop('FlexWeights', 'text', ''), prop('Scale', 'number', 1, { step: 0.05 }), prop('Additive', 'boolean', false)];
  get status() { return 'Facial flexes are not supported yet.'; }
  set status(_v) {}
}
registerPart(FaceposerPart);

// ---------------------------------------------------------------- model modifiers
export class BodygroupPart extends Part {
  static className = 'bodygroup';
  static icon = '🧩';
  static category = 'modifiers';
  static description = 'Sets one bodygroup of the parent model or entity (legacy PAC3 part; ModelModifiers does the same).';
  static props = [prop('BodyGroupName', 'string', ''), prop('ModelIndex', 'number', 0, { min: 0, integer: true })];
  update() {
    if (this.hiddenNow || !this.parent || !this.BodyGroupName) return;
    const base = this.parent.getStored ? this.parent.getStored('ModelModifiers') : '';
    const mods = parseModelModifiers(base);
    mods.groups.set(this.BodyGroupName.toLowerCase(), this.ModelIndex);
    overrideProp(this, this.parent, 'ModelModifiers', modelModifiersString(mods));
  }
  onHide() { releaseOverrides(this, 'ModelModifiers'); }
  destroy() { releaseOverrides(this, 'ModelModifiers'); }
}
registerPart(BodygroupPart);

export class SubmaterialPart extends Part {
  static className = 'submaterial';
  static icon = '🖌️';
  static category = 'modifiers';
  static description = 'Replaces one material slot of the parent model or entity (1 = first slot).';
  static props = [prop('Material', 'asset', '', { accept: 'image/*,.vtf', browse: 'material' }), prop('SubMaterialId', 'number', 1, { min: 1, integer: true }), prop('UnlitMaterialHack', 'boolean', false), prop('RootOwner', 'boolean', false)];
  update() {
    if (this.hiddenNow || !this.parent) return;
    const list = String((this.parent.getStored && this.parent.getStored('Materials')) || '').split(';');
    while (list.length < this.SubMaterialId) list.push('');
    list[this.SubMaterialId - 1] = this.Material;
    overrideProp(this, this.parent, 'Materials', list.join(';'));
  }
  onHide() { releaseOverrides(this, 'Materials'); }
  destroy() { releaseOverrides(this, 'Materials'); }
}
registerPart(SubmaterialPart);

const WEAPON_MODELS = { weapon_pistol: 'w_pistol', weapon_357: 'w_357', weapon_smg1: 'w_smg1', weapon_ar2: 'w_irifle', weapon_shotgun: 'w_shotgun', weapon_crossbow: 'w_crossbow', weapon_rpg: 'w_rocket_launcher', weapon_crowbar: 'w_crowbar', weapon_stunstick: 'w_stunbaton', weapon_frag: 'w_grenade', weapon_physcannon: 'w_physics', weapon_physgun: 'w_physics', gmod_tool: 'w_toolgun', weapon_slam: 'w_slam', weapon_bugbait: 'w_bugbait' };
/** Shows the held weapon's world model (from mounted content). */
export class WeaponPart extends ModelPart {
  static className = 'weapon';
  static icon = '🔫';
  static category = 'model';
  static description = 'Shows the weapon you hold (Player settings) or Class in your hand, using its world model from mounted game content.';
  static removeProps = ['Model'];
  static props = [
    prop('Bone', 'bone', 'right hand', { group: 'orientation' }),
    prop('Class', 'string', 'all', { help: '"all" = the weapon set in Player settings, or a class like weapon_pistol.' }),
    prop('NoDraw', 'boolean', false), prop('OverridePosition', 'boolean', false), prop('DrawShadow', 'boolean', true),
  ];
  get Model() {
    const cls = (this.Class === 'all' || !this.Class ? this.world.player.weapon : this.Class).toLowerCase();
    if (!cls || cls === 'none') return '';
    return `models/weapons/${WEAPON_MODELS[cls] || `w_${cls.replace(/^weapon_/, '')}`}.mdl`;
  }
  set Model(_v) {}
  _load() { this._lastModel = this.Model; super._load(); }
  update(dt) {
    if (this.Model !== this._lastModel) this._load();
    super.update(dt);
    this.content.visible = !this.NoDraw;
  }
}
registerPart(WeaponPart);

export class PlayerConfigPart extends Part {
  static className = 'player_config';
  static icon = '⚙️';
  static category = 'modifiers';
  static description = 'Player behaviour: AnimationRate speeds up or slows the movement animations. The sound, bullet, death and blood options are kept for PAC3 outfits but have nothing to act on here.';
  static props = [
    prop('AnimationRate', 'number', 1, { min: 0, step: 0.1 }), prop('MuteFootsteps', 'boolean', false), prop('MuteSounds', 'boolean', false),
    prop('HideBullets', 'boolean', false), prop('HidePhysgunBeam', 'boolean', false), prop('UseLegacyScale', 'boolean', false), prop('GrabEarAnimation', 'boolean', true),
    prop('BloodColor', 'string', 'red'), prop('FallApartOnDeath', 'boolean', false), prop('DeathRagdollizeParent', 'boolean', true), prop('DrawPlayerOnDeath', 'boolean', false), prop('HideRagdollOnDeath', 'boolean', false),
  ];
  beforeAvatar(fx) { fx.playerConfig = { animationRate: this.AnimationRate, muteFootsteps: this.MuteFootsteps, muteSounds: this.MuteSounds }; }
}
registerPart(PlayerConfigPart);

/** Copies a property from one part to another every frame. */
export class LinkPart extends Part {
  static className = 'link';
  static icon = '🔗';
  static category = 'logic';
  static description = 'Copies a property from one part to another every frame.';
  static props = [
    prop('From', 'part', ''), prop('To', 'part', ''),
    prop('Type', 'enum', 'from -> to', { options: ['from -> to', 'to -< from', 'from <-> to'] }),
    prop('FromVariableName', 'string', ''), prop('ToVariableName', 'string', ''),
  ];
  runProxy(touched) {
    let a = partRef(this.world, this.From), b = partRef(this.world, this.To), an = this.FromVariableName, bn = this.ToVariableName || this.FromVariableName;
    if (!a || !b || !an || !a.constructor.getProp(an) || !b.constructor.getProp(bn)) { this.status = 'Set From, To and the variable names.'; return; }
    this.status = '';
    if (this.Type === 'from <-> to') {
      // two-way: copy whichever side changed since last frame (a stored edit, not a proxy write)
      const ka = JSON.stringify(a.getStored(an)), kb = JSON.stringify(b.getStored(bn));
      const reverse = !!this._last && ka === this._last && kb !== this._last;
      const [src, sn, dst, dn] = reverse ? [b, bn, a, an] : [a, an, b, bn];
      if (ka !== kb) dst.setProp(dn, deepClone(src.getStored(sn)));
      this._last = reverse ? kb : ka;
      return;
    }
    if (this.Type === 'to -< from') { [a, b] = [b, a]; [an, bn] = [bn, an]; }
    const v = a[an];
    if (v === undefined) return;
    b.setProxied(bn, deepClone(v));
    touched.set(`${b.UniqueID}|${bn}`, { part: b, name: bn });
  }
}
registerPart(LinkPart);

/** Moves between up to 20 node parts by LerpValue (0 = Node1, 1 = Node2, …). */
export class InterpolatedMultibonePart extends MovablePart {
  static className = 'interpolated_multibone';
  static icon = '🧵';
  static category = 'model';
  static description = 'Sits between node parts: LerpValue 0 = Node1, 1 = Node2, 2 = Node3… Drive LerpValue with a proxy.';
  static removeProps = NO_AIM;
  static props = [
    prop('LerpValue', 'number', 0, { group: 'interpolation', step: 0.05 }), prop('Power', 'number', 1, { group: 'interpolation', step: 0.1 }),
    prop('InterpolatePosition', 'boolean', true, { group: 'interpolation' }), prop('InterpolateAngles', 'boolean', true, { group: 'interpolation' }),
    prop('Preview', 'boolean', false, { group: 'test' }),
    ...Array.from({ length: 20 }, (_, i) => prop(`Node${i + 1}`, 'part', '', { group: 'nodes' })),
  ];
  update(dt) {
    const nodes = [];
    for (let i = 1; i <= 20; i++) { const p = partRef(this.world, this[`Node${i}`]); if (p && p.getWorldPosition && p !== this) nodes.push(p); }
    if (nodes.length < 1 || this.hiddenNow) { super.update(dt); return; }
    const x = clamp(this.LerpValue, 0, nodes.length - 1);
    const i = Math.min(nodes.length - 2, Math.floor(x));
    let t = nodes.length > 1 ? x - Math.max(0, i) : 0;
    if (this.Power !== 1) t = t ** this.Power;
    const A = nodes[Math.max(0, i)], B = nodes[Math.min(nodes.length - 1, Math.max(0, i) + 1)];
    const pa = A.getWorldPosition(new THREE.Vector3()), pb = B.getWorldPosition(new THREE.Vector3());
    const qa = A.offset.getWorldQuaternion(new THREE.Quaternion()), qb = B.offset.getWorldQuaternion(new THREE.Quaternion());
    const pos = this.InterpolatePosition ? pa.lerp(pb, t) : pa;
    const quat = this.InterpolateAngles ? qa.slerp(qb, t) : qa;
    const parent = this.node.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    _m.copy(parent.matrixWorld).invert().multiply(new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1)));
    _m.decompose(this.node.position, this.node.quaternion, _s);
    this.node.updateMatrixWorld(true);
  }
}
registerPart(InterpolatedMultibonePart);

// ---------------------------------------------------------------- visual
/** Ghost copies of the parent model at its recent positions. */
export class MotionBlurPart extends Part {
  static className = 'motion_blur';
  static icon = '💨';
  static category = 'effects';
  static description = 'Leaves fading copies of the parent model behind as it moves.';
  static props = [prop('Alpha', 'number', 0.5, { min: 0, max: 1, step: 0.05 }), prop('BlurLength', 'number', 10, { min: 1, max: 40, integer: true }), prop('BlurSpacing', 'number', 0.1, { min: 0.01, step: 0.01, help: 'Seconds between copies.' })];
  constructor(world) { super(world); this.group = new THREE.Group(); this.ghosts = []; this._next = 0; this.material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }); }
  onAdded() { this.world.scene.add(this.group); }
  update() {
    const p = this.parent;
    const t = this.world.time;
    if (!this.hiddenNow && p && p.slots && t >= this._next) {
      this._next = t + this.BlurSpacing;
      const g = new THREE.Group();
      for (const s of p.slots) {
        const m = new THREE.Mesh(s.mesh.geometry, this.material.clone());
        const src = s.get();
        if (src && src.color) m.material.color.copy(src.color);
        if (src && src.map) m.material.map = src.map;
        s.mesh.updateWorldMatrix(true, false);
        m.matrixAutoUpdate = false;
        m.matrix.copy(s.mesh.matrixWorld);
        m.raycast = () => {};
        g.add(m);
      }
      this.group.add(g);
      this.ghosts.push(g);
      while (this.ghosts.length > this.BlurLength) { const old = this.ghosts.shift(); old.removeFromParent(); old.traverse((o) => o.material && o.material.dispose()); }
    }
    if (this.hiddenNow && this.ghosts.length && t >= this._next) { const old = this.ghosts.shift(); old.removeFromParent(); this._next = t + this.BlurSpacing; }
    this.ghosts.forEach((g, i) => g.traverse((o) => { if (o.material) o.material.opacity = this.Alpha * ((i + 1) / (this.ghosts.length + 1)); }));
  }
  destroy() { this.group.removeFromParent(); this.material.dispose(); }
}
registerPart(MotionBlurPart);

/** A spotlight that projects a texture. */
export class ProjectedTexturePart extends MovablePart {
  static className = 'projected_texture';
  static icon = '📽️';
  static category = 'effects';
  static description = 'A spotlight that projects a texture forward (+Z), like a flashlight or a projector.';
  static removeProps = NO_AIM;
  static props = [
    prop('Texture', 'asset', 'ring', { options: SPRITE_TEXTURES, accept: 'image/*,.vtf', browse: 'texture' }),
    prop('Color', 'color', [1, 1, 1], { group: 'appearance' }), prop('Brightness', 'number', 8, { group: 'appearance', min: 0, step: 0.25 }),
    prop('FOV', 'number', 90, { group: 'appearance', min: 1, max: 170 }), prop('HorizontalFOV', 'number', 90, { group: 'appearance' }), prop('VerticalFOV', 'number', 90, { group: 'appearance' }),
    prop('NearZ', 'number', 1, { group: 'appearance', min: 0.1 }), prop('FarZ', 'number', 2048, { group: 'appearance', min: 1 }),
    prop('Shadows', 'boolean', true, { group: 'appearance' }), prop('Orthographic', 'boolean', false, { group: 'appearance' }), prop('TextureFrame', 'number', 0, { group: 'appearance', integer: true }),
  ];
  constructor(world) {
    super(world);
    this.light = new THREE.SpotLight(0xffffff, 0, 2048, Math.PI / 4, 0.1, 0);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(512, 512);
    this.target = new THREE.Object3D();
    this.target.position.set(0, 0, 10);
    this.offset.add(this.light, this.target);
    this.light.target = this.target;
    this._apply();
  }
  _apply() {
    const l = this.light;
    setColor(l.color, this.Color);
    l.intensity = this.hiddenNow ? 0 : this.Brightness * 0.5;
    l.distance = this.FarZ;
    l.angle = Math.min(this.FOV, 170) * 0.5 * DEG;
    l.map = getTexture(this.Texture);
    l.shadow.camera.near = this.NearZ;
  }
  onPropChanged(name, old) { super.onPropChanged(name, old); this._apply(); }
  onShow() { this.node.visible = true; this._apply(); }
  onHide() { this.node.visible = true; this._apply(); }
  destroy() { this.light.dispose(); super.destroy(); }
}
registerPart(ProjectedTexturePart);

const _ray = new THREE.Ray();
/** First hit of a ray against the ground and world objects. */
function worldHit(world, origin, dir, max) {
  let best = null;
  if (dir.y < -1e-6) { const t = -origin.y / dir.y; if (t <= max) best = { t, normal: new THREE.Vector3(0, 1, 0) }; }
  _ray.set(origin, dir);
  for (const box of world.colliders || []) {
    const p = _ray.intersectBox(box, new THREE.Vector3());
    if (!p) continue;
    const t = p.distanceTo(origin);
    if (t <= max && (!best || t < best.t)) {
      const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      const d = p.clone().sub(c).divide(s);
      const ax = Math.abs(d.x) > Math.abs(d.y) ? (Math.abs(d.x) > Math.abs(d.z) ? 'x' : 'z') : Math.abs(d.y) > Math.abs(d.z) ? 'y' : 'z';
      const n = new THREE.Vector3(); n[ax] = Math.sign(d[ax]) || 1;
      best = { t, normal: n };
    }
  }
  return best ? { point: origin.clone().addScaledVector(dir, best.t), normal: best.normal, distance: best.t } : null;
}

/** Sprays a decal on whatever is in front of it when shown. */
export class DecalPart extends MovablePart {
  static className = 'decal';
  static icon = '🏷️';
  static category = 'effects';
  static description = 'When shown, sprays a texture onto the ground or object in front of it (+Z).';
  static removeProps = NO_AIM;
  static props = [
    prop('Material', 'asset', 'star', { options: SPRITE_TEXTURES, accept: 'image/*,.vtf', browse: 'texture' }),
    prop('Color', 'color', [1, 1, 1], { group: 'appearance' }), prop('Alpha', 'number', 1, { group: 'appearance', min: 0, max: 1, step: 0.05 }),
    prop('Width', 'number', 1, { group: 'appearance', step: 0.1 }), prop('Height', 'number', 1, { group: 'appearance', step: 0.1 }),
    prop('IgnoreOwner', 'boolean', true),
  ];
  constructor(world) { super(world); this.decals = []; }
  onShow() {
    super.onShow();
    this.offset.updateWorldMatrix(true, false);
    const hit = worldHit(this.world, this.getWorldPosition(new THREE.Vector3()), this.getWorldForward(new THREE.Vector3()), 4000);
    if (!hit) return;
    const mat = new THREE.MeshBasicMaterial({ map: getTexture(this.Material), transparent: true, opacity: this.Alpha, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    setColor(mat.color, this.Color);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(16 * this.Width, 16 * this.Height), mat);
    m.position.copy(hit.point).addScaledVector(hit.normal, 0.05);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal);
    m.raycast = () => {};
    this.world.scene.add(m);
    this.decals.push(m);
    while (this.decals.length > 32) { const d = this.decals.shift(); d.removeFromParent(); d.geometry.dispose(); d.material.dispose(); }
  }
  destroy() { for (const d of this.decals) { d.removeFromParent(); d.geometry.dispose(); d.material.dispose(); } super.destroy(); }
}
registerPart(DecalPart);

const EFFECT_PRESETS = [
  [/fire|flame|burn|torch/, { Material: 'soft', StartColor: [1, 0.8, 0.3], EndColor: [1, 0.15, 0], Gravity: [0, 60, 0], Velocity: 15, Spread: 0.4, StartSize: 6, EndSize: 1, DieTime: 0.8, FireDelay: 0.02 }],
  [/smoke|steam|fog|dust/, { Material: 'smoke', StartColor: [0.6, 0.6, 0.6], EndColor: [0.3, 0.3, 0.3], Additive: false, StartAlpha: 0.4, Gravity: [0, 30, 0], Velocity: 10, StartSize: 4, EndSize: 24, DieTime: 2.5, FireDelay: 0.06 }],
  [/spark|electric|zap|shock/, { Material: 'spark', StartColor: [1, 0.9, 0.5], EndColor: [1, 0.6, 0.2], Gravity: [0, -400, 0], Velocity: 150, Spread: 0.8, StartSize: 2, EndSize: 0.5, DieTime: 0.6, FireDelay: 0.05, NumberParticles: 3 }],
  [/blood/, { Material: 'dot', StartColor: [0.6, 0, 0], EndColor: [0.3, 0, 0], Additive: false, Gravity: [0, -500, 0], Velocity: 80, Spread: 0.6, StartSize: 2, EndSize: 1, DieTime: 1, FireDelay: 0.05 }],
  [/explo|boom|blast/, { Material: 'glow', StartColor: [1, 0.7, 0.2], EndColor: [0.4, 0.1, 0], Velocity: 200, Spread: 1, StartSize: 12, EndSize: 30, DieTime: 0.7, FireOnce: true, NumberParticles: 40 }],
  [/water|splash|rain/, { Material: 'dot', StartColor: [0.6, 0.8, 1], EndColor: [0.6, 0.8, 1], Gravity: [0, -400, 0], Velocity: 120, Spread: 0.5, StartSize: 1.5, EndSize: 1, DieTime: 1, FireDelay: 0.03, NumberParticles: 2 }],
  [/./, { Material: 'star', StartColor: [0.6, 0.8, 1], EndColor: [0.8, 0.4, 1], Velocity: 30, Spread: 1, StartSize: 3, EndSize: 0, DieTime: 1.2, FireDelay: 0.05, RandomRollSpeed: 180 }],
];
/** Source particle effects are not available; effect names pick a matching particle preset. */
const PARTICLE_LOOK = ParticlesPart.props.map((p) => p.name).filter((n) => n !== 'Follow');
export class EffectPart extends ParticlesPart {
  static className = 'effect';
  static icon = '🌟';
  static category = 'effects';
  static description = 'A particle effect by name (fire, smoke, sparks, blood, explosion, water, magic…). Source .pcf effects are approximated with built-in particles.';
  static removeProps = PARTICLE_LOOK;
  static props = [
    prop('Effect', 'string', 'default', { help: 'Effect name; keywords like fire, smoke, spark, blood, explosion or water pick the look.' }),
    prop('Loop', 'boolean', true), prop('Follow', 'boolean', true), prop('Rate', 'number', 1, { min: 0.05, step: 0.1 }),
    prop('UseParticleTracer', 'boolean', false), prop('PointA', 'part', ''), prop('PointB', 'part', ''), prop('PointC', 'part', ''), prop('PointD', 'part', ''),
  ];
  /** Fills the particle settings from the effect name (the particles constructor calls this too). */
  _apply() {
    const key = `${this.Effect}|${this.Loop}|${this.Rate}`;
    if (this._presetFor !== key) {
      this._presetFor = key;
      const [, preset] = EFFECT_PRESETS.find(([re]) => re.test(String(this.Effect).toLowerCase()));
      for (const d of ParticlesPart.props) if (d.name !== 'Follow') this[d.name] = deepClone(d.default);
      for (const [k, v] of Object.entries(preset)) this[k] = deepClone(v);
      this.FireOnce = !!preset.FireOnce || !this.Loop;
      this.FireDelay = (preset.FireDelay || 0.05) / Math.max(0.05, this.Rate || 1);
    }
    super._apply();
  }
}
registerPart(EffectPart);

/** Pixelated "censor" square that always faces the camera. */
export class CensorPart extends MovablePart {
  static className = 'censor';
  static icon = '🔲';
  static category = 'effects';
  static description = 'A pixelated censor square that faces the camera (PAC3 calls it "woohoo").';
  static removeProps = NO_AIM;
  static props = [prop('Resolution', 'number', 8, { min: 2, max: 64, integer: true }), prop('Size', 'number', 1, { step: 0.1 }), prop('FixedSize', 'boolean', true), prop('BlurFiltering', 'boolean', false), prop('Translucent', 'boolean', true)];
  constructor(world) {
    super(world);
    this.canvas = document.createElement('canvas');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.SpriteMaterial({ map: this.texture, depthTest: true });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.userData.part = this;
    this.offset.add(this.sprite);
    this._next = 0;
  }
  update(dt) {
    super.update(dt);
    if (this.hiddenNow || this.world.time < this._next) return;
    this._next = this.world.time + 0.1;
    const n = this.Resolution;
    if (this.canvas.width !== n) { this.canvas.width = this.canvas.height = n; this.texture.dispose(); }
    const x = this.canvas.getContext('2d');
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = 120 + Math.random() * 110; x.fillStyle = `rgb(${v},${v * 0.85},${v * 0.75})`; x.fillRect(i, j, 1, 1); }
    this.texture.magFilter = this.BlurFiltering ? THREE.LinearFilter : THREE.NearestFilter;
    this.texture.needsUpdate = true;
    const s = 12 * this.Size;
    this.sprite.scale.set(s, s, 1);
    this.material.transparent = this.Translucent;
  }
  destroy() { this.texture.dispose(); this.material.dispose(); super.destroy(); }
}
registerPart(CensorPart);

// ---------------------------------------------------------------- gameplay (local player and world)
/** Fires bullets (hitscan rays) forward when shown, with tracers and impacts. */
export class HitscanPart extends MovablePart {
  static className = 'hitscan';
  static icon = '🎯';
  static category = 'effects';
  static description = 'Fires bullets forward (+Z) when shown: tracers, impacts and damage_zone_hit/fire_bullets events. Pair with is_firing.';
  static removeProps = NO_AIM;
  static props = [
    prop('NumberBullets', 'number', 1, { group: 'bullet properties', min: 1, max: 50, integer: true }), prop('Spread', 'number', 0, { group: 'bullet properties', min: 0, step: 0.01 }),
    prop('SpreadX', 'number', 1, { group: 'bullet properties' }), prop('SpreadY', 'number', 1, { group: 'bullet properties' }),
    prop('Damage', 'number', 1, { group: 'bullet properties' }), prop('Force', 'number', 1000, { group: 'bullet properties' }), prop('MaxDistance', 'number', 10000, { group: 'bullet properties', min: 1 }),
    prop('DamageType', 'string', 'generic', { group: 'bullet properties' }), prop('TracerName', 'string', 'Tracer', { group: 'bullet properties' }), prop('TracerSparseness', 'number', 1, { group: 'bullet properties', integer: true, min: 1 }),
    prop('AffectSelf', 'boolean', false, { group: 'bullet properties' }), prop('ServerBullets', 'boolean', true), prop('DamageFalloff', 'boolean', false), prop('DamageFalloffDistance', 'number', 5000), prop('DamageFalloffFraction', 'number', 0.5), prop('DistributeDamage', 'boolean', false),
  ];
  constructor(world) { super(world); this.fx = []; }
  onShow() { super.onShow(); this.fire(); }
  fire() {
    const w = this.world;
    w.lastFire = w.time;
    this.offset.updateWorldMatrix(true, false);
    const o = this.getWorldPosition(new THREE.Vector3()), f = this.getWorldForward(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(right, f);
    for (let i = 0; i < this.NumberBullets; i++) {
      const d = f.clone().addScaledVector(right, (Math.random() * 2 - 1) * this.Spread * this.SpreadX).addScaledVector(up, (Math.random() * 2 - 1) * this.Spread * this.SpreadY).normalize();
      const hit = worldHit(w, o, d, this.MaxDistance);
      const end = hit ? hit.point : o.clone().addScaledVector(d, this.MaxDistance);
      if (i % this.TracerSparseness === 0) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([o, end]), new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true }));
        line.raycast = () => {};
        w.scene.add(line);
        this.fx.push({ obj: line, until: w.time + 0.08 });
      }
      if (hit) {
        const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: getTexture('spark'), color: 0xffd080, blending: THREE.AdditiveBlending, depthWrite: false }));
        spark.position.copy(hit.point);
        spark.scale.setScalar(6);
        w.scene.add(spark);
        this.fx.push({ obj: spark, until: w.time + 0.15 });
        w.damageHit = { time: w.time, damage: this.Damage, uid: this.UniqueID };
      }
    }
  }
  update(dt) {
    super.update(dt);
    const t = this.world.time;
    this.fx = this.fx.filter((e) => { if (t < e.until) return true; e.obj.removeFromParent(); e.obj.geometry && e.obj.geometry.dispose(); e.obj.material.dispose(); return false; });
  }
  destroy() { for (const e of this.fx) e.obj.removeFromParent(); this.fx = []; super.destroy(); }
}
registerPart(HitscanPart);

/** A damage area in front of the part; with AffectSelf it damages you (health in Player settings). */
export class DamageZonePart extends MovablePart {
  static className = 'damage_zone';
  static icon = '☠️';
  static category = 'effects';
  static description = 'Deals Damage inside a zone when shown (or over time). There are no other players here, so only AffectSelf has a target; it always fires damage_zone_hit events.';
  static removeProps = NO_AIM;
  static props = [
    prop('Damage', 'number', 0, { group: 'damage' }), prop('DamageType', 'string', 'generic', { group: 'damage' }), prop('DoNotKill', 'boolean', false, { group: 'damage' }), prop('CriticalHealth', 'number', 1, { group: 'damage' }),
    prop('AffectSelf', 'boolean', false, { group: 'targets' }), prop('Players', 'boolean', true, { group: 'targets' }), prop('NPC', 'boolean', true, { group: 'targets' }),
    prop('Radius', 'number', 20, { group: 'shape', min: 0 }), prop('Length', 'number', 50, { group: 'shape', min: 0 }), prop('HitboxMode', 'enum', 'Box', { group: 'shape', options: ['Box', 'Sphere', 'Cylinder', 'Cone', 'Ray'], free: true }),
    prop('DOTMode', 'boolean', false, { group: 'damage over time' }), prop('DOTTime', 'number', 0, { group: 'damage over time', min: 0 }), prop('DOTCount', 'number', 0, { group: 'damage over time', min: 0, integer: true }),
    prop('Preview', 'boolean', false, { group: 'preview' }),
  ];
  constructor(world) {
    super(world);
    this.preview = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff4040, wireframe: true, transparent: true, opacity: 0.6 }));
    this.preview.raycast = () => {};
    this.offset.add(this.preview);
  }
  _inside(p) {
    const local = this.offset.worldToLocal(p.clone());
    if (this.HitboxMode === 'Sphere') return local.length() <= this.Radius;
    return Math.abs(local.x) <= this.Radius && Math.abs(local.y) <= this.Radius && local.z >= 0 && local.z <= this.Length;
  }
  hit() {
    const w = this.world, p = w.player;
    w.damageHit = { time: w.time, damage: this.Damage, uid: this.UniqueID };
    if (!this.AffectSelf) return;
    const chest = w.avatar.getBone('spine 2').getWorldPosition(new THREE.Vector3());
    if (!this._inside(chest)) return;
    const dmg = this.Damage * (p.damageMultiplier ?? 1);
    p.health = this.DoNotKill ? Math.max(this.CriticalHealth, p.health - dmg) : Math.max(0, p.health - dmg);
    if (p.health <= 0) w.damageKill = { time: w.time, uid: this.UniqueID };
  }
  onShow() { super.onShow(); this.hit(); this._dots = 0; this._nextDot = this.world.time + this.DOTTime; }
  update(dt) {
    super.update(dt);
    const sphere = this.HitboxMode === 'Sphere';
    this.preview.visible = this.Preview && !this.hiddenNow;
    this.preview.scale.set(this.Radius * 2, this.Radius * 2, sphere ? this.Radius * 2 : this.Length);
    this.preview.position.set(0, 0, sphere ? 0 : this.Length / 2);
    if (!this.hiddenNow && this.DOTMode && this.DOTTime > 0 && this._dots < this.DOTCount && this.world.time >= this._nextDot) { this._dots++; this._nextDot = this.world.time + this.DOTTime; this.hit(); }
  }
}
registerPart(DamageZonePart);

/** Changes your health/armor and adds extra health bars while shown. */
export class HealthModifierPart extends Part {
  static className = 'health_modifier';
  static icon = '❤️';
  static category = 'modifiers';
  static description = 'Changes your max health / armor, adds extra health bars (healthmod_bar_* inputs and events) and damage multipliers while shown.';
  static props = [
    prop('ActivateOnShow', 'boolean', true), prop('ActivateOnWear', 'boolean', true),
    prop('ChangeHealth', 'boolean', false, { group: 'health' }), prop('FollowHealth', 'boolean', true, { group: 'health' }), prop('MaxHealth', 'number', 100, { group: 'health', min: 1 }),
    prop('ChangeArmor', 'boolean', false, { group: 'armor' }), prop('FollowArmor', 'boolean', true, { group: 'armor' }), prop('MaxArmor', 'number', 100, { group: 'armor', min: 0 }),
    prop('HealthBars', 'number', 0, { group: 'extra bars', min: 0, integer: true }), prop('BarsAmount', 'number', 100, { group: 'extra bars', min: 0 }), prop('BarsLayer', 'number', 1, { group: 'extra bars', integer: true }),
    prop('AbsorbFactor', 'number', 0, { group: 'extra bars' }), prop('HPBarsResetOnHide', 'boolean', false, { group: 'extra bars' }), prop('CountedHits', 'boolean', false, { group: 'extra bars' }), prop('NoOverflow', 'boolean', false, { group: 'extra bars' }), prop('FollowHealthBars', 'boolean', true, { group: 'extra bars' }),
    prop('DamageMultiplier', 'number', 1, { group: 'damage', step: 0.1 }), prop('ModifierId', 'string', '', { group: 'damage' }), prop('MultiplierResetOnHide', 'boolean', false, { group: 'damage' }),
  ];
  onShow() {
    if (!this.ActivateOnShow) return;
    const p = this.world.player;
    if (this.ChangeHealth) { p.maxHealth = this.MaxHealth; if (this.FollowHealth) p.health = this.MaxHealth; }
    if (this.ChangeArmor) { p.maxArmor = this.MaxArmor; if (this.FollowArmor) p.armor = this.MaxArmor; }
    p.damageMultiplier = this.DamageMultiplier;
    const bars = this.world.healthBars;
    const existing = bars.find((b) => b.uid === this.UniqueID);
    const value = this.HealthBars * this.BarsAmount;
    if (existing) { if (this.HPBarsResetOnHide) existing.value = value; } else if (value > 0) bars.push({ uid: this.UniqueID, name: this.Name, layer: this.BarsLayer, value });
  }
  onHide() {
    if (this.MultiplierResetOnHide) this.world.player.damageMultiplier = 1;
    if (this.HPBarsResetOnHide) this.world.healthBars = this.world.healthBars.filter((b) => b.uid !== this.UniqueID);
  }
  destroy() { this.world.healthBars = this.world.healthBars.filter((b) => b.uid !== this.UniqueID); }
}
registerPart(HealthModifierPart);

/** Pushes the player (AffectSelf / AffectPlayerOwner) inside an area. */
export class ForcePart extends MovablePart {
  static className = 'force';
  static icon = '🧲';
  static category = 'effects';
  static description = 'Pushes you while you are inside its area (or always, with AffectPlayerOwner). There are no props or other players to push here.';
  static removeProps = NO_AIM;
  static props = [
    prop('HitboxMode', 'enum', 'Sphere', { group: 'area', options: ['Box', 'Sphere'], free: true }), prop('Radius', 'number', 50, { group: 'area', min: 0 }), prop('Length', 'number', 50, { group: 'area', min: 0 }), prop('Preview', 'boolean', false, { group: 'area' }),
    prop('BaseForce', 'number', 0, { group: 'forces', help: 'Away from the part (radial).' }), prop('AddedVectorForce', 'vector', [0, 0, 0], { group: 'forces' }),
    prop('VectorForceAngleMode', 'enum', 'Global', { group: 'forces', options: ['Global', 'Local'] }),
    prop('Continuous', 'boolean', true, { group: 'behavior' }), prop('Levitation', 'boolean', false, { group: 'behavior' }), prop('LevitationHeight', 'number', 0, { group: 'behavior' }), prop('Damping', 'number', 0, { group: 'behavior', min: 0 }),
    prop('AffectSelf', 'boolean', false, { group: 'targets' }), prop('AffectPlayerOwner', 'boolean', false, { group: 'targets' }),
  ];
  _push(scale) {
    const p = this.world.player;
    if (!this.AffectSelf && !this.AffectPlayerOwner) return;
    const pos = this.getWorldPosition(new THREE.Vector3());
    const chest = this.world.avatar.getBone('spine 2').getWorldPosition(new THREE.Vector3());
    const d = chest.clone().sub(pos);
    if (!this.AffectPlayerOwner && d.length() > Math.max(this.Radius, this.HitboxMode === 'Box' ? this.Length : 0)) return;
    const f = new THREE.Vector3();
    if (this.BaseForce) f.add(d.clone().normalize().multiplyScalar(this.BaseForce));
    const v = new THREE.Vector3().fromArray(this.AddedVectorForce);
    if (this.VectorForceAngleMode === 'Local') v.applyQuaternion(this.offset.getWorldQuaternion(new THREE.Quaternion()));
    f.add(v);
    if (this.Levitation) f.y += (this.LevitationHeight - p.pos.y) * 10;
    p.vel.addScaledVector(f, scale);
    if (this.Damping) p.vel.multiplyScalar(Math.max(0, 1 - this.Damping * scale));
    if (f.y > 0) p.onGround = false;
  }
  onShow() { super.onShow(); if (!this.Continuous) this._push(0.05); }
  update(dt) { super.update(dt); if (!this.hiddenNow && this.Continuous && this.world.playMode) this._push(dt); }
}
registerPart(ForcePart);

/** Makes the parent model physical: it falls, bounces and can follow its anchor. */
export class PhysicsPart extends Part {
  static className = 'physics';
  static icon = '🪨';
  static category = 'effects';
  static description = 'Makes the parent model a physics object while shown: gravity, ground collision, constraint sphere and follow.';
  static props = [
    prop('Gravity', 'boolean', true, { group: 'behavior' }), prop('Collisions', 'boolean', true, { group: 'behavior' }), prop('ConstrainSphere', 'number', 0, { group: 'behavior', min: 0 }),
    prop('Follow', 'boolean', false, { group: 'follow' }), prop('SecondsToArrive', 'number', 0.1, { group: 'follow', min: 0.01 }), prop('MaxSpeed', 'number', 10000, { group: 'follow' }),
    prop('ConstantVelocity', 'vector', [0, 0, 0], { group: 'speeds' }), prop('InitialVelocityVector', 'vector', [0, 0, 0], { group: 'speeds' }), prop('AddOwnerSpeed', 'boolean', false, { group: 'speeds' }),
    prop('Radius', 'number', 1, { group: 'shape', min: 0 }), prop('Box', 'boolean', true, { group: 'shape' }), prop('BoxScale', 'vector', [1, 1, 1], { group: 'shape' }), prop('Mass', 'number', 100, { group: 'shape' }),
    prop('SelfCollision', 'boolean', false), prop('Pushable', 'boolean', false), prop('ThinkDelay', 'number', 1), prop('DampFactor', 'number', 1),
  ];
  onShow() {
    const p = this.parent;
    if (!p || !p.node) { this.status = 'Put this inside a model part.'; return; }
    this.status = '';
    p.node.updateWorldMatrix(true, false);
    this.pos = p.node.getWorldPosition(new THREE.Vector3());
    this.quat = p.node.getWorldQuaternion(new THREE.Quaternion());
    this.vel = new THREE.Vector3().fromArray(this.InitialVelocityVector);
    if (this.AddOwnerSpeed) this.vel.add(this.world.player.vel);
    this.active = true;
  }
  onHide() { this.active = false; if (this.parent && this.parent.applyTransform) this.parent.applyTransform(); }
  update(dt) {
    const p = this.parent;
    if (!this.active || !p || !p.node || !p.node.parent || this.hiddenNow) return;
    const anchor = p.node.parent;
    anchor.updateWorldMatrix(true, false);
    const home = new THREE.Vector3().fromArray(p.Position).applyMatrix4(anchor.matrixWorld);
    if (this.Follow) {
      const want = home.clone().sub(this.pos).divideScalar(Math.max(0.01, this.SecondsToArrive));
      if (want.length() > this.MaxSpeed) want.setLength(this.MaxSpeed);
      this.vel.lerp(want, Math.min(1, dt * 10));
    } else if (this.Gravity) this.vel.y -= 600 * dt;
    this.vel.addScaledVector(new THREE.Vector3().fromArray(this.ConstantVelocity), dt);
    this.pos.addScaledVector(this.vel, dt);
    if (this.Collisions && this.pos.y < this.Radius) { this.pos.y = this.Radius; this.vel.y = Math.abs(this.vel.y) * 0.3; this.vel.x *= 0.8; this.vel.z *= 0.8; }
    if (this.ConstrainSphere > 0 && this.pos.distanceTo(home) > this.ConstrainSphere) this.pos.sub(home).setLength(this.ConstrainSphere).add(home);
    _m.copy(anchor.matrixWorld).invert().multiply(new THREE.Matrix4().compose(this.pos, this.quat, new THREE.Vector3(1, 1, 1)));
    _m.decompose(p.node.position, p.node.quaternion, _s);
    p.node.updateMatrixWorld(true);
  }
}
registerPart(PhysicsPart);

/** Grabs or teleports you (AffectPlayerOwner) to the part. */
export class LockPart extends MovablePart {
  static className = 'lock';
  static icon = '🔒';
  static category = 'effects';
  static description = 'Grab: keeps you at this part while shown. Teleport: moves you here when shown. Only you can be grabbed here (AffectPlayerOwner).';
  static removeProps = NO_AIM;
  static props = [
    prop('Mode', 'enum', 'None', { group: 'behaviour', options: ['None', 'Grab', 'Teleport'] }), prop('OverrideAngles', 'boolean', true, { group: 'behaviour' }), prop('RelativeGrab', 'boolean', false, { group: 'behaviour' }),
    prop('RestoreDelay', 'number', 1, { group: 'behaviour' }), prop('NoCollide', 'boolean', true, { group: 'behaviour' }), prop('Radius', 'number', 20, { group: 'detection' }), prop('OffsetDownAmount', 'number', 0, { group: 'detection' }),
    prop('AffectPlayerOwner', 'boolean', false, { group: 'targets' }), prop('Players', 'boolean', false, { group: 'targets' }), prop('PhysicsProps', 'boolean', false, { group: 'targets' }), prop('NPC', 'boolean', false, { group: 'targets' }),
    prop('OverrideEyeAngles', 'boolean', false, { group: 'camera' }),
  ];
  _place() {
    const p = this.world.player;
    const pos = this.getWorldPosition(new THREE.Vector3());
    p.pos.set(pos.x, Math.max(0, pos.y - this.OffsetDownAmount), pos.z);
    p.vel.set(0, 0, 0);
    if (this.OverrideAngles || this.OverrideEyeAngles) { const f = this.getWorldForward(new THREE.Vector3()); p.eyeYaw = Math.atan2(f.x, f.z); p.bodyYaw = p.eyeYaw; }
  }
  onShow() { super.onShow(); if (this.AffectPlayerOwner && this.Mode === 'Teleport') this._place(); }
  update(dt) {
    super.update(dt);
    const grab = !this.hiddenNow && this.AffectPlayerOwner && this.Mode === 'Grab';
    if (grab) { this._place(); this.world.lockGrabbed = true; this.world.lockGrabbing = this.UniqueID; }
    else if (this.world.lockGrabbing === this.UniqueID) { this.world.lockGrabbed = false; this.world.lockGrabbing = null; }
  }
}
registerPart(LockPart);

/** PAC3 Lua script parts cannot run in a browser; the code is kept so outfits round-trip. */
export class ScriptPart extends Part {
  static className = 'script';
  static icon = '📜';
  static category = 'logic';
  static description = 'PAC3 Lua script. Kept for compatibility; Lua code cannot (and for safety should not) run in a web page.';
  static props = [prop('Code', 'text', '')];
  get status() { return 'Lua scripts do not run here.'; }
  set status(_v) {}
}
registerPart(ScriptPart);

