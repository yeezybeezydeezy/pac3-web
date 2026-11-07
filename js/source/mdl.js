// Source model reader: .mdl (skeleton, materials, body parts) + .vvd (vertices) + .dx90.vtx (triangles).
// Output stays in Source coordinates (Z up, X forward); conversion happens in the three.js loader.
import { Reader } from './binary.js';

function parseMdl(bytes) {
  const r = new Reader(bytes);
  const id = r.fixedStr(0, 4);
  if (id !== 'IDST') throw new Error('Not an MDL file');
  const version = r.i32(4);
  if (version < 44 || version > 49) throw new Error(`Unsupported MDL version ${version}`);
  const mdl = { version, checksum: r.i32(8), name: r.fixedStr(12, 64), eyePosition: r.vec3(80), hullMin: r.vec3(104), hullMax: r.vec3(116) };

  const numBones = r.i32(156), boneIndex = r.i32(160);
  if (numBones < 0 || numBones > 512) throw new Error('Bad bone count');
  mdl.bones = [];
  for (let i = 0; i < numBones; i++) {
    const b = boneIndex + i * 216;
    const m = []; for (let k = 0; k < 12; k++) m.push(r.f32(b + 96 + k * 4));
    mdl.bones.push({ name: r.str(b + r.i32(b)), parent: r.i32(b + 4), pos: r.vec3(b + 32), quat: [r.f32(b + 44), r.f32(b + 48), r.f32(b + 52), r.f32(b + 56)], poseToBone: m });
  }

  const numTex = r.i32(204), texIndex = r.i32(208);
  mdl.textures = [];
  for (let i = 0; i < numTex && i < 1024; i++) { const t = texIndex + i * 64; mdl.textures.push(r.str(t + r.i32(t))); }
  const numCd = r.i32(212), cdIndex = r.i32(216);
  mdl.cdPaths = [];
  for (let i = 0; i < numCd && i < 256; i++) mdl.cdPaths.push(r.str(r.i32(cdIndex + i * 4)));
  const numSkinRef = r.i32(220), numFamilies = r.i32(224), skinIndex = r.i32(228);
  mdl.skins = [];
  for (let f = 0; f < numFamilies && f < 256; f++) {
    const fam = [];
    for (let k = 0; k < numSkinRef; k++) fam.push(r.i16(skinIndex + (f * numSkinRef + k) * 2));
    mdl.skins.push(fam);
  }

  const numBodyParts = r.i32(232), bodyIndex = r.i32(236);
  mdl.bodyParts = [];
  for (let i = 0; i < numBodyParts && i < 256; i++) {
    const bp = bodyIndex + i * 16;
    const part = { name: r.str(bp + r.i32(bp)), models: [] };
    const nModels = r.i32(bp + 4), modelIndex = r.i32(bp + 12);
    for (let j = 0; j < nModels && j < 256; j++) {
      const mo = bp + modelIndex + j * 148;
      const model = { name: r.fixedStr(mo, 64), vertexStart: r.i32(mo + 80 + 4 * 2) / 48, numVertices: r.i32(mo + 76), meshes: [] };
      // layout: name64, type, radius, nummeshes(72), meshindex(76)... recomputed below for clarity
      const nMeshes = r.i32(mo + 72), meshIndex = r.i32(mo + 76);
      model.numVertices = r.i32(mo + 80);
      model.vertexStart = r.i32(mo + 84) / 48;
      for (let k = 0; k < nMeshes && k < 1024; k++) {
        const me = mo + meshIndex + k * 116;
        model.meshes.push({ material: r.i32(me), numVertices: r.i32(me + 8), vertexOffset: r.i32(me + 12) });
      }
      part.models.push(model);
    }
    mdl.bodyParts.push(part);
  }

  mdl.includes = [];
  for (let i = 0, n = r.i32(336), at = r.i32(340); i < n && i < 64; i++) { const g = at + i * 8; mdl.includes.push(r.str(g + r.i32(g + 4)).split('\\').join('/').toLowerCase()); }

  const numAtt = r.i32(240), attIndex = r.i32(244);
  mdl.attachments = [];
  for (let i = 0; i < numAtt && i < 256; i++) {
    const a = attIndex + i * 92;
    const m = []; for (let k = 0; k < 12; k++) m.push(r.f32(a + 12 + k * 4));
    mdl.attachments.push({ name: r.str(a + r.i32(a)), bone: r.i32(a + 8), matrix: m });
  }
  return mdl;
}

