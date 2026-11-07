// Outfit tree: select, rename, hide toggle, drag & drop, context menu.
import { h } from '../core/util.js';
import { showMenu } from './ui.js';

export class TreeView {
  constructor(el, editor, menus) {
    this.el = el;
    this.editor = editor;
    this.menus = menus;
    this.rows = new Map();
    this.drag = null;
    for (const evt of ['structure', 'select', 'changed', 'rename']) editor.on(evt, () => this.render());
    el.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.tree-row')) return;
      e.preventDefault();
      editor.select(null);
      showMenu(menus.partMenu(null), e.clientX, e.clientY);
    });
    el.addEventListener('pointerdown', (e) => { if (!e.target.closest('.tree-row')) editor.select(null); });
    el.addEventListener('keydown', (e) => this.onKey(e));
    setInterval(() => this.updateStates(), 200);
    this.render();
  }

  render() {
    const ed = this.editor;
    this.rows.clear();
    const frag = document.createDocumentFragment();
    const walk = (part, depth) => {
      frag.append(this.row(part, depth));
      if (!ed.collapsed.has(part.UniqueID)) for (const c of part.children) walk(c, depth + 1);
    };
    for (const r of ed.world.roots) walk(r, 0);
    if (!ed.world.roots.length) frag.append(h('div', { class: 'tree-empty', text: 'Right-click here or use Add to create a part.' }));
    this.el.replaceChildren(frag);
    this.updateStates();
    const sel = ed.selected && this.rows.get(ed.selected.UniqueID);
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  row(part, depth) {
    const ed = this.editor;
    const hasKids = part.children.length > 0;
    const collapsed = ed.collapsed.has(part.UniqueID);
    const twisty = h('span', { class: 'twisty', text: hasKids ? (collapsed ? '▸' : '▾') : '' });
    twisty.addEventListener('pointerdown', (e) => {
      if (!hasKids) return;
      e.stopPropagation();
      if (collapsed) ed.collapsed.delete(part.UniqueID); else ed.collapsed.add(part.UniqueID);
      this.render();
    });
    const eye = h('button', { class: 'eye', type: 'button', title: part.Hide ? 'Show' : 'Hide', 'aria-label': part.Hide ? 'Show part' : 'Hide part', text: part.Hide ? '◌' : '●' });
    eye.addEventListener('pointerdown', (e) => e.stopPropagation());
    eye.addEventListener('click', (e) => { e.stopPropagation(); ed.setProp(part, 'Hide', !part.Hide); });
    const name = h('span', { class: 'name', text: part.displayName });
    const cls = part.Name ? h('span', { class: 'cls', text: part.className }) : null;
    const row = h('div', {
      class: 'tree-row' + (ed.selected === part ? ' selected' : ''),
      role: 'treeitem', tabIndex: ed.selected === part ? 0 : -1, draggable: true,
      'aria-selected': String(ed.selected === part), 'aria-expanded': hasKids ? String(!collapsed) : null,
      style: { paddingLeft: `${6 + depth * 14}px` },
    }, twisty, h('span', { class: 'icon', text: part.constructor.icon }), name, cls, h('span', { class: 'state' }), eye);
    row.dataset.id = part.UniqueID;
    row.addEventListener('pointerdown', (e) => { if (e.button === 0 || e.button === 2) { ed.select(part); row.focus({ preventScroll: true }); } });
    row.addEventListener('dblclick', (e) => { if (!e.target.closest('.eye, .twisty')) this.rename(part, name); });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); ed.select(part); showMenu(this.menus.partMenu(part), e.clientX, e.clientY); });
    row.addEventListener('dragstart', (e) => { this.drag = part; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', part.UniqueID); });
    row.addEventListener('dragend', () => { this.drag = null; this.clearDrop(); });
    row.addEventListener('dragover', (e) => {
      if (!this.drag || this.drag === part || part.isDescendantOf(this.drag)) return;
      e.preventDefault();
      this.clearDrop();
      row.classList.add(`drop-${this.dropZone(e, row)}`);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after', 'drop-into'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const src = this.drag;
      this.clearDrop();
      if (!src || src === part || part.isDescendantOf(src)) return;
      const zone = this.dropZone(e, row);
      if (zone === 'into') { ed.collapsed.delete(part.UniqueID); ed.move(src, part, -1); return; }
      const list = part.parent ? part.parent.children : ed.world.roots;
      ed.move(src, part.parent, list.indexOf(part) + (zone === 'after' ? 1 : 0));
    });
    this.rows.set(part.UniqueID, row);
    return row;
  }

  dropZone(e, row) {
    const r = row.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'into';
  }
  clearDrop() { for (const r of this.el.querySelectorAll('.drop-before, .drop-after, .drop-into')) r.classList.remove('drop-before', 'drop-after', 'drop-into'); }

  rename(part, nameEl) {
    const input = h('input', { class: 'rename', value: part.Name, placeholder: part.className, 'aria-label': 'Part name' });
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; if (ok) this.editor.setProp(part, 'Name', input.value.trim()); else this.render(); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  /** Cheap per-frame-ish refresh of hidden/event state without rebuilding. */
  updateStates() {
    for (const [id, row] of this.rows) {
      const p = this.editor.world.getPart(id);
      if (!p) continue;
      row.classList.toggle('is-hidden', p.hiddenNow);
      row.classList.toggle('by-event', p.eventHidden);
      const st = row.querySelector('.state');
      const txt = p.eventHidden ? '⏸' : p.status && p.className !== 'event' ? '⚠' : '';
      if (st.textContent !== txt) { st.textContent = txt; st.title = p.eventHidden ? 'Hidden by an event' : p.status || ''; }
    }
  }

  onKey(e) {
    const ed = this.editor;
    const ids = [...this.rows.keys()];
    const i = ed.selected ? ids.indexOf(ed.selected.UniqueID) : -1;
    const go = (j) => { const p = ed.world.getPart(ids[Math.max(0, Math.min(ids.length - 1, j))]); if (p) { ed.select(p); this.rows.get(p.UniqueID)?.focus(); } };
    if (e.key === 'ArrowDown') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(i - 1); }
    else if (e.key === 'ArrowLeft' && ed.selected) { e.preventDefault(); if (ed.selected.children.length && !ed.collapsed.has(ed.selected.UniqueID)) { ed.collapsed.add(ed.selected.UniqueID); this.render(); } else if (ed.selected.parent) go(ids.indexOf(ed.selected.parent.UniqueID)); }
    else if (e.key === 'ArrowRight' && ed.selected) { e.preventDefault(); ed.collapsed.delete(ed.selected.UniqueID); this.render(); }
    else if (e.key === 'F2' && ed.selected) { const row = this.rows.get(ed.selected.UniqueID); if (row) this.rename(ed.selected, row.querySelector('.name')); }
  }
}
