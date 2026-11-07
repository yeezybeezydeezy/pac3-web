// The avatar: an invisible pose rig that runs the procedural animation, mapped every frame onto a
// ValveBiped-skeleton model — the built-in mannequin (js/mannequin.js) or a Garry's Mod playermodel.
// Both use the same bone names, axes and attachments, so outfits line up the same on either.
// The character faces +Z; its left side is +X. Units are Source units (about 72 tall).
import * as THREE from 'three';
import { clamp, lerp, smoothstep, setColor } from './core/util.js';
import { getTexture } from './core/textures.js';
import { loadSourceModel, loadAnimSet, toOurs, quatToOurs, mat34ToOurs, friendlyBoneName, skinMaterial, parseModelModifiers, bodygroupModel, bodygroupList, vfs } from './source/assets.js';
import { buildMannequinAsset } from './mannequin.js';

const TAU = Math.PI * 2;
const S = Math.sin;

// Pose rig: identity rest rotations, so pose rotations are easy to write. Never rendered.
const BONE_DEFS = [
  ['pelvis', 'origin', [0, 38, 0]],
  ['spine', 'pelvis', [0, 4, 0]],
  ['chest', 'spine', [0, 8, 0]],
  ['neck', 'chest', [0, 10, 0]],
  ['head', 'neck', [0, 4, 0]],
];
for (const [side, s] of [['left', 1], ['right', -1]]) {
  BONE_DEFS.push(
    [`${side} clavicle`, 'chest', [2 * s, 7, 0]],
    [`${side} upperarm`, `${side} clavicle`, [6.5 * s, 0, 0]],
    [`${side} forearm`, `${side} upperarm`, [0, -11, 0]],
    [`${side} hand`, `${side} forearm`, [0, -10, 0]],
    [`${side} thigh`, 'pelvis', [4 * s, -2, 0]],
    [`${side} calf`, `${side} thigh`, [0, -17, 0]],
    [`${side} foot`, `${side} calf`, [0, -16.5, 0]],
    [`${side} toe`, `${side} foot`, [0, -1.5, 5]],
  );
}
const BONE_NAMES = ['origin', ...BONE_DEFS.map((b) => b[0])];

// Rig bone -> ValveBiped friendly name; limbs also get a rest-direction correction (A/T-pose arms).
const RIG_TO_VB = { pelvis: 'pelvis', spine: 'spine', chest: 'spine 2', neck: 'neck', head: 'head' };
const LIMB_CHILD = {};
for (const s of ['left', 'right']) {
  for (const b of ['clavicle', 'upperarm', 'forearm', 'hand', 'thigh', 'calf', 'foot', 'toe']) RIG_TO_VB[`${s} ${b}`] = `${s} ${b}`;
  Object.assign(LIMB_CHILD, { [`${s} upperarm`]: `${s} forearm`, [`${s} forearm`]: `${s} hand`, [`${s} thigh`]: `${s} calf`, [`${s} calf`]: `${s} foot`, [`${s} foot`]: `${s} toe` });
}
// Names some outfits use that a given model may lack.
const ALIASES = {
  chest: 'spine 2', 'spine 4': 'spine 2', 'spine 1': 'spine', eyes: 'head', mouth: 'head', nose: 'head', forward: 'pelvis',
  'attach head': 'head', 'anim attachment head': 'head', 'hit position': 'eyes', lefteye: 'eyes', righteye: 'eyes',
  'attach right hand': 'right hand', 'attach left hand': 'left hand', 'anim attachment right hand': 'right hand', 'anim attachment left hand': 'left hand',
};
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v1 = new THREE.Vector3();

/**
 * Rest skeleton of a Source model in our axes. Playermodels are stored facing sideways (their
 * animations turn them), so the roots are turned until the model's left side points along +X.
 */
function skeletonOf(mdl) {
  const n = mdl.bones.length;
  const local = mdl.bones.map((b) => ({ pos: new THREE.Vector3().fromArray(toOurs(b.pos)), quat: quatToOurs(b.quat) }));
  const byName = new Map(mdl.bones.map((b, i) => [friendlyBoneName(b.name), i]));
  const world = () => {
    const worldQ = [], worldP = [];
    for (let i = 0; i < n; i++) {
      const p = mdl.bones[i].parent;
      worldQ[i] = p >= 0 ? worldQ[p].clone().multiply(local[i].quat) : local[i].quat.clone();
      worldP[i] = p >= 0 ? local[i].pos.clone().applyQuaternion(worldQ[p]).add(worldP[p]) : local[i].pos.clone();
    }
    return { worldQ, worldP };
  };
  let { worldQ, worldP } = world();
  const l = byName.get('left thigh') ?? byName.get('left upperarm'), r = byName.get('right thigh') ?? byName.get('right upperarm');
  if (l != null && r != null) {
    const left = worldP[l].clone().sub(worldP[r]);
    const yaw = Math.atan2(left.z, left.x);
    if (Math.abs(yaw) > 0.01) {
      const R0 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      mdl.bones.forEach((b, i) => { if (b.parent < 0) { local[i].pos.applyQuaternion(R0); local[i].quat.premultiply(R0); } });
      ({ worldQ, worldP } = world());
    }
  }
  return { local, worldQ, worldP, byName };
}

