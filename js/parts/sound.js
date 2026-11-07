// Sound part: plays a built-in synthesized sound or an audio URL when shown, positioned in 3D.
import * as THREE from 'three';
import { prop, registerPart } from '../core/part.js';
import { MovablePart } from './movable.js';
import { BUILTIN_SOUNDS } from '../core/audio.js';
import { clamp } from '../core/util.js';

const _p = new THREE.Vector3();

export class SoundPart extends MovablePart {
  static className = 'sound';
  static icon = '🔊';
  static category = 'effects';
  static description = 'Plays a sound when shown. Use a built-in sound or an audio URL/upload (mp3, ogg, wav).';
  static removeProps = ['EyeAngles', 'AimPart'];
  static props = [
    prop('Path', 'asset', 'beep', { options: BUILTIN_SOUNDS, accept: 'audio/*', browse: 'sound', help: 'Built-in sound, audio URL, or a game sound path like ambient/alarms/klaxon1.wav (needs mounted content).' }),
    prop('AllPaths', 'string', '', { help: 'Several sounds separated by ; — one is picked each play.' }),
    prop('Sequential', 'boolean', false, { help: 'Pick AllPaths in order instead of randomly.' }),
    prop('Volume', 'number', 1, { group: 'playback', min: 0, max: 4, step: 0.05 }),
    prop('Pitch', 'number', 1, { group: 'playback', min: 0.05, max: 8, step: 0.05 }),
    prop('MinPitch', 'number', 0, { group: 'playback', min: 0, step: 0.05, help: 'Random pitch range added to Pitch.' }),
    prop('MaxPitch', 'number', 0, { group: 'playback', min: 0, step: 0.05 }),
    prop('PlayCount', 'number', 1, { group: 'playback', min: 0, max: 1000, integer: true, help: '0 = loop forever.' }),
    prop('Overlapping', 'boolean', false, { group: 'playback', help: 'Let a new play overlap the previous one.' }),
    prop('StopOnHide', 'boolean', false, { group: 'playback' }),
    prop('PauseOnHide', 'boolean', false, { group: 'playback' }),
    prop('PlayOnFootstep', 'boolean', false, { group: 'playback', help: 'Play on every footstep instead of on show.' }),
    prop('Radius', 'number', 1500, { group: 'playback', min: 1, step: 50, help: 'Hearing distance.' }),
    prop('FilterType', 'enum', 'none', { group: 'filter', options: ['none', 'lowpass', 'highpass', 'bandpass'] }),
    prop('FilterFraction', 'number', 1, { group: 'filter', min: 0, max: 1, step: 0.02 }),
    prop('Echo', 'boolean', false, { group: 'echo' }),
    prop('EchoDelay', 'number', 0.3, { group: 'echo', min: 0.01, max: 2, step: 0.01 }),
    prop('EchoFeedback', 'number', 0.5, { group: 'echo', min: 0, max: 0.95, step: 0.05 }),
  ];
  constructor(world) {
    super(world);
    this.voices = [];
    this._seq = 0;
    this._token = 0;
    this._paused = null;
  }
  onAdded() { this._unsub = this.world.on('footstep', () => { if (this.PlayOnFootstep && !this.hiddenNow) this.play(); }); }
  pickPath() {
    const list = this.AllPaths.split(';').map((s) => s.trim()).filter(Boolean);
    if (!list.length) return this.Path;
    return this.Sequential ? list[this._seq++ % list.length] : list[Math.floor(Math.random() * list.length)];
  }
  _graph(ctx) {
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'linear';
    panner.refDistance = 1;
    panner.maxDistance = this.Radius;
    panner.rolloffFactor = 1;
    const gain = ctx.createGain();
    gain.gain.value = this.Volume;
    let head = gain;
    let filter = null;
    if (this.FilterType !== 'none') {
      filter = ctx.createBiquadFilter();
      filter.type = this.FilterType;
      filter.frequency.value = 20 * Math.pow(1000, clamp(this.FilterFraction, 0, 1));
      filter.connect(gain);
      head = filter;
    }
    gain.connect(panner);
    if (this.Echo) {
      const delay = ctx.createDelay(2);
      const fb = ctx.createGain();
      delay.delayTime.value = this.EchoDelay;
      fb.gain.value = this.EchoFeedback;
      gain.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(panner);
    }
    panner.connect(this.world.audio.master);
    return { head, gain, panner, filter };
  }
  play(offset = 0) {
    const audio = this.world.audio;
    const ctx = audio.ensure();
    const token = ++this._token;
    if (!this.Overlapping) this.stop();
    const path = this.pickPath();
    audio.getBuffer(path).then((buf) => {
      if (token !== this._token && !this.Overlapping) return;
      if (!this.inWorld) return;
      const g = this._graph(ctx);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const rate = this.Pitch + this.MinPitch + Math.random() * Math.max(0, this.MaxPitch - this.MinPitch);
      src.playbackRate.value = Math.max(0.05, rate);
      src.loop = this.PlayCount === 0;
      src.connect(g.head);
      const voice = { src, ...g, buf, started: ctx.currentTime - offset / src.playbackRate.value, remaining: Math.max(0, this.PlayCount - 1) };
      src.onended = () => {
        if (voice.stopped) return;
        if (voice.remaining > 0) {
          voice.remaining--;
          const s2 = ctx.createBufferSource();
          s2.buffer = buf; s2.playbackRate.value = src.playbackRate.value; s2.connect(g.head); s2.onended = src.onended;
          voice.src = s2; voice.started = ctx.currentTime; s2.start();
        } else this._drop(voice);
      };
      src.start(0, offset % buf.duration);
      this.voices.push(voice);
      this.status = '';
    }).catch((e) => { this.status = `Sound: ${e.message}`.slice(0, 200); });
  }
  _drop(v) {
    v.stopped = true;
    try { v.src.stop(); } catch { /* already stopped */ }
    setTimeout(() => { try { v.panner.disconnect(); v.gain.disconnect(); } catch { /* gone */ } }, this.Echo ? 4000 : 50);
    this.voices = this.voices.filter((x) => x !== v);
  }
  stop() { for (const v of [...this.voices]) this._drop(v); }
  onShow() {
    super.onShow();
    if (this.PlayOnFootstep) return;
    if (this._paused != null) { const o = this._paused; this._paused = null; this.play(o); return; }
    this.play();
  }
  onHide() {
    super.onHide();
    if (this.PauseOnHide && this.voices.length) {
      const v = this.voices[this.voices.length - 1];
      this._paused = (this.world.audio.ctx.currentTime - v.started) * v.src.playbackRate.value;
      this.stop();
    } else if (this.StopOnHide) this.stop();
  }
  onPropChanged(name, old) {
    super.onPropChanged(name, old);
    for (const v of this.voices) {
      if (name === 'Volume') v.gain.gain.value = this.Volume;
      if (name === 'Pitch') v.src.playbackRate.value = Math.max(0.05, this.Pitch);
      if (name === 'Radius') v.panner.maxDistance = this.Radius;
      if (name === 'FilterFraction' && v.filter) v.filter.frequency.value = 20 * Math.pow(1000, clamp(this.FilterFraction, 0, 1));
    }
  }
  update(dt) {
    super.update(dt);
    if (!this.voices.length) return;
    this.getWorldPosition(_p);
    for (const v of this.voices) {
      const pn = v.panner;
      if (pn.positionX) { pn.positionX.value = _p.x; pn.positionY.value = _p.y; pn.positionZ.value = _p.z; }
      else pn.setPosition(_p.x, _p.y, _p.z);
    }
  }
  destroy() { this._token++; this.stop(); if (this._unsub) this._unsub(); super.destroy(); }
}
registerPart(SoundPart);
