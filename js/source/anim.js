// Source animation reader: sequences and compressed animation data from an .mdl (+ its .ani
// animation blocks). Pure functions; poses come out in Source coordinates as local bone transforms.
import { Reader } from './binary.js';

const ANIM = { RAWPOS: 0x01, RAWROT: 0x02, ANIMPOS: 0x04, ANIMROT: 0x08, DELTA: 0x10, RAWROT2: 0x20 };
const SEQ_DELTA = 0x0004, SEQ_LOOPING = 0x0001, ALLZEROS = 0x0020;

function half(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return 0;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}
// Source AngleQuaternion(RadianEuler): x = roll, y = pitch, z = yaw
export function eulerToQuat(x, y, z) {
  const sy = Math.sin(z / 2), cy = Math.cos(z / 2), sp = Math.sin(y / 2), cp = Math.cos(y / 2), sr = Math.sin(x / 2), cr = Math.cos(x / 2);
  const srcp = sr * cp, crsp = cr * sp, crcp = cr * cp, srsp = sr * sp;
  return [srcp * cy - crsp * sy, crsp * cy + srcp * sy, crcp * sy - srsp * cy, crcp * cy + srsp * sy];
}

/**
 * Parses an animation-bearing model. Returns { name, bones, anims, seqs (Map by lowercase name),
 * poseParams, includes, pose(seq, cycle, params) }.
 */
