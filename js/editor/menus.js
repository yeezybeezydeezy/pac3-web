// Menubar and part context menu, plus the file/player dialogs they open.
import { PartRegistry } from '../core/part.js';
import { CATEGORIES } from '../parts/index.js';
import { h, downloadText, readFileAs, rgbToHex, hexToRgb } from '../core/util.js';
import { showMenu, modal, prompt, confirm, toast } from './ui.js';
import { storage, encodeShare } from './storage.js';
import { EXAMPLES } from './examples.js';
import { help } from './help.js';

export class Menus {
  constructor(app) { this.app = app; }
  get editor() { return this.app.editor; }

  addItems(parent) {
    return CATEGORIES.map(([cat, title]) => ({
      label: title,
      items: [...PartRegistry.values()].filter((C) => C.category === cat).map((C) => ({ label: C.className, icon: C.icon, title: C.description, action: () => this.editor.addPart(C.className, parent) })),
    }));
  }

  partMenu(part) {
    const ed = this.editor;
    return [
      { label: part ? 'Add child part' : 'Add part', items: this.addItems(part) },
      '-',
      part && { label: 'Copy', shortcut: 'Ctrl+C', action: () => ed.copy(part) },
      { label: part ? 'Paste into' : 'Paste', shortcut: 'Ctrl+V', disabled: !ed.clipboard, action: () => ed.paste(part) },
      part && { label: 'Clone', shortcut: 'Ctrl+D', action: () => ed.clone(part) },
      part && { label: part.Hide ? 'Show' : 'Hide', shortcut: 'H', action: () => ed.setProp(part, 'Hide', !part.Hide) },
      part && { label: 'Save part to file…', action: () => downloadText(`${(part.displayName || 'part').replace(/[^\w.-]+/g, '_')}.json`, JSON.stringify({ format: 'pac3-web', version: 1, parts: [part.serialize()] }, null, 1)) },
      part && '-',
      part && { label: 'Remove', shortcut: 'Del', action: () => ed.remove(part) },
      '-',
      { label: 'Expand all', action: () => { ed.collapsed.clear(); ed.emit('structure'); } },
      { label: 'Collapse all', action: () => { ed.world.allParts.forEach((p) => p.children.length && ed.collapsed.add(p.UniqueID)); ed.emit('structure'); } },
    ];
  }

  buildMenubar(el) {
    const ed = this.editor, app = this.app;
    const menus = {
      File: () => [
        { label: 'New outfit', action: () => this.newOutfit() },
        { label: 'Examples', items: Object.keys(EXAMPLES).map((name) => ({ label: name, action: () => this.loadExample(name) })) },
        '-',
        { label: 'Save to browser…', shortcut: 'Ctrl+S', action: () => this.saveBrowser() },
        { label: 'Open from browser…', action: () => this.openBrowser() },
        '-',
        { label: 'Import file…', action: () => this.importFile(false) },
        { label: 'Import file into outfit…', action: () => this.importFile(true) },
        { label: 'Export file…', action: () => this.exportFile() },
        { label: 'Copy share link', action: () => this.shareLink() },
      ],
      Edit: () => [
        { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !ed.undoStack.length, action: () => ed.undo() },
        { label: 'Redo', shortcut: 'Ctrl+Y', disabled: !ed.redoStack.length, action: () => ed.redo() },
        '-',
        ...this.partMenu(ed.selected).filter(Boolean),
      ],
      Add: () => this.addItems(ed.selected),
      View: () => [
        { label: 'Show bones', shortcut: 'B', checked: app.viewport.showBones, action: () => app.viewport.toggleBones() },
        { label: 'Show floor grid', checked: app.env.grid.visible, action: () => { app.env.grid.visible = !app.env.grid.visible; } },
        { label: 'Focus selected', shortcut: 'F', action: () => app.viewport.focus() },
        '-',
        { label: 'Audio volume…', action: () => this.volumeDialog() },
        { label: 'Microphone for voice_volume', checked: !!app.mic.stream, action: () => app.toggleMic() },
      ],
      Player: () => [
        { label: 'Player settings…', action: () => this.playerDialog() },
        { label: 'Play mode', shortcut: 'P', action: () => app.play.enter() },
      ],
      Help: () => [
        { label: 'Controls', action: () => help.controls() },
        { label: 'Part reference', action: () => help.partReference(ed.selected && ed.selected.className) },
        { label: 'Event types', action: () => help.events() },
        { label: 'Proxy functions', action: () => help.functions() },
        '-',
        { label: 'About', action: () => help.about() },
      ],
    };
    const bar = h('nav', { class: 'menubar-items', 'aria-label': 'Main menu' });
    for (const [name, items] of Object.entries(menus)) {
      const b = h('button', { type: 'button', class: 'menubar-btn', text: name, 'aria-haspopup': 'menu' });
      b.addEventListener('click', () => { const r = b.getBoundingClientRect(); showMenu(items(), r.left, r.bottom + 2); });
      bar.append(b);
    }
    el.append(h('div', { class: 'brand' }, h('span', { class: 'logo', text: 'PAC3' }), h('span', { class: 'muted', text: 'web' })), bar);
  }

