// light, sprite, text, trail, beam, particles, sunbeams, fog, shake, camera
import * as THREE from 'three';
import { Part, prop, registerPart } from '../core/part.js';
import { MovablePart, applyBlend, BLEND_MODES } from './movable.js';
import { getTexture, SPRITE_TEXTURES, TRAIL_TEXTURES, ALL_TEXTURES } from '../core/textures.js';
import { Ribbon } from '../core/ribbon.js';
import { DEG, clamp, lerp, setColor } from '../core/util.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color();
const NO_AIM = ['EyeAngles', 'AimPart'];

export class LightPart extends MovablePart {
  static className = 'light';
  static icon = '💡';
  static category = 'effects';
  static description = 'A dynamic light. Set OuterAngle above 0 to make it a spotlight shining forward (+Z).';
  static props = [
    prop('Color', 'color', [1, 1, 1], { group: 'appearance' }),
    prop('Brightness', 'number', 8, { group: 'appearance', min: 0, step: 0.25 }),
    prop('Size', 'number', 100, { group: 'appearance', min: 1, step: 5, help: 'Range in units.' }),
    prop('InnerAngle', 'number', 0, { group: 'appearance', min: 0, max: 179, step: 1 }),
    prop('OuterAngle', 'number', 0, { group: 'appearance', min: 0, max: 179, step: 1, help: '0 = point light, otherwise spotlight cone angle.' }),
    prop('Shadows', 'boolean', false, { group: 'appearance', help: 'Cast shadows (spotlights only, costs performance).' }),
  ];
  constructor(world) { super(world); this.light = null; this._build(); }
  _build() {
    if (this.light) { this.light.removeFromParent(); this.light.dispose(); if (this.target) this.target.removeFromParent(); }
    const spot = this.OuterAngle > 0;
    this.light = spot ? new THREE.SpotLight() : new THREE.PointLight();
    this.light.decay = 0;
    if (spot) { this.target = new THREE.Object3D(); this.target.position.set(0, 0, 10); this.offset.add(this.target); this.light.target = this.target; }
    this.offset.add(this.light);
    this._apply();
  }
  _apply() {
    const l = this.light;
    setColor(l.color, this.Color);
    l.intensity = this.hiddenNow ? 0 : this.Brightness * 0.4;
    l.distance = this.Size;
    if (l.isSpotLight) {
      l.angle = Math.min(this.OuterAngle, 179) * 0.5 * DEG;
      l.penumbra = clamp(1 - this.InnerAngle / Math.max(1e-3, this.OuterAngle), 0, 1);
      l.castShadow = this.Shadows;
      l.shadow.mapSize.set(512, 512);
      l.shadow.camera.near = 1;
      l.shadow.bias = -0.0005;
    }
  }
  onPropChanged(name, old) {
    super.onPropChanged(name, old);
    if (name === 'OuterAngle' && (old > 0) !== (this.OuterAngle > 0)) this._build(); else this._apply();
  }
  // keep the light in the scene so the light count (and shaders) stay stable
  onShow() { this.node.visible = true; this._apply(); }
  onHide() { this.node.visible = true; this._apply(); }
  destroy() { this.light.dispose(); super.destroy(); }
}
registerPart(LightPart);

