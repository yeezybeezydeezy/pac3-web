// The world owns the part tree and runs the per-frame pipeline:
// events -> visibility -> proxies -> avatar pose -> modifier parts -> everything else.
import { PartRegistry, instantiate } from './part.js';
import { uid } from './util.js';

export class World {
  constructor({ scene, camera, avatar, player, audio, input }) {
    Object.assign(this, { scene, camera, avatar, player, audio, input });
    this.roots = [];
    this.transientRoots = [];
    this.parts = new Map();
    this.time = 0;
    this.dt = 0;
    this.frame = 0;
    this.playMode = false;
    this.firstPerson = false;
    this.pacEvents = new Map();
    this.pacProxies = new Map();
    this.chat = { text: '', time: -1e9 };
    this.mic = { level: 0 };
    this.fx = { shake: 0, fog: null, camera: null, movement: null };
    this._all = [];
    this._allDirty = true;
    this._proxied = new Map();
    this._listeners = {};
  }

  on(evt, fn) { (this._listeners[evt] ||= []).push(fn); return () => { this._listeners[evt] = this._listeners[evt].filter((f) => f !== fn); }; }
  emit(evt, ...args) { for (const fn of this._listeners[evt] || []) fn(...args); }

  createPart(className) {
    const C = PartRegistry.get(className);
    if (!C) throw new Error(`Unknown part type ${className}`);
    return new C(this);
  }
  getPart(id) { return id ? this.parts.get(id) || null : null; }

  /** Inserts (or moves) a part. parent = null puts it at the root. */
  addPart(part, parent = null, index = -1) {
    if (part.inWorld) this._unlink(part);
    const list = parent ? parent.children : part.transient ? this.transientRoots : this.roots;
    if (index < 0 || index > list.length) list.push(part); else list.splice(index, 0, part);
    part.parent = parent;
    part.traverse((p) => {
      if (p.inWorld) return;
      if (this.parts.has(p.UniqueID)) p.UniqueID = uid();
      this.parts.set(p.UniqueID, p);
      p.inWorld = true;
      p.transient = part.transient;
      p.onAdded();
    });
    part.traverse((p) => p.attach && p.attach());
    this._structureChanged(part.transient);
    return part;
  }

  removePart(part) {
    if (!part.inWorld) return;
    this._unlink(part);
    const kill = (p) => {
      for (const c of [...p.children]) kill(c);
      p.destroy();
      p.inWorld = false;
      if (this.parts.get(p.UniqueID) === p) this.parts.delete(p.UniqueID);
    };
    kill(part);
    this._structureChanged(part.transient);
  }

  clear() { for (const r of [...this.roots]) this.removePart(r); }

  _unlink(part) {
    const list = part.parent ? part.parent.children : part.transient ? this.transientRoots : this.roots;
    const i = list.indexOf(part);
    if (i >= 0) list.splice(i, 1);
    part.parent = null;
  }

  _structureChanged(transient) {
    this._allDirty = true;
    if (!transient) this.emit('structure');
  }

  /** Deserializes untrusted data and adds it to the world. */
  load(data, parent = null, opts = {}) {
    const part = instantiate(this, data, opts);
    if (!part) return null;
    if (opts.transient) part.traverse((p) => { p.transient = true; });
    return this.addPart(part, parent, opts.index ?? -1);
  }

  get allParts() {
    if (this._allDirty) {
      const out = [];
      const walk = (p) => { out.push(p); for (const c of p.children) walk(c); };
      for (const r of this.roots) walk(r);
      for (const r of this.transientRoots) walk(r);
      this._all = out;
      this._allDirty = false;
    }
    return this._all;
  }

  findPartsByClass(cls) { return this.allParts.filter((p) => p.className === cls); }

