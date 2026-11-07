// Generic UI pieces: dropdown/context menus, modals, toasts.
import { h } from '../core/util.js';

let openMenu = null;
export function closeMenus() { if (openMenu) { openMenu.remove(); openMenu = null; } }
addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenus(); }, true);
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
addEventListener('blur', closeMenus);

/**
 * items: [{label, action, shortcut, icon, disabled, checked, items (submenu)} | '-']
 */
function buildMenu(items, depth = 0) {
  const menu = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it === '-') { menu.append(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
    if (!it) continue;
    const row = h('button', { class: 'menu-item' + (it.items ? ' has-sub' : ''), role: 'menuitem', type: 'button', disabled: !!it.disabled },
      h('span', { class: 'menu-icon', text: it.checked != null ? (it.checked ? '✓' : '') : it.icon || '' }),
      h('span', { class: 'menu-label', text: it.label }),
      h('span', { class: 'menu-short', text: it.items ? '▸' : it.shortcut || '' }));
    if (it.title) row.title = it.title;
    if (it.items) {
      let sub = null;
      const show = () => {
        for (const s of menu.querySelectorAll(':scope > .menu-item > .menu')) if (s !== sub) s.remove();
        if (sub && sub.isConnected) return;
        sub = buildMenu(it.items, depth + 1);
        sub.classList.add('submenu');
        row.append(sub);
        const r = sub.getBoundingClientRect();
        if (r.right > innerWidth) sub.classList.add('left');
        if (r.bottom > innerHeight) sub.style.top = `${Math.max(-r.top + 4, innerHeight - r.bottom - 4)}px`;
      };
      row.addEventListener('pointerenter', show);
      row.addEventListener('click', (e) => { e.stopPropagation(); show(); });
    } else {
      row.addEventListener('pointerenter', () => { for (const s of menu.querySelectorAll(':scope > .menu-item > .menu')) s.remove(); });
      row.addEventListener('click', (e) => { e.stopPropagation(); closeMenus(); if (it.action) it.action(); });
    }
    menu.append(row);
  }
  return menu;
}

export function showMenu(items, x, y) {
  closeMenus();
  const m = buildMenu(items);
  m.classList.add('floating');
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  m.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  openMenu = m;
  const first = m.querySelector('.menu-item:not([disabled])');
  if (first) first.focus({ preventScroll: true });
  return m;
}

export function modal(title, body, buttons = [{ label: 'Close' }]) {
  return new Promise((resolve) => {
    const close = (v) => { overlay.remove(); removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-title' }, h('span', { text: title }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', text: '✕', onclick: () => close(null) })),
      h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-buttons' }, buttons.map((b) => h('button', { type: 'button', class: b.primary ? 'btn primary' : 'btn', text: b.label, onclick: () => close(b.value ?? b.label) }))));
    const overlay = h('div', { class: 'overlay', onpointerdown: (e) => { if (e.target === overlay) close(null); } }, box);
    document.body.append(overlay);
    addEventListener('keydown', onKey, true);
    const focusable = box.querySelector('input, textarea, select, .btn.primary');
    if (focusable) focusable.focus();
  });
}

export async function prompt(title, label, value = '') {
  const input = h('input', { type: 'text', class: 'field', value, 'aria-label': label });
  const body = h('label', { class: 'stack' }, h('span', { text: label }), input);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') body.closest('.modal').querySelector('.btn.primary').click(); });
  const r = await modal(title, body, [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, value: 'ok' }]);
  return r === 'ok' ? input.value : null;
}

export async function confirm(title, text, ok = 'OK') {
  return (await modal(title, h('p', { text }), [{ label: 'Cancel', value: false }, { label: ok, primary: true, value: true }])) === true;
}

let toastBox = null;
export function toast(msg, kind = 'info', ms = 3500) {
  if (!toastBox) { toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const t = h('div', { class: `toast ${kind}`, text: msg });
  toastBox.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}