export function parseAnimModel(mdlBytes, aniBytes = null) {
  const r = new Reader(mdlBytes);
  if (r.fixedStr(0, 4) !== 'IDST') throw new Error('Not an MDL file');
  const ani = aniBytes ? new Reader(aniBytes) : null;
  const numBones = r.i32(156), boneIndex = r.i32(160);
  const bones = [];
  for (let i = 0; i < numBones; i++) {
    const b = boneIndex + i * 216;
    bones.push({ name: r.str(b + r.i32(b)), parent: r.i32(b + 4), pos: r.vec3(b + 32), quat: [r.f32(b + 44), r.f32(b + 48), r.f32(b + 52), r.f32(b + 56)], rot: r.vec3(b + 60), posscale: r.vec3(b + 72), rotscale: r.vec3(b + 84) });
  }
  const blocks = [];
  for (let i = 0, n = r.i32(352), at = r.i32(356); i < n; i++) blocks.push({ start: r.i32(at + i * 8), end: r.i32(at + i * 8 + 4) });

  const anims = [];
  for (let i = 0, n = r.i32(180), at = r.i32(184); i < n && i < 20000; i++) {
    const a = at + i * 100;
    const anim = { base: a, name: r.str(a + r.i32(a + 4)), fps: r.f32(a + 8) || 30, flags: r.i32(a + 12), numframes: Math.max(1, r.i32(a + 16)), animblock: r.i32(a + 52), animindex: r.i32(a + 56), sectionindex: r.i32(a + 80), sectionframes: r.i32(a + 84), speed: 0 };
    const nm = r.i32(a + 20), mi = r.i32(a + 24);
    if (nm > 0) { const m = a + mi + (nm - 1) * 44; const p = r.vec3(m + 32); anim.speed = Math.hypot(p[0], p[1]) / Math.max(1e-3, (anim.numframes - 1) / anim.fps); }
    anims.push(anim);
  }
  const poseParams = [];
  for (let i = 0, n = r.i32(300), at = r.i32(304); i < n; i++) { const p = at + i * 20; poseParams.push({ name: r.str(p + r.i32(p)), start: r.f32(p + 8), end: r.f32(p + 12) }); }
  const seqs = new Map();
  for (let i = 0, n = r.i32(188), at = r.i32(192); i < n && i < 20000; i++) {
    const s = at + i * 212;
    const gx = Math.max(1, r.i32(s + 68)), gy = Math.max(1, r.i32(s + 72));
    const ai = r.i32(s + 60);
    const grid = [];
    for (let k = 0; k < gx * gy; k++) grid.push(r.i16(s + ai + k * 2));
    const wl = r.i32(s + 156);
    const weights = wl ? bones.map((_, k) => r.f32(s + wl + k * 4)) : null;
    const name = r.str(s + r.i32(s + 4));
    seqs.set(name.toLowerCase(), {
      name, flags: r.i32(s + 12), gx, gy, grid, weights,
      param: [r.i32(s + 76), r.i32(s + 80)].map((pi) => (pi >= 0 && poseParams[pi] ? poseParams[pi].name : null)),
      start: [r.f32(s + 84), r.f32(s + 88)], end: [r.f32(s + 92), r.f32(s + 96)],
      looping: !!(r.i32(s + 12) & SEQ_LOOPING), delta: !!(r.i32(s + 12) & SEQ_DELTA),
    });
  }
  const includes = [];
  for (let i = 0, n = r.i32(336), at = r.i32(340); i < n && i < 64; i++) { const g = at + i * 8; includes.push(r.str(g + r.i32(g + 4))); }

  // --- decoding ---
  const value = (rd, p, frame, scale) => {
    let k = frame;
    for (let guard = 0; guard < 10000; guard++) {
      const valid = rd.u8(p), total = rd.u8(p + 1);
      if (total === 0) return 0;
      if (total > k) return (valid > k ? rd.i16(p + (k + 1) * 2) : rd.i16(p + valid * 2)) * scale;
      k -= total;
      p += (valid + 1) * 2;
    }
    return 0;
  };
  const cache = new Map();
  /** Local transforms (Source) of every bone for anim index ai at integer frame f. */
  function frame(ai, f) {
    const key = ai * 100000 + f;
    if (cache.has(key)) return cache.get(key);
    const a = anims[ai];
    const n = bones.length;
    const pos = new Float32Array(n * 3), quat = new Float32Array(n * 4);
    const delta = !!(a.flags & 0x0004);
    for (let i = 0; i < n; i++) {
      const b = bones[i];
      if (delta) { quat[i * 4 + 3] = 1; continue; }
      pos.set(b.pos, i * 3); quat.set(b.quat, i * 4);
    }
    let rd = r, off = -1, lf = f;
    if (!(a.flags & ALLZEROS)) {
      let block = a.animblock, index = a.animindex;
      if (a.sectionframes) {
        let section;
        if (a.numframes > a.sectionframes && f === a.numframes - 1) { lf = 0; section = Math.floor(a.numframes / a.sectionframes) + 1; }
        else { section = Math.floor(f / a.sectionframes); lf = f - section * a.sectionframes; }
        const so = a.base + a.sectionindex + section * 8;
        block = r.i32(so); index = r.i32(so + 4);
      }
      if (block === 0) off = a.base + index;
      else if (block > 0 && ani && blocks[block]) { rd = ani; off = blocks[block].start + index; }
    }
    if (off >= 0) {
      for (let p = off, guard = 0; guard < 512; guard++) {
        const bi = rd.u8(p), fl = rd.u8(p + 1), next = rd.i16(p + 2);
        const b = bones[bi];
        if (b) {
          let d = p + 4;
          if (fl & ANIM.RAWROT) {
            const x = rd.u16(d), y = rd.u16(d + 2), zw = rd.u16(d + 4);
            const qx = (x - 32768) / 32768, qy = (y - 32768) / 32768, qz = ((zw & 0x7fff) - 16384) / 16384;
            let qw = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy - qz * qz));
            if (zw >> 15) qw = -qw;
            quat.set([qx, qy, qz, qw], bi * 4);
            d += 6;
          } else if (fl & ANIM.RAWROT2) {
            const lo = rd.u32(d), hi = rd.u32(d + 4);
            const x = lo & 0x1fffff, y = ((lo >>> 21) | ((hi & 0x3ff) << 11)) & 0x1fffff, z = (hi >>> 10) & 0x1fffff;
            const qx = (x - 1048576) / 1048576.5, qy = (y - 1048576) / 1048576.5, qz = (z - 1048576) / 1048576.5;
            let qw = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy - qz * qz));
            if (hi >>> 31) qw = -qw;
            quat.set([qx, qy, qz, qw], bi * 4);
            d += 8;
          } else if (fl & ANIM.ANIMROT) {
            const e = [0, 0, 0];
            for (let j = 0; j < 3; j++) { const o = rd.i16(d + j * 2); if (o > 0) e[j] = value(rd, d + o, lf, b.rotscale[j]); }
            if (!(fl & ANIM.DELTA)) for (let j = 0; j < 3; j++) e[j] += b.rot[j];
            quat.set(eulerToQuat(e[0], e[1], e[2]), bi * 4);
            d += 6;
          } else if (fl & ANIM.DELTA) quat.set([0, 0, 0, 1], bi * 4);
          if (fl & ANIM.RAWPOS) { pos.set([half(rd.u16(d)), half(rd.u16(d + 2)), half(rd.u16(d + 4))], bi * 3); }
          else if (fl & ANIM.ANIMPOS) {
            const v = [0, 0, 0];
            for (let j = 0; j < 3; j++) { const o = rd.i16(d + j * 2); if (o > 0) v[j] = value(rd, d + o, lf, b.posscale[j]); }
            if (!(fl & ANIM.DELTA)) for (let j = 0; j < 3; j++) v[j] += b.pos[j];
            pos.set(v, bi * 3);
          } else if (fl & ANIM.DELTA) pos.set([0, 0, 0], bi * 3);
        }
        if (!next) break;
        p += next;
      }
    }
    const out = { pos, quat };
    if (cache.size > 4000) cache.clear();
    cache.set(key, out);
    return out;
  }

  /** Interpolated pose of one anim at cycle 0..1. */
  function animPose(ai, cycle, outPos, outQuat, w, first) {
    const a = anims[ai];
    if (!a) return;
    const fpos = Math.max(0, Math.min(1, cycle)) * (a.numframes - 1);
    const f0 = Math.floor(fpos), f1 = Math.min(a.numframes - 1, f0 + 1), t = fpos - f0;
    const A = frame(ai, f0), B = f1 === f0 ? A : frame(ai, f1);
    for (let i = 0; i < bones.length; i++) {
      for (let j = 0; j < 3; j++) { const v = A.pos[i * 3 + j] + (B.pos[i * 3 + j] - A.pos[i * 3 + j]) * t; outPos[i * 3 + j] = first ? v * w : outPos[i * 3 + j] + v * w; }
      // nlerp with hemisphere check (accumulated, normalized by the caller)
      let ax = A.quat[i * 4], ay = A.quat[i * 4 + 1], az = A.quat[i * 4 + 2], aw = A.quat[i * 4 + 3];
      let bx = B.quat[i * 4], by = B.quat[i * 4 + 1], bz = B.quat[i * 4 + 2], bw = B.quat[i * 4 + 3];
      if (ax * bx + ay * by + az * bz + aw * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
      let qx = ax + (bx - ax) * t, qy = ay + (by - ay) * t, qz = az + (bz - az) * t, qw = aw + (bw - aw) * t;
      if (!first) { const o = i * 4; if (outQuat[o] * qx + outQuat[o + 1] * qy + outQuat[o + 2] * qz + outQuat[o + 3] * qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; } }
      const o = i * 4;
      outQuat[o] = first ? qx * w : outQuat[o] + qx * w; outQuat[o + 1] = first ? qy * w : outQuat[o + 1] + qy * w;
      outQuat[o + 2] = first ? qz * w : outQuat[o + 2] + qz * w; outQuat[o + 3] = first ? qw * w : outQuat[o + 3] + qw * w;
    }
  }

  /**
   * Pose of a sequence (bilinear blend over its pose-parameter grid). params: { move_x, move_y, ... }.
   * Returns { pos: Float32Array(n*3), quat: Float32Array(n*4) } in Source local bone space.
   */
  function pose(seq, cycle, params = {}) {
    const n = bones.length;
    const pos = new Float32Array(n * 3), quat = new Float32Array(n * 4);
    const axis = (k, size) => {
      if (size <= 1 || !seq.param[k]) return [[0, 1]];
      const v = params[seq.param[k]] ?? 0;
      const s = Math.max(0, Math.min(1, (v - seq.start[k]) / ((seq.end[k] - seq.start[k]) || 1))) * (size - 1);
      const i0 = Math.min(size - 2, Math.floor(s)), t = s - i0;
      return [[i0, 1 - t], [i0 + 1, t]];
    };
    let first = true;
    for (const [ix, wx] of axis(0, seq.gx)) for (const [iy, wy] of axis(1, seq.gy)) {
      const w = wx * wy;
      if (w <= 1e-4) continue;
      animPose(seq.grid[iy * seq.gx + ix], cycle, pos, quat, w, first);
      first = false;
    }
    for (let i = 0; i < n; i++) {
      const o = i * 4, l = Math.hypot(quat[o], quat[o + 1], quat[o + 2], quat[o + 3]) || 1;
      quat[o] /= l; quat[o + 1] /= l; quat[o + 2] /= l; quat[o + 3] /= l;
    }
    return { pos, quat };
  }
  /** Ground speed (units/s) of a sequence moving straight forward, if it has motion data. */
  function groundSpeed(seq) {
    const cell = seq.grid[(seq.gy > 1 ? Math.floor(seq.gy / 2) : 0) * seq.gx + (seq.gx - 1)];
    const a = anims[cell];
    return a ? a.speed : 0;
  }
  function duration(seq) { const a = anims[seq.grid[0]]; return a ? Math.max(1, a.numframes - 1) / a.fps : 1; }

  return { bones, anims, seqs, poseParams, includes, pose, groundSpeed, duration };
}
