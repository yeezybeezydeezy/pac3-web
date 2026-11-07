// "Game content" dialog: mount local Garry's Mod / Steam / Workshop folders, browse their models,
// materials and sounds, and import PAC3 outfits. Everything is read locally; nothing is uploaded.
import { h, readFileAs } from '../core/util.js';
import { modal, toast } from './ui.js';
import { vfs } from '../source/assets.js';
import { importPac3 } from '../source/pac3import.js';

const KINDS = {
  model: { label: 'Models', test: (p) => p.endsWith('.mdl'), root: 'models' },
  material: { label: 'Materials', test: (p) => p.endsWith('.vmt'), root: 'materials' },
  texture: { label: 'Textures', test: (p) => p.endsWith('.vtf') || p.endsWith('.vmt'), root: 'materials' },
  sound: { label: 'Sounds', test: (p) => /\.(wav|mp3|ogg)$/.test(p), root: 'sound' },
  all: { label: 'Everything', test: () => true, root: '' },
};

/** Value stored in a property for a picked file. */
export function assetValue(path) {
  if (path.endsWith('.vmt') || path.endsWith('.vtf')) return path.replace(/^materials\//, '').replace(/\.(vmt|vtf)$/, '');
  if (path.startsWith('sound/')) return path.slice(6);
  return path;
}

export function openGameContent(app, { tab = vfs.mounted ? 'browse' : 'folders', kind = 'model', pick = null } = {}) {
  const { editor } = app;
  const body = h('div', { class: 'content-dlg' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const panes = {};
  const show = (t) => {
    tab = t;
    for (const [k, b] of Object.entries(tabBtns)) { b.classList.toggle('active', k === t); b.setAttribute('aria-selected', String(k === t)); }
    for (const [k, p] of Object.entries(panes)) p.hidden = k !== t;
    if (t === 'browse') browse.refresh();
    if (t === 'outfits') outfits.refresh();
  };
  const tabBtns = {
    folders: h('button', { type: 'button', role: 'tab', class: 'tab', text: 'Folders', onclick: () => show('folders') }),
    browse: h('button', { type: 'button', role: 'tab', class: 'tab', text: 'Browse', onclick: () => show('browse') }),
    outfits: h('button', { type: 'button', role: 'tab', class: 'tab', text: 'PAC3 outfits', onclick: () => show('outfits') }),
  };
  tabs.append(...Object.values(tabBtns));

  // ---------- folders ----------
  const rootList = h('div', { class: 'save-list' });
  const status = h('p', { class: 'muted' });
  const renderRoots = () => {
    const files = vfs.mounts.reduce((n, m) => n + (m.size || 0), 0);
    status.textContent = vfs.mounted
      ? `${vfs.mounts.length} sources mounted · ${files.toLocaleString()} archived files indexed${vfs.pending ? ` · unpacking ${vfs.pending} older Workshop item(s)…` : ''}`
      : 'Nothing mounted yet.';
    rootList.replaceChildren(...vfs.roots.map((r) => h('div', { class: 'save-row' },
      h('div', {}, h('b', { text: r.name }), h('div', { class: 'muted', text: r.state === 'mounted' ? `${r.mountCount} source(s)${r.transient ? ' · until you reload' : ''}${r.message ? ` · ${r.message}` : ''}` : r.state === 'mounting' ? 'Scanning…' : r.message || r.state })),
      h('div', { class: 'row-btns' },
        r.state === 'needs-permission' ? h('button', { type: 'button', class: 'btn primary', text: 'Reconnect', onclick: () => vfs.reconnect(r) }) : null,
        r.handle && !r.transient ? h('button', { type: 'button', class: 'btn', text: 'Forget', onclick: () => vfs.forget(r) }) : null))));
  };
  const fallback = h('input', { type: 'file', webkitdirectory: true, multiple: true, hidden: true });
  fallback.addEventListener('change', () => { if (fallback.files.length) vfs.addFileList(fallback.files); fallback.value = ''; });
  const dropZone = h('div', { class: 'drop-zone' },
    h('b', { text: 'Drag your steamapps or GarrysMod folder into this window' }),
    h('span', { class: 'muted', text: 'Works wherever Steam is installed, including Program Files. Folders are read in place on this computer (nothing is uploaded); drop them again after reloading the page.' }));
  const pickerHint = h('p', { class: 'notice', hidden: true, text: 'If Chrome said it "can\'t open this folder because it contains system files": its folder picker refuses everything inside Program Files, which is where Steam installs by default. Drag the folder into this window instead.' });
  panes.folders = h('div', { class: 'stack' },
    h('p', {}, 'Mount your ', h('b', { text: 'steamapps' }), ' folder (Garry\'s Mod plus Workshop items), your ', h('b', { text: 'GarrysMod' }), ' folder, a Workshop ', h('b', { text: 'content/4000' }), ' folder, or any addon folder or .gma file.'),
    dropZone,
    h('div', { class: 'row-btns' },
      vfs.supported ? h('button', { type: 'button', class: 'btn', text: 'Choose folder…', title: 'Remembered between visits. Chrome refuses folders inside Program Files; drag those in instead.', onclick: () => vfs.pickFolder().catch((e) => { if (e.name === 'AbortError') pickerHint.hidden = false; else toast(e.message, 'error'); }) }) : null,
      h('button', { type: 'button', class: 'btn', text: 'Folder upload dialog…', title: 'Also works for Program Files, but lists every file first: pick GarrysMod and steamapps/workshop/content/4000 separately, not all of steamapps.', onclick: () => fallback.click() }),
      fallback),
    pickerHint,
    status, rootList);

  // Dropping anywhere on the page while this dialog is open mounts the folder (and keeps the browser
  // from navigating away to show it).
  const hasFiles = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const onDragOver = (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dropZone.classList.add('over'); };
  const onDragLeave = (e) => { if (!e.relatedTarget) dropZone.classList.remove('over'); };
  const onDrop = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dropZone.classList.remove('over');
    // entries must be taken during the event; they stay readable afterwards
    const entries = [...e.dataTransfer.items].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter((x) => x && (x.isDirectory || /\.gma$/i.test(x.name)));
    if (!entries.length) { toast('Drop a folder (steamapps, GarrysMod, an addon) or .gma files.', 'error'); return; }
    pickerHint.hidden = true;
    show('folders');
    vfs.addEntries(entries).catch((err) => toast(err.message, 'error'));
  };
  addEventListener('dragover', onDragOver);
  addEventListener('dragleave', onDragLeave);
  addEventListener('drop', onDrop);

  // ---------- browse ----------
  const kindSel = h('select', { class: 'field', 'aria-label': 'File type' }, Object.entries(KINDS).map(([k, v]) => h('option', { value: k, text: v.label })));
  kindSel.value = kind;
  const search = h('input', { type: 'search', class: 'field', placeholder: 'Search mounted content…', 'aria-label': 'Search' });
  const crumbs = h('div', { class: 'crumbs' });
  const list = h('div', { class: 'file-list', role: 'listbox' });
  let dir = KINDS[kind].root;
  const choose = async (path) => {
    if (pick) { pick(assetValue(path)); close(); return; }
    applyToSelection(app, path);
  };
  const browse = {
    async refresh() {
      if (!vfs.mounted) { list.replaceChildren(h('p', { class: 'muted', text: 'Mount a game folder in the Folders tab first.' })); crumbs.replaceChildren(); return; }
      const k = KINDS[kindSel.value];
      const q = search.value.trim();
      if (q) {
        crumbs.replaceChildren(h('span', { class: 'muted', text: `Results for "${q}"` }));
        const hits = vfs.search(q, k.test, 400);
        list.replaceChildren(...(hits.length ? hits.map((p) => fileRow(p, p)) : [h('p', { class: 'muted', text: 'Nothing found (search covers VPK/GMA archives; browse folders for loose files).' })]));
        return;
      }
      const segs = dir ? dir.split('/') : [];
      crumbs.replaceChildren(h('button', { type: 'button', class: 'link-btn', text: '(root)', onclick: () => { dir = ''; browse.refresh(); } }),
        ...segs.flatMap((s, i) => [' / ', h('button', { type: 'button', class: 'link-btn', text: s, onclick: () => { dir = segs.slice(0, i + 1).join('/'); browse.refresh(); } })]));
      list.replaceChildren(h('p', { class: 'muted', text: 'Loading…' }));
      const l = await vfs.list(dir);
      const rows = [];
      if (dir) rows.push(h('button', { type: 'button', class: 'file-row dir', text: '⬑ ..', onclick: () => { dir = segs.slice(0, -1).join('/'); browse.refresh(); } }));
      for (const d of l.dirs) rows.push(h('button', { type: 'button', class: 'file-row dir', text: `📁 ${d}`, title: d, onclick: () => { dir = dir ? `${dir}/${d}` : d; browse.refresh(); } }));
      for (const f of l.files) { const p = dir ? `${dir}/${f}` : f; if (k.test(p)) rows.push(fileRow(p, f)); }
      list.replaceChildren(...(rows.length ? rows : [h('p', { class: 'muted', text: 'Empty folder.' })]));
    },
  };
  const fileRow = (path, label) => {
    const icon = path.endsWith('.mdl') ? '🧊' : /\.(vmt|vtf)$/.test(path) ? '🎨' : /\.(wav|mp3|ogg)$/.test(path) ? '🔊' : '📄';
    const row = h('div', { class: 'file-row' },
      h('button', { type: 'button', class: 'file-name', text: `${icon} ${label}`, title: path, onclick: () => choose(path) }),
      /\.(wav|mp3|ogg)$/.test(path) ? h('button', { type: 'button', class: 'icon-btn', text: '▶', 'aria-label': `Preview ${label}`, onclick: () => preview(app, path) }) : null);
    return row;
  };
  let timer = 0;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => browse.refresh(), 200); });
  kindSel.addEventListener('change', () => { dir = KINDS[kindSel.value].root; browse.refresh(); });
  panes.browse = h('div', { class: 'browse-pane' },
    h('div', { class: 'browse-bar' }, kindSel, search),
    crumbs, list,
    h('p', { class: 'muted', text: pick ? 'Click a file to use it.' : 'Click a model to add it (or replace the selected model). Click a material to apply it to the selected part. Sounds go into the selected sound part.' }));

  // ---------- PAC3 outfits ----------
  const outfitList = h('div', { class: 'save-list' });
  const outfitFile = h('input', { type: 'file', accept: '.txt', hidden: true });
  outfitFile.addEventListener('change', async () => { const f = outfitFile.files[0]; outfitFile.value = ''; if (f) importText(app, await readFileAs(f), f.name, 'replace'); });
  const outfits = {
    async refresh() {
      if (!vfs.mounted) { outfitList.replaceChildren(h('p', { class: 'muted', text: 'Mount your GarrysMod folder to list the outfits saved in garrysmod/data/pac3, or import a .txt file directly.' })); return; }
      const l = await vfs.list('data/pac3');
      const files = l.files.filter((f) => f.endsWith('.txt'));
      outfitList.replaceChildren(...(files.length ? files.map((f) => h('div', { class: 'save-row' },
        h('b', { text: f.replace(/\.txt$/, '') }),
        h('div', { class: 'row-btns' },
          h('button', { type: 'button', class: 'btn primary', text: 'Open', onclick: async () => importText(app, new TextDecoder().decode(await vfs.read(`data/pac3/${f}`)), f, 'replace') }),
          h('button', { type: 'button', class: 'btn', text: 'Add', title: 'Add to the current outfit', onclick: async () => importText(app, new TextDecoder().decode(await vfs.read(`data/pac3/${f}`)), f, 'append') })))) : [h('p', { class: 'muted', text: 'No PAC3 outfits found in data/pac3.' })]));
    },
  };
  panes.outfits = h('div', { class: 'stack' },
    h('div', { class: 'row-btns' }, h('button', { type: 'button', class: 'btn', text: 'Import .txt file…', onclick: () => outfitFile.click() }), outfitFile),
    outfitList,
    h('p', { class: 'muted', text: 'Imported outfits keep their Garry\'s Mod bone positions. With game content mounted they line up on the mannequin, or exactly on a playermodel set in an entity part.' }));

  body.append(tabs, ...Object.values(panes));
  const unsub = vfs.onChange(() => { renderRoots(); if (tab === 'browse' && !list.childElementCount) browse.refresh(); });
  renderRoots();
  show(pick ? 'browse' : tab);
  let close = () => {};
  const p = modal(pick ? 'Pick from game content' : 'Game content', body);
  close = () => { const o = body.closest('.overlay'); if (o) o.querySelector('.modal-title .icon-btn').click(); };
  p.then(() => { unsub(); removeEventListener('dragover', onDragOver); removeEventListener('dragleave', onDragLeave); removeEventListener('drop', onDrop); });
}

