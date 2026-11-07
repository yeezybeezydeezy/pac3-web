// Part base class, property schema, registry and (de)serialization.
import { uid, deepClone, deepEqual, clamp } from './util.js';

export const PartRegistry = new Map();
export function registerPart(cls) { PartRegistry.set(cls.className, cls); return cls; }

// Accept the class names used by PAC3 itself when importing JSON.
export const CLASS_ALIASES = { model2: 'model', bone2: 'bone', bone3: 'bone', light2: 'light', trail2: 'trail', sound2: 'sound', clip2: 'clip', entity2: 'entity', material_3d: 'material' };

/**
 * Property definition. Types: string, text, expression, number, boolean, vector, angle,
 * color, enum, asset (free text + suggestions + upload), part (UniqueID ref), bone.
 */
export const prop = (name, type, def, opts = {}) => ({ name, type, default: def, group: 'generic', ...opts });

const MAX_STR = 400000;
export const LIMITS = { maxParts: 3000, maxDepth: 64 };

export function coerce(def, v) {
  switch (def.type) {
    case 'number': {
      let n = Number(v);
      if (!Number.isFinite(n)) return def.default;
      if (def.min != null) n = Math.max(def.min, n);
      if (def.max != null) n = Math.min(def.max, n);
      return def.integer ? Math.round(n) : n;
    }
    case 'boolean': return v === true || v === 1 || v === 'true';
    case 'vector': case 'angle': case 'color': {
      const a = Array.isArray(v) ? v : typeof v === 'number' ? [v, v, v] : null;
      if (!a) return deepClone(def.default);
      const out = [0, 1, 2].map((i) => { const n = Number(a[i]); return Number.isFinite(n) ? n : def.default[i]; });
      return def.type === 'color' ? out.map((x) => clamp(x, 0, 1)) : out;
    }
    case 'enum': {
      const s = String(v ?? '');
      return def.free || def.options.includes(s) ? s.slice(0, MAX_STR) : def.default;
    }
    default: return String(v ?? '').slice(0, MAX_STR);
  }
}

export class Part {
  static className = 'base';
  static icon = '•';
  static category = 'generic';
  static description = '';
  static movable = false;
  static priority = 1; // 0 = updated before matrices (bone/entity modifiers)
  static props = [
    prop('Name', 'string', ''),
    prop('Hide', 'boolean', false),
    prop('Notes', 'text', ''),
  ];

  static get schema() {
    if (Object.hasOwn(this, '_schema')) return this._schema;
    const parent = Object.getPrototypeOf(this);
    const map = new Map(parent.schema ? parent.schema.map((p) => [p.name, p]) : []);
    if (Object.hasOwn(this, 'props')) for (const p of this.props) map.set(p.name, map.has(p.name) ? { ...map.get(p.name), ...p } : p);
    for (const name of this.removeProps || []) map.delete(name);
    this._schema = [...map.values()];
    this._schemaMap = map;
    return this._schema;
  }
  static getProp(name) { return this.schema && this._schemaMap.get(name); }

  constructor(world) {
    this.world = world;
    this.parent = null;
    this.children = [];
    this.UniqueID = uid();
    for (const p of this.constructor.schema) this[p.name] = deepClone(p.default);
    this.inWorld = false;
    this.transient = false;
    this.hiddenNow = true;
    this._visInit = false;
    this._shown = false;
    this.eventHidden = false;
    this.shownTime = 0;
    this.status = '';
    this._proxyBase = new Map();
  }

  get className() { return this.constructor.className; }
  get displayName() { return this.Name || this.className; }

  /** Normal (user / load) property write. */
  setProp(name, value) {
    const def = this.constructor.getProp(name);
    if (!def) return;
    value = coerce(def, value);
    if (this._proxyBase.has(name)) { this._proxyBase.set(name, value); return; }
    const old = this[name];
    this[name] = value;
    this.onPropChanged(name, old);
  }
  /** Proxy write: remembers the stored value so it can be restored and serialized. */
  setProxied(name, value) {
    if (!this._proxyBase.has(name)) this._proxyBase.set(name, deepClone(this[name]));
    this[name] = value;
    this.onPropChanged(name);
  }
  restoreProxied(name) {
    if (!this._proxyBase.has(name)) return;
    this[name] = this._proxyBase.get(name);
    this._proxyBase.delete(name);
    this.onPropChanged(name);
  }
  getStored(name) { return this._proxyBase.has(name) ? this._proxyBase.get(name) : this[name]; }
  isProxied(name) { return this._proxyBase.has(name); }

  // Lifecycle hooks
  onPropChanged(_name, _old) {}
  onAdded() {}
  onShow() {}
  onHide() {}
  update(_dt) {}
  destroy() {}

  traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
  getRoot() { let p = this; while (p.parent) p = p.parent; return p; }
  isDescendantOf(other) { for (let p = this.parent; p; p = p.parent) if (p === other) return true; return false; }
  timeShown() { return this.world.time - this.shownTime; }

  serialize() {
    const self = { ClassName: this.className, UniqueID: this.UniqueID };
    for (const p of this.constructor.schema) {
      const v = this.getStored(p.name);
      if (!deepEqual(v, p.default)) self[p.name] = deepClone(v);
    }
    return { self, children: this.children.map((c) => c.serialize()) };
  }
}

function collectIds(node, map, depth = 0) {
  if (!node || typeof node !== 'object' || depth > LIMITS.maxDepth) return;
  const id = node.self && node.self.UniqueID;
  if (typeof id === 'string') map.set(id, uid());
  if (Array.isArray(node.children)) for (const c of node.children) collectIds(c, map, depth + 1);
}

/**
 * Builds a detached part tree from serialized data. Untrusted input: validates shape,
 * limits size/depth, coerces every property to its schema type and ignores unknown keys.
 */
export function instantiate(world, data, { newIds = false, counter = { n: 0 }, warnings = [] } = {}) {
  let idMap = null;
  if (newIds) { idMap = new Map(); collectIds(data, idMap); }
  const build = (node, depth) => {
    if (!node || typeof node !== 'object' || !node.self || typeof node.self !== 'object') throw new Error('Invalid part data');
    if (depth > LIMITS.maxDepth) throw new Error('Outfit is nested too deeply');
    if (++counter.n > LIMITS.maxParts) throw new Error(`Outfit has more than ${LIMITS.maxParts} parts`);
    const name = String(node.self.ClassName || '');
    const cls = PartRegistry.get(CLASS_ALIASES[name] || name);
    if (!cls) { warnings.push(`Unknown part type "${name.slice(0, 40)}" skipped`); return null; }
    const part = new cls(world);
    const id = node.self.UniqueID;
    if (idMap) part.UniqueID = idMap.get(id) || uid();
    else if (typeof id === 'string' && /^[\w-]{1,64}$/.test(id)) part.UniqueID = id;
    part._loading = true;
    for (const def of cls.schema) {
      if (!Object.hasOwn(node.self, def.name)) continue;
      let v = node.self[def.name];
      if (def.type === 'part' && idMap && idMap.has(v)) v = idMap.get(v);
      part.setProp(def.name, v);
    }
    part._loading = false;
    for (const k of Array.isArray(node.children) ? node.children : []) {
      const c = build(k, depth + 1);
      if (c) { c.parent = part; part.children.push(c); }
    }
    return part;
  };
  return build(data, 0);
}
