import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { createTerrain, createScatter, heightAt, normalAt, SIZE } from './terrain.js';

const WALK_SPEED = 0.62; // m/s that matches the 0.8 s stride at timeScale 1
const RUN_FACTOR = 2.1;
const TURN_RATE = 6;

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
await renderer.init();
document.getElementById('backend').textContent =
  `three.js r${THREE.REVISION} · ${renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2 fallback'}`;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#b9cde0', 25, 70);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 2000);
camera.position.set(2.2, 1.9, 3.8);

// ---------------------------------------------------------------- sky + light
const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(42), THREE.MathUtils.degToRad(30));
const sky = new SkyMesh();
sky.scale.setScalar(1500);
sky.sunPosition.value.copy(sun);
sky.turbidity.value = 3;
sky.rayleigh.value = 1.2;
sky.cloudCoverage.value = 0.45;
sky.material.fog = false;
scene.add(sky);

scene.add(new THREE.HemisphereLight("#cfe3ff", "#5a6a3c", 1.6));
const dir = new THREE.DirectionalLight('#fff2dd', 3.2);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
Object.assign(dir.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 80 });
dir.shadow.bias = -0.0005;
dir.shadow.normalBias = 0.03;
scene.add(dir, dir.target);

// ---------------------------------------------------------------- world
const terrain = createTerrain();
scene.add(terrain, createScatter());

const marker = new THREE.Mesh(
  new THREE.RingGeometry(0.16, 0.24, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#fff7c2', transparent: true, opacity: 0, depthWrite: false }),
);
scene.add(marker);

// ---------------------------------------------------------------- moose
function furTexture() {
  // fine fibre-noise normal map so the plush reads as fabric under the sheen
  const s = 256, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const img = g.createImageData(s, s);
  const h = new Float32Array(s * s).map(() => Math.random());
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < s * s; i++) h[i] = (h[i] + h[(i + 1) % (s * s)] + h[(i + s) % (s * s)]) / 3;
  }
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = y * s + x;
    const dx = h[y * s + ((x + 1) % s)] - h[y * s + ((x - 1 + s) % s)];
    const dy = h[((y + 1) % s) * s + x] - h[((y - 1 + s) % s) * s + x];
    img.data.set([128 + dx * 900, 128 + dy * 900, 255, 255], i * 4);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 6);
  return t;
}

const gltf = await new GLTFLoader().loadAsync('/moose.glb');
const moose = gltf.scene;
const fur = furTexture();
moose.traverse((o) => {
  if (!o.isMesh) return;
  o.castShadow = true;
  o.receiveShadow = true;
  o.frustumCulled = false;
  const ms = Array.isArray(o.material) ? o.material : [o.material];
  for (const m of ms) {
    if (m.name === 'Eye') { m.roughness = 0.08; m.metalness = 0; continue; }
    m.normalMap = fur;
    m.normalScale = new THREE.Vector2(0.5, 0.5);
    m.sheenRoughness = 0.45;
    m.roughness = 0.9;
  }
});
const holder = new THREE.Group(); // yaw + terrain tilt live here
holder.add(moose);
scene.add(holder);

const mixer = new THREE.AnimationMixer(moose);
const clip = (n) => gltf.animations.find((a) => a.name === n);
const idle = mixer.clipAction(clip('Idle')).play();
const walk = mixer.clipAction(clip('Walk')).play();
walk.setEffectiveWeight(0);
document.getElementById('loading').remove();

// ---------------------------------------------------------------- input
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 1.5;
controls.maxDistance = 14;
controls.maxPolarAngle = THREE.MathUtils.degToRad(86);
controls.target.set(0, 0.6, 0);

const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

let target = null;
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY, performance.now()]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
  const quick = performance.now() - down[2] < 350;
  down = null;
  if (moved > 6 || !quick) return; // that was an orbit drag
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(terrain)[0];
  if (hit) {
    target = hit.point.clone();
    target.hurry = e.shiftKey;
    marker.position.copy(hit.point).y += 0.03;
    marker.material.opacity = 1;
  }
});

// ---------------------------------------------------------------- loop
const state = { yaw: 0, speed: 0, pos: new THREE.Vector3(0, 0, 0) };
const tmp = new THREE.Vector3(), n = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
const qYaw = new THREE.Quaternion(), qTilt = new THREE.Quaternion();
const camFwd = new THREE.Vector3(), camRight = new THREE.Vector3();
const timer = new THREE.Timer();
const lim = SIZE / 2 - 3;

