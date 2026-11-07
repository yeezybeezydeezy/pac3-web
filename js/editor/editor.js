// Editor state: selection, snapshot undo/redo, clipboard and tree operations.
export const FORMAT = 'pac3-web';

/** Accepts our file format, a bare part ({self, children}) or an array of parts. */
export function outfitParts(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.parts)) return data.parts;
  if (data && data.self) return [data];
  throw new Error('Not a PAC3 Web outfit');
}

export class Editor {
  constructor(world) {
    this.world = world;
    this.selected = null;
    this.undoStack = [];
    this.redoStack = [];
    this.clipboard = null;
    this.collapsed = new Set();
    this._listeners = {};
    this.lastSnapshot = this.snapshot();
    world.on('structure', () => this.emit('structure'));
  }

  on(evt, fn) { (this._listeners[evt] ||= []).push(fn); }
  emit(evt, ...a) { for (const fn of this._listeners[evt] || []) fn(...a); }

  serialize() { return { format: FORMAT, version: 1, parts: this.world.roots.map((r) => r.serialize()) }; }
  snapshot() { return JSON.stringify(this.serialize()); }

  commit() {
    const s = this.snapshot();
    if (s === this.lastSnapshot) return;
    this.undoStack.push(this.lastSnapshot);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.lastSnapshot = s;
    this.emit('changed');
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.lastSnapshot);
    this._restore(this.undoStack.pop());
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.lastSnapshot);
    this._restore(this.redoStack.pop());
  }
  _restore(s) {
    const sel = this.selected && this.selected.UniqueID;
    this._replace(JSON.parse(s));
    this.lastSnapshot = s;
    this.select(this.world.getPart(sel));
    this.emit('changed');
  }
  _replace(data) {
    const parts = outfitParts(data);
    const warnings = [];
    const counter = { n: 0 };
    this.world.clear();
    for (const p of parts) this.world.load(p, null, { counter, warnings });
    return warnings;
  }

  /** Replaces the whole outfit (undoable). Throws on invalid data. */
  loadOutfit(data) {
    const warnings = this._replace(data);
    this.select(this.world.roots[0] || null);
    this.commit();
    return warnings;
  }
  /** Adds parts from data next to the current outfit (undoable). */
  appendOutfit(data, parent = null) {
    const counter = { n: this.world.parts.size };
    const warnings = [];
    let last = null;
    for (const p of outfitParts(data)) last = this.world.load(p, parent, { newIds: true, counter, warnings }) || last;
    if (last) this.select(last);
    this.commit();
    return warnings;
  }

  select(part) {
    if (part && !part.inWorld) part = null;
    this.selected = part;
    if (part) for (let p = part.parent; p; p = p.parent) this.collapsed.delete(p.UniqueID);
    this.emit('select', part);
  }

  addPart(className, parent = this.selected) {
    const w = this.world;
    if (!parent && className !== 'group') {
      const g = w.createPart('group');
      g.Name = 'my outfit';
      w.addPart(g);
      parent = g;
    }
    const p = w.createPart(className);
    w.addPart(p, parent);
    this.select(p);
    this.commit();
    return p;
  }

  remove(part = this.selected) {
    if (!part) return;
    const list = part.parent ? part.parent.children : this.world.roots;
    const i = list.indexOf(part);
    const next = list[i + 1] || list[i - 1] || part.parent || null;
    this.world.removePart(part);
    this.select(next);
    this.commit();
  }

  clone(part = this.selected) {
    if (!part) return;
    const list = part.parent ? part.parent.children : this.world.roots;
    const c = this.world.load(part.serialize(), part.parent, { newIds: true, index: list.indexOf(part) + 1, counter: { n: this.world.parts.size } });
    this.select(c);
    this.commit();
  }

  copy(part = this.selected) {
    if (!part) return;
    this.clipboard = JSON.stringify(part.serialize());
    if (navigator.clipboard) navigator.clipboard.writeText(this.clipboard).catch(() => {});
  }
  paste(parent = this.selected) {
    if (!this.clipboard) return;
    const c = this.world.load(JSON.parse(this.clipboard), parent, { newIds: true, counter: { n: this.world.parts.size } });
    this.select(c);
    this.commit();
  }

  /** Moves part under newParent at index (index counted before removal). */
  move(part, newParent, index = -1) {
    if (!part || newParent === part || (newParent && newParent.isDescendantOf(part))) return;
    const oldList = part.parent ? part.parent.children : this.world.roots;
    if (part.parent === newParent && index >= 0 && oldList.indexOf(part) < index) index--;
    this.world.addPart(part, newParent, index);
    this.select(part);
    this.commit();
  }

  setProp(part, name, value, commit = true) {
    part.setProp(name, value);
    if (name === 'Name' || name === 'Hide') this.emit('rename', part);
    this.emit('prop', part, name);
    if (commit) this.commit();
  }

  newOutfit() {
    this.world.clear();
    const g = this.world.createPart('group');
    g.Name = 'my outfit';
    this.world.addPart(g);
    this.select(g);
    this.commit();
  }
}