export class SpritePart extends MovablePart {
  static className = 'sprite';
  static icon = '✨';
  static category = 'effects';
  static description = 'A camera-facing image (glow, flare, star…).';
  static removeProps = NO_AIM;
  static props = [
    prop('SpritePath', 'asset', 'glow', { options: SPRITE_TEXTURES, accept: 'image/*' }),
    prop('Size', 'number', 10, { group: 'orientation', step: 0.5 }),
    prop('SizeX', 'number', 1, { group: 'orientation', step: 0.05 }),
    prop('SizeY', 'number', 1, { group: 'orientation', step: 0.05 }),
    prop('Rotation', 'number', 0, { group: 'orientation', step: 1, help: 'Screen-space rotation in degrees.' }),
    prop('Color', 'color', [1, 1, 1], { group: 'appearance' }),
    prop('Alpha', 'number', 1, { group: 'appearance', min: 0, max: 1, step: 0.02 }),
    prop('BlendMode', 'enum', 'additive', { group: 'appearance', options: BLEND_MODES }),
    prop('IgnoreZ', 'boolean', false, { group: 'appearance' }),
  ];
  constructor(world) {
    super(world);
    this.material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.userData.part = this;
    this.offset.add(this.sprite);
    this._apply();
  }
  _apply() {
    const m = this.material;
    const map = getTexture(this.SpritePath);
    if (m.map !== map) { m.map = map; m.needsUpdate = true; }
    setColor(m.color, this.Color);
    m.opacity = this.Alpha;
    applyBlend(m, this.BlendMode);
    m.depthTest = !this.IgnoreZ;
    m.rotation = this.Rotation * DEG;
    this.sprite.renderOrder = this.IgnoreZ ? 1000 : 2;
    this.sprite.scale.set(this.Size * this.SizeX, this.Size * this.SizeY, 1);
  }
  onPropChanged(name, old) { super.onPropChanged(name, old); this._apply(); }
  destroy() { this.material.dispose(); super.destroy(); }
}
registerPart(SpritePart);

export const FONTS = ['Arial', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Comic Sans MS', 'monospace', 'serif', 'sans-serif', 'cursive', 'fantasy'];
export class TextPart extends MovablePart {
  static className = 'text';
  static icon = '🔤';
  static category = 'effects';
  static description = 'Floating text. Can show live values like health, speed or a proxy-driven number.';
  static props = [
    prop('Text', 'text', 'Hello!'),
    prop('TextOverride', 'enum', 'Text', { options: ['Text', 'Name', 'Health', 'MaxHealth', 'Armor', 'Speed', 'Time', 'Clock', 'Date', 'DynamicTextValue'], help: 'Show a live value instead of (or appended to) Text.' }),
    prop('DynamicTextValue', 'number', 0, { help: 'Number shown with TextOverride = DynamicTextValue (drive it with a proxy).' }),
    prop('RoundingPosition', 'number', 2, { min: 0, max: 8, integer: true }),
    prop('Font', 'enum', 'Arial', { options: FONTS, free: true }),
    prop('Bold', 'boolean', true),
    prop('DrawMode', 'enum', 'billboard', { options: ['billboard', '3d'] }),
    prop('Size', 'number', 1, { group: 'orientation', step: 0.05 }),
    prop('Color', 'color', [1, 1, 1], { group: 'appearance' }),
    prop('Alpha', 'number', 1, { group: 'appearance', min: 0, max: 1, step: 0.02 }),
    prop('OutlineColor', 'color', [0, 0, 0], { group: 'appearance' }),
    prop('Outline', 'number', 6, { group: 'appearance', min: 0, max: 40, step: 1 }),
    prop('IgnoreZ', 'boolean', false, { group: 'appearance' }),
  ];
  constructor(world) {
    super(world);
    this.canvas = document.createElement('canvas');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.spriteMat = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false });
    this.meshMat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.sprite = new THREE.Sprite(this.spriteMat);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.meshMat);
    this.sprite.userData.part = this.mesh.userData.part = this;
    this.offset.add(this.sprite, this.mesh);
    this._key = '';
    this._nextDyn = 0;
    this._render();
  }
  getString() {
    const w = this.world, p = w.player, d = this.RoundingPosition;
    const fmt = (n) => String(Number(Number(n).toFixed(d)));
    switch (this.TextOverride) {
      case 'Name': return p.name;
      case 'Health': return fmt(p.health);
      case 'MaxHealth': return fmt(p.maxHealth);
      case 'Armor': return fmt(p.armor);
      case 'Speed': return fmt(p.vel.length());
      case 'Time': return fmt(w.time);
      case 'Clock': return new Date().toLocaleTimeString();
      case 'Date': return new Date().toLocaleDateString();
      case 'DynamicTextValue': return this.Text + fmt(this.DynamicTextValue);
      default: return this.Text;
    }
  }
  _render() {
    const str = this.getString().slice(0, 2000);
    const key = [str, this.Font, this.Bold, this.Color, this.OutlineColor, this.Outline].join('|');
    if (key !== this._key) {
      this._key = key;
      const lines = str.split('\n');
      const px = 64, font = `${this.Bold ? 'bold ' : ''}${px}px ${JSON.stringify(this.Font)}`;
      const ctx = this.canvas.getContext('2d');
      ctx.font = font;
      const pad = this.Outline + 8;
      const w = Math.max(8, ...lines.map((l) => Math.ceil(ctx.measureText(l).width))) + pad * 2;
      const h = lines.length * px * 1.2 + pad * 2;
      this.canvas.width = Math.min(4096, w);
      this.canvas.height = Math.min(4096, h);
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      lines.forEach((l, i) => {
        const y = pad + px * 1.2 * (i + 0.5);
        if (this.Outline > 0) { ctx.strokeStyle = `rgb(${this.OutlineColor.map((x) => x * 255).join(',')})`; ctx.lineWidth = this.Outline * 2; ctx.strokeText(l, w / 2, y); }
        ctx.fillStyle = `rgb(${this.Color.map((x) => x * 255).join(',')})`;
        ctx.fillText(l, w / 2, y);
      });
      this.texture.dispose();
      this.texture.needsUpdate = true;
      this._aspect = this.canvas.width / this.canvas.height;
      this._lines = lines.length;
    }
    const hgt = 6 * this.Size * (this._lines || 1);
    this.sprite.scale.set(hgt * this._aspect, hgt, 1);
    this.mesh.scale.set(hgt * this._aspect, hgt, 1);
    const bill = this.DrawMode !== '3d';
    this.sprite.visible = bill;
    this.mesh.visible = !bill;
    for (const m of [this.spriteMat, this.meshMat]) { m.opacity = this.Alpha; m.depthTest = !this.IgnoreZ; }
    this.sprite.renderOrder = this.mesh.renderOrder = this.IgnoreZ ? 1000 : 2;
  }
  onPropChanged(name, old) { super.onPropChanged(name, old); this._render(); }
  update(dt) {
    super.update(dt);
    if (!this.hiddenNow && this.TextOverride !== 'Text' && this.world.time >= this._nextDyn) { this._nextDyn = this.world.time + 0.1; this._render(); }
  }
  destroy() { this.texture.dispose(); this.spriteMat.dispose(); this.meshMat.dispose(); this.mesh.geometry.dispose(); super.destroy(); }
}
registerPart(TextPart);

