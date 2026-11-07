// Editor viewport: orbit camera, transform gizmo, click-to-select, bone markers and picking.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { h, quatToAngles } from '../core/util.js';
import { PREVIEW_STATES } from '../player.js';
import { toast } from './ui.js';

const r3 = (v) => Math.round(v * 1000) / 1000;

export class Viewport {
  constructor({ canvas, camera, scene, world, editor, toolbar, onPlay }) {
    Object.assign(this, { canvas, camera, scene, world, editor });
    this.orbit = new OrbitControls(camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.15;
    this.orbit.target.set(0, 45, 0);
    camera.position.set(55, 62, 105);
    this.orbit.update();

    this.tc = new TransformControls(camera, canvas);
    this.tc.setSize(0.8);
    this.tc.setSpace('local');
    scene.add(this.tc.getHelper());
    this.tc.addEventListener('dragging-changed', (e) => { this.orbit.enabled = !e.value; if (!e.value) editor.commit(); });
    this.tc.addEventListener('mouseDown', () => { const p = editor.selected; this._scaleStart = p && p.Scale ? p.Scale.slice() : null; this._sizeStart = p ? p.Size : null; });
    this.tc.addEventListener('objectChange', () => this.writeBack());

    this.raycaster = new THREE.Raycaster();
    this.raycaster.camera = camera;
    this.markers = [];
    this.markerGeo = new THREE.SphereGeometry(1, 12, 8);
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0xffc94a, depthTest: false, transparent: true, opacity: 0.9 });
    this.markerHot = new THREE.MeshBasicMaterial({ color: 0x4ad8ff, depthTest: false });
    this.buildMarkers();
    this.showBones = false;
    this.picking = null;
    this.label = h('div', { class: 'bone-label', hidden: true });
    canvas.parentElement.append(this.label);

    canvas.addEventListener('pointerdown', (e) => { this._down = { x: e.clientX, y: e.clientY, axis: this.tc.axis, button: e.button }; });
    canvas.addEventListener('pointerup', (e) => {
      const d = this._down;
      this._down = null;
      if (!d || d.button !== 0 || d.axis || world.playMode || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
      this.click(e);
    });
    canvas.addEventListener('pointermove', (e) => this.hover(e));
    editor.on('select', () => this.attachGizmo());
    this.buildToolbar(toolbar, onPlay);
    this.setMode('translate');
  }

  /** One clickable marker per avatar bone (rebuilt when a playermodel replaces the mannequin). */
  buildMarkers() {
    for (const m of this.markers) m.removeFromParent();
    this.markers = [];
    const av = this.world.avatar;
    for (const name of av.getBoneNames()) {
      const m = new THREE.Mesh(this.markerGeo, this.markerMat);
      m.renderOrder = 2000;
      m.userData.boneName = name;
      m.visible = false;
      av.getBone(name).add(m);
      this.markers.push(m);
    }
  }

  buildToolbar(el, onPlay) {
    const btn = (text, title, fn, cls = '') => h('button', { type: 'button', class: `tb-btn ${cls}`, text, title, 'aria-label': title, onclick: fn });
    this.modeBtns = {
      translate: btn('✥', 'Move (W)', () => this.setMode('translate')),
      rotate: btn('⟳', 'Rotate (E)', () => this.setMode('rotate')),
      scale: btn('⤢', 'Scale (R)', () => this.setMode('scale')),
    };
    this.spaceBtn = btn('L', 'Local / world axes (Q)', () => this.toggleSpace());
    this.bonesBtn = btn('🦴', 'Show bones (B)', () => this.toggleBones());
    const preview = h('select', { class: 'tb-select', title: 'Preview animation', 'aria-label': 'Preview animation' }, PREVIEW_STATES.map((s) => h('option', { value: s, text: s })));
    preview.addEventListener('change', () => { this.world.player.preview = preview.value; preview.blur(); });
    this.previewSel = preview;
    el.replaceChildren(
      h('div', { class: 'tb-group' }, Object.values(this.modeBtns), this.spaceBtn),
      h('div', { class: 'tb-group' }, btn('⌖', 'Focus selected (F)', () => this.focus()), this.bonesBtn, preview),
      h('div', { class: 'tb-group' }, btn('▶ Play', 'Play mode: walk around with WASD (P)', onPlay, 'play')),
    );
  }

