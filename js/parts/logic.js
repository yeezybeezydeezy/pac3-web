// event, proxy, command, animation, movement
import * as THREE from 'three';
import { Part, prop, registerPart } from '../core/part.js';
import { EVENTS, EVENT_OPERATORS, compareEvent, PROXY_FUNCTIONS, PROXY_CONSTANTS, PROXY_INPUT_NAMES, EASY_FUNCTIONS } from '../core/inputs.js';
import { compileExpression, num } from '../core/expression.js';
import { SEQUENCE_NAMES } from '../avatar.js';
import { MOVEMENT_DEFAULTS } from '../player.js';

const _p = new THREE.Vector3();

/** Shared: world position of the nearest movable target/ancestor (or the owner). */
function parentWorldPosition(part, out, start) {
  for (let p = start; p; p = p.parent) if (p.getWorldPosition) return p.getWorldPosition(out);
  return part.world.avatar.root.getWorldPosition(out);
}

export class EventPart extends Part {
  static className = 'event';
  static icon = '⏱️';
  static category = 'logic';
  static description = 'Shows or hides its parent based on a condition (crouching, a key, chat, a timer…). With Invert on (default) the parent is shown only while the condition is true.';
  static props = [
    prop('Event', 'enum', 'is_crouching', { options: Object.keys(EVENTS) }),
    prop('Operator', 'enum', 'find simple', { options: EVENT_OPERATORS }),
    prop('Arguments', 'string', '', { help: 'Separate multiple arguments with @@' }),
    prop('Invert', 'boolean', true, { help: 'On: show the target only while the event is true. Off: hide it while true.' }),
    prop('AffectChildrenOnly', 'boolean', false, { help: 'Hide this event\'s own children instead of its parent.' }),
    prop('TargetPart', 'part', '', { help: 'Hide this part instead of the parent.' }),
  ];
  constructor(world) { super(world); this.refTime = world.time; this.active = false; this._anchorVis = false; }
  onPropChanged(name) {
    // picking a new event in the editor selects that event's natural operator
    if (name === 'Event' && !this._loading && EVENTS[this.Event] && EVENTS[this.Event].op) this.Operator = EVENTS[this.Event].op;
  }
  getTargets() {
    const t = this.TargetPart ? this.world.getPart(this.TargetPart) : null;
    if (t) return [t];
    if (this.AffectChildrenOnly) return this.children;
    return this.parent ? [this.parent] : [];
  }
  getParentWorldPosition(out) { return parentWorldPosition(this, out, this.getTargets()[0]); }
  evaluate() {
    const def = EVENTS[this.Event];
    if (!def) { this.status = `Unknown event "${this.Event}"`; return; }
    const targets = this.getTargets();
    const anchor = targets[0] && targets[0].parent;
    const vis = anchor ? !anchor.hiddenNow : true;
    if (vis && !this._anchorVis) this.refTime = this.world.time;
    this._anchorVis = vis;
    const args = this.Arguments.split('@@');
    const tp = this.getParentWorldPosition(_p);
    if (this._lastPos && this.world.dt > 0) this.parentVel = (this.parentVel || new THREE.Vector3()).subVectors(tp, this._lastPos).divideScalar(this.world.dt);
    this._lastPos = (this._lastPos || new THREE.Vector3()).copy(tp);
    const v = def.get(this, args);
    this.active = def.kind === 'bool' ? !!v : compareEvent(v, this.Operator, args[def.cmp ?? 0], def.kind);
    this.status = `${this.Event} is ${this.active ? 'TRUE' : 'false'}${targets.length ? '' : ' (no target)'}`;
    this.triggered = this.Invert ? !this.active : this.active;
    if (this.triggered) for (const t of targets) t.eventHidden = true;
  }
}
registerPart(EventPart);

const DRIVABLE = new Set(['number', 'boolean', 'vector', 'angle', 'color', 'string', 'text']);
const AXES = { x: 0, y: 1, z: 2, p: 0, r: 2, g: 1, b: 2 };

