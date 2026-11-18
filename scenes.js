/* =====================================================================
   APEX GARAGE — 3D scenes (Three.js r160)
   1. Hero: the coupe, still, front three-quarter (models/car.glb)
   2. Anatomy: the same car as an x-ray with each system modelled inside
   3. Engine: a sectioned single-cylinder DOHC engine driven by window.engineState,
      with real valve timing, a flame front and clickable parts
   ===================================================================== */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;
const INK = 0x0b0b0c, SIGNAL = 0xff4f1f;

/* ---------- shared helpers ---------- */
function makeRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  return r;
}
function studioEnv(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return tex;
}
function fit(renderer, camera, el) {
  const w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return false;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  return true;
}
function loopWhileVisible(el, frame) {
  let on = false, raf = 0;
  const tick = (t) => { frame(t); raf = requestAnimationFrame(tick); };
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !on) { on = true; raf = requestAnimationFrame(tick); }
    else if (!e.isIntersecting && on) { on = false; cancelAnimationFrame(raf); }
  }).observe(el);
}
function addStudioLights(scene, shadows) {
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-3, 7, 5);
  if (shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 20 });
    key.shadow.bias = -0.0005;
  }
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff6a3d, 2.0);
  rim.position.set(5, 2.5, -4);
  scene.add(rim);
}
function shadowFloor(scene, opacity) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.ShadowMaterial({ opacity }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
}
/** Creates HTML pins that follow 3D anchors. */
function makePins(container, items, onClick) {
  const pins = items.map((it) => {
    const b = document.createElement('button');
    b.className = 'pin is-hidden';
    b.type = 'button';
    b.dataset.id = it.id;
    b.setAttribute('aria-label', it.name);
    b.innerHTML = `<span class="pin__dot" aria-hidden="true">+</span><span class="pin__name">${it.name}</span>`;
    b.addEventListener('click', () => onClick(it.id));
    container.appendChild(b);
    return { ...it, el: b };
  });
  const v = new THREE.Vector3();
  return {
    pins,
    update(camera, w, h, visible = true) {
      pins.forEach((p) => {
        (typeof p.anchor === 'function' ? p.anchor(v) : v.set(...p.anchor)).project(camera);
        const off = !visible || v.z > 1;
        p.el.classList.toggle('is-hidden', off);
        if (!off) p.el.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
      });
    },
    setActive(id) { pins.forEach((p) => p.el.classList.toggle('is-active', p.id === id)); }
  };
}

/* ---------- shared car model ---------- */
const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');
const carSource = new Promise((resolve, reject) => {
  new GLTFLoader().setDRACOLoader(draco).load('models/car.glb', (g) => resolve(g.scene), undefined, reject);
});
/** Clone of the car: 3.4 long, centred, wheels on y = 0, nose pointing −X. */
function normalisedCar(src, cloneMaterials) {
  const car = src.clone(true);
  const box = new THREE.Box3().setFromObject(car);
  const size = box.getSize(new THREE.Vector3());
  const s = 3.4 / Math.max(size.x, size.z);
  car.scale.setScalar(s);
  box.setFromObject(car);
  const c = box.getCenter(new THREE.Vector3());
  car.position.set(-c.x, -box.min.y, -c.z);
  car.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    if (cloneMaterials) o.material = o.material.clone();
    o.material.envMapIntensity = 1.1;
  });
  const wrap = new THREE.Group();
  wrap.add(car);
  return wrap;
}
/**
 * Swap Meshy's plain PBR material for a car-paint material: same texture maps,
 * plus a glossy clear-coat layer and sharper (anisotropic) texture filtering.
 * The clear coat gives real reflections that hide most of the baked texture blotches.
 */
function upgradePaint(root, renderer) {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const s = o.material;
    const m = new THREE.MeshPhysicalMaterial({
      map: s.map, normalMap: s.normalMap,
      roughnessMap: s.roughnessMap, metalnessMap: s.metalnessMap,
      roughness: s.roughness, metalness: s.metalness,
      clearcoat: 1, clearcoatRoughness: 0.07,
      envMapIntensity: 1.45, side: s.side
    });
    if (s.normalScale) m.normalScale.copy(s.normalScale);
    [m.map, m.normalMap, m.roughnessMap].forEach((t) => { if (t) { t.anisotropy = aniso; t.needsUpdate = true; } });
    o.material = m;
  });
  return root;
}

// Measured from models/car.glb's vertices (ground-contact clusters + roofline): axles and wheel size in normalised units.
// If the model is swapped, re-measure these or the internals and pins will sit in the wrong place.
const CAR = { front: -1.07, rear: 0.88, wheelR: 0.27, trackZ: 0.62 };

/* =====================================================================
   1. Hero — still
   ===================================================================== */
(function heroCar() {
  const stage = document.getElementById('heroStage');
  const canvas = document.getElementById('heroCanvas');
  if (!stage || !canvas) return;
  let renderer;
  try { renderer = makeRenderer(canvas); } catch { return; }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.environment = studioEnv(renderer);
  addStudioLights(scene, true);
  shadowFloor(scene, 0.55);

  // near-frontal three-quarter: nose (−X) toward the viewer
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  camera.position.set(-6.2, 1.35, 2.6);
  const target = new THREE.Vector3(-0.25, 0.45, 0);

  // the car sits on a pivot that turns toward the mouse
  const pivot = new THREE.Group();
  scene.add(pivot);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.enabled = finePointer;          // drag to spin on desktop; touch keeps page scroll
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.rotateSpeed = 0.6;
  controls.minPolarAngle = 1.05;
  controls.maxPolarAngle = 1.48;
  controls.update();

  // mouse-follow: normalised pointer position across the whole window
  let mx = 0, my = 0;
  if (finePointer && !reduceMotion) {
    addEventListener('pointermove', (e) => {
      mx = (e.clientX / innerWidth) * 2 - 1;
      my = (e.clientY / innerHeight) * 2 - 1;
    }, { passive: true });
  }

  let loaded = false;
  carSource.then((src) => {
    pivot.add(upgradePaint(normalisedCar(src, false), renderer));
    loaded = true;
    stage.classList.add('is-loaded');
  }).catch((err) => console.warn('Car model failed to load; keeping line drawing.', err));

  fit(renderer, camera, stage);
  new ResizeObserver(() => fit(renderer, camera, stage)).observe(stage);

  let last = performance.now();
  loopWhileVisible(stage, (t) => {
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    const k = 1 - Math.exp(-dt * 3);
    pivot.rotation.y += (mx * 0.5 - pivot.rotation.y) * k;   // up to ~±29° toward the cursor
    pivot.rotation.z += (my * 0.035 - pivot.rotation.z) * k; // a hint of body roll
    controls.update();
    if (loaded) renderer.render(scene, camera);
  });
})();
/* =====================================================================
   2. Anatomy — x-ray car
   ===================================================================== */
