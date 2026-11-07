// The default avatar, defined as Source model data (the same shape loadSourceModel() returns), so it
// goes through the same skinning, naming and attachment path as real Garry's Mod playermodels.
// Its skeleton follows ValveBiped conventions: ValveBiped.Bip01_* names and hierarchy, each bone's
// X axis pointing along the bone toward its child, and the same secondary axes per limb chain, so a
// PAC3 offset relative to a bone means the same thing here as in Garry's Mod. Proportions and body
// shapes are original. Built in our axes (X left, Y up, Z fwd), stored in Source axes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const LEFT = V(1, 0, 0), UP = V(0, 1, 0), FWD = V(0, 0, 1), BACK = V(0, 0, -1);

// [short name, parent, rest world position, child used for the X axis, secondary axis hint, which axis the hint sets]
const SKELETON = [
  ['Pelvis', null, V(0, 38, 0), null, null, null],
  ['Spine', 'Pelvis', V(0, 41.5, -0.6), 'Spine1', FWD, 'Y'],
  ['Spine1', 'Spine', V(0, 45.5, -0.5), 'Spine2', FWD, 'Y'],
  ['Spine2', 'Spine1', V(0, 50, -0.2), 'Spine4', FWD, 'Y'],
  ['Spine4', 'Spine2', V(0, 55.5, 0), 'Neck1', FWD, 'Y'],
  ['Neck1', 'Spine4', V(0, 60, 0.4), 'Head1', BACK, 'Y'],
  ['Head1', 'Neck1', V(0, 63.8, 0.9), null, BACK, 'Y'],
];
for (const [s, k] of [['L', 1], ['R', -1]]) {
  SKELETON.push(
    [`${s}_Clavicle`, 'Spine4', V(1.6 * k, 57.6, 0.4), `${s}_UpperArm`, UP, 'Y'],
    [`${s}_UpperArm`, `${s}_Clavicle`, V(8.4 * k, 57, -0.2), `${s}_Forearm`, BACK, 'Y'],
    [`${s}_Forearm`, `${s}_UpperArm`, V(9.4 * k, 46, -0.4), `${s}_Hand`, BACK, 'Y'],
    [`${s}_Hand`, `${s}_Forearm`, V(9.9 * k, 36, 0.2), `${s}_Finger2`, FWD, 'Z'],
    [`${s}_Finger0`, `${s}_Hand`, V(9.2 * k, 34.6, 1.6), null, FWD, 'Z'],
    [`${s}_Finger1`, `${s}_Hand`, V(10 * k, 32.4, 1.2), null, FWD, 'Z'],
    [`${s}_Finger2`, `${s}_Hand`, V(10.2 * k, 32.2, 0.4), null, FWD, 'Z'],
    [`${s}_Finger3`, `${s}_Hand`, V(10.2 * k, 32.4, -0.4), null, FWD, 'Z'],
    [`${s}_Finger4`, `${s}_Hand`, V(10 * k, 32.8, -1.1), null, FWD, 'Z'],
    [`${s}_Thigh`, 'Pelvis', V(4 * k, 36, 0), `${s}_Calf`, BACK, 'Y'],
    [`${s}_Calf`, `${s}_Thigh`, V(4.2 * k, 19, 0.3), `${s}_Foot`, BACK, 'Y'],
    [`${s}_Foot`, `${s}_Calf`, V(4.3 * k, 2.6, 0), `${s}_Toe0`, LEFT, 'Z'],
    [`${s}_Toe0`, `${s}_Foot`, V(4.4 * k, 0.8, 5), null, LEFT, 'Z'],
  );
}
// Attachments: [name, bone, position, rotation source] — eyes/head face forward like Valve's rigs.
const ATTACHMENTS = [
  ['eyes', 'Head1', V(0, 68, 5.6)],
  ['anim_attachment_head', 'Head1', V(0, 66, 0.8)],
  ['mouth', 'Head1', V(0, 65.4, 5)],
  ['chest', 'Spine2', V(0, 54, 4.6)],
  ['forward', 'Pelvis', V(0, 38, 8)],
  ['anim_attachment_RH', 'R_Hand', V(-10.2, 33, 0.4)],
  ['anim_attachment_LH', 'L_Hand', V(10.2, 33, 0.4)],
];

