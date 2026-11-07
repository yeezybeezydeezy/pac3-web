// Converts PAC3 outfits (Garry's Mod data/pac3/*.txt) into PAC3 Web outfits.
// Positions/scales are re-ordered from Source axes (X fwd, Y left, Z up) to ours (X left, Y up, Z fwd);
// Source angles (pitch, yaw, roll) already match ours. Top-level groups get CoordinateSpace "source"
// so bone-attached parts use Source bone axes.
import { parseLuaData } from './luadata.js';
import { EVENTS } from '../core/inputs.js';
import { SEQUENCE_NAMES } from '../avatar.js';

const CLASS = {
  group: 'group', model2: 'model', model: 'model', entity2: 'entity', entity: 'entity', bone3: 'bone', bone2: 'bone', bone: 'bone',
  light2: 'light', light: 'light', sprite: 'sprite', text: 'text', trail2: 'trail', trail: 'trail', beam: 'beam', particles: 'particles',
  sound2: 'sound', sound: 'sound', ogg: 'sound', webaudio: 'sound', proxy: 'proxy', event: 'event', command: 'command',
  animation: 'animation', jiggle: 'jiggle', clip2: 'clip', clip: 'clip', material_3d: 'material', material: 'material',
  material_2d: 'material', material_eye_refract: 'material', material_refract: 'material', projectile: 'projectile',
  sunbeams: 'sunbeams', fog: 'fog', halo: 'halo', shake: 'shake', camera: 'camera', info: 'info', player_movement: 'movement',
};
// PAC3 defaults that differ from PAC3 Web's, applied when a saved outfit omits the key.
const PAC_DEFAULTS = {
  model: { Model: '' },
  sprite: { Size: 1, SpritePath: 'sprites/grip' },
  particles: { Additive: false, DieTime: 3, StartSize: 2, EndSize: 20, FireDelay: 0.2, Velocity: 250, Spread: 0.1, AirResistance: 5, Bounce: 5, Material: 'effects/slime1', Gravity: { $type: 'Vector', v: [0, 0, -50] }, StartAlpha: 255, Color1: { $type: 'Vector', v: [255, 255, 255] }, Color2: { $type: 'Vector', v: [255, 255, 255] } },
  trail: { Spacing: 0.25, StartSize: 3, TrailPath: 'trails/laser' },
  beam: { Width: 1, Material: 'cable/rope' },
  event: { Event: '' },
  command: { String: '' },
  sound: { Path: '' },
  text: { Text: '', Outline: 0 },
  animation: { SequenceName: '' },
};
const SPATIAL = new Set(['Position', 'PositionOffset', 'Scale', 'Gravity', 'ConstantVelocity']);
const COLOR255 = { sprite: ['Color'], beam: ['StartColor', 'EndColor'], particles: ['Color1', 'Color2', 'StartAlpha', 'EndAlpha'], text: ['Color', 'OutlineColor'] };
const FONTS = { dermadefault: 'Arial', dermalarge: 'Arial', dermadefaultbold: 'Arial', closecaption_normal: 'Verdana', chatfont: 'Verdana', trebuchet24: 'Trebuchet MS', trebuchet18: 'Trebuchet MS', hudnumber5: 'Impact', default: 'Arial' };
const SEQ_WORDS = [['dance', 'dance'], ['robot', 'robot'], ['wave', 'wave'], ['cheer', 'cheer'], ['salute', 'salute'], ['zombie', 'zombie'], ['sit', 'sit'], ['bow', 'bow'], ['laugh', 'clap'], ['muscle', 'flex'], ['pers', 'flex'], ['point', 'point'], ['swim', 'swim'], ['fly', 'fly'], ['lay', 'lay'], ['run', 'run'], ['walk', 'walk'], ['crouch', 'crouch'], ['jump', 'jump']];

const isVec = (v) => v && typeof v === 'object' && (v.$type === 'Vector' || v.$type === 'Angle' || v.$type === 'Color');
const vec = (v) => (isVec(v) ? v.v.slice(0, 3) : Array.isArray(v) ? v.slice(0, 3) : typeof v === 'number' ? [v, v, v] : null);
const srcToOurs = (v) => [v[1], v[2], v[0]];

