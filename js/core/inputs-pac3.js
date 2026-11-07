// The rest of PAC3's event types and proxy inputs, adapted to a single-player web scene.
// Things that do not exist here (vehicles, water, other players, Steam IDs) are present for
// compatibility and report "nothing there"; their help text says so.
import * as THREE from 'three';
import { num } from './expression.js';

const DEG = 180 / Math.PI;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const pl = (c) => c.world.player;
const now = (c) => c.world.time;
const sinceShown = (c) => c.world.time - (c.refTime ?? c.shownTime ?? 0);

// ---------- shared helpers ----------
function targetPart(c) { return (c.getTargets && c.getTargets()[0]) || c.parent || null; }
function partPos(c, p, out = new THREE.Vector3()) {
  if (p && p.getWorldPosition) return p.getWorldPosition(out);
  return c.world.avatar.root.getWorldPosition(out);
}
function findPart(c, ref, cls) {
  if (ref == null || ref === '') return null;
  const key = String(ref);
  return c.world.allParts.find((x) => (!cls || x.className === cls) && (x.UniqueID === key || x.Name === key)) || null;
}
/** Distance along a ray until it hits the ground plane (or max). */
function rayToGround(origin, dir, max = 32768) {
  if (dir.y >= -1e-6) return max;
  return Math.min(max, -origin.y / dir.y);
}
/** Source-axis component of one of our vectors: x = forward (our z), y = left (our x), z = up (our y). */
const srcComp = (v, axis) => (axis === 'x' ? v.z : axis === 'y' ? v.x : v.y);
function eyeInfo(c) {
  const p = pl(c);
  const eye = c.world.avatar.getBone('eyes').getWorldPosition(new THREE.Vector3());
  return { p, eye, dir: p.getEyeDir(new THREE.Vector3()) };
}
function viewerDots(c, flat) {
  const { p, eye } = eyeInfo(c);
  const toCam = _v.copy(c.world.camera.position).sub(eye);
  const fwd = p.getEyeDir(_w);
  if (flat) { toCam.y = 0; fwd.y = 0; }
  toCam.normalize(); fwd.normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x).normalize(); // our right = forward x up
  return { forward: fwd.dot(toCam), right: -right.dot(toCam) };
}
function turnRate(c) {
  const p = pl(c), t = now(c);
  const st = (c._turn ||= { t, yaw: p.eyeYaw, pitch: p.eyePitch, ry: 0, rp: 0 });
  const dt = t - st.t;
  if (dt > 0) {
    let dy = p.eyeYaw - st.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    st.ry = (dy / dt) * DEG;
    st.rp = ((p.eyePitch - st.pitch) / dt) * DEG;
    st.t = t; st.yaw = p.eyeYaw; st.pitch = p.eyePitch;
  }
  return st;
}
const rateCheck = (rate, amount, absolute) => (absolute ? Math.abs(rate) > Math.abs(amount) : amount >= 0 ? rate > amount : rate < amount);
/** Pose parameters as Garry's Mod players report them. */
export function poseParameters(c) {
  const p = pl(c);
  const speed = Math.hypot(p.vel.x, p.vel.z);
  const sy = Math.sin(p.bodyYaw), cy = Math.cos(p.bodyYaw);
  let dyaw = p.eyeYaw - p.bodyYaw;
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw)) * DEG;
  return {
    move_x: speed > 1 ? (p.vel.x * sy + p.vel.z * cy) / speed : 0,
    move_y: speed > 1 ? (p.vel.x * cy - p.vel.z * sy) / speed : 0,
    aim_pitch: p.eyePitch * DEG, aim_yaw: dyaw, head_pitch: p.eyePitch * DEG * 0.7, head_yaw: dyaw * 0.7,
    vertical_velocity: Math.max(-1, Math.min(1, p.vel.y / 300)), vehicle_steer: 0,
  };
}
const POSE_RANGE = { move_x: [-1, 1], move_y: [-1, 1], aim_pitch: [-90, 90], aim_yaw: [-90, 90], head_pitch: [-60, 60], head_yaw: [-75, 75], vertical_velocity: [-1, 1], vehicle_steer: [-1, 1] };
function poseNormalized(c, name) {
  const v = poseParameters(c)[name];
  const r = POSE_RANGE[name];
  return v == null || !r ? 0 : (v - r[0]) / (r[1] - r[0]);
}
function touching(c, radius) {
  const p = partPos(c, targetPart(c));
  if (p.y <= radius) return true; // the ground
  for (const box of c.world.colliders || []) if (box.distanceToPoint(p) <= radius) return true;
  return false;
}
function velocityOf(c, which) {
  const p = pl(c);
  const sy = Math.sin(p.bodyYaw), cy = Math.cos(p.bodyYaw);
  return { forward: p.vel.x * sy + p.vel.z * cy, right: -(p.vel.x * cy - p.vel.z * sy), up: p.vel.y, world_forward: p.vel.z, world_right: -p.vel.x, world_up: p.vel.y, length: p.vel.length() }[which];
}
function increase(c, which) {
  const st = (c._inc ||= {});
  const v = velocityOf(c, which), t = now(c);
  const prev = st[which];
  st[which] = { v, t };
  return prev && t > prev.t ? (v - prev.v) / (t - prev.t) : 0;
}
const EASE = {
  InSine: (x) => 1 - Math.cos((x * Math.PI) / 2), OutSine: (x) => Math.sin((x * Math.PI) / 2), InOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  InQuad: (x) => x * x, OutQuad: (x) => 1 - (1 - x) * (1 - x), InOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
  InCubic: (x) => x ** 3, OutCubic: (x) => 1 - (1 - x) ** 3, InOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  InQuart: (x) => x ** 4, OutQuart: (x) => 1 - (1 - x) ** 4, InOutQuart: (x) => (x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2),
  InExpo: (x) => (x === 0 ? 0 : 2 ** (10 * x - 10)), OutExpo: (x) => (x === 1 ? 1 : 1 - 2 ** (-10 * x)),
  InOutExpo: (x) => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2),
  InCirc: (x) => 1 - Math.sqrt(1 - x * x), OutCirc: (x) => Math.sqrt(1 - (x - 1) ** 2),
  InBack: (x) => 2.70158 * x ** 3 - 1.70158 * x * x, OutBack: (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2,
  InElastic: (x) => (x === 0 || x === 1 ? x : -(2 ** (10 * x - 10)) * Math.sin((x * 10 - 10.75) * ((2 * Math.PI) / 3))),
  OutElastic: (x) => (x === 0 || x === 1 ? x : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  OutBounce: (x) => { const n = 7.5625, d = 2.75; if (x < 1 / d) return n * x * x; if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75; if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375; return n * (x -= 2.625 / d) * x + 0.984375; },
};
EASE.InBounce = (x) => 1 - EASE.OutBounce(1 - x);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ammo = (c) => pl(c).ammo;
const healthBars = (c) => c.world.healthBars || [];

// ---------- proxy inputs ----------
export const EXTRA_INPUTS = {
  aim_length: (c) => { const { eye, dir } = eyeInfo(c); return rayToGround(eye, dir); },
  aim_length_fraction: (c) => { const { eye, dir } = eyeInfo(c); return rayToGround(eye, dir) / 32768; },
  ambient_light: () => [1, 1, 1], ambient_light_r: () => 1, ambient_light_g: () => 1, ambient_light_b: () => 1,
  sum: (_c, ...a) => a.reduce((s, x) => s + num(x), 0),
  product: (_c, ...a) => a.reduce((s, x) => s * num(x), 1),
  average: (_c, ...a) => (a.length ? a.reduce((s, x) => s + num(x), 0) / a.length : 0),
  mean: (_c, ...a) => (a.length ? a.reduce((s, x) => s + num(x), 0) / a.length : 0),
  median: (_c, ...a) => { const s = a.map(num).sort((x, y) => x - y); if (!s.length) return 0; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; },
  polynomial: (_c, x, ...k) => k.reduce((s, ki, i) => s + num(ki) * num(x) ** i, 0),
  number_operator_alternative: (_c, a, op, b, x = 1, y = 0) => {
    a = num(a); b = num(b);
    const r = { '>': a > b, '<': a < b, '=': a === b, '==': a === b, '>=': a >= b, '<=': a <= b, '!=': a !== b, '~=': a !== b, above: a > b, below: a < b, equal: a === b }[String(op)];
    return r ? num(x) : num(y);
  },
  bodygroup: (c, name) => { const t = targetPart(c); const m = /([^;=]+)=(\d+)/g; let r; while (t && (r = m.exec(t.ModelModifiers || ''))) if (r[1].trim().toLowerCase() === String(name).toLowerCase()) return Number(r[2]); return 0; },
  model_bodygroup: (c, name) => EXTRA_INPUTS.bodygroup(c, name),
  delta_x: (c) => (c._delta ? srcComp(c._delta, 'x') : 0), delta_y: (c) => (c._delta ? srcComp(c._delta, 'y') : 0), delta_z: (c) => (c._delta ? srcComp(c._delta, 'z') : 0),
  drift: (c, speed = 1, min = 0, max = 1) => { const st = (c._drift ||= { v: 0.5, d: 0 }); st.d += (Math.random() - 0.5) * num(speed) * c.world.dt * 4; st.d *= 0.98; st.v = clamp01(st.v + st.d * c.world.dt); return num(min) + st.v * (num(max) - num(min)); },
  random_drift: (c, speed = 1, min = 0, max = 1) => EXTRA_INPUTS.drift(c, speed, min, max),
  ease: (_c, name, x) => (EASE[String(name)] || EASE.InOutSine)(clamp01(num(x))),
  ent_color: (c) => [...((c.world.fx.entity && c.world.fx.entity.color) || [1, 1, 1])],
  ent_color_r: (c) => ((c.world.fx.entity && c.world.fx.entity.color) || [1])[0],
  ent_color_g: (c) => ((c.world.fx.entity && c.world.fx.entity.color) || [1, 1])[1],
  ent_color_b: (c) => ((c.world.fx.entity && c.world.fx.entity.color) || [1, 1, 1])[2],
  ent_color_a: (c) => (c.world.fx.entity ? c.world.fx.entity.alpha : 1),
  var: (c, n = 1, ref) => { const p = ref != null ? findPart(c, ref, 'proxy') : c; return (p && p.extraOut && p.extraOut[num(n) - 1]) || 0; },
  extra: (c, n = 1, ref) => EXTRA_INPUTS.var(c, n, ref),
  eye_angle_distance: (c) => { const cam = c.world.camera; const to = partPos(c, targetPart(c)).sub(cam.position).normalize(); const f = cam.getWorldDirection(_w); return Math.acos(Math.max(-1, Math.min(1, f.dot(to)))) * DEG; },
  ezfade: (c, speed = 1, start = 0, end) => { const t = c.world.time - c.shownTime, s = num(speed); const fin = clamp01((t - num(start)) * s); const fout = end == null ? 1 : clamp01(1 - (t - num(end)) * s); return Math.min(fin, fout); },
  ezfade_4pt: (c, a = 0, b = 1, d = 2, e = 3) => { const t = c.world.time - c.shownTime; [a, b, d, e] = [a, b, d, e].map(num); if (t < a) return 0; if (t < b) return (t - a) / Math.max(1e-6, b - a); if (t < d) return 1; if (t < e) return 1 - (t - d) / Math.max(1e-6, e - d); return 0; },
  flat_dot_forward: (c) => viewerDots(c, true).forward, flat_dot_right: (c) => viewerDots(c, true).right,
  dot_forward: (c) => viewerDots(c, false).forward, dot_right: (c) => viewerDots(c, false).right,
  fnumber: (c) => c.world.frame,
  hexadecimal_level_sequence: (c, freq = 1, str = '0') => { const s = String(str).replace(/[^0-9a-f]/gi, '') || '0'; return parseInt(s[Math.floor((c.world.time - c.shownTime) * num(freq)) % s.length], 16) / 15; },
  letters_level_sequence: (c, freq = 1, str = 'a') => { const s = String(str).toLowerCase().replace(/[^a-z]/g, '') || 'a'; return (s.charCodeAt(Math.floor((c.world.time - c.shownTime) * num(freq)) % s.length) - 97) / 25; },
  numberlist_level_sequence: (c, freq = 1, str = '0') => { const l = String(str).split(/[;,\s]+/).filter(Boolean).map(Number); return l.length ? l[Math.floor((c.world.time - c.shownTime) * num(freq)) % l.length] || 0 : 0; },
  owner_position: (c) => { const p = pl(c).pos; return [p.z, p.x, p.y]; },
  owner_total_ammo: (c) => ammo(c).reserve,
  weapon_primary_ammo: (c) => ammo(c).clip, weapon_primary_clipsize: (c) => ammo(c).clipSize, weapon_primary_total_ammo: (c) => ammo(c).clip + ammo(c).reserve,
  weapon_secondary_ammo: (c) => ammo(c).secondary, weapon_secondary_clipsize: () => 1, weapon_secondary_total_ammo: (c) => ammo(c).secondary,
  parent_scale_x: (c) => partScale(c, 'x'), parent_scale_y: (c) => partScale(c, 'y'), parent_scale_z: (c) => partScale(c, 'z'),
  part_distance: (c, a, b) => { const pa = a != null ? findPart(c, a) : targetPart(c); const pb = b != null ? findPart(c, b) : c.parent; return partPos(c, pa).distanceTo(partPos(c, pb, _w)); },
  part_pos_x: (c, ref) => srcComp(partPos(c, ref != null ? findPart(c, ref) : targetPart(c)), 'x'),
  part_pos_y: (c, ref) => srcComp(partPos(c, ref != null ? findPart(c, ref) : targetPart(c)), 'y'),
  part_pos_z: (c, ref) => srcComp(partPos(c, ref != null ? findPart(c, ref) : targetPart(c)), 'z'),
  pose_parameter: (c, name) => poseNormalized(c, String(name)),
  pose_parameter_true: (c, name) => poseParameters(c)[String(name)] ?? 0,
  property: (c, name, ref) => { const t = ref != null ? findPart(c, ref) : targetPart(c); const v = t && t[String(name)]; return Array.isArray(v) ? v.map(num) : num(v); },
  sample_and_hold: (c, interval = 1, min = 0, max = 1) => { const st = (c._sah ||= { t: -1e9, v: 0 }); if (now(c) - st.t >= num(interval)) { st.t = now(c); st.v = num(min) + Math.random() * (num(max) - num(min)); } return st.v; },
  samplehold: (c, interval, min, max) => EXTRA_INPUTS.sample_and_hold(c, interval, min, max),
  server_botcount: () => 0, server_humancount: () => 1, server_maxplayers: () => 1, server_playercount: () => 1, server_population: () => 1,
  visible: (c, ref) => { const t = ref != null ? findPart(c, ref) : targetPart(c); return t && !t.hiddenNow ? 1 : 0; },
  healthmod_bar_total: (c) => healthBars(c).reduce((s, b) => s + b.value, 0),
  healthmod_bar_layertotal: (c, layer = 0) => healthBars(c).filter((b) => b.layer === num(layer)).reduce((s, b) => s + b.value, 0),
  healthmod_bar_remaining_bars: (c) => healthBars(c).filter((b) => b.value > 0).length,
  healthmod_bar_uidvalue: (c, ref) => { const b = healthBars(c).find((x) => x.uid === String(ref) || x.name === String(ref)); return b ? b.value : 0; },
};
for (const k of ['forward', 'right', 'up', 'length', 'world_forward', 'world_right', 'world_up']) EXTRA_INPUTS[`owner_velocity_${k}_increase`] = (c) => increase(c, k);
for (const name of Object.keys(EASE)) EXTRA_INPUTS[`ease_${name}`] = (_c, x) => EASE[name](clamp01(num(x)));
Object.assign(EXTRA_INPUTS, {
  pac_healthbars_total: EXTRA_INPUTS.healthmod_bar_total, pac_healthbars_layertotal: EXTRA_INPUTS.healthmod_bar_layertotal,
  pac_healthbar_remaining_bars: EXTRA_INPUTS.healthmod_bar_remaining_bars, pac_healthbar_uidvalue: EXTRA_INPUTS.healthmod_bar_uidvalue,
});
function partScale(c, axis) {
  const t = targetPart(c);
  if (!t || !t.Scale) return 1;
  const s = { x: t.Scale[2], y: t.Scale[0], z: t.Scale[1] }[axis];
  return s * (t.Size ?? 1);
}

// ---------- events ----------
// kind 'bool' | 'number' | 'string'; cmp = index of the argument to compare with (default 0).
export const EXTRA_EVENTS = {
  randint: { kind: 'number', op: 'equal', args: 'compare@@min@@max', help: 'A random whole number between min and max every frame.', get: (e, a) => Math.floor(num(a[1] || 0) + Math.random() * (num(a[2] || 1) - num(a[1] || 0) + 1)) },
  timerx2: { kind: 'bool', args: 'start seconds@@end seconds', help: 'True between start and end seconds after the target became visible.', get: (e, a) => { const t = sinceShown(e); return t >= num(a[0] || 0) && t <= num(a[1] || 1); } },
  timersys: { kind: 'number', op: 'above', args: 'seconds', help: 'Like timerx.', get: (e) => sinceShown(e) },
  timer: { kind: 'bool', args: 'interval@@offset', help: 'Blinks: on for the first half of every interval.', get: (e, a) => { const i = Math.max(0.01, num(a[0] || 1)); return ((now(e) + num(a[1] || 0)) % i) < i / 2; } },
  ratio_timer: { kind: 'bool', args: 'interval@@offset@@ratio', help: 'On for ratio (0-1) of every interval.', get: (e, a) => { const i = Math.max(0.01, num(a[0] || 1)); return ((sinceShown(e) + num(a[1] || 0)) % i) / i < num(a[2] ?? 0.5); } },
  map_name: { kind: 'string', op: 'find simple', args: 'name', help: 'Always "pac3web" here.', get: () => 'pac3web' },
  fov: { kind: 'number', op: 'above', args: 'degrees', help: 'Camera field of view.', get: (e) => e.world.camera.fov },
  health_lost: { kind: 'bool', args: 'amount', help: 'Briefly true when health drops by at least amount (change health in Player settings).', get: (e, a) => { const h = pl(e).health; if (e._hp != null && e._hp - h >= num(a[0] || 1)) e._hlUntil = now(e) + 0.25; e._hp = h; return now(e) < (e._hlUntil || 0); } },
  holdtype: { kind: 'string', op: 'find simple', args: 'holdtype', help: 'Current holdtype (set by a holdtype part).', get: (e) => pl(e).holdtype || 'normal' },
  using_physgun: { kind: 'bool', help: 'Holding weapon_physgun (Player settings).', get: (e) => pl(e).weapon === 'weapon_physgun' },
  eyetrace_entity_class: { kind: 'string', op: 'find simple', args: 'class', help: '"worldspawn" when you look at the ground, else empty.', get: (e) => (pl(e).eyePitch > 0.05 ? 'worldspawn' : '') },
  owner_max_health: { kind: 'number', op: 'above', args: 'health', help: 'Max health (Player settings).', get: (e) => pl(e).maxHealth },
  owner_alive: { kind: 'bool', help: 'Health above 0.', get: (e) => pl(e).health > 0 },
  owner_armor: { kind: 'number', op: 'above', args: 'armor', help: 'Armor (Player settings).', get: (e) => pl(e).armor },
  owner_scale_x: { kind: 'number', op: 'above', args: 'scale', help: 'Player model scale (entity part).', get: (e) => e.world.avatar.root.scale.z },
  owner_scale_y: { kind: 'number', op: 'above', args: 'scale', help: 'Player model scale (entity part).', get: (e) => e.world.avatar.root.scale.x },
  owner_scale_z: { kind: 'number', op: 'above', args: 'scale', help: 'Player model scale (entity part).', get: (e) => e.world.avatar.root.scale.y },
  pose_parameter: { kind: 'number', op: 'above', cmp: 1, args: 'name@@value 0-1', help: 'A player pose parameter (move_x, move_y, aim_pitch, aim_yaw, head_pitch, head_yaw…), 0-1.', get: (e, a) => poseNormalized(e, String(a[0] || 'move_x')) },
  pose_parameter_true: { kind: 'number', op: 'above', cmp: 1, args: 'name@@value', help: 'A player pose parameter in its real range.', get: (e, a) => poseParameters(e)[String(a[0] || 'move_x')] ?? 0 },
  is_turning: { kind: 'bool', args: 'degrees per second', help: 'Turning the view faster than amount.', get: (e, a) => { const r = turnRate(e); return Math.hypot(r.ry, r.rp) > num(a[0] || 50); } },
  is_turning_pitch: { kind: 'bool', args: 'pitch deg/s@@absolute (1/0)', help: 'Looking up/down faster than amount (negative = up).', get: (e, a) => rateCheck(turnRate(e).rp, num(a[0] || 50), a[1] === '1' || a[1] === 'true') },
  is_turning_yaw: { kind: 'bool', args: 'yaw deg/s@@absolute (1/0)', help: 'Turning left/right faster than amount (positive = left).', get: (e, a) => rateCheck(turnRate(e).ry, num(a[0] || 50), a[1] === '1' || a[1] === 'true') },
  is_turning_xy: { kind: 'bool', args: 'pitch deg/s@@yaw deg/s@@absolute', help: 'Either pitch or yaw turning faster than its amount.', get: (e, a) => { const r = turnRate(e), abs = a[2] === '1' || a[2] === 'true'; return rateCheck(r.rp, num(a[0] || 50), abs) || rateCheck(r.ry, num(a[1] || 50), abs); } },
  is_under_water: { kind: 'bool', args: 'level', help: 'There is no water here: always false.', get: () => false },
  is_on_fire: { kind: 'bool', help: 'Nothing burns here: always false.', get: () => false },
  client_spawned: { kind: 'bool', args: 'seconds', help: 'True for the first seconds after the page loaded.', get: (e, a) => now(e) < num(a[0] || 1) },
  is_client: { kind: 'bool', help: 'You are the owner viewing your outfit: always true.', get: () => true },
  seen_by_player: { kind: 'bool', args: 'extra radius', help: 'Another player looks at you. Single-player here: always false.', get: () => false },
  collide: { kind: 'bool', help: 'The target touches the ground or a world object.', get: (e) => touching(e, 1) },
  ranger: { kind: 'number', op: 'below', cmp: 1, args: 'distance@@compare', help: 'Distance from the target forward until it hits the ground (up to distance).', get: (e, a) => { const t = targetPart(e); const o = partPos(e, t); const d = t && t.getWorldForward ? t.getWorldForward(new THREE.Vector3()) : pl(e).getEyeDir(new THREE.Vector3()); return rayToGround(o, d, num(a[0] || 100)); } },
  ground_surface: { kind: 'bool', args: 'exclude noclip@@surfaces', help: 'Standing on one of the surfaces (the floor here is "concrete").', get: (e, a) => pl(e).onGround && (!a[1] || String(a[1]).toLowerCase().includes('concrete')) },
  is_touching: { kind: 'bool', args: 'extra radius', help: 'The target is within radius of the ground or a world object.', get: (e, a) => touching(e, num(a[0] || 5)) },
  is_touching_filter: { kind: 'bool', args: 'extra radius', help: 'Like is_touching (there are no NPCs or other players here).', get: (e, a) => touching(e, num(a[0] || 5)) },
  is_touching_scalable: { kind: 'bool', args: 'extra radius', help: 'Like is_touching.', get: (e, a) => touching(e, num(a[0] || 5)) },
  is_touching_life: { kind: 'bool', args: 'extra radius', help: 'Touching an NPC or player. None here: always false.', get: () => false },
  is_explicit: { kind: 'bool', help: 'Always false.', get: () => false },
  ammo: { kind: 'number', op: 'above', cmp: 1, args: 'primary (1/0)@@amount', help: 'Ammo in the clip (Player settings).', get: (e, a) => (a[0] === '0' || a[0] === 'false' ? ammo(e).secondary : ammo(e).clip) },
  total_ammo: { kind: 'number', op: 'above', cmp: 1, args: 'ammo type@@amount', help: 'Reserve ammo (Player settings).', get: (e) => ammo(e).reserve },
  clipsize: { kind: 'number', op: 'above', cmp: 1, args: 'primary (1/0)@@amount', help: 'Clip size (Player settings).', get: (e) => ammo(e).clipSize },
  vehicle_class: { kind: 'string', op: 'find simple', args: 'class', help: 'No vehicles here: always empty.', get: () => '' },
  vehicle_model: { kind: 'string', op: 'find simple', args: 'model', help: 'No vehicles here: always empty.', get: () => '' },
  driver_name: { kind: 'string', op: 'find simple', args: 'name', help: 'No vehicles here: always empty.', get: () => '' },
  is_driving: { kind: 'bool', help: 'No vehicles here: always false.', get: () => false },
  is_passenger: { kind: 'bool', help: 'No vehicles here: always false.', get: () => false },
  entity_class: { kind: 'string', op: 'find simple', args: 'class', help: 'Always "player".', get: () => 'player' },
  animation_event: { kind: 'bool', args: 'event (e.g. footstep, jump)@@seconds', help: 'An animation event happened recently.', get: (e, a) => recent(e, e.world.animEvent, a[0], a[1], 0.2) },
  fire_bullets: { kind: 'bool', args: 'ammo@@seconds', help: 'You fired recently (mouse in play mode, projectile or hitscan parts).', get: (e, a) => now(e) - (e.world.lastFire ?? -1e9) < num(a[1] || 0.1) },
  emit_sound: { kind: 'bool', args: 'sound@@seconds', help: 'A sound part played a matching sound recently.', get: (e, a) => recent(e, e.world.lastSound, a[0], a[1], 0.2) },
  gravitygun_punt: { kind: 'bool', args: 'seconds', help: 'There is no gravity gun here: always false.', get: () => false },
  movetype: { kind: 'string', op: 'find simple', args: 'movetype', help: '"noclip" while a movement part has Noclip, else "walk".', get: (e) => (e.world.fx.movement && e.world.fx.movement.noclip ? 'noclip' : 'walk') },
  dot_forward: { kind: 'number', op: 'above', args: 'value -1..1', help: 'How much you face the camera (1 = straight at it).', get: (e) => viewerDots(e, false).forward },
  dot_right: { kind: 'number', op: 'above', args: 'value -1..1', help: 'How far the camera is to your right.', get: (e) => viewerDots(e, false).right },
  flat_dot_forward: { kind: 'number', op: 'above', args: 'value -1..1', help: 'dot_forward ignoring height.', get: (e) => viewerDots(e, true).forward },
  flat_dot_right: { kind: 'number', op: 'above', args: 'value -1..1', help: 'dot_right ignoring height.', get: (e) => viewerDots(e, true).right },
  weapon_iron_sight: { kind: 'bool', help: 'Aiming down sights (right mouse in play mode).', get: (e) => e.world.input.isDown('mouse_right') },
  weapon_firemode: { kind: 'string', op: 'find simple', args: 'mode', help: 'Always "auto".', get: () => 'auto' },
  weapon_safety: { kind: 'bool', help: 'Always false.', get: () => false },
  damage_zone_hit: { kind: 'bool', args: 'seconds@@damage@@damage zone uid', help: 'A damage_zone part hit something recently.', get: (e, a) => { const h = e.world.damageHit; return !!h && now(e) - h.time < num(a[0] || 0.2) && h.damage >= num(a[1] || 0) && (!a[2] || h.uid === a[2]); } },
  damage_zone_kill: { kind: 'bool', args: 'seconds@@damage zone uid', help: 'A damage_zone part destroyed a target recently.', get: (e, a) => { const h = e.world.damageKill; return !!h && now(e) - h.time < num(a[0] || 0.2) && (!a[1] || h.uid === a[1]); } },
  lockpart_grabbed: { kind: 'bool', help: 'A lock part is holding you.', get: (e) => !!e.world.lockGrabbed },
  lockpart_grabbing: { kind: 'bool', args: 'lock part uid', help: 'A lock part is holding something.', get: (e, a) => !!e.world.lockGrabbing && (!a[0] || e.world.lockGrabbing === a[0]) },
  healthmod_bar_total: { kind: 'number', op: 'above', args: 'value', help: 'Total of all health_modifier bars.', get: (e) => EXTRA_INPUTS.healthmod_bar_total(e) },
  healthmod_bar_layertotal: { kind: 'number', op: 'above', args: 'value@@layer', help: 'Total of one bar layer.', get: (e, a) => EXTRA_INPUTS.healthmod_bar_layertotal(e, a[1] || 0) },
  healthmod_bar_uidvalue: { kind: 'number', op: 'above', args: 'value@@health_modifier uid', help: 'Value of one health_modifier bar.', get: (e, a) => EXTRA_INPUTS.healthmod_bar_uidvalue(e, a[1]) },
  healthmod_bar_hit: { kind: 'bool', args: 'amount@@layer@@uid@@seconds', help: 'A health bar took damage recently.', get: (e, a) => { const h = e.world.barHit; return !!h && now(e) - h.time < num(a[3] || 0.2) && h.amount >= num(a[0] || 0); } },
  or_gate: { kind: 'bool', args: 'event uids or names (;)@@ignore inverts (1/0)', help: 'True if any listed event is true.', get: (e, a) => gate(e, a[0], a[1]).some(Boolean) },
  and_gate: { kind: 'bool', args: 'event uids or names (;)@@ignore inverts (1/0)', help: 'True if all listed events are true.', get: (e, a) => { const s = gate(e, a[0], a[1]); return s.length > 0 && s.every(Boolean); } },
  xor_gate: { kind: 'bool', args: 'event 1@@event 2', help: 'True if exactly one of the two events is true.', get: (e, a) => { const s = gate(e, `${a[0]};${a[1]}`, '0'); return s.length === 2 && s[0] !== s[1]; } },
  is_no_draw: { kind: 'bool', help: 'The player model is hidden (entity HideEntity).', get: (e) => !!(e.world.fx.entity && e.world.fx.entity.hide) },
  viewer_steamid: { kind: 'string', op: 'find simple', args: 'steamid', help: 'There are no Steam IDs here: always empty.', get: () => '' },
};
for (const k of ['length', 'forward', 'right', 'up', 'world_forward', 'world_right', 'world_up']) {
  EXTRA_EVENTS[`owner_velocity_${k}`] = { kind: 'number', op: 'above', args: 'speed', help: `Owner velocity (${k.replace('_', ' ')}).`, get: (e) => velocityOf(e, k) };
}
for (const k of ['length', 'forward', 'right', 'up']) {
  EXTRA_EVENTS[`parent_velocity_${k}`] = { kind: 'number', op: 'above', args: 'speed', help: `Velocity of the target (${k}).`, get: (e) => (e.parentVel ? (k === 'length' ? e.parentVel.length() : k === 'forward' ? e.parentVel.z : k === 'right' ? -e.parentVel.x : e.parentVel.y) : 0) };
}
for (const ax of ['x', 'y', 'z']) EXTRA_EVENTS[`parent_scale_${ax}`] = { kind: 'number', op: 'above', args: 'scale', help: `Scale of the target (${ax}).`, get: (e) => partScale(e, ax) };

function recent(e, ev, find, secs, def) {
  return !!ev && now(e) - ev.time < num(secs || def) && (!find || String(ev.name || '').toLowerCase().includes(String(find).toLowerCase()));
}
function gate(e, list, ignoreInverts) {
  const ignore = ignoreInverts === '1' || ignoreInverts === 'true';
  return String(list || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean).map((ref) => {
    const ev = findPart(e, ref, 'event');
    if (!ev) return false;
    return ignore ? !!ev.active : !ev.triggered;
  });
}