/**
 * World rotation of a bone following the ValveBiped axis convention. x/y/z are the bone's SOURCE
 * local axes as world directions; Source local axes are relabelled like positions when converted to
 * our axes (our local X = Source local Y, our Y = Source Z, our Z = Source X), hence the column order.
 */
function boneBasis(name, pos, childPos, hint, hintAxis) {
  const m = new THREE.Matrix4();
  if (name === 'Pelvis') return new THREE.Quaternion().setFromRotationMatrix(m.makeBasis(UP, FWD, LEFT)); // Source X left, Y up, Z forward
  const x = childPos ? childPos.clone().sub(pos).normalize() : (name === 'Head1' ? V(0, 1, 0.15).normalize() : null);
  if (!x) return null;
  let y, z;
  if (hintAxis === 'Y') { z = new THREE.Vector3().crossVectors(x, hint).normalize(); y = new THREE.Vector3().crossVectors(z, x); }
  else { y = new THREE.Vector3().crossVectors(hint, x).normalize(); z = new THREE.Vector3().crossVectors(x, y); }
  return new THREE.Quaternion().setFromRotationMatrix(m.makeBasis(y, z, x));
}

// ours -> Source: src = (z, x, y)
const posToSource = (v) => [v.z, v.x, v.y];
const quatToSource = (q) => [q.z, q.x, q.y, q.w];
function poseToBoneSource(worldPos, worldQ) {
  const P = new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1); // ours -> src
  const m = new THREE.Matrix4().compose(worldPos, worldQ, V(1, 1, 1)).invert();
  const s = P.clone().multiply(m).multiply(P.clone().transpose()).elements; // column-major
  return [s[0], s[4], s[8], s[12], s[1], s[5], s[9], s[13], s[2], s[6], s[10], s[14]];
}

const MATERIALS = [
  { name: 'body', color: [0.84, 0.86, 0.89], roughness: 0.45, metalness: 0.05 },
  { name: 'joints', color: [0.23, 0.26, 0.31], roughness: 0.5, metalness: 0.1 },
  { name: 'visor', color: [0.05, 0.07, 0.09], roughness: 0.15, metalness: 0.4 },
  { name: 'eyes', color: [0.5, 0.89, 1], selfIllum: true },
];