(function anatomyCar() {
  const stage = document.getElementById('anatStage');
  const canvas = document.getElementById('anatCanvas');
  const pinsEl = document.getElementById('anatPins');
  if (!stage || !canvas) return;
  let renderer;
  try { renderer = makeRenderer(canvas); } catch { return; }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.environment = studioEnv(renderer);
  addStudioLights(scene, true);
  shadowFloor(scene, 0.22);

  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 100);
  const { front: F, rear: RA, wheelR: WR, trackZ: TZ } = CAR;
  const wheels = [[F, TZ], [F, -TZ], [RA, TZ], [RA, -TZ]];

  /* camera presets per system: [camera position], [look-at] */
  const VIEWS = {
    overview:     { cam: [-3.6, 1.65, 4.2], at: [0.05, 0.42, 0] },
    engine:       { cam: [-3.0, 2.4, 2.7], at: [-0.72, 0.45, 0] },
    transmission: { cam: [-0.4, 2.3, 4.0], at: [0.1, 0.32, 0] },
    brakes:       { cam: [-2.5, 0.9, 2.9], at: [-1.0, 0.3, 0.3] },
    suspension:   { cam: [2.5, 1.6, 3.1], at: [0.85, 0.4, 0.2] },
    cooling:      { cam: [-4.0, 1.7, 2.0], at: [-1.2, 0.45, 0] },
    electrical:   { cam: [3.4, 2.4, 2.6], at: [0.5, 0.42, -0.1] },
    exhaust:      { cam: [0.9, 0.75, 5.3], at: [0.2, 0.26, 0] },
    tyres:        { cam: [2.3, 0.8, 3.0], at: [0.85, 0.28, 0.35] }
  };
  const PIN_AT = {
    engine: [-0.72, 0.8, 0], transmission: [-0.12, 0.55, 0], brakes: [F, WR, TZ + 0.05],
    suspension: [RA, 0.68, TZ - 0.12], cooling: [-1.5, 0.66, 0], electrical: [1.35, 0.72, -0.35],
    exhaust: [0.4, 0.15, 0.3], tyres: [RA - 0.18, 0.1, TZ + 0.12]
  };

  /* ---- internals, one group per system ---- */
  const internals = new THREE.Group();
  scene.add(internals);
  const groups = {};
  function group(id) {
    const mat = new THREE.MeshStandardMaterial({ color: INK, metalness: 0.4, roughness: 0.5, transparent: true, opacity: 0, depthWrite: false });
    const g = new THREE.Group();
    g.userData.mat = mat;
    groups[id] = g;
    internals.add(g);
    return g;
  }
  function add(g, geo, pos, rot) {
    const m = new THREE.Mesh(geo, g.userData.mat);
    m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    g.add(m);
    return m;
  }
  const tube = (pts, r) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 64, r, 10, false);
  class Helix extends THREE.Curve {
    constructor(r, h, turns) { super(); this.r = r; this.h = h; this.turns = turns; }
    getPoint(t, out = new THREE.Vector3()) {
      const a = t * this.turns * Math.PI * 2;
      return out.set(Math.cos(a) * this.r, t * this.h, Math.sin(a) * this.r);
    }
  }

  // engine: V8 block, heads, plenum, front pulley
  let g = group('engine');
  add(g, new THREE.BoxGeometry(0.62, 0.3, 0.42), [-0.72, 0.46, 0]);
  add(g, new THREE.BoxGeometry(0.6, 0.1, 0.17), [-0.72, 0.64, 0.17], [0.55, 0, 0]);
  add(g, new THREE.BoxGeometry(0.6, 0.1, 0.17), [-0.72, 0.64, -0.17], [-0.55, 0, 0]);
  add(g, new THREE.BoxGeometry(0.5, 0.08, 0.14), [-0.72, 0.7, 0]);
  add(g, new THREE.CylinderGeometry(0.08, 0.08, 0.05, 32), [-1.05, 0.45, 0], [0, 0, Math.PI / 2]);

  // transmission: gearbox, driveshaft, differential, half-shafts
  g = group('transmission');
  add(g, new THREE.CylinderGeometry(0.09, 0.15, 0.55, 32), [-0.15, 0.4, 0], [0, 0, Math.PI / 2]);
  add(g, new THREE.CylinderGeometry(0.035, 0.035, 0.66, 16), [0.46, 0.33, 0], [0, 0, Math.PI / 2 + 0.08]);
  add(g, new THREE.SphereGeometry(0.11, 24, 16), [RA, WR, 0]);
  add(g, new THREE.CylinderGeometry(0.03, 0.03, TZ * 2 - 0.1, 16), [RA, WR, 0], [Math.PI / 2, 0, 0]);

  // brakes: discs + calipers at every wheel, lines from the master cylinder
  g = group('brakes');
  wheels.forEach(([x, z]) => {
    const zi = z - Math.sign(z) * 0.07;
    add(g, new THREE.CylinderGeometry(0.19, 0.19, 0.025, 48), [x, WR, zi], [Math.PI / 2, 0, 0]);
    add(g, new THREE.BoxGeometry(0.09, 0.14, 0.06), [x + 0.15, WR + 0.08, zi], [0, 0, -0.5]);
  });
  add(g, new THREE.CylinderGeometry(0.04, 0.04, 0.16, 16), [-0.32, 0.66, -0.3], [0, 0, Math.PI / 2]);
  add(g, tube([[-0.32, 0.64, -0.3], [-0.7, 0.3, -0.4], [F, WR + 0.1, -TZ + 0.1]], 0.008), [0, 0, 0]);
  add(g, tube([[-0.32, 0.64, -0.3], [-0.6, 0.25, 0.2], [F, WR + 0.1, TZ - 0.1]], 0.008), [0, 0, 0]);
  add(g, tube([[-0.32, 0.64, -0.3], [0, 0.14, -0.35], [RA, WR + 0.1, -TZ + 0.1]], 0.008), [0, 0, 0]);
  add(g, tube([[-0.32, 0.64, -0.3], [0, 0.14, 0.35], [RA, WR + 0.1, TZ - 0.1]], 0.008), [0, 0, 0]);

  // suspension: coil-over at each corner
  g = group('suspension');
  const spring = new THREE.TubeGeometry(new Helix(0.055, 0.24, 6), 160, 0.011, 8, false);
  wheels.forEach(([x, z]) => {
    const zi = z - Math.sign(z) * 0.14;
    add(g, spring, [x, WR + 0.16, zi]);
    add(g, new THREE.CylinderGeometry(0.022, 0.022, 0.3, 12), [x, WR + 0.28, zi]);
    add(g, new THREE.BoxGeometry(0.34, 0.03, 0.05), [x, WR + 0.02, z - Math.sign(z) * 0.3], [0, Math.sign(z) * 1.2, 0]);
  });

  // cooling: radiator, fan, hoses
  g = group('cooling');
  add(g, new THREE.BoxGeometry(0.05, 0.34, 0.9), [-1.5, 0.42, 0]);
  add(g, new THREE.CylinderGeometry(0.15, 0.15, 0.03, 32), [-1.42, 0.42, 0], [0, 0, Math.PI / 2]);
  add(g, tube([[-1.48, 0.56, 0.22], [-1.25, 0.6, 0.15], [-1.03, 0.58, 0.08]], 0.025), [0, 0, 0]);
  add(g, tube([[-1.48, 0.28, -0.22], [-1.25, 0.3, -0.15], [-1.03, 0.36, -0.08]], 0.025), [0, 0, 0]);

  // electrical: boot-mounted battery, main cable, alternator
  g = group('electrical');
  add(g, new THREE.BoxGeometry(0.3, 0.2, 0.18), [1.35, 0.52, -0.35]);
  add(g, tube([[1.3, 0.48, -0.35], [1.0, 0.2, -0.45], [-0.3, 0.2, -0.45], [-0.95, 0.5, -0.22]], 0.012), [0, 0, 0]);
  add(g, new THREE.CylinderGeometry(0.065, 0.065, 0.09, 24), [-1.0, 0.56, 0.2], [0, 0, Math.PI / 2]);

  // exhaust: twin pipes, cats, silencers, tips
  g = group('exhaust');
  [0.3, -0.3].forEach((z) => {
    add(g, tube([[-0.85, 0.45, z], [-0.6, 0.18, z * 1.05], [0, 0.15, z], [1.1, 0.16, z], [1.72, 0.22, z * 1.4]], 0.032), [0, 0, 0]);
    add(g, new THREE.CylinderGeometry(0.06, 0.06, 0.22, 24), [-0.25, 0.15, z], [0, 0, Math.PI / 2]);
    add(g, new THREE.BoxGeometry(0.42, 0.1, 0.17), [1.25, 0.17, z * 1.15]);
  });

  // tyres
  g = group('tyres');
  const tyre = new THREE.TorusGeometry(WR - 0.05, 0.075, 16, 64);
  wheels.forEach(([x, z]) => add(g, tyre, [x, WR, z]));

  /* ---- x-ray shell: fresnel edges in ink ---- */
  const xrayMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(INK) }, uOpacity: { value: 0 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
        gl_FragColor = vec4(uColor, (0.03 + f * 0.6) * uOpacity);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide
  });

  let solidMats = [];
  let loaded = false;
  carSource.then((src) => {
    const solid = upgradePaint(normalisedCar(src, true), renderer);
    solid.traverse((o) => { if (o.isMesh) solidMats.push(o.material); });
    scene.add(solid);
    const ghost = normalisedCar(src, false);
    ghost.traverse((o) => { if (o.isMesh) { o.material = xrayMat; o.castShadow = false; o.receiveShadow = false; o.renderOrder = 2; } });
    scene.add(ghost);
    loaded = true;
  });

  /* ---- pins ---- */
  const names = Object.fromEntries((window.anatomySystems || []).map((s) => [s.id, s.name]));
  const pinSet = makePins(pinsEl, Object.keys(PIN_AT).map((id) => ({ id, name: names[id] || id, anchor: PIN_AT[id] })),
    (id) => window.anatomySelect && window.anatomySelect(id));

  /* ---- state + transitions ---- */
  let active = window.anatomyCurrent || 'overview';
  const camGoal = new THREE.Vector3(), atGoal = new THREE.Vector3(), at = new THREE.Vector3();
  function setGoal(id, snap) {
    const v = VIEWS[id] || VIEWS.overview;
    camGoal.set(...v.cam); atGoal.set(...v.at);
    if (snap) { camera.position.copy(camGoal); at.copy(atGoal); }
  }
  setGoal(active, true);
  pinSet.setActive(active);
  window.addEventListener('anatomy:select', (e) => {
    active = e.detail;
    setGoal(active, reduceMotion);
    pinSet.setActive(active);
  });

  let xray = 0;
  const signal = new THREE.Color(SIGNAL), ink = new THREE.Color(INK);
  fit(renderer, camera, stage);
  new ResizeObserver(() => fit(renderer, camera, stage)).observe(stage);

  let last = performance.now();
  loopWhileVisible(stage, (t) => {
    // frame-rate independent easing: ~95% of the way in about a second
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 3.2);
    camera.position.lerp(camGoal, k);
    at.lerp(atGoal, k);
    camera.lookAt(at);

    xray += ((active === 'overview' ? 0 : 1) - xray) * (reduceMotion ? 1 : 1 - Math.exp(-dt * 4));
    const km = reduceMotion ? 1 : 1 - Math.exp(-dt * 6);
    solidMats.forEach((m) => {
      m.transparent = xray > 0.01;
      m.opacity = 1 - xray * 0.97;
      m.depthWrite = xray < 0.5;
    });
    xrayMat.uniforms.uOpacity.value = xray;
    Object.entries(groups).forEach(([id, grp]) => {
      const on = id === active;
      const m = grp.userData.mat;
      m.color.lerp(on ? signal : ink, km);
      m.emissive.copy(on ? signal : ink).multiplyScalar(on ? 0.35 : 0);
      m.opacity += ((on ? 1 : 0.22) * xray - m.opacity) * km;
      m.depthWrite = on && xray > 0.5;
      grp.visible = m.opacity > 0.01;
    });

    pinSet.update(camera, stage.clientWidth, stage.clientHeight, loaded);
    renderer.render(scene, camera);
  });
})();

