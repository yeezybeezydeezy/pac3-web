// Proxy functions/inputs and event types. ctx is always the proxy or event part.
import * as THREE from 'three';
import { num } from './expression.js';

const DEG = 180 / Math.PI;
const pl = (c) => c.world.player;
const _v = new THREE.Vector3();

function bodyVelocity(c) {
  const p = pl(c);
  const s = Math.sin(p.bodyYaw), co = Math.cos(p.bodyYaw);
  // body forward is +Z rotated by yaw, right is -X rotated by yaw
  return { forward: p.vel.x * s + p.vel.z * co, right: -(p.vel.x * co - p.vel.z * s), up: p.vel.y };
}

function hsv(h, s, v) {
  h = ((num(h) % 360) + 360) % 360 / 60; s = num(s); v = num(v);
  const c = v * s, x = c * (1 - Math.abs((h % 2) - 1)), m = v - c;
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

const M = (f) => (_c, ...a) => f(...a.map(num));

// Pure math helpers (ctx ignored).
const MATH = {
  sin: M(Math.sin), cos: M(Math.cos), tan: M(Math.tan), asin: M(Math.asin), acos: M(Math.acos),
  atan: M((y, x) => (x === undefined ? Math.atan(y) : Math.atan2(y, x))), atan2: M(Math.atan2),
  abs: M(Math.abs), floor: M(Math.floor), ceil: M(Math.ceil), sqrt: M(Math.sqrt), exp: M(Math.exp),
  log: M((x, b) => (b ? Math.log(x) / Math.log(b) : Math.log(x))), log10: M(Math.log10),
  pow: M(Math.pow), min: M(Math.min), max: M(Math.max),
  clamp: M((x, a, b) => Math.min(Math.max(x, a), b)),
  lerp: M((a, b, t) => a + (b - a) * t),
  round: M((x, d = 0) => { const k = 10 ** d; return Math.round(x * k) / k; }),
  sgn: M(Math.sign), sign: M(Math.sign),
  mod: M((a, b) => a - Math.floor(a / b) * b), fmod: M((a, b) => a % b),
  nsin: M((x) => Math.sin(x) * 0.5 + 0.5), ncos: M((x) => Math.cos(x) * 0.5 + 0.5),
  nsin2: M((x) => Math.abs(Math.sin(x))), ncos2: M((x) => Math.abs(Math.cos(x))),
  deg: M((x) => x * DEG), rad: M((x) => x / DEG),
  smoothstep: M((a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); }),
  step: M((edge, x) => (x >= edge ? 1 : 0)),
  if_else: (_c, cond, a, b) => (num(cond) > 0 ? num(a) : num(b)),
  hsv_to_color: M((h, s = 1, v = 1) => hsv(h, s, v)),
  vec: (_c, ...a) => a.map(num),
  // used by imported PAC3 outfits: Source (x fwd, y left, z up) vector order -> ours, and 0-255 colors
  src_vec: (_c, ...a) => (a.length >= 3 ? [num(a[1]), num(a[2]), num(a[0])] : [num(a[0]), num(a[0]), num(a[0])]),
  div255: (_c, ...a) => a.map((x) => num(x) / 255),
};

