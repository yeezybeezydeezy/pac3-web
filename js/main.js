// App bootstrap: renderer, world, editor UI, input shortcuts, persistence and the frame loop.
import * as THREE from 'three';
import { World } from './core/world.js';
import { Avatar } from './avatar.js';
import { Player } from './player.js';
import { Input, isTyping } from './input.js';
import { AudioEngine } from './core/audio.js';
import './parts/index.js';
import { Editor } from './editor/editor.js';
import { TreeView } from './editor/tree.js';
import { PropertiesView } from './editor/properties.js';
import { Viewport } from './editor/viewport.js';
import { Menus } from './editor/menus.js';
import { help } from './editor/help.js';
import { storage, decodeShare } from './editor/storage.js';
import { EXAMPLES, DEFAULT_EXAMPLE } from './editor/examples.js';
import { toast, showMenu } from './editor/ui.js';
import { buildEnvironment } from './environment.js';
import { PlayMode } from './play.js';
import { vfs, clearFailedAssets } from './source/assets.js';
import { openGameContent } from './editor/content.js';

const DEFAULT_APPEARANCE = { hide: false, color: [1, 1, 1], brightness: 1, alpha: 1, material: '', wireframe: false, size: 1, scale: [1, 1, 1] };
const $ = (id) => document.getElementById(id);

const canvas = $('canvas');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  $('viewport').append(Object.assign(document.createElement('p'), { className: 'fatal', textContent: 'WebGL is not available in this browser, so the 3D view cannot start.' }));
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 1, 30000);
const env = buildEnvironment(scene, renderer);
const avatar = new Avatar(scene);
const player = new Player();
const input = new Input();
const audio = new AudioEngine();
const world = new World({ scene, camera, avatar, player, audio, input });
avatar.onFootstep = () => world.emit('footstep');
const editor = new Editor(world);

const app = {
  world, editor, env, audio, input, canvas, hud: $('hud'), mic: {},
  saveSettings() {
    storage.saveSettings({ volume: audio.volume, player: { name: player.name, health: player.health, maxHealth: player.maxHealth, armor: player.armor, color: player.color, weaponColor: player.weaponColor, weapon: player.weapon, weapons: player.weapons } });
  },
  openContent: (opts) => openGameContent(app, opts),
  async toggleMic() {
    if (app.mic.stream) {
      app.mic.stream.getTracks().forEach((t) => t.stop());
      app.mic = {};
      world.mic.level = 0;
      toast('Microphone off');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = audio.ensure();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      app.mic = { stream, analyser, buf: new Float32Array(analyser.fftSize) };
      toast('Microphone on: voice_volume() and is_voice_chatting now react to your voice', 'ok');
    } catch (e) { toast(`Microphone unavailable: ${e.message}`, 'error'); }
  },
};
const settings = storage.settings();
if (typeof settings.volume === 'number') audio.setVolume(settings.volume);
if (settings.player && typeof settings.player === 'object') {
  const sp = settings.player;
  if (typeof sp.name === 'string') player.name = sp.name.slice(0, 40);
  for (const k of ['health', 'maxHealth', 'armor']) if (Number.isFinite(sp[k])) player[k] = sp[k];
  for (const k of ['color', 'weaponColor']) if (Array.isArray(sp[k]) && sp[k].length === 3) player[k] = sp[k].map(Number);
  if (typeof sp.weapon === 'string') player.weapon = sp.weapon.slice(0, 80);
  if (Array.isArray(sp.weapons)) player.weapons = sp.weapons.filter((x) => typeof x === 'string').map((x) => x.slice(0, 80)).slice(0, 50);
}

const viewport = new Viewport({ canvas, camera, scene, world, editor, toolbar: $('vp-toolbar'), onPlay: () => app.play.enter() });
app.viewport = viewport;
const menus = new Menus(app);
menus.buildMenubar($('menubar'));
new TreeView($('tree'), editor, menus);
new PropertiesView($('props'), editor, viewport, help, { browse: (kind, pick) => openGameContent(app, { kind, pick }) });
app.play = new PlayMode(app);

// ---------- game content (local Garry's Mod / Workshop folders) ----------
avatar.onBonesChanged = () => {
  for (const p of world.allParts) if (p.attach) p.attach();
  viewport.buildMarkers();
};
let mountedCount = 0, remountTimer = 0;
vfs.onChange(() => {
  if (vfs.mounts.length === mountedCount) return;
  mountedCount = vfs.mounts.length;
  clearTimeout(remountTimer);
  remountTimer = setTimeout(() => {
    // new content: retry anything that failed to load and rebuild the outfit with it
    clearFailedAssets();
    avatar.reloadAnimations();
    editor.reload();
  }, 600);
});
vfs.restore();
$('add-btn').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); showMenu(menus.addItems(editor.selected), r.left, r.bottom + 2); });

// Audio needs a user gesture.
addEventListener('pointerdown', () => audio.ensure(), { once: true });