async function preview(app, path) {
  try {
    const audio = app.world.audio;
    const buf = await audio.getBuffer(path.replace(/^sound\//, ''));
    const src = audio.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(audio.master);
    src.start();
  } catch (e) { toast(`Cannot play: ${e.message}`, 'error'); }
}

/** Uses a picked file on the selected part (or adds a part). */
function applyToSelection(app, path) {
  const { editor } = app;
  const sel = editor.selected;
  const v = assetValue(path);
  if (path.endsWith('.mdl')) {
    if (sel && (sel.className === 'model' || sel.className === 'entity') && sel.constructor.getProp('Model')) editor.setProp(sel, 'Model', v);
    else { const p = editor.addPart('model', sel); editor.setProp(p, 'Model', v); }
    toast(`Model: ${v}`);
    return;
  }
  if (/\.(wav|mp3|ogg)$/.test(path)) {
    if (sel && sel.className === 'sound') editor.setProp(sel, 'Path', v);
    else { const p = editor.addPart('sound', sel); editor.setProp(p, 'Path', v); }
    toast(`Sound: ${v}`);
    return;
  }
  const slot = sel && ({ model: 'Material', entity: 'Material', material: 'BaseTexture', sprite: 'SpritePath', particles: 'Material', trail: 'TrailPath', beam: 'Material' })[sel.className];
  if (!slot) { toast('Select a model, material, sprite, particles, trail or beam part first.', 'warn'); return; }
  editor.setProp(sel, slot, v);
  toast(`${slot}: ${v}`);
}

/** Imports PAC3 text into the editor. mode: 'replace' | 'append' */
export function importText(app, text, name, mode) {
  try {
    const { data, warnings } = importPac3(text);
    const w2 = mode === 'append' ? app.editor.appendOutfit(data) : app.editor.loadOutfit(data);
    const all = [...warnings, ...w2];
    toast(`Imported ${name}${all.length ? ` — ${all.length} note(s): ${all.slice(0, 3).join('; ')}` : ''}`, all.length ? 'warn' : 'ok', all.length ? 9000 : 3500);
    if (!vfs.mounted) toast('Mount your Garry\'s Mod folder (File → Game content) to load its models, materials and bone positions.', 'info', 7000);

  } catch (e) { toast(`Could not import ${name}: ${e.message}`, 'error', 7000); }
}
