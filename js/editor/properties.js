// Property inspector for the selected part. Live-refreshes (proxies, events) without stealing focus.
import { h, rgbToHex, hexToRgb, readFileAs } from '../core/util.js';
import { EVENTS } from '../core/inputs.js';
import { toast } from './ui.js';

const fmt = (v) => String(Number(Number(v).toFixed(4)));
const AXIS_LABELS = { vector: ['x', 'y', 'z'], angle: ['p', 'y', 'r'] };
let uidCounter = 0;

/** Drag on a label to scrub a number. Shift = x10, Alt = x0.1. */
function scrub(label, get, set, commit, step = 0.1) {
  label.classList.add('scrub');
  label.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    label.setPointerCapture(e.pointerId);
    const start = get(), x0 = e.clientX;
    let moved = false;
    const move = (ev) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 2) moved = true;
      const mul = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      set(start + Math.round(dx) * step * mul);
    };
    const up = () => { label.removeEventListener('pointermove', move); label.removeEventListener('pointerup', up); label.removeEventListener('pointercancel', up); if (moved) commit(); };
    label.addEventListener('pointermove', move);
    label.addEventListener('pointerup', up);
    label.addEventListener('pointercancel', up);
  });
}

function numInput(get, set, commit, step, aria) {
  const inp = h('input', { type: 'text', inputMode: 'decimal', class: 'field num', value: fmt(get()), 'aria-label': aria, spellcheck: false });
  inp.addEventListener('change', () => {
    const v = parseFloat(inp.value);
    if (Number.isFinite(v)) { set(v); commit(); } else inp.value = fmt(get());
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const mul = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
    set(get() + step * mul);
    inp.value = fmt(get());
    commit();
  });
  inp.refresh = () => { if (document.activeElement !== inp) inp.value = fmt(get()); };
  return inp;
}

export class PropertiesView {
  constructor(el, editor, viewport, help) {
    this.el = el;
    this.editor = editor;
    this.viewport = viewport;
    this.help = help;
    this.fields = [];
    this.collapsedGroups = new Set();
    this.structVersion = 0;
    editor.on('select', () => this.render());
    editor.on('structure', () => { this.structVersion++; });
    editor.on('rename', () => { this.structVersion++; });
    editor.on('changed', () => { if (this.part && !this.part.inWorld) this.render(); else this.refresh(true); });
    setInterval(() => this.refresh(), 150);
    this.render();
  }

  render() {
    const part = (this.part = this.editor.selected);
    this.fields = [];
    if (!part) {
      this.el.replaceChildren(h('div', { class: 'props-empty' }, h('p', { text: 'Select a part to edit it.' }), h('p', { class: 'muted', text: 'Right-click the outfit tree to add parts. Drag rows to re-parent them.' })));
      return;
    }
    const C = part.constructor;
    this.statusEl = h('div', { class: 'part-status' });
    const head = h('div', { class: 'props-head' },
      h('div', { class: 'props-title' }, h('span', { class: 'icon', text: C.icon }), h('span', { text: part.className }),
        h('button', { class: 'icon-btn', type: 'button', title: 'Part reference', 'aria-label': 'Part reference', text: '?', onclick: () => this.help.partReference(part.className) })),
      h('p', { class: 'props-desc', text: C.description }),
      this.statusEl);
    const groups = new Map();
    for (const def of C.schema) {
      if (!groups.has(def.group)) groups.set(def.group, []);
      groups.get(def.group).push(def);
    }
    const sections = [];
    for (const [g, defs] of groups) {
      const body = h('div', { class: 'group-body' });
      for (const def of defs) body.append(this.field(part, def));
      const collapsed = this.collapsedGroups.has(g);
      const btn = h('button', { class: 'group-title', type: 'button', 'aria-expanded': String(!collapsed), text: `${collapsed ? '▸' : '▾'} ${g}` });
      const sec = h('section', { class: 'group' + (collapsed ? ' collapsed' : '') }, btn, body);
      btn.addEventListener('click', () => {
        const c = sec.classList.toggle('collapsed');
        if (c) this.collapsedGroups.add(g); else this.collapsedGroups.delete(g);
        btn.textContent = `${c ? '▸' : '▾'} ${g}`;
        btn.setAttribute('aria-expanded', String(!c));
      });
      sections.push(sec);
    }
    this.el.replaceChildren(head, ...sections);
    this.refresh(true);
  }