function parseVvd(bytes, checksum) {
  const r = new Reader(bytes);
  if (r.fixedStr(0, 4) !== 'IDSV') throw new Error('Not a VVD file');
  if (checksum != null && r.i32(8) !== checksum) throw new Error('VVD does not match MDL (checksum)');
  const numLod0 = r.i32(16);
  const numFixups = r.i32(48), fixupStart = r.i32(52), vertStart = r.i32(56);
  const read = (i) => {
    const o = vertStart + i * 48;
    return o;
  };
  let order;
  if (numFixups > 0) {
    order = [];
    for (let f = 0; f < numFixups; f++) {
      const o = fixupStart + f * 12;
      if (r.i32(o) >= 0) { const src = r.i32(o + 4), n = r.i32(o + 8); for (let k = 0; k < n; k++) order.push(src + k); }
    }
  }
  const n = order ? order.length : numLod0;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const bones = new Uint8Array(n * 4), weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = read(order ? order[i] : i);
    const nb = r.u8(o + 15);
    for (let k = 0; k < 3; k++) {
      if (k < nb) { weights[i * 4 + k] = r.f32(o + k * 4); bones[i * 4 + k] = r.u8(o + 12 + k); }
      pos[i * 3 + k] = r.f32(o + 16 + k * 4);
      nrm[i * 3 + k] = r.f32(o + 28 + k * 4);
    }
    uv[i * 2] = r.f32(o + 40); uv[i * 2 + 1] = r.f32(o + 44);
  }
  return { count: n, pos, nrm, uv, bones, weights };
}

/** Reads VTX triangles for LOD 0. Tries the classic 25-byte strip group layout, then the 33-byte one. */
function parseVtx(bytes, mdl, vertCount) {
  for (const sgSize of [25, 33]) {
    try { return parseVtxWith(bytes, mdl, vertCount, sgSize); } catch (e) { if (sgSize === 33) throw e; }
  }
  return null;
}
function parseVtxWith(bytes, mdl, vertCount, sgSize) {
  const r = new Reader(bytes);
  if (r.i32(0) !== 7) throw new Error('Unsupported VTX version');
  const stripSize = sgSize === 25 ? 27 : 35;
  const numBodyParts = r.i32(28), bpOffset = r.i32(32);
  const out = [];
  for (let i = 0; i < numBodyParts && i < mdl.bodyParts.length; i++) {
    const bp = bpOffset + i * 8;
    const nModels = r.i32(bp), modelOff = bp + r.i32(bp + 4);
    for (let j = 0; j < nModels && j < mdl.bodyParts[i].models.length; j++) {
      const mo = modelOff + j * 8;
      if (r.i32(mo) < 1) continue;
      const lod = mo + r.i32(mo + 4);
      const nMeshes = r.i32(lod), meshOff = lod + r.i32(lod + 4);
      const mModel = mdl.bodyParts[i].models[j];
      for (let k = 0; k < nMeshes && k < mModel.meshes.length; k++) {
        const me = meshOff + k * 9;
        const nSg = r.i32(me), sgOff = me + r.i32(me + 4);
        const mMesh = mModel.meshes[k];
        const indices = [];
        for (let s = 0; s < nSg; s++) {
          const sg = sgOff + s * sgSize;
          const nVerts = r.i32(sg), vOff = sg + r.i32(sg + 4), nIdx = r.i32(sg + 8), iOff = sg + r.i32(sg + 12);
          const nStrips = r.i32(sg + 16), stOff = sg + r.i32(sg + 20);
          if (nVerts < 0 || nIdx < 0 || nIdx % 1 || nVerts > 1e6 || nIdx > 3e6) throw new Error('Bad strip group');
          r.check(nVerts * 9, vOff); r.check(nIdx * 2, iOff);
          const map = new Int32Array(nVerts);
          for (let v = 0; v < nVerts; v++) {
            const g = mModel.vertexStart + mMesh.vertexOffset + r.u16(vOff + v * 9 + 4);
            if (g < 0 || g >= vertCount) throw new Error('VTX vertex out of range');
            map[v] = g;
          }
          const idx = (q) => { const x = r.u16(iOff + q * 2); if (x >= nVerts) throw new Error('VTX index out of range'); return map[x]; };
          let strips = [];
          for (let t = 0; t < nStrips && t < 10000; t++) {
            const st = stOff + t * stripSize;
            strips.push({ n: r.i32(st), off: r.i32(st + 4), flags: r.u8(st + 18) });
          }
          if (!strips.length || strips.some((st) => st.off < 0 || st.off + st.n > nIdx)) strips = [{ n: nIdx, off: 0, flags: 1 }];
          for (const st of strips) {
            if (st.flags & 2) {
              for (let q = 0; q + 2 < st.n; q++) {
                const a = idx(st.off + q), b = idx(st.off + q + 1), c = idx(st.off + q + 2);
                if (a === b || b === c || a === c) continue;
                if (q & 1) indices.push(a, c, b); else indices.push(a, b, c);
              }
            } else for (let q = 0; q + 2 < st.n; q += 3) indices.push(idx(st.off + q), idx(st.off + q + 1), idx(st.off + q + 2));
          }
        }
        out.push({ bodyPart: i, model: j, material: mMesh.material, indices });
      }
    }
  }
  return out;
}