export class TrailPart extends MovablePart {
  static className = 'trail';
  static icon = '〰️';
  static category = 'effects';
  static description = 'Leaves a fading ribbon behind as it moves. Best seen in play mode.';
  static removeProps = NO_AIM;
  static props = [
    prop('TrailPath', 'asset', 'laser', { options: TRAIL_TEXTURES, accept: 'image/*' }),
    prop('Duration', 'number', 1, { min: 0.05, step: 0.1, help: 'Seconds a point lives.' }),
    prop('Spacing', 'number', 2, { min: 0.1, step: 0.5, help: 'Units between points.' }),
    prop('StartSize', 'number', 4, { group: 'appearance', min: 0, step: 0.5 }),
    prop('EndSize', 'number', 0, { group: 'appearance', min: 0, step: 0.5 }),
    prop('StartColor', 'color', [1, 1, 1], { group: 'appearance' }),
    prop('EndColor', 'color', [1, 1, 1], { group: 'appearance' }),
    prop('StartAlpha', 'number', 1, { group: 'appearance', min: 0, max: 1, step: 0.02 }),
    prop('EndAlpha', 'number', 0, { group: 'appearance', min: 0, max: 1, step: 0.02 }),
    prop('Stretch', 'number', 1, { group: 'appearance', step: 0.1, help: 'Texture repeats along the trail.' }),
    prop('BlendMode', 'enum', 'additive', { group: 'appearance', options: BLEND_MODES }),
    prop('IgnoreZ', 'boolean', false, { group: 'appearance' }),
    prop('Gravity', 'vector', [0, 0, 0], { group: 'movement', help: 'Units/s² applied to trail points (y is up).' }),
  ];
  constructor(world) {
    super(world);
    this.ribbon = new Ribbon(512);
    this.points = [];
    this._list = [];
    this._apply();
  }
  onAdded() { this.world.scene.add(this.ribbon.mesh); }
  _apply() {
    const m = this.ribbon.material;
    const map = getTexture(this.TrailPath);
    if (m.map !== map) { m.map = map; m.needsUpdate = true; }
    applyBlend(m, this.BlendMode);
    m.depthTest = !this.IgnoreZ;
    this.ribbon.mesh.renderOrder = this.IgnoreZ ? 1000 : 3;
  }
  onPropChanged(name, old) { super.onPropChanged(name, old); this._apply(); }
  onShow() { super.onShow(); this.points.length = 0; }
  update(dt) {
    super.update(dt);
    const t = this.world.time;
    const pts = this.points;
    while (pts.length && t - pts[0].t > this.Duration) pts.shift();
    const g = this.Gravity;
    if (g[0] || g[1] || g[2]) for (const p of pts) p.v.add(_v.fromArray(g).multiplyScalar(dt)), p.p.addScaledVector(p.v, dt);
    let head = null;
    if (!this.hiddenNow) {
      this.getWorldPosition(_w);
      const last = pts[pts.length - 1];
      if (!last || last.p.distanceTo(_w) >= this.Spacing) { pts.push({ p: _w.clone(), v: new THREE.Vector3(), t }); if (pts.length > 510) pts.shift(); }
      else head = { p: _w.clone(), t };
    }
    const all = head ? [...pts, head] : pts;
    const n = all.length;
    const list = this._list;
    list.length = 0;
    for (let i = n - 1; i >= 0; i--) {
      const f = clamp((t - all[i].t) / this.Duration, 0, 1);
      list.push({ p: all[i].p, w: lerp(this.StartSize, this.EndSize, f), c: [0, 1, 2].map((k) => lerp(this.StartColor[k], this.EndColor[k], f)), a: lerp(this.StartAlpha, this.EndAlpha, f), u: f * this.Stretch });
    }
    this.ribbon.mesh.visible = n > 1;
    if (n > 1) this.ribbon.build(list, this.world.camera);
  }
  destroy() { this.ribbon.dispose(); super.destroy(); }
}
registerPart(TrailPart);