  async newOutfit() {
    if (this.editor.world.roots.length && !(await confirm('New outfit', 'Clear the current outfit? You can undo this.', 'Clear'))) return;
    this.editor.newOutfit();
  }
  loadExample(name) {
    this.editor.loadOutfit(EXAMPLES[name]());
    toast(`Loaded example "${name}"`);
  }
  async saveBrowser() {
    const name = await prompt('Save to browser', 'Outfit name', (this.editor.world.roots[0] && this.editor.world.roots[0].displayName) || 'my outfit');
    if (!name) return;
    if (storage.save(name.trim().slice(0, 80), this.editor.snapshot())) toast(`Saved "${name}"`, 'ok');
    else toast('Saving failed: browser storage is full or disabled. Export to a file instead.', 'error', 6000);
  }
  openBrowser() {
    const list = h('div', { class: 'save-list' });
    const fill = () => {
      const saves = storage.listSaves();
      list.replaceChildren(...(saves.length ? saves.map((s) => h('div', { class: 'save-row' },
        h('div', {}, h('b', { text: s.name }), h('div', { class: 'muted', text: `${new Date(s.time).toLocaleString()} · ${Math.ceil(s.size / 1024)} KB` })),
        h('div', { class: 'row-btns' },
          h('button', { type: 'button', class: 'btn primary', text: 'Load', onclick: () => { try { this.editor.loadOutfit(storage.load(s.name)); toast(`Loaded "${s.name}"`); list.closest('.overlay').remove(); } catch (e) { toast(e.message, 'error'); } } }),
          h('button', { type: 'button', class: 'btn', text: 'Delete', onclick: async () => { if (await confirm('Delete save', `Delete "${s.name}" permanently?`, 'Delete')) { storage.remove(s.name); fill(); } } })))) : [h('p', { class: 'muted', text: 'No saved outfits yet. Use File → Save to browser.' })]));
    };
    fill();
    modal('Open from browser', list);
  }
  importFile(append) {
    const input = h('input', { type: 'file', accept: '.json,.txt,application/json' });
    input.addEventListener('change', async () => {
      const f = input.files[0];
      if (!f) return;
      let data;
      try { data = JSON.parse(await readFileAs(f)); }
      catch { toast('That file is not PAC3 Web JSON. Garry\'s Mod PAC3 .txt outfits (Lua tables) are not supported yet.', 'error', 7000); return; }
      try {
        const warnings = append ? this.editor.appendOutfit(data, this.editor.selected) : this.editor.loadOutfit(data);
        toast(`Imported ${f.name}${warnings.length ? ` (${warnings.length} warning${warnings.length > 1 ? 's' : ''}: ${warnings[0]})` : ''}`, warnings.length ? 'warn' : 'ok', 5000);
      } catch (e) { toast(`Import failed: ${e.message}`, 'error', 6000); }
    });
    input.click();
  }
  exportFile() {
    const name = ((this.editor.world.roots[0] && this.editor.world.roots[0].displayName) || 'outfit').replace(/[^\w.-]+/g, '_');
    downloadText(`${name}.pac3.json`, JSON.stringify(this.editor.serialize(), null, 1));
  }
  async shareLink() {
    try {
      const code = await encodeShare(this.editor.snapshot());
      const url = `${location.origin}${location.pathname}#outfit=${code}`;
      if (url.length > 1.5e6) { toast('Outfit is too large for a link (embedded files?). Export a file instead.', 'error', 6000); return; }
      await navigator.clipboard.writeText(url);
      toast(`Share link copied (${Math.ceil(url.length / 1024)} KB)`, 'ok');
    } catch (e) { toast(`Could not create link: ${e.message}`, 'error'); }
  }
  async volumeDialog() {
    const audio = this.app.world.audio;
    const range = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: audio.volume, 'aria-label': 'Volume' });
    range.addEventListener('input', () => { audio.setVolume(Number(range.value)); this.app.saveSettings(); });
    await modal('Audio volume', h('label', { class: 'stack' }, h('span', { text: 'Master volume' }), range));
  }
  async playerDialog() {
    const p = this.app.world.player;
    const num = (label, key, max) => { const i = h('input', { type: 'number', class: 'field', min: 0, max, value: p[key] }); i.addEventListener('change', () => { const v = Number(i.value); if (Number.isFinite(v)) p[key] = Math.max(0, v); }); return h('label', { class: 'stack' }, h('span', { text: label }), i); };
    const col = (label, key) => { const i = h('input', { type: 'color', value: rgbToHex(p[key]) }); i.addEventListener('input', () => { p[key] = hexToRgb(i.value); }); return h('label', { class: 'stack' }, h('span', { text: label }), i); };
    const name = h('input', { type: 'text', class: 'field', value: p.name, maxLength: 40 });
    name.addEventListener('input', () => { p.name = name.value; });
    await modal('Player settings', h('div', { class: 'grid2' },
      h('label', { class: 'stack' }, h('span', { text: 'Name' }), name),
      num('Health', 'health', 100000), num('Max health', 'maxHealth', 100000), num('Armor', 'armor', 100000),
      col('Player color', 'color'), col('Weapon color', 'weaponColor'),
      h('p', { class: 'muted span2', text: 'These feed proxy inputs (owner_health, player_color…) and events (health, armor) and text overrides.' })));
    this.app.saveSettings();
  }
}