// ---------- pose helpers ----------
function blankPose() {
  const p = {};
  for (const n of BONE_NAMES) p[n] = { r: [0, 0, 0], p: [0, 0, 0] };
  return p;
}
function resetPose(p) { for (const n in p) { const b = p[n]; b.r[0] = b.r[1] = b.r[2] = b.p[0] = b.p[1] = b.p[2] = 0; } }
const Q = (pose) => ({
  r(b, x = 0, y = 0, z = 0) { const t = pose[b].r; t[0] += x; t[1] += y; t[2] += z; return this; },
  p(b, x = 0, y = 0, z = 0) { const t = pose[b].p; t[0] += x; t[1] += y; t[2] += z; return this; },
  // mirrored: left side as given, right side with y/z rotation flipped
  m(b, x = 0, y = 0, z = 0) { this.r(`left ${b}`, x, y, z); return this.r(`right ${b}`, x, -y, -z); },
});

function gait(q, ph, w, run, crouch = 0) {
  const s = S(ph), c = Math.cos(ph);
  const amp = lerp(0.55, 0.85, run) * lerp(1, 0.6, crouch);
  const knee = lerp(0.85, 1.6, run);
  q.r('left thigh', -s * amp * w).r('right thigh', s * amp * w);
  q.r('left calf', (0.1 + Math.max(0, c) * knee) * w).r('right calf', (0.1 + Math.max(0, -c) * knee) * w);
  q.r('left foot', s * 0.2 * w).r('right foot', -s * 0.2 * w);
  const arm = lerp(0.45, 0.9, run);
  q.r('left upperarm', s * arm * w).r('right upperarm', -s * arm * w);
  q.m('forearm', -lerp(0.2, 1.3, run) * w);
  q.p('pelvis', 0, (Math.abs(c) - 0.6) * lerp(1.2, 2.6, run) * w, 0);
  q.r('spine', lerp(0, 0.15, run) * w, s * 0.12 * w).r('pelvis', 0, -s * 0.1 * w);
}
function crouchPose(q, k) {
  q.p('pelvis', 0, -16 * k, -1.5 * k);
  q.m('thigh', -1.25 * k).m('calf', 2.1 * k).m('foot', -0.85 * k);
  q.r('spine', 0.35 * k).r('head', -0.3 * k);
  q.m('upperarm', -0.35 * k).m('forearm', -0.5 * k);
}
function airPose(q, k) { q.m('thigh', -0.5 * k).m('calf', 0.9 * k).m('upperarm', -0.3 * k, 0, 0.5 * k).m('forearm', -0.4 * k); }

