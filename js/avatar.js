// Procedural segmented mannequin with a named skeleton, procedural locomotion and
// a library of animation sequences used by the animation part.
// The character faces +Z; its left side is +X. Units are roughly inches (72 tall).
import * as THREE from 'three';
import { clamp, lerp, smoothstep, setColor } from './core/util.js';
import { getTexture } from './core/textures.js';

const TAU = Math.PI * 2;
const S = Math.sin;

const BONE_DEFS = [
  ['pelvis', 'origin', [0, 38, 0]],
  ['spine', 'pelvis', [0, 4, 0]],
  ['chest', 'spine', [0, 8, 0]],
  ['neck', 'chest', [0, 10, 0]],
  ['head', 'neck', [0, 4, 0]],
  ['eyes', 'head', [0, 4, 5]],
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
export const BONE_NAMES = ['origin', ...BONE_DEFS.map((b) => b[0])];

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

// ---------- geometry ----------
const sphereGeo = new THREE.SphereGeometry(1, 28, 18);
const cap = (r, len) => new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 6, 16);

export class Avatar {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'avatar';
    scene.add(this.root);
    this.bones = { origin: this.root };
    this.rest = {};
    this.segments = {};
    this.meshes = [];
    this.mats = {
      body: new THREE.MeshStandardMaterial({ color: 0xd5dae3, roughness: 0.45, metalness: 0.05 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.5, metalness: 0.1 }),
      visor: new THREE.MeshStandardMaterial({ color: 0x0d1117, roughness: 0.15, metalness: 0.4 }),
      eye: new THREE.MeshBasicMaterial({ color: 0x7fe3ff }),
    };
    this.baseColors = Object.fromEntries(Object.entries(this.mats).map(([k, m]) => [k, m.color.clone()]));
    for (const [name, parent, pos] of BONE_DEFS) {
      const b = new THREE.Bone();
      b.name = name;
      b.position.fromArray(pos);
      this.bones[parent].add(b);
      this.bones[name] = b;
      this.rest[name] = new THREE.Vector3().fromArray(pos);
    }
    this.rest.origin = new THREE.Vector3();
    this._buildBody();
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
    this._appearanceKey = '';
  }

  _seg(bone, meshes) {
    const g = new THREE.Group();
    g.name = `${bone} mesh`;
    for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; m.userData.avatarBone = bone; g.add(m); this.meshes.push(m); }
    this.bones[bone].add(g);
    this.segments[bone] = g;
  }
  _mesh(geo, mat, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.fromArray(pos); m.scale.fromArray(scale); m.rotation.fromArray(rot);
    return m;
  }
  _buildBody() {
    const { body, dark, visor, eye } = this.mats;
    this._seg('pelvis', [this._mesh(sphereGeo, dark, [0, -0.5, 0], [6.4, 4.8, 4.4])]);
    this._seg('spine', [this._mesh(sphereGeo, body, [0, 4, 0], [5.6, 5.4, 4.0])]);
    this._seg('chest', [this._mesh(sphereGeo, body, [0, 5.5, 0], [8.2, 6.8, 5.0])]);
    this._seg('neck', [this._mesh(new THREE.CylinderGeometry(2, 2.3, 5.5, 16), dark, [0, 2, 0])]);
    const visorGeo = new THREE.SphereGeometry(1, 28, 10, Math.PI / 2 - 0.95, 1.9, 1.2, 0.55);
    this._seg('head', [
      this._mesh(sphereGeo, body, [0, 3.8, 0.2], [4.7, 5.6, 5.3]),
      this._mesh(visorGeo, visor, [0, 3.8, 0.25], [4.85, 5.75, 5.45]),
      this._mesh(sphereGeo, eye, [1.6, 4.25, 5.55], [0.65, 0.4, 0.25]),
      this._mesh(sphereGeo, eye, [-1.6, 4.25, 5.55], [0.65, 0.4, 0.25]),
    ]);
    for (const side of ['left', 'right']) {
      this._seg(`${side} upperarm`, [this._mesh(sphereGeo, dark, [0, 0, 0], [2.7, 2.7, 2.7]), this._mesh(cap(2.2, 11), body, [0, -5.5, 0])]);
      this._seg(`${side} forearm`, [this._mesh(sphereGeo, dark, [0, 0, 0], [1.9, 1.9, 1.9]), this._mesh(cap(1.8, 10), body, [0, -5, 0])]);
      this._seg(`${side} hand`, [this._mesh(sphereGeo, dark, [0, -2.8, 0.3], [1.5, 3, 2.3])]);
      this._seg(`${side} thigh`, [this._mesh(cap(3.1, 18), body, [0, -8.5, 0])]);
      this._seg(`${side} calf`, [this._mesh(sphereGeo, dark, [0, 0, 0], [2.7, 2.7, 2.7]), this._mesh(cap(2.5, 16.5), body, [0, -8, 0])]);
      this._seg(`${side} foot`, [this._mesh(sphereGeo, dark, [0, -1.1, 2.2], [2.3, 1.5, 4.6])]);
    }
  }

  getBone(name) { return this.bones[name] || this.root; }
  getBoneNames() { return BONE_NAMES; }

  /** Entity part settings (or defaults when none is active). */
  setAppearance(a) {
    const key = JSON.stringify(a);
    if (key === this._appearanceKey) return;
    this._appearanceKey = key;
    const tex = getTexture(a.material);
    for (const [k, m] of Object.entries(this.mats)) {
      if (k === 'eye') continue;
      m.color.copy(this.baseColors[k]);
      if (k === 'body' || k === 'dark') { const c = setColor(new THREE.Color(), a.color, a.brightness); m.color.multiply(c); }
      m.map = k === 'visor' ? null : tex;
      m.wireframe = a.wireframe;
      m.needsUpdate = true;
    }
    for (const m of Object.values(this.mats)) {
      m.opacity = a.alpha;
      m.transparent = a.alpha < 1;
      m.depthWrite = a.alpha >= 1;
    }
    this.hidden = a.hide;
    this.scale = [a.size * a.scale[0], a.size * a.scale[1], a.size * a.scale[2]];
  }

  update(dt, player, anims, world) {
    this.time += dt;
    this.root.position.copy(player.pos);
    this.root.rotation.set(0, player.bodyYaw, 0);
    const sc = this.scale || [1, 1, 1];
    this.root.scale.set(sc[0], sc[1], sc[2]);
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

    // footsteps
    const sign = Math.sign(S(this.phase));
    if (w > 0.4 && player.onGround && sign !== this._lastStepSign && sign !== 0) { this._lastStepSign = sign; if (this.onFootstep) this.onFootstep(); }

    this.currentAnimation = !player.onGround ? 'jump' : this.crouch > 0.5 ? (w > 0.2 ? 'crouch_walk' : 'crouch') : w > 0.2 ? (run > 0.5 ? 'run' : 'walk') : 'idle';

    // animation parts override / blend
    for (const a of anims) {
      const seq = SEQUENCES[a.SequenceName];
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

    // write pose
    for (const n of BONE_NAMES) {
      if (n === 'origin') continue;
      const b = this.bones[n], d = P[n];
      b.position.set(this.rest[n].x + d.p[0], this.rest[n].y + d.p[1], this.rest[n].z + d.p[2]);
      b.rotation.set(d.r[0], d.r[1], d.r[2], 'XYZ');
      b.scale.set(1, 1, 1);
    }
    for (const g of Object.values(this.segments)) { g.scale.set(1, 1, 1); g.visible = !this.hidden; }
  }
}
