// Web Audio engine: lazily created context, cached buffers, built-in synthesized sounds.
import { isUrl, fixUrl } from './util.js';
import { readGameSound, vfs } from '../source/assets.js';
import { decodeWav } from '../source/wav.js';

const TAU = Math.PI * 2;
const env = (t, a, d) => (t < a ? t / a : Math.max(0, 1 - (t - a) / d));
const sq = (p) => (Math.sin(p) >= 0 ? 1 : -1);
const saw = (p) => ((p / TAU) % 1) * 2 - 1;

// Original procedurally generated sounds: [duration, (t, rand) => sample]
const SYNTHS = {
  beep: [0.18, (t) => Math.sin(TAU * 880 * t) * env(t, 0.005, 0.17) * 0.5],
  boop: [0.25, (t) => Math.sin(TAU * (440 - 300 * t) * t) * env(t, 0.005, 0.24) * 0.6],
  blip: [0.06, (t) => sq(TAU * 1200 * t) * env(t, 0.002, 0.058) * 0.25],
  coin: [0.4, (t) => sq(TAU * (t < 0.08 ? 988 : 1319) * t) * env(t, 0.002, 0.4) * 0.25],
  jump: [0.25, (t) => sq(TAU * (300 + 1000 * t) * t) * env(t, 0.005, 0.24) * 0.25],
  laser: [0.3, (t) => saw(TAU * (1600 - 2800 * t) * t) * env(t, 0.002, 0.3) * 0.3],
  powerup: [0.6, (t) => sq(TAU * [523, 659, 784, 1047][Math.min(3, Math.floor(t / 0.12))] * t) * env(t, 0.005, 0.6) * 0.22],
  alarm: [1.2, (t) => sq(TAU * (Math.floor(t * 4) % 2 ? 660 : 880) * t) * 0.18],
  chime: [1.6, (t) => [1, 2.76, 5.4].reduce((s, k, i) => s + Math.sin(TAU * 660 * k * t) * Math.exp(-t * (2 + i * 2)) / (i + 1), 0) * 0.35],
  horn: [0.8, (t) => saw(TAU * (220 + Math.sin(TAU * 6 * t) * 4) * t) * env(t, 0.05, 0.75) * 0.3],
  hum: [2, (t) => (Math.sin(TAU * 110 * t) * 0.5 + Math.sin(TAU * 220 * t) * 0.25 + Math.sin(TAU * 330 * t) * 0.1) * 0.5],
  noise: [1, (_t, r) => (r() * 2 - 1) * 0.3],
};
// Filtered-noise sounds need state, so they are generated as whole arrays.
const NOISES = {
  explosion: [1.4, (n, sr, r) => lowNoise(n, sr, r, 0.04, (t) => Math.exp(-t * 3) * 0.9)],
  hit: [0.15, (n, sr, r) => lowNoise(n, sr, r, 0.3, (t) => Math.exp(-t * 30) * 0.8)],
  footstep: [0.09, (n, sr, r) => lowNoise(n, sr, r, 0.08, (t) => Math.exp(-t * 50) * 0.7)],
  whoosh: [0.7, (n, sr, r) => lowNoise(n, sr, r, 0.15, (t) => Math.sin(Math.PI * t / 0.7) * 0.6)],
  wind: [3, (n, sr, r) => lowNoise(n, sr, r, 0.02, (t) => 0.5 + 0.3 * Math.sin(TAU * t / 3))],
};
function lowNoise(n, sr, r, k, gain) {
  const out = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) { y += k * ((r() * 2 - 1) - y); out[i] = y * gain(i / sr) * (1 / Math.sqrt(k)) * 0.5; }
  return out;
}

export const BUILTIN_SOUNDS = [...Object.keys(SYNTHS), ...Object.keys(NOISES)];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.volume = 0.8;
  }
  ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  /** Resolves a sound path (built-in name or URL) to a decoded AudioBuffer. */
  getBuffer(path) {
    path = String(path || '').trim();
    if (!path) return Promise.reject(new Error('no sound path'));
    if (this.buffers.has(path)) return this.buffers.get(path);
    const ctx = this.ensure();
    let p;
    const key = path.toLowerCase();
    const synth = Object.hasOwn(SYNTHS, key), noise = Object.hasOwn(NOISES, key);
    if (synth || noise) {
      const [dur, fn] = synth ? SYNTHS[key] : NOISES[key];
      const sr = ctx.sampleRate, n = Math.floor(dur * sr);
      const buf = ctx.createBuffer(1, n, sr);
      let seed = 1234;
      const r = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      if (synth) { const d = buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = fn(i / sr, r); }
      else buf.copyToChannel(fn(n, sr, r), 0);
      p = Promise.resolve(buf);
    } else {
      // URL or a game sound path from mounted folders ("ambient/alarms/klaxon1.wav")
      p = (async () => {
        let bytes;
        if (isUrl(path)) { const r = await fetch(fixUrl(path)); if (!r.ok) throw new Error(`HTTP ${r.status}`); bytes = new Uint8Array(await r.arrayBuffer()); }
        else {
          bytes = await readGameSound(path);
          if (!bytes) throw new Error(vfs.mounted ? `sound not found: ${path.slice(0, 80)}` : `"${path.slice(0, 60)}" needs mounted game content (File → Game content)`);
        }
        const wav = decodeWav(bytes); // handles the ADPCM .wav files browsers cannot play
        if (wav && wav.channels[0] && wav.channels[0].length) {
          const buf = ctx.createBuffer(wav.channels.length, wav.channels[0].length, wav.sampleRate);
          wav.channels.forEach((d, i) => buf.copyToChannel(d, i));
          return buf;
        }
        return ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      })();
    }
    p.catch(() => this.buffers.delete(path));
    this.buffers.set(path, p);
    return p;
  }

  updateListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener, e = camera.matrixWorld.elements;
    const pos = camera.position;
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      l.forwardX.value = -e[8]; l.forwardY.value = -e[9]; l.forwardZ.value = -e[10];
      l.upX.value = e[4]; l.upY.value = e[5]; l.upZ.value = e[6];
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }
}
