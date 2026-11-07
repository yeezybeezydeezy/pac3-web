// jiggle, projectile
import * as THREE from 'three';
import { prop, registerPart } from '../core/part.js';
import { MovablePart } from './movable.js';
import { lerp, DEG } from '../core/util.js';

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _e = new THREE.Euler();

/** Children lag behind with spring physics. */
export class JigglePart extends MovablePart {
  static className = 'jiggle';
  static icon = '〽️';
  static category = 'model';
  static description = 'Children follow this point with springy lag: tails, ears, antennae, floating pets.';
  static removeProps = ['EyeAngles', 'AimPart'];
  static props = [
    prop('Strain', 'number', 0.5, { group: 'dynamics', min: 0, max: 0.99, step: 0.02, help: 'Higher = floppier, more lag.' }),
    prop('Speed', 'number', 1, { group: 'dynamics', min: 0.01, step: 0.1 }),
    prop('ConstantVelocity', 'vector', [0, 0, 0], { group: 'dynamics', help: 'Constant push in world units/s² (y is up).' }),
    prop('JiggleAngle', 'boolean', true, { group: 'dynamics' }),
    prop('JigglePosition', 'boolean', true, { group: 'dynamics' }),
    prop('ConstrainSphere', 'number', 0, { group: 'dynamics', min: 0, step: 1, help: 'Maximum distance from the anchor (0 = unlimited).' }),
    prop('Ground', 'boolean', false, { group: 'dynamics', help: 'Stay above the ground.' }),
    prop('ResetOnHide', 'boolean', false, { group: 'dynamics' }),
  ];
  constructor(world) {
    super(world);
    // node/offset stay attached (the anchor); children live in a world-space follower
    this.follower = new THREE.Group();
    this.follower.userData.part = this;
    this.vel = new THREE.Vector3();
    this._init = false;
  }
  get childAnchor() { return this.follower; }
  onAdded() { this.world.scene.add(this.follower); }
  onShow() { super.onShow(); this.follower.visible = true; if (this.ResetOnHide) this._init = false; }
  onHide() { super.onHide(); this.follower.visible = false; }
  update(dt) {
    this.offset.updateWorldMatrix(true, false);
    this.offset.matrixWorld.decompose(_p, _q, _s);
    const f = this.follower;
    if (!this._init || dt <= 0) { f.position.copy(_p); f.quaternion.copy(_q); this.vel.set(0, 0, 0); this._init = true; }
    else {
      const k = lerp(400, 12, this.Strain) * this.Speed * this.Speed;
      const c = 2 * Math.sqrt(k) * lerp(0.6, 0.15, this.Strain);
      if (this.JigglePosition) {
        const steps = Math.ceil(dt / 0.008);
        const h = dt / steps;
        for (let i = 0; i < steps; i++) {
          _v.subVectors(_p, f.position).multiplyScalar(k).addScaledVector(this.vel, -c).add(_s.fromArray(this.ConstantVelocity));
          this.vel.addScaledVector(_v, h);
          f.position.addScaledVector(this.vel, h);
        }
        if (this.ConstrainSphere > 0 && f.position.distanceTo(_p) > this.ConstrainSphere) f.position.sub(_p).setLength(this.ConstrainSphere).add(_p);
        if (this.Ground && f.position.y < 0) { f.position.y = 0; this.vel.y = Math.max(0, this.vel.y); }
      } else f.position.copy(_p);
      if (this.JiggleAngle) f.quaternion.slerp(_q, 1 - Math.exp(-dt * lerp(30, 2, this.Strain) * this.Speed));
      else f.quaternion.copy(_q);
    }
    this.offset.matrixWorld.decompose(_v, _q, _s);
    f.scale.copy(_s);
    f.updateMatrixWorld(true);
  }
  destroy() { this.follower.removeFromParent(); super.destroy(); }
}
registerPart(JigglePart);