// Player / world inputs (ctx-aware).
const INPUTS = {
  time: (c) => c.world.time,
  stime: (c) => c.world.time,
  synced_time: () => Date.now() / 1000,
  systime: () => performance.now() / 1000,
  timeex: (c) => c.world.time - c.shownTime,
  frametime: (c) => c.world.dt,
  ftime: (c) => c.world.dt,
  framenumber: (c) => c.world.frame,
  random: (_c, a = 0, b = 1) => num(a) + Math.random() * (num(b) - num(a)),
  random_once: (c, a = 0, b = 1) => { if (c._randomOnce == null) c._randomOnce = Math.random(); return num(a) + c._randomOnce * (num(b) - num(a)); },
  feedback: (c) => (c.feedback && c.feedback[0]) || 0,
  feedback_x: (c) => (c.feedback && c.feedback[0]) || 0,
  feedback_y: (c) => (c.feedback && c.feedback[1]) || 0,
  feedback_z: (c) => (c.feedback && c.feedback[2]) || 0,
  command: (c, name) => c.world.pacProxies.get(String(name)) ?? 0,

  owner_velocity_length: (c) => pl(c).vel.length(),
  owner_velocity_forward: (c) => bodyVelocity(c).forward,
  owner_velocity_right: (c) => bodyVelocity(c).right,
  owner_velocity_up: (c) => bodyVelocity(c).up,
  owner_velocity_world_forward: (c) => pl(c).vel.z,
  owner_velocity_world_right: (c) => -pl(c).vel.x,
  owner_velocity_world_up: (c) => pl(c).vel.y,
  owner_position_x: (c) => pl(c).pos.x,
  owner_position_y: (c) => pl(c).pos.z,
  owner_position_z: (c) => pl(c).pos.y,
  owner_eye_angle_pitch: (c) => pl(c).eyePitch * DEG,
  owner_eye_angle_yaw: (c) => pl(c).eyeYaw * DEG,
  owner_eye_angle_roll: () => 0,
  owner_health: (c) => pl(c).health,
  owner_max_health: (c) => pl(c).maxHealth,
  owner_health_fraction: (c) => pl(c).health / Math.max(1, pl(c).maxHealth),
  owner_armor: (c) => pl(c).armor,
  owner_max_armor: (c) => pl(c).maxArmor,
  owner_armor_fraction: (c) => pl(c).armor / Math.max(1, pl(c).maxArmor),
  owner_scale_x: (c) => c.world.avatar.root.scale.x,
  owner_scale_y: (c) => c.world.avatar.root.scale.z,
  owner_scale_z: (c) => c.world.avatar.root.scale.y,
  owner_fov: (c) => c.world.camera.fov,
  is_crouching: (c) => (pl(c).crouching ? 1 : 0),
  is_on_ground: (c) => (pl(c).onGround ? 1 : 0),
  is_moving: (c) => (pl(c).vel.length() > 5 ? 1 : 0),
  player_color: (c) => [...pl(c).color],
  player_color_r: (c) => pl(c).color[0],
  player_color_g: (c) => pl(c).color[1],
  player_color_b: (c) => pl(c).color[2],
  weapon_color: (c) => [...pl(c).weaponColor],
  weapon_color_r: (c) => pl(c).weaponColor[0],
  weapon_color_g: (c) => pl(c).weaponColor[1],
  weapon_color_b: (c) => pl(c).weaponColor[2],
  parent_velocity_length: (c) => (c.parentVel ? c.parentVel.length() : 0),
  parent_velocity_forward: (c) => (c.parentVel ? c.parentVel.z : 0),
  parent_velocity_right: (c) => (c.parentVel ? -c.parentVel.x : 0),
  parent_velocity_up: (c) => (c.parentVel ? c.parentVel.y : 0),
  eye_position_distance: (c) => c.world.camera.position.distanceTo(c.getParentWorldPosition(_v)),
  mouse_x: (c) => c.world.input.mouseX,
  mouse_y: (c) => c.world.input.mouseY,
  voice_volume: (c) => c.world.mic.level,
  voice_volume_scale: (c) => c.world.mic.level,
  sequenced_event_number: () => 0,
};

// PAC3 "extra" expressions: var1()..var5() read this proxy's ExtraN result; with an argument they
// read another proxy's (by UniqueID or Name).
for (let i = 1; i <= 5; i++) {
  INPUTS[`var${i}`] = INPUTS[`extra${i}`] = (c, ref) => {
    if (ref == null) return (c.extraOut && c.extraOut[i - 1]) || 0;
    const key = String(ref);
    c._refCache ||= new Map();
    let p = c._refCache.get(key);
    if (!p || !p.inWorld) {
      p = c.world.allParts.find((x) => x.className === 'proxy' && (x.UniqueID === key || x.Name === key)) || null;
      c._refCache.set(key, p);
    }
    return (p && p.extraOut && p.extraOut[i - 1]) || 0;
  };
}

// PAC3 if_event(event uid or name, a = 0, b = 1): a while that event is hiding its target, else b.
INPUTS.event_alternative = INPUTS.if_event = INPUTS.if_else_event = (c, ref, a = 0, b = 1) => {
  if (ref == null) return 0;
  const key = String(ref);
  c._refCache ||= new Map();
  let p = c._refCache.get(`event|${key}`);
  if (!p || !p.inWorld) {
    p = c.world.allParts.find((x) => x.className === 'event' && (x.UniqueID === key || x.Name === key)) || null;
    c._refCache.set(`event|${key}`, p);
  }
  return p ? (p.triggered ? num(a) : num(b)) : 0;
};
// Ambient light at the part: there is no light probe here, so it reads as fully lit.
INPUTS.light_value = () => 1;
INPUTS.light_amount = () => [1, 1, 1];
INPUTS.light_amount_r = INPUTS.light_amount_g = INPUTS.light_amount_b = () => 1;

