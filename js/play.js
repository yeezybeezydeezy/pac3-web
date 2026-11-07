// Play mode: third/first-person camera, pointer-lock mouse look, chat, HUD, flashlight.
import * as THREE from 'three';
import { h, clamp, DEG } from './core/util.js';

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3(), _q = new THREE.Quaternion();
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

export class PlayMode {
  constructor(app) {
    this.app = app;
    const { world, canvas } = app;
    this.world = world;
    this.canvas = canvas;
    this.dist = 110;
    this.locked = false;
    this.pivot = new THREE.Vector3();
    this.chatLines = [];
    this.flashlight = new THREE.SpotLight(0xfff4e0, 0, 1500, 25 * DEG, 0.4, 0);
    world.scene.add(this.flashlight, this.flashlight.target);

    this.chatLog = h('div', { class: 'chat-log', 'aria-live': 'polite' });
    this.chatInput = h('input', { class: 'chat-input', type: 'text', placeholder: 'say something, or pac_event <name>', maxLength: 200, hidden: true, 'aria-label': 'Chat' });
    this.eventBar = h('div', { class: 'event-bar' });
    this.bubble = h('div', { class: 'bubble', hidden: true });
    this.hint = h('div', { class: 'play-hint' });
    this.health = h('div', { class: 'hud-health' });
    app.hud.replaceChildren(h('div', { class: 'crosshair' }), this.bubble, this.health, this.eventBar, this.chatLog, this.chatInput, this.hint,
      h('button', { type: 'button', class: 'btn exit-play', text: '✕ Exit play mode', onclick: () => this.exit() }));

    canvas.addEventListener('click', () => { if (world.playMode && !this.locked) canvas.requestPointerLock(); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; this.updateHint(); });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const p = world.player;
      p.eyeYaw -= e.movementX * 0.0025;
      p.eyePitch = clamp(p.eyePitch + e.movementY * 0.0025, -1.45, 1.45);
    });
    canvas.addEventListener('mousedown', (e) => { if (this.locked) { app.input.mouseDown(e.button); if (e.button === 0) world.lastFire = world.time; } });
    canvas.addEventListener('wheel', (e) => { if (world.playMode) { e.preventDefault(); this.dist = clamp(this.dist * (e.deltaY > 0 ? 1.12 : 0.89), 30, 600); } }, { passive: false });
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { this.send(this.chatInput.value); this.closeChat(); }
      if (e.key === 'Escape') this.closeChat();
    });
    world.on('chat', (t) => this.log(`${world.player.name}: ${t}`));
    world.on('pac_event', () => this.renderEvents());
    setInterval(() => { if (world.playMode) this.refreshHud(); }, 200);
  }

  enter() {
    const w = this.world;
    if (w.playMode) return;
    w.playMode = true;
    this.app.input.mouseEnabled = true;
    document.body.classList.add('playing');
    w.player.eyeYaw = w.player.bodyYaw;
    w.player.eyePitch = 0.15;
    this.app.viewport.attachGizmo();
    this.renderEvents();
    this.updateHint();
    this.app.audio.ensure();
  }

  exit() {
    const w = this.world;
    if (!w.playMode) return;
    w.playMode = false;
    this.app.input.mouseEnabled = false;
    this.app.input.down.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    document.body.classList.remove('playing');
    this.closeChat();
    w.player.vel.set(0, 0, 0);
    w.player.pos.y = 0;
    w.camera.fov = 60;
    w.camera.updateProjectionMatrix();
    this.flashlight.intensity = 0;
    this.app.viewport.attachGizmo();
    this.app.viewport.frameAvatar();
  }

  updateHint() {
    this.hint.textContent = this.locked
      ? 'WASD move · Shift sprint · Space jump · Ctrl crouch · Mouse fire · F flashlight · V view · T chat · 1-9 events · Esc release'
      : 'Click the view to capture the mouse · Esc again to return to the editor';
  }

  commandEvents() {
    const names = new Set();
    for (const p of this.world.allParts) if (p.className === 'event' && p.Event === 'command' && !p.transient) { const n = p.Arguments.split('@@')[0].trim(); if (n) names.add(n); }
    return [...names];
  }
  renderEvents() {
    const names = this.commandEvents().slice(0, 9);
    this.eventBar.replaceChildren(...names.map((n, i) => h('button', {
      type: 'button', class: 'ev-btn' + (this.world.pacEvents.get(n) ? ' on' : ''), title: `pac_event ${n}`,
      onclick: () => this.world.runCommand(`pac_event ${n} toggle`),
    }, h('kbd', { text: String(i + 1) }), ` ${n}`)));
  }
  refreshHud() {
    const p = this.world.player;
    this.health.textContent = `♥ ${Math.round(p.health)}${p.armor ? `  ⛨ ${Math.round(p.armor)}` : ''}`;
    if (this.eventBar.childElementCount !== Math.min(9, this.commandEvents().length)) this.renderEvents();
  }

  log(line) {
    this.chatLines.push(line);
    if (this.chatLines.length > 6) this.chatLines.shift();
    this.chatLog.replaceChildren(...this.chatLines.map((l) => h('div', { text: l })));
  }
  openChat() {
    this.world.typing = true;
    this.chatInput.hidden = false;
    this.chatInput.value = '';
    if (document.pointerLockElement) document.exitPointerLock();
    this.chatInput.focus();
  }
  closeChat() { this.world.typing = false; this.chatInput.hidden = true; this.chatInput.blur(); }
  send(text) {
    text = text.trim();
    if (!text) return;
    if (/^\/?(pac_event|pac_proxy)\b/i.test(text)) { const r = this.world.runCommand(text); if (r) this.log(r); }
    else this.world.say(text);
  }

  onKey(e) {
    const k = this.app.input.keyName(e);
    if (k === 'escape') { if (!this.locked) this.exit(); return; }
    if (k === 't' || k === 'enter') { e.preventDefault(); this.openChat(); return; }
    if (e.repeat) return;
    if (k === 'v') this.world.firstPerson = !this.world.firstPerson;
    if (k === 'f') this.world.player.flashlight = !this.world.player.flashlight;
    if (/^[1-9]$/.test(k)) {
      const n = this.commandEvents()[Number(k) - 1];
      if (n) { const r = this.world.runCommand(`pac_event ${n} toggle`); if (r) this.log(r); }
    }
    if (e.ctrlKey && k !== 'control') e.preventDefault();
    if (k === 'space') e.preventDefault();
  }

  update(dt) {
    const w = this.world, p = w.player, cam = w.camera, av = w.avatar;
    av.getBone('eyes').getWorldPosition(_v);
    if (!this.pivot.lengthSq()) this.pivot.copy(_v);
    this.pivot.lerp(_v, 1 - Math.exp(-dt * 20));
    p.getEyeDir(_d);
    const camPart = w.fx.camera;
    let fov = 75;
    if (camPart) {
      camPart.offset.getWorldPosition(cam.position);
      camPart.offset.getWorldQuaternion(_q);
      cam.quaternion.copy(_q).multiply(FLIP);
      fov = camPart.FOV;
    } else if (w.firstPerson) {
      cam.position.copy(_v).addScaledVector(_d, 3);
      cam.lookAt(_r.copy(cam.position).add(_d));
      av.getBone("head").scale.setScalar(0.001); // hide the head from the inside
    } else {
      _r.set(-Math.cos(p.eyeYaw), 0, Math.sin(p.eyeYaw));
      cam.position.copy(this.pivot).addScaledVector(_d, -this.dist).addScaledVector(_r, -this.dist * 0.12);
      cam.position.y = Math.max(4, cam.position.y);
      cam.lookAt(_r.copy(cam.position).add(_d));
    }
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    // flashlight from the eyes
    this.flashlight.position.copy(_v);
    this.flashlight.target.position.copy(_v).addScaledVector(_d, 100);
    this.flashlight.intensity = p.flashlight ? 4 : 0;
    // chat bubble over the head
    const recent = w.time - w.chat.time < 5;
    this.bubble.hidden = !recent;
    if (recent) {
      av.getBone('head').getWorldPosition(_v).y += 16 * av.root.scale.y;
      _v.project(cam);
      if (_v.z < 1) {
        if (this.bubble.textContent !== w.chat.text) this.bubble.textContent = w.chat.text;
        this.bubble.style.left = `${(_v.x * 0.5 + 0.5) * 100}%`;
        this.bubble.style.top = `${(-_v.y * 0.5 + 0.5) * 100}%`;
      } else this.bubble.hidden = true;
    }
  }
}

