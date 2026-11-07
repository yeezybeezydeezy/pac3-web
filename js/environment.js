// Sky, ground, lights and a few landmarks for scale in play mode.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { setColor } from './core/util.js';

const SKY_TOP = new THREE.Color(0x5b8fd6), SKY_HORIZON = new THREE.Color(0xc9d6e6), GROUND = 0x6f7680;

export function buildEnvironment(scene, renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(20000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = normalize(vP).y; gl_FragColor = vec4(mix(horizon, top, pow(max(h, 0.0), 0.6)), 1.0);\n#include <colorspace_fragment>\n}',
    }),
  );
  sky.raycast = () => {};
  sky.renderOrder = -10;
  scene.add(sky);

  const defaultFog = { color: SKY_HORIZON.clone(), near: 2500, far: 12000 };
  scene.fog = new THREE.Fog(defaultFog.color.clone(), defaultFog.near, defaultFog.far);

  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x4a4036, 1.4));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -160; sc.right = sc.top = 160; sc.near = 10; sc.far = 1600;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.4;
  scene.add(sun, sun.target);

  // ground with a subtle tile texture
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#8b929c'; x.fillRect(0, 0, 256, 256);
  x.fillStyle = '#848b95'; x.fillRect(0, 0, 128, 128); x.fillRect(128, 128, 128, 128);
  x.strokeStyle = 'rgba(0,0,0,.18)'; x.lineWidth = 2; x.strokeRect(1, 1, 254, 254);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(200, 200);
  tex.anisotropy = 8;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshStandardMaterial({ map: tex, color: GROUND, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.raycast = () => {};
  scene.add(ground);

  const grid = new THREE.GridHelper(2000, 80, 0x3d434d, 0x5a616b);
  grid.position.y = 0.05;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  grid.raycast = () => {};
  scene.add(grid);

  // landmarks
  const mat = (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.8 });
  const props = [
    [new THREE.BoxGeometry(80, 80, 80), mat(0xb3925f), [420, 40, 300]],
    [new THREE.BoxGeometry(40, 160, 40), mat(0x7b8fa8), [-380, 80, 420]],
    [new THREE.CylinderGeometry(30, 30, 240, 24), mat(0xc9c2b6), [-600, 120, -350]],
    [new THREE.BoxGeometry(200, 20, 120), mat(0x8fa37c), [600, 10, -420]],
    [new THREE.SphereGeometry(70, 32, 20), mat(0xb46b6b), [-220, 70, -700]],
  ];
  for (const [g, m, p] of props) {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.fromArray(p);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.raycast = () => {};
    scene.add(mesh);
  }

  return {
    sun, grid, defaultFog,
    update(target) {
      sun.target.position.copy(target);
      sun.position.copy(target).add(new THREE.Vector3(260, 520, 180));
    },
    applyFog(fx) {
      const f = scene.fog;
      if (fx) { setColor(f.color, fx.color); f.near = fx.start; f.far = fx.end; }
      else { f.color.copy(defaultFog.color); f.near = defaultFog.near; f.far = defaultFog.far; }
    },
  };
}