/* =====================================================================
   3. Engine cutaway with clickable parts
   ===================================================================== */
(function engineCutaway() {
  const stage = document.getElementById('engineStage');
  const canvas = document.getElementById('engineCanvas');
  const pinsEl = document.getElementById('enginePins');
  const partBody = document.getElementById('partBody');
  if (!stage || !canvas) return;
  let renderer;
  try { renderer = makeRenderer(canvas); } catch { return; }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMappingExposure = 0.9;

  const scene = new THREE.Scene();
  scene.environment = studioEnv(renderer);
  scene.background = (() => {           // soft studio backdrop, opaque so bloom composites cleanly
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(256, 200, 20, 256, 256, 380);
    grd.addColorStop(0, '#26262b'); grd.addColorStop(1, '#0e0e10');
    g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const target = new THREE.Vector3(0, 1.62, 0);
  camera.position.set(2.3, 2.7, 11.6);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1a1e, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3.5, 7, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 5, bottom: -2, near: 1, far: 25 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff6a3d, 0.5);
  rim.position.set(-5, 3, -4);
  scene.add(rim);

  /* ---------- dimensions (scene units; bore = 1.0) ---------- */
  const R = 0.45;              // crank throw (stroke 0.9)
  const L = 1.5;               // con-rod centres
  const BORE = 0.5, SLEEVE = 0.57, JACKET = 0.66, S = 0.8;   // radii / block half-width
  const DECK = 0.8;            // bottom of the cylinder block
  const HEAD_Y = 2.45, HEAD_H = 0.5, ROOF = 0.18;            // pent-roof chamber rises ROOF at the centre
  const TILT = Math.atan(ROOF / BORE);                      // valves sit square to the roof slopes
  const VX = 0.22;                                          // valve seat offset from centre
  const STEM = 1.05, BUCKET = 0.1, R0 = 0.14, LIFT = 0.13;  // valvetrain
  const ZB = -0.98;                                         // timing-belt plane (behind the block)
  const roofY = (x) => HEAD_Y + ROOF * (1 - Math.min(1, Math.abs(x) / BORE));

  /* ---------- materials ---------- */
  const noiseTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const img = g.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 110 + Math.random() * 110;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 3);
    return t;
  })();
  const cast = new THREE.MeshStandardMaterial({ color: 0x8c8f95, metalness: 0.7, roughness: 0.62, bumpMap: noiseTex, bumpScale: 0.6, roughnessMap: noiseTex });
  const castHead = cast.clone(); castHead.color.setHex(0x9a9da2);
  const honed = new THREE.MeshStandardMaterial({ color: 0xa9adb4, metalness: 1, roughness: 0.26, side: THREE.DoubleSide });
  const section = new THREE.MeshStandardMaterial({ color: 0xd8522a, metalness: 0.15, roughness: 0.55, side: THREE.DoubleSide });
  const coolant = new THREE.MeshStandardMaterial({ color: 0x1fa79a, metalness: 0, roughness: 0.2, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  const forged = new THREE.MeshStandardMaterial({ color: 0x7c7f86, metalness: 1, roughness: 0.4 });
  const polished = new THREE.MeshStandardMaterial({ color: 0xcfd2d8, metalness: 1, roughness: 0.13 });
  const alloy = new THREE.MeshStandardMaterial({ color: 0xd4d4d2, metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x202024, metalness: 0.6, roughness: 0.45 });
  const ceramic = new THREE.MeshStandardMaterial({ color: 0xf1eee7, metalness: 0, roughness: 0.3 });
  const portDark = new THREE.MeshBasicMaterial({ color: 0x0a0a0b });
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x3a3b40, metalness: 0.9, roughness: 0.35, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
  const headerMat = new THREE.MeshStandardMaterial({ color: 0x6b4a3a, metalness: 0.9, roughness: 0.4, emissive: 0x7a2a0a, emissiveIntensity: 0.08, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });

  [cast, castHead, section, dark, ceramic].forEach((m) => { m.envMapIntensity = 0.55; });
  [honed, forged, polished, alloy].forEach((m) => { m.envMapIntensity = 0.85; });   // bare metal needs reflections to read as metal
  const engine = new THREE.Group();
  scene.add(engine);
  const put = (geo, mat, parent = engine, pos, rot) => {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    parent.add(m);
    return m;
  };
  // vertical extrusion of an XZ-plane shape; shape (X, Y) → world (X, −Y), so shape Y ≥ 0 is the back half (z ≤ 0)
  const extrudeY = (shape, h, y0) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 64 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y0, 0);
    return g;
  };
  // extrusion of an XY-plane section backwards from z = 0 to z = −depth; caps (group 0) are the section faces
  const extrudeBack = (shape, depth) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 64 });
    g.translate(0, 0, -depth);
    return g;
  };
  // a section-face strip on the z = 0 plane
  const face = (x0, x1, y0, y1, mat) => put(new THREE.PlaneGeometry(x1 - x0, y1 - y0), mat, engine, [(x0 + x1) / 2, (y0 + y1) / 2, 0.002]);

  /* ---------- cylinder block: back half, with sleeve and coolant jacket ---------- */
  const halfBlock = (s, r) => {
    const sh = new THREE.Shape();
    sh.moveTo(s, 0); sh.lineTo(s, s); sh.lineTo(-s, s); sh.lineTo(-s, 0); sh.lineTo(-r, 0);
    sh.absarc(0, 0, r, Math.PI, 0, true);
    sh.lineTo(s, 0);
    return sh;
  };
  const halfRing = (r1, r2) => {
    const sh = new THREE.Shape();
    sh.moveTo(r1, 0); sh.lineTo(r2, 0);
    sh.absarc(0, 0, r2, 0, Math.PI, false);
    sh.lineTo(-r1, 0);
    sh.absarc(0, 0, r1, Math.PI, 0, true);
    return sh;
  };
  const blockH = HEAD_Y - DECK;
  put(extrudeY(halfBlock(S, JACKET), blockH, DECK), cast);
  put(extrudeY(halfRing(BORE, SLEEVE), blockH, DECK), honed);
  put(extrudeY(halfRing(SLEEVE, JACKET), blockH - 0.12, DECK + 0.06), coolant);
  [[-S, -JACKET], [JACKET, S], [-SLEEVE, -BORE], [BORE, SLEEVE]].forEach(([a, b]) => face(a, b, DECK, HEAD_Y, section));
  [[-JACKET, -SLEEVE], [SLEEVE, JACKET]].forEach(([a, b]) => face(a, b, DECK + 0.06, HEAD_Y - 0.06, coolant));

  /* ---------- crankcase: U-shaped section around the crank ---------- */
  {
    const a1 = Math.asin(0.52 / 0.74);
    const sh = new THREE.Shape();
    sh.moveTo(S, DECK); sh.lineTo(S, -0.9); sh.lineTo(-S, -0.9); sh.lineTo(-S, DECK); sh.lineTo(-0.52, DECK);
    sh.lineTo(-0.52, Math.cos(a1) * 0.74);
    sh.absarc(0, 0, 0.74, Math.PI / 2 + a1, Math.PI * 2.5 - a1, false);
    sh.lineTo(0.52, DECK);
    sh.lineTo(S, DECK);
    put(extrudeBack(sh, S), [section, cast]);
  }

  /* ---------- cylinder head: pent-roof section with ports ---------- */
  {
    const sh = new THREE.Shape();
    sh.moveTo(-S, HEAD_Y); sh.lineTo(-BORE, HEAD_Y); sh.lineTo(0, HEAD_Y + ROOF); sh.lineTo(BORE, HEAD_Y);
    sh.lineTo(S, HEAD_Y); sh.lineTo(S, HEAD_Y + HEAD_H); sh.lineTo(-S, HEAD_Y + HEAD_H); sh.lineTo(-S, HEAD_Y);
    put(extrudeBack(sh, S), [section, castHead]);
  }
  // port channels drawn on the section face (dark = hollow passage)
  function channel(pts, w0, w1) {
    const curve = new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const n = 32, left = [], right = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, p = curve.getPoint(t), d = curve.getTangent(t);
      const w = (w0 + (w1 - w0) * t) / 2;
      left.push(new THREE.Vector2(p.x - d.y * w, p.y + d.x * w));
      right.push(new THREE.Vector2(p.x + d.y * w, p.y - d.x * w));
    }
    return new THREE.Shape([...left, ...right.reverse()]);
  }
  const seatY = roofY(VX);
  const inPort = [[-S - 0.01, HEAD_Y + 0.36], [-0.56, HEAD_Y + 0.33], [-0.34, HEAD_Y + 0.22], [-VX - 0.02, seatY + 0.02]];
  const exPort = [[VX + 0.02, seatY + 0.02], [0.34, HEAD_Y + 0.22], [0.56, HEAD_Y + 0.33], [S + 0.01, HEAD_Y + 0.36]];
  put(new THREE.ShapeGeometry(channel(inPort, 0.17, 0.27)), portDark, engine, [0, 0, 0.004]);
  put(new THREE.ShapeGeometry(channel(exPort, 0.27, 0.17)), portDark, engine, [0, 0, 0.004]);
  // manifolds outside the head (semi-transparent so the flow stays visible)
  const tubeAlong = (pts, r, mat) => put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 40, r, 20, false), mat);
  tubeAlong([[-S - 0.75, HEAD_Y + 0.5, 0], [-S - 0.35, HEAD_Y + 0.4, 0], [-S, HEAD_Y + 0.36, 0]], 0.1, pipeMat);
  tubeAlong([[S, HEAD_Y + 0.36, 0], [S + 0.35, HEAD_Y + 0.38, 0], [S + 0.7, HEAD_Y + 0.2, 0]], 0.1, headerMat);

  /* ---------- valve timing (crank degrees, 0 = TDC at start of intake) ---------- */
  const DUR = 240;
  const lobe = (phi, open) => { const t = (((phi - open) % 720) + 720) % 720 / DUR; return t < 1 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * t) : 0; };
  const IN_OPEN = 700;   // opens 20° BTDC, closes 40° ABDC
  const EX_OPEN = 500;   // opens 40° BBDC, closes 20° ATDC (overlap with intake around TDC)

  /* ---------- valvetrain: valves, springs, buckets, cams ---------- */
  const valvesGroup = new THREE.Group(); engine.add(valvesGroup);
  const camGroup = new THREE.Group(); engine.add(camGroup);
  class Helix extends THREE.Curve {
    constructor(r, h, turns) { super(); this.r = r; this.h = h; this.turns = turns; }
    getPoint(t, out = new THREE.Vector3()) { const a = t * this.turns * Math.PI * 2; return out.set(Math.cos(a) * this.r, t * this.h, Math.sin(a) * this.r); }
  }
  const SPRING_BASE = (HEAD_H - (seatY - HEAD_Y)) / Math.cos(TILT) + 0.02, RETAINER = STEM - 0.12;
  const SPRING_LEN = RETAINER - SPRING_BASE;
  const springGeo = new THREE.TubeGeometry(new Helix(0.085, SPRING_LEN, 7), 220, 0.013, 8, false);
  const valveHead = new THREE.LatheGeometry([[0, 0], [0.17, 0], [0.17, 0.018], [0.11, 0.05], [0.05, 0.12], [0.03, 0.2]].map(([x, y]) => new THREE.Vector2(x, y)), 48);

  function makeValve(side, open) {           // side −1 = intake, +1 = exhaust
    const alpha = -side * TILT;              // rotating +Y by α gives (−sin α, cos α)
    const u = new THREE.Vector2(-Math.sin(alpha), Math.cos(alpha));
    const seat = new THREE.Vector2(side * VX, seatY);
    const v = new THREE.Group();
    put(valveHead, polished, v);
    put(new THREE.CylinderGeometry(0.03, 0.03, STEM, 16), polished, v, [0, STEM / 2, 0]);
    put(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 32), forged, v, [0, RETAINER, 0]);
    put(new THREE.CylinderGeometry(0.1, 0.1, BUCKET, 32), polished, v, [0, STEM + BUCKET / 2, 0]);
    v.rotation.z = alpha;
    valvesGroup.add(v);
    const sp = new THREE.Group();
    const spring = put(springGeo, forged, sp, [0, SPRING_BASE, 0]);
    sp.position.set(seat.x, seat.y, 0);
    sp.rotation.z = alpha;
    valvesGroup.add(sp);
    // cam lobe: base circle R0 plus the lift profile, mapped so that the angle facing the bucket gives the valve lift
    const camC = seat.clone().addScaledVector(u, STEM + BUCKET + R0);
    const gamma = Math.atan2(-u.y, -u.x);
    const pts = [];
    for (let i = 0; i < 180; i++) {
      const beta = (i / 180) * Math.PI * 2;
      const phi = ((((beta - gamma) * 2) * 180 / Math.PI) % 720 + 720) % 720;  // cam turns at half crank speed
      const r = R0 + LIFT * lobe(phi, open);
      pts.push(new THREE.Vector2(Math.cos(beta) * r, Math.sin(beta) * r));
    }
    const lobeGeo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.14, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 });
    lobeGeo.translate(0, 0, -0.07);
    const cam = new THREE.Group();
    put(lobeGeo, polished, cam);
    put(new THREE.CylinderGeometry(0.06, 0.06, 1.15, 24), forged, cam, [0, 0, -0.5], [Math.PI / 2, 0, 0]);
    // cam pulley (2× crank pulley → half speed) with a timing mark
    put(new THREE.CylinderGeometry(0.32, 0.32, 0.12, 64), dark, cam, [0, 0, ZB], [Math.PI / 2, 0, 0]);
    put(new THREE.CylinderGeometry(0.1, 0.1, 0.13, 32), forged, cam, [0, 0, ZB], [Math.PI / 2, 0, 0]);
    put(new THREE.BoxGeometry(0.05, 0.08, 0.13), section, cam, [0, 0.27, ZB]);
    cam.position.set(camC.x, camC.y, 0);
    camGroup.add(cam);
    return { v, spring, u, seat, cam, camC, open };
  }
  const vIn = makeValve(-1, IN_OPEN);
  const vEx = makeValve(1, EX_OPEN);

  /* ---------- spark plug ---------- */
  const plug = new THREE.Group();
  const plugTop = HEAD_Y + HEAD_H;
  put(new THREE.CylinderGeometry(0.05, 0.05, HEAD_H - ROOF + 0.02, 24), forged, plug, [0, HEAD_Y + ROOF + (HEAD_H - ROOF) / 2, 0]);
  put(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 6), polished, plug, [0, plugTop + 0.05, 0]);
  put(new THREE.CylinderGeometry(0.055, 0.07, 0.36, 32), ceramic, plug, [0, plugTop + 0.28, 0]);
  put(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 16), polished, plug, [0, plugTop + 0.5, 0]);
  put(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8), polished, plug, [0, HEAD_Y + ROOF - 0.02, 0]);
  engine.add(plug);
  const SPARK_POS = new THREE.Vector3(0, HEAD_Y + ROOF - 0.05, 0);
  const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.9, 1.4), transparent: true, opacity: 0, depthWrite: false });
  const spark = put(new THREE.SphereGeometry(0.045, 16, 12), sparkMat, engine, SPARK_POS.toArray());
  const fire = new THREE.PointLight(0xff6a2a, 0, 1.4, 2);
  fire.position.set(0, HEAD_Y, 0.2);
  engine.add(fire);

  /* ---------- combustion gas: section view of the charge, with a propagating flame front ---------- */
  const gasMat = new THREE.ShaderMaterial({
    uniforms: {
      uFresh: { value: 0 }, uDense: { value: 0 }, uFlameR: { value: 0 }, uFront: { value: 0 },
      uBurn: { value: 0 }, uExh: { value: 0 }, uTime: { value: 0 },
      uSpark: { value: SPARK_POS }, uRoofY: { value: HEAD_Y }, uRoofH: { value: ROOF }, uBore: { value: BORE }
    },
    vertexShader: `
      varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform float uFresh, uDense, uFlameR, uFront, uBurn, uExh, uTime, uRoofY, uRoofH, uBore;
      uniform vec3 uSpark;
      varying vec3 vW;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x) {
        vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      void main() {
        if (vW.y > uRoofY + uRoofH * (1.0 - min(1.0, abs(vW.x) / uBore))) discard;   // stay under the pent roof
        float n = noise(vW * 7.0 + vec3(0.0, uTime * 0.7, uTime * 0.35));
        float n2 = noise(vW * 16.0 - uTime * 1.1);
        vec3 col = vec3(0.0); float a = 0.0;
        float fresh = uFresh * (0.10 + 0.16 * uDense) * (0.55 + 0.9 * n);         // swirling fuel-air charge
        col += vec3(0.55, 0.68, 1.0) * fresh; a += fresh;
        float d = distance(vW, uSpark) + (n - 0.5) * 0.14;                        // wrinkled flame front
        float inside = (1.0 - smoothstep(uFlameR - 0.1, uFlameR, d)) * step(0.001, uFlameR);
        vec3 hot = mix(vec3(1.0, 0.26, 0.04), vec3(1.0, 0.72, 0.32), n2) * (0.55 + 0.75 * uBurn);
        col = mix(col, hot, inside * uBurn);
        a = mix(a, (0.32 + 0.3 * n) * uBurn, inside);
        float edge = exp(-pow((d - uFlameR) / 0.045, 2.0)) * uFront;             // thin blue reaction zone
        col += vec3(0.45, 0.62, 1.1) * edge * 1.2; a += edge * 0.5;
        col = mix(col, vec3(0.42, 0.4, 0.38) * (0.6 + 0.7 * n), uExh);            // exhaust haze
        a = max(a, uExh * (0.2 + 0.28 * n));
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.95));
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide
  });
  const gas = new THREE.Group();
  put(new THREE.CylinderGeometry(BORE - 0.004, BORE - 0.004, 1, 64, 1, false, Math.PI / 2, Math.PI), gasMat, gas, [0, 0.5, 0]);
  put(new THREE.PlaneGeometry((BORE - 0.004) * 2, 1), gasMat, gas, [0, 0.5, 0.003]);
  engine.add(gas);

  /* ---------- piston: turned profile, sectioned ---------- */
  const piston = new THREE.Group();
  const prof = [[0, 0.405], [0.3, 0.415], [0.455, 0.42], [0.482, 0.405], [0.485, 0.385],
    [0.485, 0.36], [0.468, 0.36], [0.468, 0.335], [0.485, 0.335],
    [0.485, 0.3], [0.468, 0.3], [0.468, 0.275], [0.485, 0.275],
    [0.485, 0.24], [0.468, 0.24], [0.468, 0.21], [0.485, 0.21],
    [0.485, -0.12], [0.475, -0.18], [0.44, -0.18], [0.44, 0.14], [0.4, 0.2], [0, 0.22]];
  put(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 96, Math.PI / 2, Math.PI), alloy, piston);
  put(new THREE.ShapeGeometry(new THREE.Shape([...prof.map(([x, y]) => new THREE.Vector2(x, y)), ...prof.slice(1, -1).reverse().map(([x, y]) => new THREE.Vector2(-x, y))])), section, piston, [0, 0, 0.002]);
  [0.3475, 0.2875, 0.225].forEach((y, i) => {
    put(new THREE.TorusGeometry(0.477, i === 2 ? 0.014 : 0.011, 8, 64, Math.PI), i === 2 ? dark : forged, piston, [0, y, 0], [-Math.PI / 2, 0, 0]);
  });
  put(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 32), polished, piston, [0, 0, -0.21], [Math.PI / 2, 0, 0]);
  put(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 32), alloy, piston, [0, 0, -0.38], [Math.PI / 2, 0, 0]);
  engine.add(piston);

  /* ---------- connecting rod: I-beam outline with bolted big-end cap ---------- */
  const rod = new THREE.Group();
  {
    const sh = new THREE.Shape();
    sh.moveTo(0.06, 0.104);
    sh.absarc(0, 0, 0.12, Math.PI / 3, (2 * Math.PI) / 3, true);
    const aL = Math.atan2(-0.19, -0.09), aR = Math.atan2(-0.19, 0.09);
    sh.lineTo(-0.09, L - 0.19);
    sh.absarc(0, L, 0.21, aL, aR, true);
    sh.lineTo(0.06, 0.104);
    const small = new THREE.Path(); small.absarc(0, 0, 0.068, 0, Math.PI * 2, true);
    const big = new THREE.Path(); big.absarc(0, L, 0.112, 0, Math.PI * 2, true);
    sh.holes.push(small, big);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 3, curveSegments: 48 });
    g.translate(0, 0, -0.04);
    put(g, forged, rod);
    put(new THREE.BoxGeometry(0.07, L - 0.42, 0.11), forged, rod, [0, L / 2 - 0.02, 0]);            // I-beam flange
    put(new THREE.BoxGeometry(0.44, 0.012, 0.115), dark, rod, [0, L, 0]);                           // cap split line
    [-0.165, 0.165].forEach((x) => {
      put(new THREE.CylinderGeometry(0.028, 0.028, 0.32, 16), polished, rod, [x, L + 0.02, 0]);
      put(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 6), polished, rod, [x, L + 0.19, 0]);
    });
  }
  engine.add(rod);

  /* ---------- crankshaft: journals, counterweighted webs, crank pulley ---------- */
  const crank = new THREE.Group();
  put(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 48), polished, crank, [0, 0, -0.35], [Math.PI / 2, 0, 0]);
  put(new THREE.CylinderGeometry(0.105, 0.105, 0.3, 48), polished, crank, [0, R, 0], [Math.PI / 2, 0, 0]);
  {
    const sh = new THREE.Shape();
    sh.moveTo(-0.17, R);
    sh.absarc(0, R, 0.17, Math.PI, 0, true);
    sh.lineTo(0.6, -0.02);
    sh.absarc(0, 0, 0.6, -0.02, Math.PI + 0.02, true);
    sh.lineTo(-0.17, R);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.11, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 3, curveSegments: 48 });
    g.translate(0, 0, -0.055);
    [-0.165, 0.165].forEach((z) => put(g, forged, crank, [0, 0, z]));
  }
  put(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 48), dark, crank, [0, 0, ZB], [Math.PI / 2, 0, 0]);
  put(new THREE.BoxGeometry(0.04, 0.06, 0.13), section, crank, [0, 0.13, ZB]);
  engine.add(crank);

  /* ---------- timing belt: hull around the three pulleys, teeth scroll with the crank ---------- */
  const beltTex = (() => {
    const c = document.createElement('canvas'); c.width = 32; c.height = 8;
    const g = c.getContext('2d');
    g.fillStyle = '#1b1b1d'; g.fillRect(0, 0, 32, 8);
    g.fillStyle = '#34343a'; g.fillRect(0, 0, 15, 8);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    return t;
  })();
  const PITCH = 0.07;
  beltTex.repeat.set(1 / PITCH, 1);
  {
    const circles = [[0, 0, 0.175], [vIn.camC.x, vIn.camC.y, 0.335], [vEx.camC.x, vEx.camC.y, 0.335]];
    const pts = [];
    circles.forEach(([cx, cy, r]) => { for (let i = 0; i < 72; i++) { const a = (i / 72) * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } });
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    lo.pop(); up.pop();
    const hull = lo.concat(up);
    const pos = [], uv = [], idx = [];
    let s = 0;
    for (let i = 0; i <= hull.length; i++) {
      const p = hull[i % hull.length];
      if (i > 0) { const q = hull[i - 1]; s += Math.hypot(p[0] - q[0], p[1] - q[1]); }
      pos.push(p[0], p[1], ZB - 0.055, p[0], p[1], ZB + 0.055);
      uv.push(s, 0, s, 1);
    }
    for (let i = 0; i < hull.length; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    put(g, new THREE.MeshStandardMaterial({ map: beltTex, color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }), camGroup);
  }

  /* ---------- flow particles through the ports ---------- */
  function flowLine(pts, color, size) {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, 0.03)));
    const N = 34;
    const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(size, 10, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }), N);
    engine.add(dots);
    return { curve, dots, N };
  }
  const inFlow = flowLine([[-S - 0.75, HEAD_Y + 0.5], [-S, HEAD_Y + 0.36], ...inPort.slice(1), [-0.12, HEAD_Y - 0.2]], new THREE.Color(0.62, 0.72, 1.0), 0.026);
  const exFlow = flowLine([[0.12, HEAD_Y - 0.2], ...exPort.slice(0, -1), [S, HEAD_Y + 0.36], [S + 0.7, HEAD_Y + 0.2]], new THREE.Color(0.85, 0.55, 0.4), 0.03);
  const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  function flow(f, amount, phase) {
    for (let i = 0; i < f.N; i++) {
      f.curve.getPointAt((phase + i / f.N) % 1, v3);
      sc.setScalar(Math.max(amount * (0.55 + 0.45 * Math.sin(i * 12.9898)), 0.0001));
      m4.compose(v3, q, sc);
      f.dots.setMatrixAt(i, m4);
    }
    f.dots.instanceMatrix.needsUpdate = true;
  }

  // shadows on the solid parts only
  engine.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const solid = mats.every((m) => !m.transparent && m !== portDark);
    o.castShadow = solid; o.receiveShadow = solid;
  });

  /* ---------- parts: clickable, highlighted, explained ---------- */
  const PARTS = [
    { id: 'plug', name: 'Spark plug', obj: plug, anchor: (v) => v.set(0, plugTop + 0.55, 0.06),
      what: 'Fires a spark of 20,000 volts or more just before the piston reaches the top, so the flame has time to spread.',
      wear: 'Worn plugs misfire: rough idle, hesitation, worse fuel economy.',
      care: 'New plugs roughly every 36,000 miles.' },
    { id: 'valves', name: 'Valves & springs', obj: valvesGroup, anchor: (v) => v.set(vIn.seat.x + vIn.u.x * 0.75, vIn.seat.y + vIn.u.y * 0.75, 0.12),
      what: 'Poppet valves seal the chamber. The springs snap each one shut the instant its cam lobe rolls past.',
      wear: 'Burnt or leaking valves lose compression. Worn stem seals give a puff of blue smoke on start-up.',
      care: 'A compression test, plus valve clearance checks on engines that need them.' },
    { id: 'cam', name: 'Camshafts & timing belt', obj: camGroup, anchor: (v) => v.set(vEx.camC.x, vEx.camC.y + R0 + LIFT + 0.08, 0.1),
      what: 'The cams turn at exactly half crank speed, and each lobe pushes its valve open on cue. The toothed belt keeps them in step.',
      wear: 'A stretched or cracked belt can jump a tooth or snap. On many engines that means pistons hit valves.',
      care: 'Belt and tensioner on schedule, usually every 60,000–100,000 miles or 5–10 years.' },
    { id: 'piston', name: 'Piston & rings', obj: piston, anchor: (v) => v.set(0.32, piston.position.y + 0.3, 0.3),
      what: 'Takes the punch of every combustion and passes it down the rod. Three rings seal it against the bore and scrape oil off.',
      wear: 'Worn rings burn oil (blue smoke) and lose compression, so the engine feels flat.',
      care: 'A compression or leak-down test tells us how healthy they are.' },
    { id: 'rod', name: 'Connecting rod', obj: rod, anchor: (v) => {
        const th = ((window.engineState?.phi || 0) % 360) * Math.PI / 180;
        return v.set(R * Math.sin(th) / 2, (piston.position.y + R * Math.cos(th)) / 2, 0.1);
      },
      what: 'Links the piston to the crankshaft and turns a straight push into a shove on the crank.',
      wear: 'A worn big-end bearing knocks under load, usually after the oil ran low or old.',
      care: 'Fresh oil at the right interval is what keeps these bearings alive.' },
    { id: 'crank', name: 'Crankshaft', obj: crank, anchor: (v) => v.set(-0.38, -0.32, 0.26),
      what: 'Turns up-and-down into round-and-round. The heavy counterweights balance it so the engine runs smoothly.',
      wear: 'Main-bearing wear shows up as low oil pressure and a deep knock.',
      care: 'Regular oil changes, and an oil-pressure test if the light ever flickers.' }
  ];
  PARTS.forEach((p) => p.obj.traverse((o) => { if (o.isMesh && !Array.isArray(o.material)) o.material = o.material.clone(); }));
  let activePart = null;
  function selectPart(id) {
    activePart = activePart === id ? null : id;
    pinSet.setActive(activePart);
    PARTS.forEach((p) => p.obj.traverse((o) => {
      if (!o.isMesh || !o.material.emissive) return;
      const on = p.id === activePart;
      o.material.emissive.setHex(on ? SIGNAL : 0x000000);
      o.material.emissiveIntensity = on ? 0.45 : 0;
    }));
    const p = PARTS.find((x) => x.id === activePart);
    partBody.classList.add('is-out');
    setTimeout(() => {
      partBody.innerHTML = p
        ? `<h3><em>${String(PARTS.indexOf(p) + 1).padStart(2, '0')}</em> ${p.name}</h3><p>${p.what}</p><dl><dt>Wears</dt><dd>${p.wear}</dd><dt>Care</dt><dd>${p.care}</dd></dl>`
        : '<h3>Tap a <em>+</em> to meet the parts.</h3><p>Each one has a job, a way of wearing out, and a way we look after it.</p>';
      partBody.classList.remove('is-out');
    }, reduceMotion ? 0 : 200);
  }
  const pinSet = makePins(pinsEl, PARTS, selectPart);

  /* ---------- post-processing: bloom on the spark and flame ---------- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.25, 1.1);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(Math.min(devicePixelRatio, 2));
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  new ResizeObserver(resize).observe(stage);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.enabled = finePointer;
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minPolarAngle = 0.95;
  controls.maxPolarAngle = 1.7;
  const baseAz = Math.atan2(camera.position.x, camera.position.z);
  controls.minAzimuthAngle = baseAz - 0.75;
  controls.maxAzimuthAngle = baseAz + 0.6;
  controls.update();

  /* ---------- per-frame state from the crank angle ---------- */
  const IGN = 345;   // ignition 15° before TDC
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function update(time) {
    const phi = (((window.engineState?.phi || 0) % 720) + 720) % 720;
    const th = (phi % 360) * Math.PI / 180;
    const pinY = R * Math.cos(th) + Math.sqrt(L * L - (R * Math.sin(th)) ** 2);
    const cpx = R * Math.sin(th), cpy = R * Math.cos(th);

    crank.rotation.z = -th;
    piston.position.y = pinY;
    rod.position.set(0, pinY, 0);
    rod.rotation.z = Math.atan2(-cpx, cpy - pinY);   // aim the rod's +Y at the crank pin

    // valvetrain: cams turn at half speed with the crank; lift comes from the same lobe profile
    const camRot = -(phi * Math.PI / 180) / 2;
    [vIn, vEx].forEach((vv) => {
      const lift = LIFT * lobe(phi, vv.open);
      vv.cam.rotation.z = camRot;
      vv.v.position.set(vv.seat.x - vv.u.x * lift, vv.seat.y - vv.u.y * lift, 0);
      vv.spring.scale.y = (SPRING_LEN - lift) / SPRING_LEN;
      vv.lift = lift / LIFT;
    });
    beltTex.offset.x = ((th + Math.floor(phi / 360) * Math.PI * 2) * 0.175 / PITCH) % 1;

    // chamber gas between crown and roof
    const crown = pinY + 0.42;
    const h = HEAD_Y + ROOF - crown;
    gas.position.y = crown;
    gas.scale.y = h;

    const ign = phi >= IGN && phi < 560;
    const flameR = ign ? Math.min(1, (phi - IGN) / 36) * 1.25 : 0;
    const u = gasMat.uniforms;
    u.uTime.value = time;
    u.uFlameR.value = flameR;
    u.uFront.value = ign ? 1 - ss(IGN + 30, IGN + 44, phi) : 0;
    u.uBurn.value = ign ? ss(IGN, IGN + 10, phi) * (1 - 0.8 * ss(IGN + 25, 540, phi)) * (1 - ss(530, 560, phi)) : 0;
    u.uExh.value = phi >= 500 ? ss(500, 545, phi) * 0.7 * (1 - ss(580, 720, phi)) : 0;
    u.uFresh.value = phi >= 700 ? 0.25 * ss(700, 720, phi) : phi < IGN ? Math.max(0.25, ss(0, 200, phi)) : phi < IGN + 40 ? 1 : 0;
    u.uDense.value = phi < IGN ? ss(180, 340, phi) : 1;

    const sparkOn = phi >= IGN && phi < IGN + 7 ? 1 - (phi - IGN) / 7 : 0;
    sparkMat.opacity = sparkOn;
    spark.scale.setScalar(0.8 + sparkOn * 0.6);
    fire.intensity = sparkOn * 1.5 + u.uBurn.value * 2.2;

    flow(inFlow, vIn.lift, (phi / 90) % 1);
    flow(exFlow, vEx.lift, (phi / 90) % 1);
  }

  loopWhileVisible(stage, (t) => {
    update(t / 1000);
    controls.update();
    pinSet.update(camera, stage.clientWidth, stage.clientHeight);
    composer.render();
  });
})();