export class BeamPart extends MovablePart {
  static className = 'beam';
  static icon = '⚡';
  static category = 'effects';
  static description = 'A bendy ribbon from this part to EndPoint (or 100 units forward). Add Jitter for lightning.';
  static removeProps = NO_AIM;
  static props = [
    prop('EndPoint', 'part', ''),
    prop('Material', 'asset', 'laser', { options: TRAIL_TEXTURES, accept: 'image/*' }),
    prop('Bend', 'number', 10, { step: 1 }),
    prop('Resolution', 'number', 16, { min: 2, max: 128, integer: true }),
    prop('Width', 'number', 2, { group: 'appearance', min: 0, step: 0.25 }),
    prop('StartWidthMultiplier', 'number', 1, { group: 'appearance', min: 0, step: 0.1 }),
    prop('EndWidthMultiplier', 'number', 1, { group: 'appearance', min: 0, step: 0.1 }),
    prop('StartColor', 'color', [1, 1, 1], { group: 'appearance' }),
    prop('EndColor', 'color', [1, 1, 1], { group: 'appearance' }),
    prop('StartAlpha', 'number', 1, { group: 'appearance', min: 0, max: 1, step: 0.02 }),
    prop('EndAlpha', 'number', 1, { group: 'appearance', min: 0, max: 1, step: 0.02 }),
    prop('TextureStretch', 'number', 1, { group: 'appearance', step: 0.1 }),
    prop('TextureScroll', 'number', 0, { group: 'appearance', step: 0.05 }),
    prop('ScrollRate', 'number', 0, { group: 'appearance', step: 0.1 }),
    prop('Jitter', 'number', 0, { group: 'appearance', min: 0, step: 0.25, help: 'Random wobble per frame (lightning).' }),
    prop('BlendMode', 'enum', 'additive', { group: 'appearance', options: BLEND_MODES }),
    prop('IgnoreZ', 'boolean', false, { group: 'appearance' }),
  ];
  constructor(world) { super(world); this.ribbon = new Ribbon(130); this._apply(); }
  onAdded() { this.world.scene.add(this.ribbon.mesh); }
  _apply() {
    const m = this.ribbon.material;
    const map = getTexture(this.Material);
    if (m.map !== map) { m.map = map; m.needsUpdate = true; }
    applyBlend(m, this.BlendMode);
    m.depthTest = !this.IgnoreZ;
  }
  onPropChanged(name, old) { super.onPropChanged(name, old); this._apply(); }
  update(dt) {
    super.update(dt);
    this.ribbon.mesh.visible = !this.hiddenNow;
    if (this.hiddenNow) return;
    const p0 = this.getWorldPosition(new THREE.Vector3());
    const d0 = this.getWorldForward(new THREE.Vector3());
    const end = this.world.getPart(this.EndPoint);
    let p3, d3;
    if (end && end.getWorldPosition && end !== this) { p3 = end.getWorldPosition(new THREE.Vector3()); d3 = end.getWorldForward ? end.getWorldForward(new THREE.Vector3()) : d0.clone(); }
    else { p3 = p0.clone().addScaledVector(d0, 100); d3 = d0.clone(); }
    const p1 = p0.clone().addScaledVector(d0, this.Bend), p2 = p3.clone().addScaledVector(d3, -this.Bend);
    const n = this.Resolution + 1, list = [];
    const scroll = this.TextureScroll + this.ScrollRate * this.world.time;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), it = 1 - t;
      const p = new THREE.Vector3()
        .addScaledVector(p0, it * it * it).addScaledVector(p1, 3 * it * it * t)
        .addScaledVector(p2, 3 * it * t * t).addScaledVector(p3, t * t * t);
      if (this.Jitter && i > 0 && i < n - 1) p.add(_v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(this.Jitter * 2));
      list.push({ p, w: this.Width * lerp(this.StartWidthMultiplier, this.EndWidthMultiplier, t), c: [0, 1, 2].map((k) => lerp(this.StartColor[k], this.EndColor[k], t)), a: lerp(this.StartAlpha, this.EndAlpha, t), u: t * this.TextureStretch + scroll });
    }
    this.ribbon.build(list, this.world.camera);
  }
  destroy() { this.ribbon.dispose(); super.destroy(); }
}
registerPart(BeamPart);

