// Camera-facing ribbon mesh shared by trail and beam parts.
import * as THREE from 'three';

const _t = new THREE.Vector3(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

export class Ribbon {
  constructor(maxPoints = 256) {
    this.max = maxPoints;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPoints * 6), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxPoints * 8), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(maxPoints * 4), 2).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < maxPoints - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
    this.color = new THREE.Color();
  }
  /** points: [{p: Vector3, w: width, c: [r,g,b] sRGB, a: alpha, u: texcoord}] */
  build(points, camera) {
    const n = Math.min(points.length, this.max);
    const g = this.mesh.geometry;
    const pos = g.attributes.position.array, col = g.attributes.color.array, uv = g.attributes.uv.array;
    for (let i = 0; i < n; i++) {
      const pt = points[i];
      const a = points[Math.max(0, i - 1)].p, b = points[Math.min(n - 1, i + 1)].p;
      _t.subVectors(b, a);
      _v.subVectors(camera.position, pt.p);
      _s.crossVectors(_t, _v);
      if (_s.lengthSq() < 1e-8) _s.set(0, 1, 0);
      _s.normalize().multiplyScalar(pt.w * 0.5);
      pos[i * 6] = pt.p.x + _s.x; pos[i * 6 + 1] = pt.p.y + _s.y; pos[i * 6 + 2] = pt.p.z + _s.z;
      pos[i * 6 + 3] = pt.p.x - _s.x; pos[i * 6 + 4] = pt.p.y - _s.y; pos[i * 6 + 5] = pt.p.z - _s.z;
      this.color.setRGB(pt.c[0], pt.c[1], pt.c[2], THREE.SRGBColorSpace);
      for (let k = 0; k < 2; k++) { const o = i * 8 + k * 4; col[o] = this.color.r; col[o + 1] = this.color.g; col[o + 2] = this.color.b; col[o + 3] = pt.a; }
      uv[i * 4] = pt.u; uv[i * 4 + 1] = 1; uv[i * 4 + 2] = pt.u; uv[i * 4 + 3] = 0;
    }
    g.setDrawRange(0, n > 1 ? (n - 1) * 6 : 0);
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.uv.needsUpdate = true;
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.material.dispose(); }
}