// Animation sequences: speed = cycles per second at Rate 1, fn(cycle 0..1, q).
export const SEQUENCES = {
  idle: { speed: 0.25, fn: (c, q) => q.r('chest', S(c * TAU) * 0.03).m('upperarm', 0, 0, 0.08).m('forearm', -0.12) },
  walk: { speed: 0.9, fn: (c, q) => gait(q, c * TAU, 1, 0) },
  run: { speed: 1.4, fn: (c, q) => gait(q, c * TAU, 1, 1) },
  crouch: { speed: 0.25, fn: (c, q) => crouchPose(q, 1) },
  crouch_walk: { speed: 0.8, fn: (c, q) => { crouchPose(q, 1); gait(q, c * TAU, 1, 0, 1); } },
  jump: { speed: 1, fn: (c, q) => airPose(q, 1) },
  tpose: { speed: 0, fn: (c, q) => q.m('upperarm', 0, 0, Math.PI / 2) },
  apose: { speed: 0, fn: (c, q) => q.m('upperarm', 0, 0, 0.75) },
  wave: { speed: 1, fn: (c, q) => q.r('right upperarm', 0, 0, -2.5).r('right forearm', 0, 0, -0.35 + S(c * TAU * 2) * 0.45).r('head', 0, -0.2).m('upperarm', 0, 0, 0).r('left upperarm', 0, 0, 0.08) },
  cheer: { speed: 1.2, fn: (c, q) => { const b = Math.abs(S(c * TAU)); q.m('upperarm', 0, 0, 2.6 + b * 0.25).m('forearm', 0, 0, 0.2).p('pelvis', 0, b * 2.5).r('head', -0.25); } },
  dance: { speed: 0.9, fn: (c, q) => {
    const a = c * TAU, b = Math.abs(S(a * 2));
    q.p('pelvis', S(a) * 2.5, -b * 2.5).r('pelvis', 0, 0, S(a) * 0.12).r('chest', 0, S(a) * 0.2, -S(a) * 0.2);
    q.r('left upperarm', -0.5, 0, 1.2 + S(a) * 0.8).r('right upperarm', -0.5, 0, -1.2 + S(a) * 0.8);
    q.m('forearm', -1.4).r('head', 0, 0, S(a * 2) * 0.15).m('thigh', -0.3 * b).m('calf', 0.6 * b);
  } },
  robot: { speed: 0.5, fn: (c, q) => {
    const k = Math.floor(c * 8) / 8, a = k * TAU;
    q.r('left upperarm', -1.5 * (S(a) > 0 ? 1 : 0.2)).r('right upperarm', -1.5 * (S(a) > 0 ? 0.2 : 1)).m('forearm', -1.57);
    q.r('head', 0, Math.round(S(a * 2)) * 0.6).r('chest', 0, Math.round(S(a)) * 0.3);
  } },
  salute: { speed: 0, fn: (c, q) => q.r('right upperarm', -0.3, 0, -1.4).r('right forearm', 0, 0, -2.3).r('left upperarm', 0, 0, 0.05) },
  point: { speed: 0, fn: (c, q) => q.r('right upperarm', -1.5, 0, -0.1).r('head', 0, -0.15) },
  flex: { speed: 0.5, fn: (c, q) => q.m('upperarm', 0, 0, 1.5).m('forearm', 0, 0, 1.64 + S(c * TAU) * 0.15).r('chest', -0.05 - S(c * TAU) * 0.03) },
  zombie: { speed: 0.6, fn: (c, q) => q.m('upperarm', -1.45, 0, -0.05).r('head', 0.2, 0, 0.3 + S(c * TAU) * 0.1).r('spine', 0.15, S(c * TAU) * 0.1) },
  sit: { speed: 0.2, fn: (c, q) => q.p('pelvis', 0, -17, -2).m('thigh', -1.57).m('calf', 1.57).m('upperarm', -0.3).m('forearm', -0.9).r('chest', S(c * TAU) * 0.02) },
  sit_ground: { speed: 0.2, fn: (c, q) => q.p('pelvis', 0, -33.5).m('thigh', -1.35, 0, 0.25).m('calf', 1.7).m('upperarm', -0.6, 0, 0.1).m('forearm', -0.6) },
  lay: { speed: 0.2, fn: (c, q) => q.p('pelvis', 0, -34, 0).r('pelvis', -Math.PI / 2).m('upperarm', 0, 0, 0.3).r('chest', S(c * TAU) * 0.02) },
  fly: { speed: 0.5, fn: (c, q) => q.p('pelvis', 0, 4 + S(c * TAU) * 2).r('pelvis', 1.3).r('head', -1.0).r('right upperarm', -2.9).r('left upperarm', 0, 0, 0.15).m('thigh', 0.1 + S(c * TAU) * 0.05) },
  swim: { speed: 0.6, fn: (c, q) => {
    const a = c * TAU;
    q.p('pelvis', 0, 6).r('pelvis', 1.4).r('head', -1.0).r('left upperarm', -a).r('right upperarm', -a - Math.PI);
    q.r('left thigh', S(a * 3) * 0.3).r('right thigh', -S(a * 3) * 0.3);
  } },
  bow: { speed: 0.4, fn: (c, q) => { const k = smoothstep(0, 0.3, c) * (1 - smoothstep(0.7, 1, c)); q.r('spine', 0.6 * k).r('chest', 0.4 * k).r('head', 0.3 * k).r('right upperarm', -0.4 * k).r('right forearm', -1.4 * k); } },
  clap: { speed: 2, fn: (c, q) => { const k = Math.abs(S(c * TAU)) * 0.35; q.m('upperarm', -1.0, 0, -0.1).m('forearm', -0.6, 0, -0.7 + k); } },
  headbang: { speed: 2, fn: (c, q) => { const k = S(c * TAU); q.r('head', 0.25 + k * 0.45).r('neck', 0.1 + k * 0.2).m('thigh', -0.15 * Math.abs(k)).m('calf', 0.3 * Math.abs(k)).p('pelvis', 0, -Math.abs(k) * 1.5); } },
  facepalm: { speed: 0, fn: (c, q) => q.r('right upperarm', -0.9, 0, -0.35).r('right forearm', -2.3, 0, 0.6).r('head', 0.35) },
};
export const SEQUENCE_NAMES = Object.keys(SEQUENCES);