  update(dt) {
    this.dt = dt;
    this.time += dt;
    this.frame++;
    const all = this.allParts;
    this.fx.shake = 0;
    this.fx.fog = null;
    this.fx.camera = null;
    this.fx.movement = null;
    this.fx.entity = null;

    // A failing part reports its error instead of stopping the frame loop.
    const safe = (p, fn) => { try { fn(); } catch (e) { p.status = `Error: ${e.message}`.slice(0, 200); if (!p._errLogged) { p._errLogged = true; console.error('[pac3]', p.className, e); } } };

    // 1. events decide what is hidden
    for (const p of all) p.eventHidden = false;
    for (const p of all) if (p.evaluate && !p.Hide) safe(p, () => p.evaluate());

    // 2. visibility (fires onShow / onHide)
    const vis = (p, parentHidden) => {
      const hidden = parentHidden || p.Hide || p.eventHidden;
      if (hidden !== p.hiddenNow || !p._visInit) {
        p._visInit = true;
        p.hiddenNow = hidden;
        if (hidden) { if (p._shown) { p._shown = false; safe(p, () => p.onHide()); } }
        else { p._shown = true; p.shownTime = this.time; safe(p, () => p.onShow()); }
      }
      for (const c of p.children) vis(c, hidden);
    };
    for (const r of this.roots) vis(r, false);
    for (const r of this.transientRoots) vis(r, false);

    // 3. proxies write properties; anything no longer driven is restored
    const touched = new Map();
    for (const p of all) if (p.runProxy && !p.hiddenNow) safe(p, () => p.runProxy(touched));
    for (const [key, e] of this._proxied) if (!touched.has(key) && e.part.inWorld) e.part.restoreProxied(e.name);
    this._proxied = touched;

    // 4. avatar pose (animation parts blend into it)
    this.avatar.update(dt, this.player, all.filter((p) => p.className === 'animation' && !p.hiddenNow), this);

    // 5. modifiers, then everything else in tree order
    for (const p of all) if (p.constructor.priority === 0) safe(p, () => p.update(dt));
    this.scene.updateMatrixWorld();
    for (const p of all) if (p.constructor.priority !== 0) safe(p, () => p.update(dt));
  }

  // Command handling shared by chat, command parts and HUD buttons.
  runCommand(line) {
    const parts = String(line).trim().replace(/^\//, '').split(/\s+/);
    const cmd = (parts.shift() || '').toLowerCase();
    if (cmd === 'pac_event') {
      const name = parts[0];
      if (!name) return 'usage: pac_event <name> [on|off|toggle]';
      const mode = (parts[1] || 'toggle').toLowerCase();
      const cur = !!this.pacEvents.get(name);
      const next = mode === '1' || mode === 'on' ? true : mode === '0' || mode === 'off' ? false : !cur;
      this.pacEvents.set(name, next);
      this.emit('pac_event', name, next);
      return `pac_event ${name} = ${next ? 'on' : 'off'}`;
    }
    if (cmd === 'pac_proxy') {
      const n = Number(parts[1]);
      if (!parts[0] || !Number.isFinite(n)) return 'usage: pac_proxy <name> <number>';
      this.pacProxies.set(parts[0], n);
      return `pac_proxy ${parts[0]} = ${n}`;
    }
    if (cmd === 'say') { this.say(parts.join(' ')); return null; }
    if (cmd === 'pac_wipe_events') { this.pacEvents.clear(); this.emit('pac_event'); return 'pac events cleared'; }
    if (cmd === 'pac_event_sequenced') {
      // pac_event_sequenced <name> [+|-|set N]: steps through events named name1, name2, ...
      const name = parts[0];
      if (!name) return 'usage: pac_event_sequenced <name> [+|-|set <n>]';
      const seq = [...new Set(this.allParts.filter((p) => p.className === 'event' && p.Event === 'command').map((p) => p.Arguments.split('@@')[0].trim()))]
        .filter((n) => n.startsWith(name) && /^\d+$/.test(n.slice(name.length))).sort((a, b) => Number(a.slice(name.length)) - Number(b.slice(name.length)));
      if (!seq.length) return `no events named ${name}1, ${name}2…`;
      let cur = seq.findIndex((n) => this.pacEvents.get(n));
      const op = (parts[1] || '+').toLowerCase();
      cur = op === 'set' ? Math.max(0, Number(parts[2]) - 1) : op === '-' ? (cur - 1 + seq.length) % seq.length : (cur + 1) % seq.length;
      for (const n of seq) this.pacEvents.set(n, false);
      this.pacEvents.set(seq[cur % seq.length], true);
      this.emit('pac_event');
      return `pac_event_sequenced ${seq[cur % seq.length]}`;
    }
    if (cmd.startsWith('pac_')) return `${cmd} is not supported here (ignored)`;
    return `unknown command: ${cmd}`;
  }

  say(text) {
    this.chat = { text: String(text).slice(0, 200), time: this.time };
    this.emit('chat', this.chat.text);
  }
}