  setMode(m) {
    this.tc.setMode(m);
    for (const [k, b] of Object.entries(this.modeBtns)) b.classList.toggle('active', k === m);
  }
  toggleSpace() {
    this.tc.setSpace(this.tc.space === 'local' ? 'world' : 'local');
    this.spaceBtn.textContent = this.tc.space === 'local' ? 'L' : 'W';
  }
  toggleBones() { this.showBones = !this.showBones; this.bonesBtn.classList.toggle('active', this.showBones); }

  attachGizmo() {
    const p = this.editor.selected;
    if (p && p.gizmoTarget && p.inWorld && !this.world.playMode) this.tc.attach(p.gizmoTarget);
    else this.tc.detach();
  }

  writeBack() {
    const p = this.editor.selected;
    if (!p || !p.gizmoTarget) return;
    const n = p.gizmoTarget, ed = this.editor;
    if (this.tc.mode === 'translate') ed.setProp(p, 'Position', n.position.toArray().map(r3), false);
    else if (this.tc.mode === 'rotate') ed.setProp(p, 'Angles', quatToAngles(n.quaternion).map(r3), false);
    else {
      const s = n.scale.toArray();
      if (this._scaleStart && p.constructor.getProp('Scale')) ed.setProp(p, 'Scale', this._scaleStart.map((v, i) => r3(v * s[i])), false);
      else if (this._sizeStart != null && p.constructor.getProp('Size')) ed.setProp(p, 'Size', r3(this._sizeStart * (s[0] + s[1] + s[2]) / 3), false);
      n.scale.set(1, 1, 1);
    }
  }

  focus() {
    const p = this.editor.selected;
    const target = new THREE.Vector3();
    if (p && p.getWorldPosition) p.getWorldPosition(target);
    else this.world.avatar.getBone('chest').getWorldPosition(target);
    const off = this.camera.position.clone().sub(this.orbit.target);
    if (p && p.getWorldPosition) off.setLength(Math.min(off.length(), 60));
    this.orbit.target.copy(target);
    this.camera.position.copy(target).add(off);
  }

  /** Reframe the avatar (after leaving play mode). */
  frameAvatar() {
    const off = this.camera.position.clone().sub(this.orbit.target);
    this.world.avatar.getBone('chest').getWorldPosition(this.orbit.target);
    this.camera.position.copy(this.orbit.target).add(off);
  }

  pickBone(cb) {
    this.picking = cb;
    toast('Click a bone marker in the viewport (Esc to cancel).');
  }
  cancelPick() { this.picking = null; this.label.hidden = true; }

  _ray(e) {
    const r = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
  }
  _markerHit(e) {
    this._ray(e);
    const hit = this.raycaster.intersectObjects(this.markers.filter((m) => m.visible), false)[0];
    return hit ? hit.object : null;
  }

  hover(e) {
    if (!this.picking && !this.showBones) { this.label.hidden = true; return; }
    const m = this._markerHit(e);
    for (const mk of this.markers) mk.material = mk === m ? this.markerHot : this.markerMat;
    this.label.hidden = !m;
    if (m) {
      const r = this.canvas.getBoundingClientRect();
      this.label.textContent = m.userData.boneName;
      this.label.style.left = `${e.clientX - r.left + 14}px`;
      this.label.style.top = `${e.clientY - r.top + 10}px`;
    }
  }

  click(e) {
    if (this.picking) {
      const m = this._markerHit(e);
      if (m) { const cb = this.picking; this.cancelPick(); cb(m.userData.boneName); }
      return;
    }
    this._ray(e);
    const visible = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
    for (const hit of this.raycaster.intersectObjects(this.scene.children, true)) {
      if (!visible(hit.object)) continue;
      let part = null;
      for (let x = hit.object; x && !part; x = x.parent) part = x.userData.part || null;
      if (part && part.inWorld && !part.transient) { this.editor.select(part); return; }
    }
  }

  update() {
    const play = this.world.playMode;
    const show = !play && (this.showBones || !!this.picking);
    const d = this.camera.position.distanceTo(this.orbit.target);
    for (const m of this.markers) { m.visible = show; m.scale.setScalar(Math.max(0.4, d * 0.008)); }
    if (!play) this.orbit.update();
    this.tc.getHelper().visible = !play && !!this.tc.object;
  }
}
