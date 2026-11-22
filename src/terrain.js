import * as THREE from 'three/webgpu';

// Small seeded 2D gradient noise + fbm, shared by the mesh and height queries.
const perm = new Uint8Array(512);
{
  let s = 1337;
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const grad = (h, x, y) => {
  const a = (h / 256) * Math.PI * 2;
  return Math.cos(a) * x + Math.sin(a) * y;
};
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const u = fade(xf), v = fade(yf);
  const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
  const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
  const x1 = THREE.MathUtils.lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
  const x2 = THREE.MathUtils.lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
  return THREE.MathUtils.lerp(x1, x2, v);
}

export function heightAt(x, z) {
  let h = 0, amp = 2.6, f = 0.035;
  for (let o = 0; o < 5; o++) {
    h += noise(x * f, z * f) * amp;
    amp *= 0.45;
    f *= 2.1;
  }
  // flatten the spawn meadow a bit
  const d = Math.hypot(x, z);
  return h * THREE.MathUtils.smoothstep(d, 2, 14) * 1.0 + h * 0.25 * (1 - THREE.MathUtils.smoothstep(d, 2, 14));
}

export function normalAt(x, z, target = new THREE.Vector3()) {
  const e = 0.15;
  return target.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
}

export const SIZE = 140;

export function createTerrain() {
  const seg = 280;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const grassA = new THREE.Color('#5d8a3a'), grassB = new THREE.Color('#87a84a');
  const moss = new THREE.Color('#3f6b34'), dirt = new THREE.Color('#9c8358');
  const c = new THREE.Color(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    normalAt(x, z, n);
    const patch = noise(x * 0.12 + 40, z * 0.12) * 0.5 + 0.5;
    c.copy(grassA).lerp(grassB, patch);
    c.lerp(moss, THREE.MathUtils.clamp(-y * 0.25, 0, 0.7));
    c.lerp(dirt, THREE.MathUtils.smoothstep(1 - n.y, 0.12, 0.3));
    const speck = (noise(x * 2.3, z * 2.3) * 0.5 + 0.5) * 0.12;
    colors.set([c.r * (0.94 + speck), c.g * (0.94 + speck), c.b * (0.94 + speck)], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

// Instanced pine trees, rocks and flowers scattered on the terrain.
export function createScatter() {
  const group = new THREE.Group();
  const rand = (() => { let s = 42; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const spots = (count, minR) => {
    const out = [];
    while (out.length < count) {
      const x = (rand() - 0.5) * SIZE * 0.95, z = (rand() - 0.5) * SIZE * 0.95;
      if (Math.hypot(x, z) < minR) continue;
      out.push([x, z]);
    }
    return out;
  };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  // pines: trunk + 3 stacked cones
  const trees = spots(260, 9);
  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.12, 0.18, 1.2, 7).translate(0, 0.6, 0),
    new THREE.MeshStandardMaterial({ color: '#5a3d26', roughness: 1 }), trees.length);
  const coneGeo = [0, 1, 2].map((k) => new THREE.ConeGeometry(1.25 - k * 0.32, 1.6 - k * 0.2, 9).translate(0, 1.5 + k * 0.85, 0));
  const leafMat = new THREE.MeshStandardMaterial({ color: '#2f5a32', roughness: 0.9, flatShading: true });
  const cones = coneGeo.map((g) => new THREE.InstancedMesh(g, leafMat, trees.length));
  const tint = new THREE.Color();
  trees.forEach(([x, z], i) => {
    const sc = 0.8 + rand() * 1.1;
    p.set(x, heightAt(x, z) - 0.1, z);
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    s.set(sc, sc * (0.9 + rand() * 0.4), sc);
    m.compose(p, q, s);
    trunk.setMatrixAt(i, m);
    tint.setHSL(0.33 + rand() * 0.05, 0.35 + rand() * 0.15, 0.2 + rand() * 0.08);
    cones.forEach((c) => { c.setMatrixAt(i, m); c.setColorAt(i, tint); });
  });
  for (const im of [trunk, ...cones]) { im.castShadow = true; im.receiveShadow = true; group.add(im); }

  // beer glasses (nonic pints): glass shell, beer, foam head — unit height 1
  const v2 = (pts) => pts.map(([x, y]) => new THREE.Vector2(x, y));
  const glassGeo = new THREE.LatheGeometry(v2([[0, 0], [0.15, 0], [0.16, 0.05], [0.2, 0.7], [0.226, 0.8],
    [0.212, 0.86], [0.216, 1.0], [0.206, 1.0]]), 40);
  const beerGeo = new THREE.LatheGeometry(v2([[0, 0.045], [0.142, 0.045], [0.19, 0.7], [0.205, 0.78], [0, 0.78]]), 40);
  const foamGeo = new THREE.LatheGeometry(v2([[0, 0.78], [0.205, 0.78], [0.204, 0.88], [0.17, 0.93], [0, 0.95]]), 40);
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#f4fbff', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.13,
    side: THREE.FrontSide, depthWrite: false, specularIntensity: 1,
  });
  const beerMat = new THREE.MeshPhysicalMaterial({
    color: '#b8650a', roughness: 0.3,
    emissive: '#a85a00', emissiveIntensity: 0.5, specularIntensity: 0.4,
  });
  const foamMat = new THREE.MeshStandardMaterial({ color: '#fff6e2', roughness: 1 });
  const pints = [[1.6, -1.4], [-2.2, -0.6], [-1.1, -2.6], ...spots(90, 4)];
  const [glass, beer, foam] = [[glassGeo, glassMat], [beerGeo, beerMat], [foamGeo, foamMat]]
    .map(([g, mt]) => new THREE.InstancedMesh(g, mt, pints.length));
  pints.forEach(([x, z], i) => {
    const sc = 0.5 + rand() * 0.5;
    p.set(x, heightAt(x, z) - 0.02, z);
    q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.12, rand() * 6.28, (rand() - 0.5) * 0.12));
    m.compose(p, q, s.setScalar(sc));
    for (const im of [glass, beer, foam]) im.setMatrixAt(i, m);
  });
  beer.castShadow = foam.castShadow = true;
  beer.receiveShadow = foam.receiveShadow = true;
  glass.renderOrder = 2;
  group.add(beer, foam, glass);

  // flowers
  const flowers = spots(900, 1.5);
  const flower = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.06, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.6 }), flowers.length);
  const palette = ['#ffffff', '#f6d74a', '#c58be0', '#f08aa0'].map((h) => new THREE.Color(h));
  flowers.forEach(([x, z], i) => {
    p.set(x, heightAt(x, z) + 0.05, z);
    flower.setMatrixAt(i, m.compose(p, q.identity(), s.setScalar(0.7 + rand() * 0.6)));
    flower.setColorAt(i, palette[Math.floor(rand() * palette.length)]);
  });
  group.add(flower);
  return group;
}