function update(dt) {
  // desired direction: keyboard (camera-relative) wins over click target
  camera.getWorldDirection(camFwd).setY(0).normalize();
  camRight.crossVectors(camFwd, up);
  const wish = new THREE.Vector3();
  if (keys.has('KeyW') || keys.has('ArrowUp')) wish.add(camFwd);
  if (keys.has('KeyS') || keys.has('ArrowDown')) wish.sub(camFwd);
  if (keys.has('KeyD') || keys.has('ArrowRight')) wish.add(camRight);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) wish.sub(camRight);
  let hurry = keys.has('ShiftLeft') || keys.has('ShiftRight');
  if (wish.lengthSq() > 0) {
    target = null;
  } else if (target) {
    wish.subVectors(target, state.pos).setY(0);
    hurry ||= target.hurry;
    if (wish.length() < 0.12) { target = null; wish.set(0, 0, 0); }
  }
  marker.material.opacity = THREE.MathUtils.damp(marker.material.opacity, target ? 1 : 0, 8, dt);
  marker.scale.setScalar(1 + 0.15 * Math.sin(performance.now() / 160));

  const moving = wish.lengthSq() > 0;
  const want = moving ? WALK_SPEED * (hurry ? RUN_FACTOR : 1) : 0;
  state.speed = THREE.MathUtils.damp(state.speed, want, 6, dt);

  if (moving) {
    wish.normalize();
    const goalYaw = Math.atan2(wish.x, wish.z);
    let d = goalYaw - state.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    state.yaw += d * Math.min(1, TURN_RATE * dt);
    // only walk forward once roughly facing the way
    const facing = Math.max(0, Math.cos(d));
    tmp.set(Math.sin(state.yaw), 0, Math.cos(state.yaw)).multiplyScalar(state.speed * facing * dt);
    // slow down uphill, a touch faster downhill
    const slope = heightAt(state.pos.x + tmp.x * 10, state.pos.z + tmp.z * 10) - heightAt(state.pos.x, state.pos.z);
    tmp.multiplyScalar(THREE.MathUtils.clamp(1 - slope * 0.5, 0.55, 1.2));
    state.pos.add(tmp);
    state.pos.x = THREE.MathUtils.clamp(state.pos.x, -lim, lim);
    state.pos.z = THREE.MathUtils.clamp(state.pos.z, -lim, lim);
  }

  // stick to the surface, tilt partially with the slope
  state.pos.y = heightAt(state.pos.x, state.pos.z);
  normalAt(state.pos.x, state.pos.z, n);
  qTilt.setFromUnitVectors(up, n.lerp(up, 0.55).normalize());
  qYaw.setFromAxisAngle(up, state.yaw);
  holder.position.lerp(state.pos, 1 - Math.exp(-20 * dt));
  holder.quaternion.slerp(qTilt.multiply(qYaw), 1 - Math.exp(-10 * dt));

  // blend idle <-> walk and sync stride to ground speed
  const w = THREE.MathUtils.clamp(state.speed / WALK_SPEED, 0, 1);
  walk.setEffectiveWeight(w);
  idle.setEffectiveWeight(1 - w);
  walk.timeScale = Math.max(0.6, state.speed / WALK_SPEED);
  mixer.update(dt);

  // camera follows, keeping the user's orbit offset
  tmp.copy(holder.position).y += 0.6;
  const delta = tmp.clone().sub(controls.target);
  controls.target.add(delta.multiplyScalar(1 - Math.exp(-6 * dt)));
  camera.position.add(delta);
  const minY = heightAt(camera.position.x, camera.position.z) + 0.3;
  if (camera.position.y < minY) camera.position.y = minY;
  controls.update();

  // shadow frustum follows the moose
  dir.position.copy(holder.position).addScaledVector(sun, 30);
  dir.target.position.copy(holder.position);
}

renderer.setAnimationLoop((t) => {
  timer.update(t);
  update(Math.min(timer.getDelta(), 0.05));
  if (innerWidth === 0 || innerHeight === 0) return; // hidden/zero-size viewport
  renderer.render(scene, camera);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