const PARTICLE_VS = `
attribute float aSize; attribute vec4 aColor; attribute float aRot;
uniform float uScale; varying vec4 vColor; varying float vRot;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.001, -mv.z);
  vColor = aColor; vRot = aRot;
}`;
const PARTICLE_FS = `
uniform sampler2D map; varying vec4 vColor; varying float vRot;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  uv = mat2(c, -s, s, c) * uv + 0.5;
  gl_FragColor = texture2D(map, vec2(uv.x, 1.0 - uv.y)) * vColor;
  if (gl_FragColor.a < 0.004) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const MAX_PARTICLES = 2000;

export class ParticlesPart extends MovablePart {
  static className = 'particles';
  static icon = '🎆';
  static category = 'effects';
  static description = 'Emits particles forward (+Z): fire, smoke, sparks, magic. Particles live in the world.';
  static removeProps = NO_AIM;
  static props = [
    prop('Material', 'asset', 'glow', { options: ALL_TEXTURES, accept: 'image/*' }),
    prop('FireDelay', 'number', 0.05, { group: 'emission', min: 0.005, step: 0.01, help: 'Seconds between bursts.' }),
    prop('NumberParticles', 'number', 1, { group: 'emission', min: 1, max: 200, integer: true }),
    prop('FireOnce', 'boolean', false, { group: 'emission', help: 'Emit one burst when shown.' }),
    prop('DieTime', 'number', 1.5, { group: 'emission', min: 0.05, step: 0.1 }),
    prop('Follow', 'boolean', false, { group: 'emission', help: 'Particles move with the emitter.' }),
    prop('StartSize', 'number', 3, { group: 'size', min: 0, step: 0.5 }),
    prop('EndSize', 'number', 10, { group: 'size', min: 0, step: 0.5 }),
    prop('StartColor', 'color', [1, 0.8, 0.4], { group: 'appearance' }),
    prop('EndColor', 'color', [1, 0.2, 0.05], { group: 'appearance' }),
    prop('RandomColor', 'boolean', false, { group: 'appearance' }),
    prop('StartAlpha', 'number', 1, { group: 'appearance', min: 0, max: 1, step: 0.02 }),
    prop('EndAlpha', 'number', 0, { group: 'appearance', min: 0, max: 1, step: 0.02 }),
    prop('Additive', 'boolean', true, { group: 'appearance' }),
    prop('IgnoreZ', 'boolean', false, { group: 'appearance' }),
    prop('Velocity', 'number', 40, { group: 'movement', step: 5 }),
    prop('Spread', 'number', 0.2, { group: 'movement', min: 0, max: 1, step: 0.02, help: '0 = straight, 1 = every direction.' }),
    prop('PositionSpread', 'number', 0, { group: 'movement', min: 0, step: 0.5 }),
    prop('Gravity', 'vector', [0, 0, 0], { group: 'movement', help: 'Units/s² (y is up).' }),
    prop('AirResistance', 'number', 0.5, { group: 'movement', min: 0, step: 0.1 }),
    prop('Collide', 'boolean', true, { group: 'movement', help: 'Bounce off the ground.' }),
    prop('Bounce', 'number', 0.4, { group: 'movement', min: 0, max: 1, step: 0.05 }),
    prop('RollDelta', 'number', 0, { group: 'rotation', step: 10, help: 'Degrees per second.' }),
    prop('RandomRollSpeed', 'number', 0, { group: 'rotation', min: 0, step: 10 }),
  ];
  constructor(world) {
    super(world);
    const n = MAX_PARTICLES;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.rotVel = new Float32Array(n);
    this.tint = new Float32Array(n * 3);
    this.count = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos).setAttribute('aSize', this.aSize).setAttribute('aColor', this.aColor).setAttribute('aRot', this.aRot);
    this.material = new THREE.ShaderMaterial({ vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, uniforms: { map: { value: null }, uScale: { value: 500 } }, transparent: true, depthWrite: false });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.raycast = () => {};
    this._acc = 0;
    this._last = null;
    this._apply();
  }
  onAdded() { this.world.scene.add(this.points); }
  _apply() {
    this.material.uniforms.map.value = getTexture(this.Material) || getTexture('glow');
    this.material.blending = this.Additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.material.depthTest = !this.IgnoreZ;
    this.points.renderOrder = this.IgnoreZ ? 1000 : 3;
  }
  onPropChanged(name, old) { super.onPropChanged(name, old); this._apply(); }
  onShow() { super.onShow(); this._acc = this.FireDelay; this._fireOncePending = true; }
  emit(n) {
    this.offset.updateWorldMatrix(true, false);
    const origin = this.getWorldPosition(new THREE.Vector3());
    const fwd = this.getWorldForward(new THREE.Vector3());
    for (let k = 0; k < n && this.count < MAX_PARTICLES; k++) {
      const i = this.count++;
      _v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      _w.copy(fwd).lerp(_v, this.Spread).normalize().multiplyScalar(this.Velocity);
      const sp = this.PositionSpread;
      this.pos[i * 3] = origin.x + (Math.random() * 2 - 1) * sp;
      this.pos[i * 3 + 1] = origin.y + (Math.random() * 2 - 1) * sp;
      this.pos[i * 3 + 2] = origin.z + (Math.random() * 2 - 1) * sp;
      this.vel[i * 3] = _w.x; this.vel[i * 3 + 1] = _w.y; this.vel[i * 3 + 2] = _w.z;
      this.age[i] = 0;
      this.life[i] = this.DieTime * (0.8 + Math.random() * 0.4);
      this.rot[i] = Math.random() * Math.PI * 2;
      this.rotVel[i] = (this.RollDelta + (Math.random() * 2 - 1) * this.RandomRollSpeed) * DEG;
      if (this.RandomColor) { _c.setHSL(Math.random(), 1, 0.6); this.tint[i * 3] = _c.r; this.tint[i * 3 + 1] = _c.g; this.tint[i * 3 + 2] = _c.b; }
      else this.tint[i * 3] = this.tint[i * 3 + 1] = this.tint[i * 3 + 2] = 1;
    }
  }
  update(dt) {
    super.update(dt);
    const w = this.world;
    if (!this.hiddenNow) {
      if (this.FireOnce) { if (this._fireOncePending) { this._fireOncePending = false; this.emit(this.NumberParticles); } }
      else { this._acc += dt; let guard = 0; while (this._acc >= this.FireDelay && guard++ < 50) { this._acc -= this.FireDelay; this.emit(this.NumberParticles); } }
    }
    // follow: move existing particles by the emitter's displacement
    const here = this.getWorldPosition(new THREE.Vector3());
    if (this.Follow && this._last) { _v.subVectors(here, this._last); for (let i = 0; i < this.count; i++) { this.pos[i * 3] += _v.x; this.pos[i * 3 + 1] += _v.y; this.pos[i * 3 + 2] += _v.z; } }
    this._last = here;
    const g = this.Gravity, drag = Math.max(0, 1 - this.AirResistance * dt);
    setColor(_c, this.StartColor); setColor(_c2, this.EndColor);
    const sizes = this.aSize.array, cols = this.aColor.array;
    for (let i = 0; i < this.count; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const j = --this.count;
        if (i !== j) {
          for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; this.tint[i * 3 + k] = this.tint[j * 3 + k]; }
          this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.rot[i] = this.rot[j]; this.rotVel[i] = this.rotVel[j];
        }
        i--;
        continue;
      }
      const o = i * 3;
      this.vel[o] = (this.vel[o] + g[0] * dt) * drag;
      this.vel[o + 1] = (this.vel[o + 1] + g[1] * dt) * drag;
      this.vel[o + 2] = (this.vel[o + 2] + g[2] * dt) * drag;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.Collide && this.pos[o + 1] < 0) { this.pos[o + 1] = 0; this.vel[o + 1] = -this.vel[o + 1] * this.Bounce; this.vel[o] *= 0.8; this.vel[o + 2] *= 0.8; }
      this.rot[i] += this.rotVel[i] * dt;
      const f = this.age[i] / this.life[i];
      sizes[i] = lerp(this.StartSize, this.EndSize, f);
      cols[i * 4] = lerp(_c.r, _c2.r, f) * this.tint[o];
      cols[i * 4 + 1] = lerp(_c.g, _c2.g, f) * this.tint[o + 1];
      cols[i * 4 + 2] = lerp(_c.b, _c2.b, f) * this.tint[o + 2];
      cols[i * 4 + 3] = lerp(this.StartAlpha, this.EndAlpha, f);
    }
    this.points.geometry.setDrawRange(0, this.count);
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aColor.needsUpdate = this.aRot.needsUpdate = true;
    this.material.uniforms.uScale.value = (w.viewHeight || 800) * 0.5 * w.camera.projectionMatrix.elements[5];
  }
  destroy() { this.points.removeFromParent(); this.points.geometry.dispose(); this.material.dispose(); super.destroy(); }
}
registerPart(ParticlesPart);

export class SunbeamsPart extends MovablePart {
  static className = 'sunbeams';
  static icon = '🌞';
  static category = 'effects';
  static description = 'A bright screen-sized flare with light rays at this position.';
  static removeProps = NO_AIM;
  static props = [
    prop('Multiplier', 'number', 0.6, { group: 'appearance', min: 0, step: 0.05 }),
    prop('Size', 'number', 0.25, { group: 'appearance', min: 0, step: 0.01, help: 'Fraction of the screen.' }),
    prop('Color', 'color', [1, 0.95, 0.8], { group: 'appearance' }),
  ];
  constructor(world) {
    super(world);
    this.material = new THREE.SpriteMaterial({ map: getTexture('flare'), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.renderOrder = 1001;
    this.offset.add(this.sprite);
  }
  update(dt) {
    super.update(dt);
    if (this.hiddenNow) return;
    const cam = this.world.camera;
    const d = cam.position.distanceTo(this.getWorldPosition(_v));
    const h = 2 * d * Math.tan((cam.fov * DEG) / 2) * this.Size * 2;
    this.offset.getWorldScale(_w);
    this.sprite.scale.set(h / (_w.x || 1), h / (_w.y || 1), 1);
    setColor(this.material.color, this.Color);
    this.material.opacity = this.Multiplier;
  }
  destroy() { this.material.dispose(); super.destroy(); }
}
registerPart(SunbeamsPart);

export class FogPart extends Part {
  static className = 'fog';
  static icon = '🌫️';
  static category = 'modifiers';
  static description = 'Fills the world with distance fog while visible.';
  static props = [
    prop('Color', 'color', [0.75, 0.8, 0.88], { group: 'appearance' }),
    prop('Start', 'number', 50, { group: 'appearance', min: 0, step: 10 }),
    prop('End', 'number', 600, { group: 'appearance', min: 1, step: 10 }),
  ];
  update() { if (!this.hiddenNow) this.world.fx.fog = { color: this.Color, start: this.Start, end: Math.max(this.Start + 1, this.End) }; }
}
registerPart(FogPart);

export class ShakePart extends MovablePart {
  static className = 'shake';
  static icon = '📳';
  static category = 'effects';
  static description = 'Shakes the camera when shown (strongest near this part).';
  static removeProps = NO_AIM;
  static props = [
    prop('Amplitude', 'number', 2, { group: 'shake', min: 0, step: 0.25 }),
    prop('Frequency', 'number', 20, { group: 'shake', min: 0, step: 1 }),
    prop('Duration', 'number', 0.5, { group: 'shake', min: 0, step: 0.1, help: '0 = shake while visible.' }),
    prop('Radius', 'number', 500, { group: 'shake', min: 1, step: 10 }),
    prop('Falloff', 'boolean', true, { group: 'shake' }),
  ];
  update(dt) {
    super.update(dt);
    if (this.hiddenNow) return;
    const el = this.timeShown();
    if (this.Duration > 0 && el > this.Duration) return;
    let a = this.Amplitude * (this.Duration > 0 ? 1 - el / this.Duration : 1);
    if (this.Falloff) a *= Math.max(0, 1 - this.world.camera.position.distanceTo(this.getWorldPosition(_v)) / this.Radius);
    if (a > this.world.fx.shake) { this.world.fx.shake = a; this.world.fx.shakeFreq = this.Frequency; }
  }
}
registerPart(ShakePart);

export class CameraPart extends MovablePart {
  static className = 'camera';
  static icon = '🎥';
  static category = 'effects';
  static description = 'Overrides the play-mode camera while visible. The camera looks along +Z.';
  static props = [prop('FOV', 'number', 75, { group: 'appearance', min: 5, max: 170, step: 1 })];
  update(dt) { super.update(dt); if (!this.hiddenNow) this.world.fx.camera = this; }
}
registerPart(CameraPart);