  refresh(force = false) {
    const part = this.part;
    if (!part || !part.inWorld) return;
    if (this.statusEl) {
      const s = part.status || '';
      if (this.statusEl.textContent !== s) { this.statusEl.textContent = s; this.statusEl.hidden = !s; }
    }
    for (const f of this.fields) f.refresh(force);
  }

  field(part, def) {
    const ed = this.editor;
    const get = () => part[def.name];
    const set = (v) => ed.setProp(part, def.name, v, false);
    const commit = () => ed.commit();
    const id = `pf${++uidCounter}`;
    const label = h('label', { class: 'prop-label', for: id, text: def.name, title: def.help || def.name });
    let control;
    let refresh = () => {};
    const step = def.step ?? (def.integer ? 1 : 0.1);

    switch (def.type) {
      case 'boolean': {
        control = h('input', { type: 'checkbox', id, checked: get() });
        control.addEventListener('change', () => { set(control.checked); commit(); });
        refresh = () => { control.checked = get(); };
        break;
      }
      case 'number': {
        control = numInput(get, set, commit, step, def.name);
        control.id = id;
        scrub(label, get, set, commit, step);
        refresh = () => control.refresh();
        break;
      }
      case 'vector': case 'angle': {
        const names = AXIS_LABELS[def.type];
        const inputs = names.map((ax, i) => {
          const g = () => get()[i];
          const s = (v) => { const a = get().slice(); a[i] = v; set(a); };
          const inp = numInput(g, s, commit, def.type === 'angle' ? 1 : step, `${def.name} ${ax}`);
          const lab = h('span', { class: `axis axis-${i}`, text: ax });
          scrub(lab, g, s, commit, def.type === 'angle' ? 1 : step);
          return [lab, inp];
        });
        inputs[0][1].id = id;
        control = h('div', { class: 'vec' }, inputs.flat());
        refresh = () => inputs.forEach(([, inp]) => inp.refresh());
        break;
      }
      case 'color': {
        const picker = h('input', { type: 'color', id, value: rgbToHex(get()) });
        const hex = h('span', { class: 'muted mono' });
        picker.addEventListener('input', () => set(hexToRgb(picker.value)));
        picker.addEventListener('change', commit);
        control = h('div', { class: 'color-row' }, picker, hex);
        refresh = () => { const v = rgbToHex(get()); if (document.activeElement !== picker) picker.value = v; hex.textContent = v; };
        break;
      }
      case 'text': case 'expression': {
        const ta = h('textarea', { id, class: 'field' + (def.type === 'expression' ? ' mono' : ''), rows: def.type === 'expression' ? 3 : 2, spellcheck: def.type !== 'expression', value: get() });
        ta.addEventListener('input', () => set(ta.value));
        ta.addEventListener('change', commit);
        ta.addEventListener('keydown', (e) => e.stopPropagation());
        const extra = [];
        if (def.type === 'expression') {
          const out = h('div', { class: 'proxy-out mono' });
          extra.push(h('div', { class: 'expr-tools' }, out, h('button', { type: 'button', class: 'link-btn', text: 'ƒ functions', onclick: () => this.help.functions() })));
          refresh = (force) => {
            if (force || document.activeElement !== ta) { if (ta.value !== get()) ta.value = get(); }
            const o = part.output && part.output.length ? `→ ${part.output.map((x) => fmt(x)).join(', ')}` : '';
            if (out.textContent !== o) out.textContent = o;
          };
        } else refresh = (force) => { if ((force || document.activeElement !== ta) && ta.value !== get()) ta.value = get(); };
        control = h('div', { class: 'stack' }, ta, extra);
        break;
      }
      case 'enum': case 'asset': case 'bone': case 'part': {
        ({ control, refresh } = this.choiceField(part, def, id, get, set, commit));
        break;
      }
      default: {
        control = h('input', { type: 'text', id, class: 'field', value: get(), spellcheck: false });
        control.addEventListener('input', () => set(control.value));
        control.addEventListener('change', commit);
        refresh = (force) => {
          if ((force || document.activeElement !== control) && control.value !== get()) control.value = get();
          if (def.name === 'Arguments' && part.className === 'event') control.placeholder = (EVENTS[part.Event] && EVENTS[part.Event].args) || 'no arguments';
        };
      }
    }
    const row = h('div', { class: `prop prop-${def.type}` }, label, control);
    this.fields.push({ refresh: (force) => { label.classList.toggle('proxied', part.isProxied(def.name)); refresh(force); } });
    return row;
  }