export class ProxyPart extends Part {
  static className = 'proxy';
  static icon = '🧮';
  static category = 'logic';
  static description = 'Drives a property of its parent (or TargetPart) every frame with an expression, e.g. sin(time()*4)*10. Leave Expression empty to use the easy setup.';
  static props = [
    prop('VariableName', 'enum', '', { free: true, options: [], help: 'Property of the target to drive.' }),
    prop('Expression', 'expression', ''),
    prop('TargetPart', 'part', ''),
    prop('AffectChildren', 'boolean', false, { help: 'Drive this proxy\'s children instead of its parent.' }),
    prop('Axis', 'enum', '', { options: ['', 'x', 'y', 'z'], help: 'For vectors/angles/colors: drive one component (x/y/z = pitch/yaw/roll = r/g/b).' }),
    prop('Additive', 'boolean', false, { help: 'Add to the stored value instead of replacing it.' }),
    prop('Input', 'enum', 'time', { group: 'easy setup', options: PROXY_INPUT_NAMES }),
    prop('Function', 'enum', 'sin', { group: 'easy setup', options: Object.keys(EASY_FUNCTIONS) }),
    prop('InputMultiplier', 'number', 1, { group: 'easy setup', step: 0.1 }),
    prop('InputDivider', 'number', 1, { group: 'easy setup', step: 0.1 }),
    prop('Offset', 'number', 0, { group: 'easy setup', step: 0.1 }),
    prop('Pow', 'number', 1, { group: 'easy setup', step: 0.1 }),
    prop('Min', 'number', 0, { group: 'easy setup', step: 0.1 }),
    prop('Max', 'number', 1, { group: 'easy setup', step: 0.1 }),
    ...[1, 2, 3, 4, 5].map((i) => prop(`Extra${i}`, 'expression', '', { group: 'extra expressions', help: `Computed before Expression; read it as var${i}() here, or var${i}("name or uid") from another proxy.` })),
  ];
  constructor(world) { super(world); this.feedback = null; this.output = []; this.extraOut = [0, 0, 0, 0, 0]; this._extra = []; this.parentVel = new THREE.Vector3(); this._lastPos = null; }
  _compile(src, slot) {
    const c = (this._compiled ||= {});
    if (!c[slot] || c[slot].src !== src) {
      try { c[slot] = { src, fn: compileExpression(src, { functions: PROXY_FUNCTIONS, constants: PROXY_CONSTANTS }), err: '' }; }
      catch (e) { c[slot] = { src, fn: null, err: e.message }; }
    }
    return c[slot];
  }
  onShow() { this._randomOnce = null; }
  getTargets() {
    const t = this.TargetPart ? this.world.getPart(this.TargetPart) : null;
    if (t) return [t];
    if (this.AffectChildren) return this.children;
    return this.parent ? [this.parent] : [];
  }
  /** Property names the editor offers for VariableName. */
  getVariableOptions() {
    const t = this.getTargets()[0];
    return t ? t.constructor.schema.filter((d) => DRIVABLE.has(d.type) && d.name !== 'Name' && d.name !== 'Notes').map((d) => d.name) : [];
  }
  getParentWorldPosition(out) { return parentWorldPosition(this, out, this.getTargets()[0]); }
  compute() {
    for (let i = 0; i < 5; i++) {
      const src = this[`Extra${i + 1}`];
      if (!src.trim()) { this.extraOut[i] = 0; continue; }
      const c = this._compile(src, i);
      if (!c.fn) { this.status = `Extra${i + 1} error: ${c.err}`; return null; }
      try { this.extraOut[i] = c.fn(this)[0] || 0; } catch (e) { this.status = `Extra${i + 1} error: ${e.message}`; return null; }
    }
    if (this.Expression.trim()) {
      const c = this._compile(this.Expression, 'main');
      if (!c.fn) { this.status = `Expression error: ${c.err}`; return null; }
      try { return c.fn(this); } catch (e) { this.status = `Expression error: ${e.message}`; return null; }
    }
    const input = PROXY_FUNCTIONS[this.Input];
    const x = num(input ? input(this) : 0) * this.InputMultiplier / (this.InputDivider || 1) + this.Offset;
    let y = (EASY_FUNCTIONS[this.Function] || EASY_FUNCTIONS.none)(x);
    if (this.Pow !== 1) y = Math.sign(y) * Math.pow(Math.abs(y), this.Pow);
    return [this.Min + (this.Max - this.Min) * y];
  }
  runProxy(touched) {
    const w = this.world;
    this.getParentWorldPosition(_p);
    if (this._lastPos && w.dt > 0) { this.parentVel.subVectors(_p, this._lastPos).divideScalar(w.dt); this._delta = (this._delta || new THREE.Vector3()).subVectors(_p, this._lastPos); }
    this._lastPos = (this._lastPos || new THREE.Vector3()).copy(_p);

    const values = this.compute();
    if (!values) return;
    if (!values.length) values.push(0);
    this.feedback = values;
    this.output = values;
    const name = this.VariableName;
    const targets = this.getTargets();
    if (!name) { this.status = 'Pick a VariableName (property to drive).'; return; }
    if (!targets.length) { this.status = 'No target: put the proxy inside the part to drive.'; return; }
    let ok = 0;
    for (const t of targets) {
      if (t === this) continue;
      const def = t.constructor.getProp(name);
      if (!def || !DRIVABLE.has(def.type) || name === 'Name') continue;
      const key = `${t.UniqueID}|${name}`;
      const base = touched.has(key) ? t[name] : t.getStored(name);
      let v;
      const a = this.Additive;
      if (def.type === 'number') {
        v = (a ? base : 0) + values[0];
        if (def.min != null) v = Math.max(def.min, v);
        if (def.max != null) v = Math.min(def.max, v);
      } else if (def.type === 'boolean') v = values[0] >= 0.5;
      else if (def.type === 'string' || def.type === 'text') v = String(Number(values[0].toFixed(3)));
      else {
        v = base.slice();
        const ax = AXES[this.Axis];
        if (ax != null) v[ax] = (a ? v[ax] : 0) + values[0];
        else for (let i = 0; i < 3; i++) v[i] = (a ? v[i] : 0) + (values.length >= 3 ? values[i] : values[0]);
      }
      t.setProxied(name, v);
      touched.set(key, { part: t, name });
      ok++;
    }
    this.status = ok ? '' : `Target has no drivable property "${name}".`;
  }
}
registerPart(ProxyPart);