/** Parses PAC3 text and returns { data (PAC3 Web outfit), warnings }. */
export function importPac3(text) {
  const parsed = parseLuaData(text);
  const roots = (Array.isArray(parsed) ? parsed : [parsed]).filter((n) => n && typeof n === 'object' && n.self);
  if (!roots.length) throw new Error('No PAC3 parts found in this file');
  const warnings = new Set();

  // index parts by UID and name so references and proxy targets can be resolved
  const byId = new Map(), byName = new Map(), parentOf = new Map();
  const index = (n, parent, depth) => {
    if (depth > 64 || !n || !n.self) return;
    const id = String(n.self.UniqueID || '');
    if (id) byId.set(id, n);
    if (n.self.Name) byName.set(String(n.self.Name), n);
    parentOf.set(n, parent);
    for (const c of Array.isArray(n.children) ? n.children : []) index(c, n, depth + 1);
  };
  roots.forEach((r) => index(r, null, 0));
  const classOf = (n) => (n ? CLASS[String(n.self.ClassName)] || null : null);

  const convert = (n, depth) => {
    const pacClass = String(n.self.ClassName || '');
    const cls = CLASS[pacClass];
    const kids = (Array.isArray(n.children) ? n.children : []).flatMap((c) => convert(c, depth + 1));
    if (!cls) {
      warnings.add(`"${pacClass}" parts are not supported (children kept)`);
      return kids;
    }
    const src = { ...PAC_DEFAULTS[cls], ...n.self };
    const self = { ClassName: cls };
    for (const [k, raw] of Object.entries(src)) {
      if (k === 'ClassName') continue;
      if (/UID$/.test(k) && k !== 'UniqueID') { if (raw) self[k.slice(0, -3)] = String(raw); continue; }
      if (/Name$/.test(k) && k !== 'Name' && byName.has(String(raw))) { self[k.slice(0, -4)] = String(byName.get(String(raw)).self.UniqueID || ''); continue; }
      let v = raw;
      if (isVec(v)) {
        v = vec(v);
        if (SPATIAL.has(k)) v = srcToOurs(v);
      }
      if (COLOR255[cls] && COLOR255[cls].includes(k)) v = Array.isArray(v) ? v.map((x) => x / 255) : Number(v) / 255;
      self[k] = v;
    }
    switch (cls) {
      case 'particles':
        if (self.Color1) self.StartColor = self.Color1;
        if (self.Color2) self.EndColor = self.Color2;
        self.Bounce = Math.min(1, Math.max(0, Number(self.Bounce) / 10));
        break;
      case 'entity':
        if (self.NoDraw != null) self.HideEntity = !!self.NoDraw;
        break;
      case 'text':
        self.Font = FONTS[String(self.Font || '').toLowerCase()] || 'Arial';
        break;
      case 'animation': {
        const s = String(self.SequenceName || '').toLowerCase();
        const hit = SEQ_WORDS.find(([w]) => s.includes(w));
        // keep Garry's Mod sequence names: they play from mounted content, else the closest built-in animation is used
        if (!s) self.SequenceName = 'idle';
        void hit;
        break;
      }
      case 'event':
        if (!Object.hasOwn(EVENTS, String(self.Event))) {
          warnings.add(`Event "${self.Event || '(none)'}" is not supported; those events are disabled`);
          self.Notes = `PAC3 event "${self.Event}" (${self.Operator || ''} ${self.Arguments || ''}) is not supported in PAC3 Web.`;
          self.Event = 'always';
          self.Hide = true;
        }
        break;
      case 'material': {
        // Source shader parameters (lowercase keys) -> material part
        const p = n.self;
        if (p.basetexture) self.BaseTexture = String(p.basetexture);
        if (p.bumpmap) self.BumpMap = String(p.bumpmap);
        const tint = vec(p.color2) || vec(p.color);
        if (tint) self.Color = tint.map((x) => Math.min(1, x));
        if (p.alpha != null) self.Alpha = Number(p.alpha);
        if (p.selfillum) self.Emissive = vec(p.selfillumtint) || [0.6, 0.6, 0.6];
        self.Roughness = p.phong ? Math.max(0.15, 0.5 - Number(p.phongboost || 1) * 0.08) : 0.75;
        if (p.envmap) self.Metalness = 0.3;
        if (p.detail) warnings.add('Material detail textures are not supported');
        break;
      }
      case 'proxy': {
        const target = self.TargetPart ? byId.get(self.TargetPart) : self.AffectChildren ? null : parentOf.get(n);
        const tcls = classOf(target);
        const name = String(self.VariableName || '');
        const axisMap = { x: 'z', y: 'x', z: 'y' };
        const wrap = (fn) => { for (const k of ['Expression']) if (self[k] && String(self[k]).trim()) self[k] = `${fn}(${self[k]})`; };
        if (SPATIAL.has(name)) {
          if (self.Axis && axisMap[String(self.Axis).toLowerCase()]) self.Axis = axisMap[String(self.Axis).toLowerCase()];
          else if (!self.Axis) wrap('src_vec');
        }
        if (tcls && COLOR255[tcls] && COLOR255[tcls].includes(name)) wrap('div255');
        if (tcls === 'particles' && (name === 'Color1' || name === 'Color2')) self.VariableName = name === 'Color1' ? 'StartColor' : 'EndColor';
        // Source shader parameters driven on material parts
        const MAT_PARAMS = { basetexture: 'BaseTexture', bumpmap: 'BumpMap', color2: 'Color', color: 'Color', alpha: 'Alpha', selfillumtint: 'Emissive' };
        if (tcls === 'material' && MAT_PARAMS[name.toLowerCase()]) self.VariableName = MAT_PARAMS[name.toLowerCase()];
        break;
      }
      default:
    }
    return [{ self, children: kids }];
  };

  const parts = roots.flatMap((r) => convert(r, 0)).map((p) => {
    const root = p.self.ClassName === 'group' ? p : { self: { ClassName: 'group', Name: 'imported outfit' }, children: [p] };
    root.self.CoordinateSpace = 'source';
    return root;
  });
  return { data: { format: 'pac3-web', version: 1, parts }, warnings: [...warnings] };
}