  choiceField(part, def, id, get, set, commit) {
    const ed = this.editor;
    // Part references: a select of all parts
    if (def.type === 'part') {
      const sel = h('select', { id, class: 'field' });
      let ver = -1;
      const build = () => {
        const opts = [h('option', { value: '', text: '(none)' })];
        const walk = (p, d) => {
          if (p !== part) opts.push(h('option', { value: p.UniqueID, text: `${'  '.repeat(d)}${p.constructor.icon} ${p.displayName}` }));
          for (const c of p.children) walk(c, d + 1);
        };
        for (const r of ed.world.roots) walk(r, 0);
        if (get() && !ed.world.getPart(get())) opts.push(h('option', { value: get(), text: '(missing part)' }));
        sel.replaceChildren(...opts);
      };
      sel.addEventListener('change', () => { set(sel.value); commit(); });
      return { control: sel, refresh: () => { if (ver !== this.structVersion) { ver = this.structVersion; build(); } if (document.activeElement !== sel) sel.value = get(); } };
    }
    const dynamic = () => (def.type === 'bone' ? part.getBoneOptions ? part.getBoneOptions() : [] : def.name === 'VariableName' && part.getVariableOptions ? part.getVariableOptions() : def.options || []);
    // Strict enums: a select
    if (def.type === 'enum' && !def.free && def.name !== 'VariableName') {
      const sel = h('select', { id, class: 'field' }, def.options.map((o) => h('option', { value: o, text: o || '(none)' })));
      sel.addEventListener('change', () => { set(sel.value); commit(); });
      return { control: sel, refresh: () => { if (document.activeElement !== sel) sel.value = get(); } };
    }
    // Free text with suggestions (assets, bones, free enums)
    const listId = `${id}-list`;
    const list = h('datalist', { id: listId });
    const inp = h('input', { type: 'text', id, class: 'field', list: listId, value: get(), spellcheck: false, autocomplete: 'off' });
    let lastOpts = '';
    const fill = () => {
      const opts = dynamic();
      const key = opts.join('|');
      if (key !== lastOpts) { lastOpts = key; list.replaceChildren(...opts.filter(Boolean).map((o) => h('option', { value: o }))); }
    };
    inp.addEventListener('focus', fill);
    inp.addEventListener('input', () => { if (def.type !== 'asset') set(inp.value); });
    inp.addEventListener('change', () => { set(inp.value); commit(); });
    const tools = [];
    if (def.type === 'bone') {
      tools.push(h('button', { type: 'button', class: 'icon-btn', title: 'Pick a bone in the viewport', 'aria-label': 'Pick bone in viewport', text: '🎯', onclick: () => this.viewport.pickBone((name) => { set(name); commit(); inp.value = name; }) }));
    }
    if (def.type === 'asset' && def.accept) {
      const file = h('input', { type: 'file', accept: def.accept, hidden: true });
      file.addEventListener('change', async () => {
        const f = file.files[0];
        file.value = '';
        if (!f) return;
        if (f.size > 8e6) toast(`${f.name} is ${(f.size / 1e6).toFixed(1)} MB: it is embedded in the outfit, so saving and share links may fail. Prefer a URL.`, 'warn', 7000);
        let url = await readFileAs(f, 'dataurl');
        if (/\.obj$/i.test(f.name)) url = url.replace(/^data:[^;,]*/, 'data:model/obj');
        set(url); commit();
        inp.value = url;
      });
      tools.push(file, h('button', { type: 'button', class: 'icon-btn', title: 'Embed a file from your computer', 'aria-label': 'Upload file', text: '📁', onclick: () => file.click() }));
    }
    const control = h('div', { class: 'choice' }, inp, list, tools);
    return {
      control,
      refresh: (force) => {
        if ((force || document.activeElement !== inp) && inp.value !== get()) inp.value = get().length > 300 ? get() : get();
        inp.title = get().startsWith('data:') ? `embedded file (${Math.round(get().length / 1024)} KB)` : get();
      },
    };
  }
}