export class CommandPart extends Part {
  static className = 'command';
  static icon = '⌨️';
  static category = 'logic';
  static description = 'Runs commands when shown/hidden: pac_event <name> [on|off|toggle], pac_proxy <name> <number>, say <text>. Separate with ;';
  static props = [
    prop('String', 'string', 'pac_event my_event toggle', { help: 'Run when this part becomes visible.' }),
    prop('OnHide', 'string', '', { help: 'Run when this part becomes hidden.' }),
  ];
  run(str) { for (const c of String(str).split(';')) if (c.trim()) this.world.runCommand(c); }
  onShow() { this.run(this.String); }
  onHide() { this.run(this.OnHide); }
}
registerPart(CommandPart);

export class AnimationPart extends Part {
  static className = 'animation';
  static icon = '🏃';
  static category = 'model';
  static description = 'Plays an animation sequence on the player model while visible.';
  static props = [
    prop('SequenceName', 'enum', 'wave', { options: SEQUENCE_NAMES, free: true, help: 'A built-in animation, or any sequence of the model (e.g. taunt_dance, gesture_wave, sit_zen) when game content is mounted.' }),
    prop('Rate', 'number', 1, { step: 0.1 }),
    prop('Weight', 'number', 1, { min: 0, max: 1, step: 0.05, help: 'Blend with the normal movement animation.' }),
    prop('Loop', 'boolean', true),
    prop('PingPongLoop', 'boolean', false),
    prop('Offset', 'number', 0, { step: 0.05, help: 'Cycle offset.' }),
    prop('Min', 'number', 0, { min: 0, max: 1, step: 0.05 }),
    prop('Max', 'number', 1, { min: 0, max: 1, step: 0.05 }),
    prop('ResetOnHide', 'boolean', true),
  ];
  getSequenceOptions() { return this.world.avatar.getSequenceNames(); }
  cycle(speed) {
    const t = this.ResetOnHide ? this.timeShown() : this.world.time;
    const x = t * speed * this.Rate + this.Offset;
    let f;
    if (!this.Loop) f = Math.min(Math.max(x, 0), 1);
    else if (this.PingPongLoop) { const m = ((x % 2) + 2) % 2; f = m > 1 ? 2 - m : m; }
    else f = ((x % 1) + 1) % 1;
    return this.Min + (this.Max - this.Min) * f;
  }
}
registerPart(AnimationPart);

export class MovementPart extends Part {
  static className = 'movement';
  static icon = '👟';
  static category = 'modifiers';
  static description = 'Changes how the player moves in play mode while visible: speed, jump, gravity, noclip flying.';
  static props = [
    prop('WalkSpeed', 'number', MOVEMENT_DEFAULTS.walkSpeed, { min: 0, step: 10 }),
    prop('RunSpeed', 'number', MOVEMENT_DEFAULTS.runSpeed, { min: 0, step: 10 }),
    prop('CrouchSpeed', 'number', MOVEMENT_DEFAULTS.crouchSpeed, { min: 0, step: 10 }),
    prop('JumpHeight', 'number', MOVEMENT_DEFAULTS.jumpPower, { min: 0, step: 10, help: 'Jump velocity.' }),
    prop('Gravity', 'number', MOVEMENT_DEFAULTS.gravity, { step: 25 }),
    prop('AirControl', 'number', MOVEMENT_DEFAULTS.airControl, { min: 0, max: 1, step: 0.05 }),
    prop('Noclip', 'boolean', false, { help: 'Fly freely (Space up, Ctrl down).' }),
  ];
  update() {
    if (this.hiddenNow) return;
    this.world.fx.movement = { walkSpeed: this.WalkSpeed, runSpeed: this.RunSpeed, crouchSpeed: this.CrouchSpeed, jumpPower: this.JumpHeight, gravity: this.Gravity, airControl: this.AirControl, noclip: this.Noclip };
  }
}
registerPart(MovementPart);