// ---------- persistence ----------
let saveTimer = 0, warnedSave = false;
editor.on('changed', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!storage.autosave(editor.snapshot()) && !warnedSave) { warnedSave = true; toast('Autosave failed: browser storage is full or disabled. Export your outfit to a file.', 'warn', 7000); }
  }, 400);
});

async function initialOutfit() {
  const m = /^#outfit=([\w-]+)$/.exec(location.hash);
  if (m) {
    try {
      const data = await decodeShare(m[1]);
      editor.loadOutfit(data);
      history.replaceState(null, '', location.pathname + location.search);
      toast('Loaded shared outfit', 'ok');
      return;
    } catch (e) { toast(`Could not open shared outfit: ${e.message}`, 'error', 6000); }
  }
  const saved = storage.loadAutosave();
  if (saved) {
    try { editor.loadOutfit(saved); editor.undoStack = []; return; } catch (e) { toast(`Autosave could not be loaded: ${e.message}`, 'warn'); }
  }
  editor.loadOutfit(EXAMPLES[DEFAULT_EXAMPLE]());
  editor.undoStack = [];
}
initialOutfit();

// ---------- shortcuts ----------
addEventListener('keydown', (e) => {
  if (isTyping(e.target) || document.querySelector('.overlay')) return;
  if (world.playMode) { app.play.onKey(e); return; }
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const sel = editor.selected;
  if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); editor.undo(); }
  else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); editor.redo(); }
  else if (ctrl && k === 'd') { e.preventDefault(); editor.clone(); }
  else if (ctrl && k === 's') { e.preventDefault(); menus.saveBrowser(); }
  else if (ctrl) return;
  else if ((k === 'delete' || k === 'backspace') && sel) { e.preventDefault(); editor.remove(); }
  else if (k === 'w') viewport.setMode('translate');
  else if (k === 'e') viewport.setMode('rotate');
  else if (k === 'r') viewport.setMode('scale');
  else if (k === 'q') viewport.toggleSpace();
  else if (k === 'f') viewport.focus();
  else if (k === 'b') viewport.toggleBones();
  else if (k === 'h' && sel) editor.setProp(sel, 'Hide', !sel.Hide);
  else if (k === 'p') app.play.enter();
  else if (k === 'escape') viewport.cancelPick();
});
// Copy/paste parts as JSON through the system clipboard (works across tabs and with friends).
addEventListener('copy', (e) => {
  if (isTyping(e.target) || world.playMode || !editor.selected || String(getSelection())) return;
  e.preventDefault();
  editor.copy();
  e.clipboardData.setData('text/plain', editor.clipboard);
});
addEventListener('paste', (e) => {
  if (isTyping(e.target) || world.playMode) return;
  const text = e.clipboardData.getData('text/plain');
  e.preventDefault();
  try { if (text.trim().startsWith('{') || text.trim().startsWith('[')) { editor.appendOutfit(JSON.parse(text), editor.selected); return; } } catch (err) { toast(`Paste failed: ${err.message}`, 'error'); return; }
  editor.paste();
});

// ---------- layout ----------
const vpEl = $('viewport');
function resize() {
  const w = vpEl.clientWidth, h = vpEl.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  world.viewHeight = h * renderer.getPixelRatio();
}
new ResizeObserver(resize).observe(vpEl);
resize();

const splitter = $('splitter');
splitter.addEventListener('pointerdown', (e) => {
  splitter.setPointerCapture(e.pointerId);
  const side = $('sidebar').getBoundingClientRect();
  const move = (ev) => { $('tree-panel').style.flexBasis = `${Math.max(80, Math.min(side.height - 120, ev.clientY - side.top))}px`; };
  const up = () => { splitter.removeEventListener('pointermove', move); splitter.removeEventListener('pointerup', up); };
  splitter.addEventListener('pointermove', move);
  splitter.addEventListener('pointerup', up);
});

// ---------- frame loop ----------
const clock = new THREE.Clock();
const shake = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  player.update(dt, world, input);
  world.update(dt);
  avatar.setAppearance(world.fx.entity || DEFAULT_APPEARANCE);
  env.applyFog(world.fx.fog);
  if (world.playMode) app.play.update(dt); else viewport.update();
  env.update(avatar.root.position);
  audio.updateListener(camera);
  if (app.mic.analyser) {
    app.mic.analyser.getFloatTimeDomainData(app.mic.buf);
    let s = 0;
    for (const v of app.mic.buf) s += v * v;
    world.mic.level = Math.min(1, Math.sqrt(s / app.mic.buf.length) * 4);
  }
  const a = world.fx.shake, f = world.fx.shakeFreq || 20, t = world.time;
  shake.set(Math.sin(t * f * 1.3), Math.sin(t * f * 1.7 + 1), Math.sin(t * f * 1.1 + 2)).multiplyScalar(a);
  camera.position.add(shake);
  renderer.render(scene, camera);
  camera.position.sub(shake);
}
requestAnimationFrame(frame);

// for debugging in the console
window.pac = { world, editor, app };