export const PROXY_FUNCTIONS = { ...MATH, ...INPUTS };
export const PROXY_CONSTANTS = { pi: Math.PI, PI: Math.PI, huge: 1e9, e: Math.E };
export const PROXY_INPUT_NAMES = Object.keys(INPUTS).filter((n) => !/^feedback_|^stime$|^ftime$|^extra\d$/.test(n));
export const EASY_FUNCTIONS = {
  none: (x) => x, sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, sgn: Math.sign,
  nsin: (x) => Math.sin(x) * 0.5 + 0.5, ncos: (x) => Math.cos(x) * 0.5 + 0.5, nsin2: (x) => Math.abs(Math.sin(x)),
  ncos2: (x) => Math.abs(Math.cos(x)), mod: (x) => x - Math.floor(x), saw: (x) => x - Math.floor(x),
  square: (x) => (Math.sin(x) >= 0 ? 1 : 0), triangle: (x) => 1 - Math.abs(((x % 2) + 2) % 2 - 1) * 2,
};

/* ---------------- events ----------------
 * kind 'bool': value used directly. 'number' / 'string': compared with Operator vs Arguments[0].
 */
export const EVENT_OPERATORS = ['find simple', 'find', 'equal', 'not equal', 'above', 'below', 'equal or above', 'equal or below', 'maybe'];