export function buildMannequinAsset() {
  const index = new Map(SKELETON.map((b, i) => [b[0], i]));
  const worldQ = [], worldP = [];
  SKELETON.forEach(([name, , pos, child, hint, axis], i) => {
    worldP[i] = pos;
    worldQ[i] = boneBasis(name, pos, child ? SKELETON[index.get(child)][2] : null, hint, axis) || worldQ[index.get(SKELETON[i][1])].clone();
  });
  const bones = SKELETON.map(([name, parent], i) => {
    const pi = parent ? index.get(parent) : -1;
    const inv = pi >= 0 ? worldQ[pi].clone().invert() : new THREE.Quaternion();
    const lp = pi >= 0 ? worldP[i].clone().sub(worldP[pi]).applyQuaternion(inv) : worldP[i].clone();
    const lq = inv.multiply(worldQ[i]);
    return { name: `ValveBiped.Bip01_${name}`, parent: pi, pos: posToSource(lp), quat: quatToSource(lq), poseToBone: poseToBoneSource(worldP[i], worldQ[i]) };
  });
  const attachments = ATTACHMENTS.map(([name, bone, pos]) => {
    const bi = index.get(bone);
    const local = new THREE.Matrix4().compose(pos.clone().sub(worldP[bi]).applyQuaternion(worldQ[bi].clone().invert()), worldQ[bi].clone().invert(), V(1, 1, 1));
    const P = new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
    const s = P.clone().multiply(local).multiply(P.clone().transpose()).elements;
    return { name, bone: bi, matrix: [s[0], s[4], s[8], s[12], s[1], s[5], s[9], s[13], s[2], s[6], s[10], s[14]] };
  });

  // body: rigid segments, each skinned 100% to one bone, merged per material
  const parts = { body: [], joints: [], visor: [], eyes: [] };
  const sphere = new THREE.SphereGeometry(1, 28, 18);
  const add = (mat, geo, boneName, matrix) => {
    const g = geo.clone().applyMatrix4(matrix);
    const n = g.attributes.position.count;
    const bi = index.get(boneName);
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4).map((_, k) => (k % 4 === 0 ? bi : 0)), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, k) => (k % 4 === 0 ? 1 : 0)), 4));
    parts[mat].push(g);
  };
  const at = (p, s = [1, 1, 1], q = new THREE.Quaternion()) => new THREE.Matrix4().compose(p, q, V(...s));
  const ellipsoid = (mat, bone, p, s) => add(mat, sphere, bone, at(p, s));
  const limb = (mat, bone, a, b, r) => {
    const d = b.clone().sub(a);
    const len = d.length();
    const geo = new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 6, 16);
    add(mat, geo, bone, at(a.clone().add(b).multiplyScalar(0.5), [1, 1, 1], new THREE.Quaternion().setFromUnitVectors(UP, d.normalize())));
  };
  const P = (n) => SKELETON[index.get(n)][2];
  ellipsoid('joints', 'Pelvis', V(0, 37.5, 0), [6.4, 4.8, 4.4]);
  ellipsoid('body', 'Spine1', V(0, 45.5, -0.3), [5.6, 5.4, 4]);
  ellipsoid('body', 'Spine2', V(0, 55.5, 0), [8.2, 6.8, 5]);
  add('joints', new THREE.CylinderGeometry(2, 2.3, 5.5, 16), 'Neck1', at(V(0, 62, 0.5)));
  ellipsoid('body', 'Head1', V(0, 67.6, 1), [4.7, 5.6, 5.3]);
  add('visor', new THREE.SphereGeometry(1, 28, 10, Math.PI / 2 - 0.95, 1.9, 1.2, 0.55), 'Head1', at(V(0, 67.6, 1.05), [4.85, 5.75, 5.45]));
  ellipsoid('eyes', 'Head1', V(1.6, 68, 6.35), [0.65, 0.4, 0.25]);
  ellipsoid('eyes', 'Head1', V(-1.6, 68, 6.35), [0.65, 0.4, 0.25]);
  for (const s of ['L', 'R']) {
    ellipsoid('joints', `${s}_UpperArm`, P(`${s}_UpperArm`), [2.7, 2.7, 2.7]);
    limb('body', `${s}_UpperArm`, P(`${s}_UpperArm`), P(`${s}_Forearm`), 2.2);
    ellipsoid('joints', `${s}_Forearm`, P(`${s}_Forearm`), [1.9, 1.9, 1.9]);
    limb('body', `${s}_Forearm`, P(`${s}_Forearm`), P(`${s}_Hand`), 1.8);
    ellipsoid('joints', `${s}_Hand`, P(`${s}_Hand`).clone().add(V(0, -2.8, 0.3)), [1.5, 3, 2.3]);
    limb('body', `${s}_Thigh`, P(`${s}_Thigh`), P(`${s}_Calf`), 3.1);
    ellipsoid('joints', `${s}_Calf`, P(`${s}_Calf`), [2.7, 2.7, 2.7]);
    limb('body', `${s}_Calf`, P(`${s}_Calf`), P(`${s}_Foot`), 2.5);
    ellipsoid('joints', `${s}_Foot`, P(`${s}_Foot`).clone().add(V(0, -1.1, 2.2)), [2.3, 1.5, 4.6]);
  }
  const geoms = MATERIALS.map((m, i) => {
    const merged = mergeGeometries(parts[m.name]);
    merged.computeBoundingSphere();
    return { geometry: merged, material: i, bodyPart: 0, model: 0 };
  });
  return {
    mdl: { name: 'mannequin', includes: ['models/m_anm.mdl'], bones, attachments, textures: MATERIALS.map((m) => m.name), cdPaths: [], skins: [MATERIALS.map((_, i) => i)], bodyParts: [] },
    geoms,
    descs: MATERIALS.map((m) => ({ name: m.name, map: null, normalMap: null, color: m.color, roughness: m.roughness, metalness: m.metalness, selfIllum: !!m.selfIllum })),
  };
}
