// Player state + movement. Drives the avatar, events and proxy inputs.
import * as THREE from 'three';

export const MOVEMENT_DEFAULTS = { walkSpeed: 150, runSpeed: 320, crouchSpeed: 60, jumpPower: 240, gravity: 600, airControl: 0.3, noclip: false };
export const PREVIEW_STATES = ['idle', 'walk', 'run', 'crouch', 'crouch walk', 'jump'];

const WEAPON_HOLDTYPES = { none: 'normal', weapon_pistol: 'pistol', weapon_357: 'revolver', weapon_smg1: 'smg', weapon_ar2: 'ar2', weapon_shotgun: 'shotgun', weapon_crossbow: 'crossbow', weapon_rpg: 'rpg', weapon_crowbar: 'melee', weapon_stunstick: 'melee', weapon_frag: 'grenade', weapon_bugbait: 'grenade', weapon_slam: 'slam', weapon_physcannon: 'physgun', weapon_physgun: 'physgun', gmod_tool: 'revolver', gmod_camera: 'camera', weapon_fists: 'fist' };

export class Player {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.bodyYaw = 0;
    this.eyeYaw = 0;
    this.eyePitch = 0;
    this.onGround = true;
    this.crouching = false;
    this.running = false;
    this.flashlight = false;
    this.name = 'Player';
    this.health = 100;
    this.maxHealth = 100;
    this.armor = 0;
    this.maxArmor = 100;
    this.color = [0.24, 0.55, 1];
    this.weaponColor = [0.3, 1, 1];
    this.weapon = 'none';
    this.ammo = { clip: 30, clipSize: 30, reserve: 90, secondary: 0 };
    this.weapons = [];
    this.preview = 'idle';
  }

  /** Holdtype of the held weapon (Garry's Mod defaults). */
  get holdtype() { return WEAPON_HOLDTYPES[this.weapon] || (this.weapon && this.weapon !== 'none' ? 'pistol' : 'normal'); }

  getEyeDir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.eyePitch);
    return out.set(Math.sin(this.eyeYaw) * cp, -Math.sin(this.eyePitch), Math.cos(this.eyeYaw) * cp);
  }

  update(dt, world, input) {
    const mv = { ...MOVEMENT_DEFAULTS, ...(world.fx.movement || {}) };
    if (!world.playMode) {
      // Editor preview: animate in place.
      const pr = this.preview;
      const speed = pr === 'walk' ? 80 : pr === 'run' ? 220 : pr === 'crouch walk' ? 50 : 0; // preview speeds, like Garry's Mod walk / run
      this.vel.set(Math.sin(this.bodyYaw) * speed, 0, Math.cos(this.bodyYaw) * speed);
      this.crouching = pr.startsWith('crouch');
      this.running = pr === 'run';
      this.onGround = pr !== 'jump';
      this.pos.y = pr === 'jump' ? 16 : 0;
      this.eyeYaw = this.bodyYaw;
      this.eyePitch = 0;
      return;
    }
    const f = (input.isDown('w') ? 1 : 0) - (input.isDown('s') ? 1 : 0);
    const r = (input.isDown('d') ? 1 : 0) - (input.isDown('a') ? 1 : 0);
    this.crouching = input.isDown('control') || input.isDown('c');
    this.running = input.isDown('shift') && !this.crouching && (f !== 0 || r !== 0);
    const speed = this.crouching ? mv.crouchSpeed : this.running ? mv.runSpeed : mv.walkSpeed;
    const sy = Math.sin(this.eyeYaw), cy = Math.cos(this.eyeYaw);
    const wish = new THREE.Vector3(sy * f - cy * r, 0, cy * f + sy * r);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

    if (mv.noclip) {
      const dir = this.getEyeDir();
      const up = (input.isDown('space') ? 1 : 0) - (this.crouching ? 1 : 0);
      this.vel.set(dir.x * f * speed - cy * r * speed, (dir.y * f + up) * speed, dir.z * f * speed + sy * r * speed);
      this.pos.addScaledVector(this.vel, dt);
      this.pos.y = Math.max(0, this.pos.y);
      this.onGround = this.pos.y <= 0.01;
      this.crouching = false;
    } else {
      const accel = this.onGround ? 10 : 10 * mv.airControl;
      const k = Math.min(1, accel * dt);
      this.vel.x += (wish.x - this.vel.x) * k;
      this.vel.z += (wish.z - this.vel.z) * k;
      if (this.onGround && input.isDown('space')) { this.vel.y = mv.jumpPower; this.onGround = false; }
      this.vel.y -= mv.gravity * dt;
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.y <= 0) { this.pos.y = 0; if (this.vel.y < 0) this.vel.y = 0; this.onGround = true; }
      else this.onGround = false;
    }
    const lim = 4000;
    this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x));
    this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z));
    // body turns toward the aim direction
    let d = this.eyeYaw - this.bodyYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.bodyYaw += d * Math.min(1, dt * 10);
  }
}