// Built-in names -> Garry's Mod player sequences (used when game content is mounted).
const TO_SOURCE = {
  idle: 'idle_all_01', walk: 'walk_all', run: 'run_all_01', crouch: 'cidle_all', crouch_walk: 'cwalk_all', jump: 'jump_slam', fly: 'swimming_all', swim: 'swimming_all',
  dance: 'taunt_dance', robot: 'taunt_robot', cheer: 'taunt_cheer', salute: 'gesture_salute', flex: 'taunt_muscle', zombie: 'taunt_zombie', wave: 'gesture_wave',
  bow: 'gesture_bow', clap: 'taunt_laugh', point: 'gesture_signal_forward', sit: 'sit_rollercoaster', sit_ground: 'sit_zen', lay: 'sit_zen', headbang: 'taunt_persistence', facepalm: 'gesture_disagree',
};
// Source sequence names -> closest built-in procedural animation (when no game content is mounted).
const PROC_WORDS = [['cwalk', 'crouch_walk'], ['cidle', 'crouch'], ['dance', 'dance'], ['robot', 'robot'], ['wave', 'wave'], ['cheer', 'cheer'], ['salute', 'salute'], ['zombie', 'zombie'], ['sit', 'sit'], ['bow', 'bow'], ['laugh', 'clap'], ['muscle', 'flex'], ['persistence', 'headbang'], ['point', 'point'], ['signal', 'point'], ['swim', 'swim'], ['fly', 'fly'], ['lay', 'lay'], ['run', 'run'], ['walk', 'walk'], ['crouch', 'crouch'], ['jump', 'jump'], ['idle', 'idle']];
export function proceduralSequence(name) {
  const n = String(name || '').toLowerCase();
  if (Object.hasOwn(SEQUENCES, n)) return SEQUENCES[n];
  const hit = PROC_WORDS.find(([w]) => n.includes(w));
  return hit ? SEQUENCES[hit[1]] : null;
}
function blendBone(dPos, dQuat, sPos, sQuat, i, w) {
  for (let k = 0; k < 3; k++) dPos[i * 3 + k] += (sPos[i * 3 + k] - dPos[i * 3 + k]) * w;
  const o = i * 4;
  let bx = sQuat[o], by = sQuat[o + 1], bz = sQuat[o + 2], bw = sQuat[o + 3];
  if (dQuat[o] * bx + dQuat[o + 1] * by + dQuat[o + 2] * bz + dQuat[o + 3] * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
  const x = dQuat[o] + (bx - dQuat[o]) * w, y = dQuat[o + 1] + (by - dQuat[o + 1]) * w, z = dQuat[o + 2] + (bz - dQuat[o + 2]) * w, ww = dQuat[o + 3] + (bw - dQuat[o + 3]) * w;
  const l = Math.hypot(x, y, z, ww) || 1;
  dQuat[o] = x / l; dQuat[o + 1] = y / l; dQuat[o + 2] = z / l; dQuat[o + 3] = ww / l;
}

export class Avatar {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'avatar';
    scene.add(this.root);
    // invisible pose rig
    this.rig = { origin: new THREE.Group() };
    this.rig.origin.name = 'pose rig';
    this.root.add(this.rig.origin);
    this.rest = {};
    for (const [name, parent, pos] of BONE_DEFS) {
      const b = new THREE.Object3D();
      b.name = name;
      b.position.fromArray(pos);
      this.rig[parent].add(b);
      this.rig[name] = b;
      this.rest[name] = new THREE.Vector3().fromArray(pos);
    }
    this.rest.origin = new THREE.Vector3();
    this._rigRest = {};
    for (const n of BONE_NAMES) { const v = new THREE.Vector3(); for (let b = this.rig[n]; b && b !== this.rig.origin; b = b.parent) v.add(this.rest[b.name]); this._rigRest[n] = v; }
    this.pose = blankPose();
    this._tmp = blankPose();
    this.time = 0;
    this.phase = 0;
    this.crouch = 0;
    this.air = 0;
    this.walk = 0;
    this._lastStepSign = 0;
    this.currentAnimation = 'idle';
    this.onFootstep = null;
    this.onBonesChanged = null;
    this._appearanceKey = '';
    this.playerModelStatus = '';
    this.mannequin = buildMannequinAsset();
    this._buildSource(this.mannequin, 0);
  }

  // ---------- bones ----------
  getBone(name) {
    const n = this.source.named;
    return n.get(name) || n.get(ALIASES[name]) || n.get(ALIASES[ALIASES[name]]) || this.root;
  }
  getBoneNames() { return [...this.source.named.keys()]; }
  /**
   * A frame on a bone whose axes match the avatar's (X left, Y up, Z forward) in the rest pose.
   * Outfits with CoordinateSpace "web" attach here; "source" outfits attach to the bone itself.
   */
  getWebFrame(name) {
    const bone = this.getBone(name);
    if (bone === this.root) return this.root;
    let f = this._webFrames.get(bone);
    if (!f) {
      f = new THREE.Group();
      f.name = `${bone.name} (web frame)`;
      f.quaternion.copy(this.source.restQ.get(bone) || new THREE.Quaternion()).invert();
      bone.add(f);
      this._webFrames.set(bone, f);
    }
    return f;
  }
  getWebFrameQuat(name) { return this.getWebFrame(name).quaternion; }

  // ---------- models ----------
  /** Uses a Garry's Mod playermodel (.mdl from mounted content); '' = the built-in mannequin. */
  async setPlayerModel(path, skin = 0, modifiers = '') {
    if (!path) this.playerModelStatus = '';
    const key = path ? `${path}#${skin}#${modifiers}` : '';
    if (key === this._pmKey) return;
    this._pmKey = key;
    const token = (this._pmToken = (this._pmToken || 0) + 1);
    this.playerModelStatus = '';
    if (!path) { this._buildSource(this.mannequin, 0); return; }
    try {
      const asset = await loadSourceModel(path);
      if (token !== this._pmToken) return;
      this._buildSource(asset, skin, modifiers);
    } catch (e) {
      if (token !== this._pmToken) return;
      this.playerModelStatus = e.message; // retried when new game content is mounted (reloadAnimations)
      this._buildSource(this.mannequin, 0);
    }
  }
  getBodygroups() { return this.source ? bodygroupList(this.source.asset.mdl) : []; }

  _buildSource(asset, skin, modifiers = '') {
    if (this.source && this.source.asset === asset && this.source.skin === skin && this.source.modifiers === modifiers) return;
    if (this.source) { this.source.group.removeFromParent(); for (const m of this.source.meshes) m.material.dispose(); }
    const { mdl } = asset;
    const skel = skeletonOf(mdl);
    const group = new THREE.Group();
    group.name = 'model';
    const bones = mdl.bones.map((b, i) => { const o = new THREE.Bone(); o.name = b.name; o.position.copy(skel.local[i].pos); o.quaternion.copy(skel.local[i].quat); return o; });
    mdl.bones.forEach((b, i) => (b.parent >= 0 ? bones[b.parent] : group).add(bones[i]));
    const skeleton = new THREE.Skeleton(bones, mdl.bones.map((b) => mat34ToOurs(b.poseToBone)));
    const meshes = [];
    const mods = parseModelModifiers(modifiers);
    if (mods.skin != null) skin = mods.skin;
    for (const g of asset.geoms) {
      if (g.model !== bodygroupModel(mdl, g.bodyPart, mods)) continue;
      const desc = asset.descs[skinMaterial(mdl, g.material, skin)] || {};
      const mat = new THREE.MeshStandardMaterial({
        map: desc.map || null, normalMap: desc.normalMap || null, alphaTest: desc.alphaTest || 0, transparent: !!desc.translucent,
        roughness: desc.roughness ?? (desc.phong ? 0.45 : 0.75), metalness: desc.metalness ?? 0, side: desc.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      });
      if (desc.normalMap) mat.normalScale.set(1, -1);
      if (desc.color) mat.color.setRGB(desc.color[0], desc.color[1], desc.color[2], THREE.SRGBColorSpace);
      if (desc.selfIllum) { mat.emissive.copy(mat.color); mat.emissiveMap = desc.map || null; }
      const mesh = new THREE.SkinnedMesh(g.geometry, mat);
      mesh.bind(skeleton, new THREE.Matrix4());
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.materialName = desc.name || '';
      group.add(mesh);
      meshes.push(mesh);
    }
    const named = new Map([['origin', this.root]]);
    const restQ = new Map();
    bones.forEach((b, i) => { restQ.set(b, skel.worldQ[i]); const f = friendlyBoneName(mdl.bones[i].name); if (f && !named.has(f)) named.set(f, b); });
    for (const a of mdl.attachments) {
      const f = friendlyBoneName(a.name);
      if (!f || named.has(f) || !bones[a.bone]) continue;
      const o = new THREE.Object3D();
      o.name = a.name;
      mat34ToOurs(a.matrix).decompose(o.position, o.quaternion, o.scale);
      bones[a.bone].add(o);
      named.set(f, o);
      restQ.set(o, skel.worldQ[a.bone].clone().multiply(o.quaternion));
    }
    this.root.add(group);
    const map = [];
    for (const [m, vb] of Object.entries(RIG_TO_VB)) { const i = skel.byName.get(vb); if (i != null) map[i] = m; }
    const pelvis = skel.byName.get('pelvis');
    this.source = {
      asset, skin, modifiers, group, bones, meshes, named, restQ, skel, map, C: this._corrections(skel),
      heightScale: pelvis != null ? skel.worldP[pelvis].y / 38 : 1,
      parents: mdl.bones.map((b) => b.parent),
      worldQ: bones.map(() => new THREE.Quaternion()),
    };
    this._webFrames = new Map();
    this._appearanceKey = '';
    this._loadAnims();
    if (this.onBonesChanged) this.onBonesChanged();
  }

  // ---------- Source animations ----------
  /** Loads the active model's animation sets (its $includemodel files, then the standard male set). */
  async _loadAnims() {
    const src = this.source;
    const token = (this._animToken = (this._animToken || 0) + 1);
    this.anim = null;
    this._seqCache = new Map();
    if (!vfs.mounted) return;
    const paths = [...new Set([...(src.asset.mdl.includes || []), 'models/m_anm.mdl'])];
    const sets = [];
    for (const p of paths) { try { sets.push(await loadAnimSet(p)); } catch { /* not in mounted content */ } }
    if (token !== this._animToken || this.source !== src || !sets.length) return;
    const T = src.bones.length;
    const index = new Map(src.asset.mdl.bones.map((b, i) => [b.name.toLowerCase(), i]));
    const pelvis = src.skel.byName.get('pelvis');
    const anim = { sets: [], pos: new Float32Array(T * 3), quat: new Float32Array(T * 4), tmpPos: new Float32Array(T * 3), tmpQuat: new Float32Array(T * 4), prevPos: new Float32Array(T * 3), prevQuat: new Float32Array(T * 4), blend: 1, cycle: 0 };
    for (const set of sets) {
      // per-model view of a shared, cached set: bone mapping and height scale
      const map = new Int32Array(T).fill(-1);
      set.bones.forEach((b, j) => { const i = index.get(b.name.toLowerCase()); if (i != null) map[i] = j; });
      const ap = set.bones.find((b) => /pelvis/i.test(b.name));
      anim.sets.push({ ...set, map, heightScale: pelvis != null && ap && ap.pos[2] > 1 ? src.skel.worldP[pelvis].y / ap.pos[2] : 1 });
    }
    this.anim = anim;
    this._srcState = '';
  }
  /** After new game content is mounted: reload animations and retry a playermodel that failed. */
  reloadAnimations() { if (this.playerModelStatus) this._pmKey = null; this._loadAnims(); }
  /** Sequence names usable by animation parts (Source ones when game content is mounted). */
  getSequenceNames() {
    const out = new Set(SEQUENCE_NAMES);
    if (this.anim) for (const set of this.anim.sets) for (const s of set.seqs.values()) if (!/(_layer|^aimlayer|_original$|_base$|^@|_pelvis)/.test(s.name.toLowerCase())) out.add(s.name);
    return [...out];
  }
  /** Finds a Source sequence by name (or the GMod equivalent of a built-in name); taunts use their full-body layer. */
  resolveSequence(name) {
    if (!this.anim) return null;
    const n = String(name || '').toLowerCase();
    if (this._seqCache.has(n)) return this._seqCache.get(n);
    let hit = null;
    for (const cand of [n, TO_SOURCE[n]]) {
      if (!cand || hit) continue;
      for (const set of this.anim.sets) {
        const empty = (q) => q && set.anims[q.grid[0]] && set.anims[q.grid[0]].flags & 0x20;
        let s = set.seqs.get(cand);
        if (s && (empty(s) || s.delta)) s = set.seqs.get(`${cand}_base`) || set.seqs.get(`${cand}_original`) || set.seqs.get(`${cand}_base_layer`) || (s.delta ? null : s);
        if (s && !empty(s)) { hit = { set, seq: s }; break; }
      }
    }
    this._seqCache.set(n, hit);
    return hit;
  }
  /** Writes a Source pose into target-skeleton arrays (rotations from the animation, proportions from the model). */
  _toTarget(set, pose, outPos, outQuat) {
    const S2 = this.source, map = set.map;
    for (let i = 0; i < S2.bones.length; i++) {
      const j = map[i], L = S2.skel.local[i];
      if (j < 0) { L.pos.toArray(outPos, i * 3); L.quat.toArray(outQuat, i * 4); continue; }
      const q = pose.quat;
      outQuat[i * 4] = q[j * 4 + 1]; outQuat[i * 4 + 1] = q[j * 4 + 2]; outQuat[i * 4 + 2] = q[j * 4]; outQuat[i * 4 + 3] = q[j * 4 + 3];
      if (S2.parents[i] < 0) {
        const p = pose.pos, hs = set.heightScale;
        outPos[i * 3] = p[j * 3 + 1] * hs; outPos[i * 3 + 1] = p[j * 3 + 2] * hs; outPos[i * 3 + 2] = p[j * 3] * hs;
      } else L.pos.toArray(outPos, i * 3);
    }
  }
  _sourceAnimate(dt, player, anims, world) {
    const A = this.anim, S2 = this.source, T = S2.bones.length;
    const speed = Math.hypot(player.vel.x, player.vel.z);
    const sy = Math.sin(player.bodyYaw), cy = Math.cos(player.bodyYaw);
    const fwd = player.vel.x * sy + player.vel.z * cy, left = player.vel.x * cy - player.vel.z * sy;
    const noclip = world && world.playMode && world.fx.movement && world.fx.movement.noclip;
    const state = noclip && !player.onGround ? 'fly' : !player.onGround ? 'jump' : player.crouching ? (speed > 10 ? 'crouch_walk' : 'crouch') : speed > 10 ? (speed > 130 ? 'run' : 'walk') : 'idle';
    const base = this.resolveSequence(state);
    if (!base) return false;
    const params = { move_x: speed > 1 ? fwd / speed : 0, move_y: speed > 1 ? left / speed : 0, vertical_velocity: Math.max(-1, Math.min(1, player.vel.y / 300)) };
    const moving = (s) => /walk|run|fly/.test(s);
    if (state !== this._srcState) {
      // ease from the pose we were in
      A.prevPos.set(A.pos);
      A.prevQuat.set(A.quat);
      A.blend = this._srcState ? 0 : 1;
      if (!moving(state) || !moving(this._srcState)) A.cycle = 0;
      this._srcState = state;
    }
    const gs = base.set.groundSpeed(base.seq);
    const rate = moving(state) && gs > 1 ? Math.min(3, Math.max(0.3, speed / gs)) : 1;
    const prevCycle = A.cycle;
    A.cycle = (A.cycle + (dt * rate) / base.set.duration(base.seq)) % 1;
    this._toTarget(base.set, base.set.pose(base.seq, A.cycle, params), A.pos, A.quat);
    this.currentAnimation = base.seq.name;

    for (const a of anims) {
      const r = this.resolveSequence(a.SequenceName);
      if (!r) continue;
      const P = r.set.pose(r.seq, a.cycle(1 / r.set.duration(r.seq)), params);
      this._toTarget(r.set, P, A.tmpPos, A.tmpQuat);
      const w = clamp(a.Weight, 0, 1);
      const wl = r.seq.weights;
      for (let i = 0; i < T; i++) {
        const j = r.set.map[i];
        const wi = w * (wl && j >= 0 ? wl[j] : 1);
        if (j >= 0 && wi > 0) blendBone(A.pos, A.quat, A.tmpPos, A.tmpQuat, i, wi);
      }
      this.currentAnimation = r.seq.name;
    }
    if (A.blend < 1) {
      A.blend = Math.min(1, A.blend + dt / 0.2);
      const t = A.blend * A.blend * (3 - 2 * A.blend);
      A.tmpPos.set(A.pos);
      A.tmpQuat.set(A.quat);
      A.pos.set(A.prevPos);
      A.quat.set(A.prevQuat);
      for (let i = 0; i < T; i++) blendBone(A.pos, A.quat, A.tmpPos, A.tmpQuat, i, t);
    }
    for (let i = 0; i < T; i++) {
      const b = S2.bones[i];
      b.position.fromArray(A.pos, i * 3);
      b.quaternion.fromArray(A.quat, i * 4);
      b.scale.set(1, 1, 1);
    }
    // look where the player looks
    this.root.updateMatrixWorld(true);
    let dyaw = player.eyeYaw - player.bodyYaw;
    dyaw = clamp(Math.atan2(Math.sin(dyaw), Math.cos(dyaw)), -1.3, 1.3);
    const pitch = clamp(player.eyePitch, -1.2, 1.2);
    if (Math.abs(dyaw) > 1e-3 || Math.abs(pitch) > 1e-3) {
      const rq = this.root.quaternion, rqi = rq.clone().invert();
      for (const [name, k] of [['neck', 0.35], ['head', 0.65]]) {
        const b = S2.named.get(name);
        if (!b || !b.isBone || !b.parent) continue;
        const look = _q1.setFromEuler(new THREE.Euler(pitch * k, dyaw * k, 0, 'YXZ'));
        const wq = b.getWorldQuaternion(new THREE.Quaternion());
        const target = rq.clone().multiply(look).multiply(rqi).multiply(wq);
        b.quaternion.copy(b.parent.getWorldQuaternion(_q2).invert().multiply(target));
        b.updateMatrixWorld(true);
      }
    }
    // footsteps twice per walk/run cycle
    if (/walk|run/.test(state) && player.onGround && Math.floor(A.cycle * 2) !== Math.floor(prevCycle * 2) && this.onFootstep) this.onFootstep();
    S2.group.visible = !this.hidden;
    return true;
  }

  /** Rotations turning a model's rest limb directions into the rig's (arms down instead of A/T-pose). */
  _corrections(skel) {
    const C = {};
    for (const m of BONE_NAMES) {
      const si = skel.byName.get(RIG_TO_VB[m]);
      const child = LIMB_CHILD[m];
      const ci = child ? skel.byName.get(RIG_TO_VB[child]) : undefined;
      if (si != null && ci != null) {
        const ds = skel.worldP[ci].clone().sub(skel.worldP[si]).normalize();
        const dm = this._rigRest[child].clone().sub(this._rigRest[m]).normalize();
        C[m] = new THREE.Quaternion().setFromUnitVectors(ds, dm);
      } else if (/(hand|toe)$/.test(m) && this.rig[m]) C[m] = (C[this.rig[m].parent.name] || new THREE.Quaternion()).clone();
      else C[m] = new THREE.Quaternion();
    }
    return C;
  }

  /** Copies the rig's animation onto the model's skeleton. */
  _retarget() {
    const S2 = this.source;
    const rootInv = _q2.copy(this.root.quaternion).invert();
    const worldQ = S2.worldQ;
    for (let i = 0; i < S2.bones.length; i++) {
      const b = S2.bones[i], p = S2.parents[i];
      b.position.copy(S2.skel.local[i].pos);
      b.scale.set(1, 1, 1);
      const m = S2.map[i];
      if (m) {
        this.rig[m].getWorldQuaternion(_q1).premultiply(rootInv);
        const target = _q1.multiply(S2.C[m]).multiply(S2.skel.worldQ[i]);
        b.quaternion.copy(p >= 0 ? worldQ[p].clone().invert().multiply(target) : target);
        worldQ[i].copy(target);
        if (m === 'pelvis') { const d = this.pose.pelvis.p; b.position.add(_v1.set(d[0], d[1], d[2]).multiplyScalar(S2.heightScale)); }
      } else {
        b.quaternion.copy(S2.skel.local[i].quat);
        worldQ[i].copy(p >= 0 ? worldQ[p] : new THREE.Quaternion()).multiply(b.quaternion);
      }
    }
  }

  // ---------- appearance ----------
  /** Entity part settings (or defaults when none is active). */
  setAppearance(a) {
    this.setPlayerModel(a.model || '', a.skin || 0, a.modifiers || '');
    const key = JSON.stringify(a) + (this._pmKey || '') + this.source.skin;
    if (key === this._appearanceKey) return;
    this._appearanceKey = key;
    this._applyMaterials(a);
    this.hidden = a.hide;
    this.scale = [a.size * a.scale[0], a.size * a.scale[1], a.size * a.scale[2]];
  }
  /** Entity color/alpha/material plus material parts (matched by MaterialOverride). */
  _applyMaterials(a) {
    const c = new THREE.Color();
    for (const mesh of this.source.meshes) {
      const m = mesh.material;
      const o = (mesh.userData.orig ||= { map: m.map, normalMap: m.normalMap, color: m.color.clone(), emissive: m.emissive.clone(), emissiveMap: m.emissiveMap, roughness: m.roughness, metalness: m.metalness, transparent: m.transparent });
      const mp = (a.materials || []).find((x) => x.matches(mesh.userData.materialName)) || null;
      m.map = mp && mp.BaseTexture ? getTexture(mp.BaseTexture) : a.material ? getTexture(a.material) : o.map;
      m.normalMap = mp && mp.BumpMap ? getTexture(mp.BumpMap, { linear: true }) : o.normalMap;
      if (m.normalMap) m.normalScale.set(1, -1);
      m.color.copy(o.color).multiply(setColor(c, a.color, a.brightness));
      if (mp) m.color.multiply(setColor(c, mp.Color));
      m.roughness = mp ? mp.Roughness : o.roughness;
      m.metalness = mp ? mp.Metalness : o.metalness;
      if (mp) { setColor(m.emissive, mp.Emissive, mp.EmissiveIntensity); m.emissiveMap = null; } else { m.emissive.copy(o.emissive); m.emissiveMap = o.emissiveMap; }
      m.opacity = a.alpha * (mp ? mp.Alpha : 1);
      m.transparent = o.transparent || m.opacity < 1;
      m.depthWrite = m.opacity >= 1;
      m.wireframe = a.wireframe || !!(mp && mp.Wireframe);
      const sig = `${!!m.map}|${!!m.normalMap}|${!!m.emissiveMap}|${m.transparent}`;
      if (sig !== mesh.userData.sig) { mesh.userData.sig = sig; m.needsUpdate = true; }
    }
  }

  // ---------- animation ----------
  update(dt, player, anims, world) {
    this.time += dt;
    this.root.position.copy(player.pos);
    this.root.rotation.set(0, player.bodyYaw, 0);
    const sc = this.scale || [1, 1, 1];
    this.root.scale.set(sc[0], sc[1], sc[2]);
    if (this.anim && this._sourceAnimate(dt, player, anims, world)) return;
    const P = this.pose;
    resetPose(P);
    const q = Q(P);

    // locomotion
    const speed = Math.hypot(player.vel.x, player.vel.z);
    const fwd = player.vel.x * Math.sin(player.bodyYaw) + player.vel.z * Math.cos(player.bodyYaw);
    const k = 1 - Math.exp(-dt * 12);
    this.crouch += ((player.crouching ? 1 : 0) - this.crouch) * k;
    this.air += ((player.onGround ? 0 : 1) - this.air) * (1 - Math.exp(-dt * 10));
    this.walk += (clamp(speed / 110, 0, 1) - this.walk) * k;
    const run = smoothstep(170, 300, speed);
    this.phase += dt * (speed / lerp(58, 90, run)) * TAU * (fwd < -10 ? -1 : 1);
    const w = this.walk * (1 - this.air);
    q.r('chest', S(this.time * 1.6) * 0.025).m('upperarm', 0, 0, 0.08 * (1 - w)).m('forearm', -0.12);
    if (w > 0.01) gait(q, this.phase, w, run, this.crouch);
    if (this.crouch > 0.01) crouchPose(q, this.crouch);
    if (this.air > 0.01) airPose(q, this.air);

    const sign = Math.sign(S(this.phase));
    if (w > 0.4 && player.onGround && sign !== this._lastStepSign && sign !== 0) { this._lastStepSign = sign; if (this.onFootstep) this.onFootstep(); }

    this.currentAnimation = !player.onGround ? 'jump' : this.crouch > 0.5 ? (w > 0.2 ? 'crouch_walk' : 'crouch') : w > 0.2 ? (run > 0.5 ? 'run' : 'walk') : 'idle';

    // animation parts override / blend
    for (const a of anims) {
      const seq = proceduralSequence(a.SequenceName);
      if (!seq) continue;
      const T = this._tmp;
      resetPose(T);
      seq.fn(a.cycle(seq.speed), Q(T));
      const wgt = clamp(a.Weight, 0, 1);
      for (const n of BONE_NAMES) {
        const d = P[n], s = T[n];
        for (let i = 0; i < 3; i++) { d.r[i] = lerp(d.r[i], s.r[i], wgt); d.p[i] = lerp(d.p[i], s.p[i], wgt); }
      }
      this.currentAnimation = a.SequenceName;
    }

    // look direction
    let dy = player.eyeYaw - player.bodyYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    dy = clamp(dy, -1.3, 1.3);
    const pitch = clamp(player.eyePitch, -1.2, 1.2);
    q.r('neck', pitch * 0.35, dy * 0.4).r('head', pitch * 0.65, dy * 0.6);

    // write the rig, then copy it onto the model
    for (const n of BONE_NAMES) {
      if (n === 'origin') continue;
      const b = this.rig[n], d = P[n];
      b.position.set(this.rest[n].x + d.p[0], this.rest[n].y + d.p[1], this.rest[n].z + d.p[2]);
      b.rotation.set(d.r[0], d.r[1], d.r[2], 'XYZ');
    }
    this.root.updateMatrixWorld(true);
    this._retarget();
    this.source.group.visible = !this.hidden;
  }
}