export const EVENTS = {
  always: { kind: 'bool', help: 'Always true. Use Invert to hide.', get: () => true },
  timerx: { kind: 'number', op: 'above', args: 'seconds', help: 'Seconds since the target (or its parent) became visible.', get: (e) => e.world.time - e.refTime },
  random: { kind: 'number', op: 'below', args: 'chance 0-1', help: 'A new random number 0-1 every frame.', get: () => Math.random() },
  random_timer: { kind: 'bool', args: 'min seconds@@max seconds@@hold seconds', help: 'Turns on for a moment at random intervals.', get: (e, a) => {
    const t = e.world.time;
    if (e._rtNext == null) e._rtNext = t + num(a[0] || 1) + Math.random() * (num(a[1] || 3) - num(a[0] || 1));
    if (t >= e._rtNext) { e._rtUntil = t + num(a[2] || 0.2); e._rtNext = t + num(a[0] || 1) + Math.random() * Math.max(0, num(a[1] || 3) - num(a[0] || 1)); }
    return t < (e._rtUntil || 0);
  } },
  is_on_ground: { kind: 'bool', help: 'Owner is standing on the ground.', get: (e) => e.world.player.onGround },
  is_in_air: { kind: 'bool', help: 'Owner is jumping/falling.', get: (e) => !e.world.player.onGround },
  is_crouching: { kind: 'bool', help: 'Owner is crouching (Ctrl).', get: (e) => e.world.player.crouching },
  is_running: { kind: 'bool', help: 'Owner is sprinting (Shift).', get: (e) => e.world.player.running },
  is_moving: { kind: 'bool', help: 'Owner is moving.', get: (e) => e.world.player.vel.length() > 5 },
  is_firing: { kind: 'bool', help: 'Primary attack held (left mouse in play mode).', get: (e) => e.world.input.isDown('mouse_left') },
  is_attacking2: { kind: 'bool', help: 'Secondary attack held (right mouse in play mode).', get: (e) => e.world.input.isDown('mouse_right') },
  is_flashlight_on: { kind: 'bool', help: 'Flashlight toggled with F.', get: (e) => e.world.player.flashlight },
  is_first_person: { kind: 'bool', help: 'Camera is in first person (V in play mode).', get: (e) => e.world.playMode && e.world.firstPerson },
  is_in_editor: { kind: 'bool', help: 'The editor is open (not play mode).', get: (e) => !e.world.playMode },
  is_voice_chatting: { kind: 'bool', help: 'Microphone level is above 0.05 (enable the microphone in View menu).', get: (e) => e.world.mic.level > 0.05 },
  speed: { kind: 'number', op: 'above', args: 'units/second', help: 'Owner speed.', get: (e) => e.world.player.vel.length() },
  eye_pitch: { kind: 'number', op: 'above', args: 'degrees (negative = looking up)', help: 'Owner eye pitch.', get: (e) => e.world.player.eyePitch * DEG },
  health: { kind: 'number', op: 'below', args: 'health', help: 'Owner health (set in Player settings).', get: (e) => e.world.player.health },
  armor: { kind: 'number', op: 'above', args: 'armor', help: 'Owner armor.', get: (e) => e.world.player.armor },
  camera_distance: { kind: 'number', op: 'below', args: 'units', help: 'Distance from the camera to the target.', get: (e) => e.world.camera.position.distanceTo(e.getParentWorldPosition(_v)) },
  hour: { kind: 'number', op: 'equal or above', args: 'hour 0-23', help: 'Local clock hour.', get: () => new Date().getHours() },
  button: { kind: 'bool', args: 'key (e.g. e, r, mouse_left, space, shift, 1)', help: 'A key is held down.', get: (e, a) => e.world.input.isDown(String(a[0] || '').trim().toLowerCase()) },
  command: { kind: 'bool', args: 'event name', help: 'Toggled with "pac_event <name>" in chat, HUD buttons or number keys.', get: (e, a) => !!e.world.pacEvents.get(String(a[0] || '').trim()) },
  say: { kind: 'string', op: 'find simple', args: 'text@@seconds', help: 'Something matching was said in chat recently.', get: (e, a) => (e.world.time - e.world.chat.time < num(a[1] || 4) ? e.world.chat.text : null) },
  animation: { kind: 'string', op: 'find simple', args: 'animation name', help: 'Current animation (idle, walk, run, crouch, jump, or an animation part).', get: (e) => e.world.avatar.currentAnimation },
  sequence_name: { kind: 'string', op: 'find simple', args: 'animation name', help: 'Same as animation (PAC3 name).', get: (e) => e.world.avatar.currentAnimation },
  is_typing: { kind: 'bool', help: 'The chat box is open (T in play mode).', get: (e) => !!e.world.typing },
  viewed_by_owner: { kind: 'bool', help: 'True when you are looking at your own outfit (always, here). Uninvert to hide from yourself.', get: () => true },
  weapon_class: { kind: 'string', op: 'find simple', args: 'weapon class', help: 'The weapon you are holding (set in Player settings).', get: (e) => e.world.player.weapon || 'none' },
  has_weapon: { kind: 'bool', args: 'weapon class', help: 'You carry this weapon (Player settings → weapons).', get: (e, a) => e.world.player.weapons.includes(String(a[0] || '').trim().toLowerCase()) },
  is_sitting: { kind: 'bool', help: 'A sit animation is playing.', get: (e) => /sit/.test(e.world.avatar.currentAnimation) },
  is_in_noclip: { kind: 'bool', help: 'A movement part with Noclip is active in play mode.', get: (e) => !!(e.world.fx.movement && e.world.fx.movement.noclip) },
  model_name: { kind: 'string', op: 'find simple', args: 'model path', help: 'The player model in use (an entity part Model, or "mannequin").', get: (e) => (e.world.fx.entity && e.world.fx.entity.model) || 'mannequin' },
  owner_health: { kind: 'number', op: 'below', args: 'health', help: 'Same as health (PAC3 name).', get: (e) => e.world.player.health },
};

export function compareEvent(value, op, arg, kind) {
  if (value == null) return false;
  if (op === 'maybe') return Math.random() < 0.5;
  if (kind === 'number' && (op === 'find' || op === 'find simple')) op = 'equal or above';
  const n = Number(arg);
  switch (op) {
    case 'equal': return kind === 'number' ? value === n : String(value).toLowerCase() === String(arg).toLowerCase();
    case 'not equal': return kind === 'number' ? value !== n : String(value).toLowerCase() !== String(arg).toLowerCase();
    case 'above': return num(value) > n;
    case 'below': return num(value) < n;
    case 'equal or above': return num(value) >= n;
    case 'equal or below': return num(value) <= n;
    case 'find': return String(value).includes(String(arg));
    default: return String(value).toLowerCase().includes(String(arg).toLowerCase());
  }
}