/**
 * Parses a model from its three files. Returns { mdl, meshes } where each mesh has its own
 * compact vertex arrays (Source coordinates): pos, nrm, uv, bones, weights, index (Uint32Array).
 */
export function parseSourceModel({ mdl: mdlBytes, vvd, vtx }) {
  const mdl = parseMdl(mdlBytes);
  const verts = parseVvd(vvd, mdl.checksum);
  const raw = parseVtx(vtx, mdl, verts.count);
  const meshes = [];
  for (const m of raw) {
    if (!m.indices.length) continue;
    const remap = new Map();
    const order = [];
    const index = new Uint32Array(m.indices.length);
    m.indices.forEach((g, i) => { let l = remap.get(g); if (l == null) { l = order.length; remap.set(g, l); order.push(g); } index[i] = l; });
    const n = order.length;
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    const bones = new Uint8Array(n * 4), weights = new Float32Array(n * 4);
    order.forEach((g, l) => {
      pos.set(verts.pos.subarray(g * 3, g * 3 + 3), l * 3);
      nrm.set(verts.nrm.subarray(g * 3, g * 3 + 3), l * 3);
      uv.set(verts.uv.subarray(g * 2, g * 2 + 2), l * 2);
      bones.set(verts.bones.subarray(g * 4, g * 4 + 4), l * 4);
      weights.set(verts.weights.subarray(g * 4, g * 4 + 4), l * 4);
    });
    meshes.push({ bodyPart: m.bodyPart, model: m.model, material: m.material, pos, nrm, uv, bones, weights, index });
  }
  return { mdl, meshes };
}

/** Candidate .vmt paths for texture slot i (searches every $cdmaterials path). */
export function materialPaths(mdl, i) {
  const name = mdl.textures[i].replace(/\\/g, '/').replace(/^\/+/, '');
  const out = [];
  for (const cd of mdl.cdPaths.length ? mdl.cdPaths : ['']) {
    const dir = cd.replace(/\\/g, '/').replace(/^\/+/, '');
    out.push(`materials/${dir && !dir.endsWith('/') ? `${dir}/` : dir}${name}.vmt`.toLowerCase().replace(/\/{2,}/g, '/'));
  }
  return out;
}