/** Fires copies of OutfitPart (or a ball) forward when shown. */
export class ProjectilePart extends MovablePart {
  static className = 'projectile';
  static icon = '💣';
  static category = 'effects';
  static description = 'Fires projectiles forward (+Z) when shown. Set OutfitPart to fire a copy of another part (hide the original). Pair with an event like is_firing.';
  static props = [
    prop('OutfitPart', 'part', '', { group: 'firing', help: 'Part to copy as the projectile (its own position is ignored).' }),
    prop('Speed', 'number', 1, { group: 'firing', min: 0, step: 0.1, help: '1 = 600 units/s' }),
    prop('AddOwnerSpeed', 'boolean', false, { group: 'firing' }),
    prop('Spread', 'number', 0, { group: 'firing', min: 0, max: 1, step: 0.02 }),
    prop('NumberProjectiles', 'number', 1, { group: 'firing', min: 1, max: 50, integer: true }),
    prop('Delay', 'number', 0, { group: 'firing', min: 0, step: 0.05, help: 'Seconds after showing before firing.' }),
    prop('FireRate', 'number', 0, { group: 'firing', min: 0, step: 0.05, help: 'Seconds between shots while visible (0 = fire once per show).' }),
    prop('Maximum', 'number', 30, { group: 'firing', min: 1, max: 200, integer: true, help: 'Max projectiles alive.' }),
    prop('LifeTime', 'number', 5, { group: 'physics', min: 0.1, step: 0.5 }),
    prop('Gravity', 'boolean', true, { group: 'physics' }),
    prop('Damping', 'number', 0, { group: 'physics', min: 0, step: 0.1 }),
    prop('Radius', 'number', 2, { group: 'physics', min: 0, step: 0.5 }),
    prop('Bounce', 'number', 0.4, { group: 'physics', min: 0, max: 1, step: 0.05 }),
    prop('RemoveOnCollide', 'boolean', false, { group: 'physics' }),
    prop('AimDir', 'boolean', true, { group: 'physics', help: 'Rotate to face the direction of travel.' }),
    prop('RandomAngleVelocity', 'vector', [0, 0, 0], { group: 'physics', help: 'Random spin in degrees/s.' }),
  ];
  constructor(world) { super(world); this.projectiles = []; this._pending = []; this._nextFire = Infinity; }
  onShow() { super.onShow(); this._nextFire = this.world.time + this.Delay; }
  onHide() { super.onHide(); this._nextFire = Infinity; }
  fire() {
    const w = this.world;
    w.lastFire = w.time;
    this.offset.updateWorldMatrix(true, false);
    const origin = this.getWorldPosition(new THREE.Vector3());
    const fwd = this.getWorldForward(new THREE.Vector3());
    const src = w.getPart(this.OutfitPart);
    for (let i = 0; i < this.NumberProjectiles; i++) {
      while (this.projectiles.length >= this.Maximum) this._kill(this.projectiles[0]);
      const obj = new THREE.Group();
      obj.position.copy(origin);
      w.scene.add(obj);
      const dir = fwd.clone().lerp(_v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize(), this.Spread).normalize();
      const vel = dir.multiplyScalar(this.Speed * 600);
      if (this.AddOwnerSpeed) vel.add(w.player.vel);
      const r = this.RandomAngleVelocity;
      const spin = new THREE.Vector3((Math.random() * 2 - 1) * r[0], (Math.random() * 2 - 1) * r[1], (Math.random() * 2 - 1) * r[2]).multiplyScalar(DEG);
      const proj = { obj, vel, spin, born: w.time, root: null, ball: null };
      if (src && src !== this && !this.isDescendantOf(src)) {
        const data = src.serialize();
        data.self.Hide = false;
        delete data.self.Position; delete data.self.Angles;
        try {
          const root = w.load(data, null, { newIds: true, transient: true });
          if (root) { root.rootAnchor = obj; root.traverse((p) => p.attach && p.attach()); proj.root = root; }
        } catch (e) { this.status = `Projectile copy failed: ${e.message}`; }
      }
      if (!proj.root) {
        proj.ball = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.5, this.Radius), 12, 8), new THREE.MeshStandardMaterial({ color: 0x888888 }));
        proj.ball.castShadow = true;
        obj.add(proj.ball);
      }
      this.projectiles.push(proj);
    }
  }
  _kill(p) {
    const i = this.projectiles.indexOf(p);
    if (i >= 0) this.projectiles.splice(i, 1);
    if (p.root) this.world.removePart(p.root);
    if (p.ball) { p.ball.geometry.dispose(); p.ball.material.dispose(); }
    p.obj.removeFromParent();
  }
  update(dt) {
    super.update(dt);
    const t = this.world.time;
    if (!this.hiddenNow && t >= this._nextFire) {
      this.fire();
      this._nextFire = this.FireRate > 0 ? t + this.FireRate : Infinity;
    }
    for (const p of [...this.projectiles]) {
      if (t - p.born > this.LifeTime) { this._kill(p); continue; }
      if (this.Gravity) p.vel.y -= 600 * dt;
      if (this.Damping) p.vel.multiplyScalar(Math.max(0, 1 - this.Damping * dt));
      p.obj.position.addScaledVector(p.vel, dt);
      if (p.obj.position.y < this.Radius) {
        if (this.RemoveOnCollide) { this._kill(p); continue; }
        p.obj.position.y = this.Radius;
        p.vel.y = Math.abs(p.vel.y) * this.Bounce;
        p.vel.x *= 0.85; p.vel.z *= 0.85;
      }
      if (this.AimDir && p.vel.lengthSq() > 1) p.obj.lookAt(_v.copy(p.obj.position).add(p.vel));
      if (p.spin.lengthSq()) p.obj.quaternion.multiply(_q.setFromEuler(_e.set(p.spin.x * dt, p.spin.y * dt, p.spin.z * dt)));
      p.obj.updateMatrixWorld(true);
    }
  }
  destroy() { for (const p of [...this.projectiles]) this._kill(p); super.destroy(); }
}
registerPart(ProjectilePart);

