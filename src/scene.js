import {
  BoxGeometry, BufferAttribute, BufferGeometry, CapsuleGeometry, CircleGeometry, Color, DirectionalLight, DoubleSide,
  EdgesGeometry, Fog, Group, HemisphereLight, Line, LineBasicMaterial, LineDashedMaterial, LineSegments, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, PlaneGeometry, RingGeometry, Scene,
  ShadowMaterial, Shape, ShapeGeometry, SphereGeometry, TOUCH, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { mix } from './theme.js';

// The scene is in metres with the sensor at the origin, `h` m above the floor. Radar → world:
// x (positive to the sensor's right) → -X, y (forward) → +Z, height → +Y.

const V = (x, y, z) => new Vector3(x, y, z);
const TRAIL_HZ = 10;
const ZONE_HEIGHT = 1.0;      // drawn height for zones without Z limits
const BASE_FOV = 42;

// Figure per posture. Lying is the standing figure turned 90° onto the floor.
const POSES = {
  standing: { bodyY: 0.66, headY: 1.52, top: 1.65, lying: false },
  sitting: { bodyY: 0.45, headY: 1.0, top: 1.13, lying: false },
  lying: { bodyY: 0.66, headY: 1.52, top: 0.45, lying: true },
};

const ease = (s) => (s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2);

export class RadarScene {
  constructor(container) {
    this.container = container;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });   // throws without WebGL
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    container.prepend(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels';
    container.appendChild(this.labels.domElement);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(BASE_FOV, 1, 0.05, 120);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 30;
    // Don't hijack dashboard scrolling: one finger scrolls the page and the wheel only zooms with Ctrl/⌘
    // (a trackpad pinch arrives as a wheel event with Ctrl). Two fingers rotate and zoom.
    this.controls.touches = { ONE: -1, TWO: TOUCH.DOLLY_ROTATE };
    this.renderer.domElement.style.touchAction = 'pan-y';
    this._onWheel = (e) => { this.controls.enableZoom = e.ctrlKey || e.metaKey; };
    this._onPointer = (e) => { if (e.pointerType === 'touch') this.controls.enableZoom = true; };
    container.addEventListener('wheel', this._onWheel, { capture: true, passive: true });
    container.addEventListener('pointerdown', this._onPointer, { capture: true, passive: true });

    this.scene.add(new HemisphereLight(0xdfe7f5, 0x0b0d12, 1.6));
    this.sun = new DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target);

    this.staticGroup = new Group();
    this.zoneGroup = new Group();
    this.scene.add(this.staticGroup, this.zoneGroup);
    this.zoneObjs = [];
    this.zoneSig = '';
    this.lastZones = { zones: [], names: [], visible: true };

    this.bodyGeo = { standing: new CapsuleGeometry(0.17, 0.9, 6, 18), sitting: new CapsuleGeometry(0.17, 0.42, 6, 18) };
    this.headGeo = new SphereGeometry(0.13, 24, 16);
    this.targets = [0, 1, 2].map((i) => this._makeTarget(i));

    this.layout = null;
    this.theme = null;
    this.view = '3d';
    this.showTrail = true;
    this.trailSamples = 80;
    this.tween = null;
    this.running = false;
    this.trailAcc = 0;

    this.ro = new ResizeObserver(() => this._resize());
    this.ro.observe(container);
    this._resize();
  }

  // ---------- configuration ----------

  /** layout: { mount: 'wall'|'ceiling', h, range, fov (grados), label } */
  setLayout(layout) {
    const changed = JSON.stringify(layout) !== JSON.stringify(this.layout);
    this.layout = layout;
    if (changed && this.theme) {
      this._buildStatic();
      this.setView(this.view, true);
    }
  }

  setTheme(theme) {
    const first = !this.theme;
    this.theme = theme;
    for (const t of this.targets) {
      const c = new Color(theme.targets[t.i]);
      t.color.copy(c);
      t.bodyMat.color.copy(c);
      t.bodyMat.emissive.copy(c);
      t.ring.material.color.copy(c);
      t.disc.material.color.copy(c);
      t.ray.material.color.copy(c);
    }
    if (this.layout) {
      this._buildStatic();
      if (first) this.setView(this.view, true);
    }
    this.zoneSig = '';
    this.setZones(this.lastZones.zones, this.lastZones.names, this.lastZones.visible);
  }

  setTrail(seconds, visible) {
    this.trailSamples = Math.max(1, Math.round(seconds * TRAIL_HZ));
    this.showTrail = visible;
  }

  // ---------- data ----------

  /** targets: from buildFrame(); labelFor(t) returns the floating label text. */
  setTargets(targets, labelFor) {
    targets.forEach((d, i) => {
      const t = this.targets[i];
      if (!t) return;
      const was = t.present;
      t.present = d.present;
      if (!d.present) return;
      t.goal.set(-d.x, 0, d.y);
      if (!was || t.presence < 0.05) t.pos.copy(t.goal);
      this._applyPose(t, d.posture);
      t.aimY = d.z === null ? 1.1 : Math.min(2.2, Math.max(0.2, d.z));
      t.info.textContent = labelFor(d);
    });
  }

  /** zones: from buildFrame(); names: label text for each zone. */
  setZones(zones, names, visible) {
    this.lastZones = { zones, names, visible };
    this.zoneGroup.visible = visible;
    if (!this.theme) return;
    const sig = JSON.stringify([zones.map((z) => [z.kind, z.x1, z.x2, z.y1, z.y2, z.z1, z.z2]), names]);
    if (sig !== this.zoneSig) {
      this.zoneSig = sig;
      this._buildZones(zones, names);
    }
    zones.forEach((z, i) => {
      if (this.zoneObjs[i]) this.zoneObjs[i].on = z.kind === 'detection' && z.occupied ? 1 : 0;
    });
  }

  setHighlight(i, on) {
    if (this.targets[i]) this.targets[i].hover = on;
  }

  // ---------- camera ----------

  setView(name, instant = false) {
    this.view = name;
    if (!this.layout) return;
    const p = this._pose(name);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (instant || reduced) {
      this.tween = null;
      this.camera.position.copy(p.pos);
      this.camera.fov = p.fov;
      this.camera.updateProjectionMatrix();
      this.controls.target.copy(p.target);
      this.controls.enabled = true;
      this.controls.update();
      return;
    }
    this.tween = {
      t0: performance.now(), dur: 900, ...p,
      fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone(), fromFov: this.camera.fov,
    };
    this.controls.enabled = false;
  }

  _extent() {
    const { mount, h, range } = this.layout;
    const half = (this.layout.fov / 2) * Math.PI / 180;
    if (mount === 'ceiling') {
      const r = half >= Math.PI / 2 - 0.01 ? range : Math.min(range, h * Math.tan(half));
      return { half, r, xSpan: 2 * r, zSpan: 2 * r, center: V(0, 0, 0) };
    }
    const rx = half >= Math.PI / 2 ? range : range * Math.sin(half);
    return { half, r: range, rx, xSpan: 2 * rx, zSpan: range, center: V(0, 0, range / 2) };
  }

  _pose(name) {
    const { mount, h } = this.layout;
    const e = this._extent();
    const t = Math.tan((BASE_FOV / 2) * Math.PI / 180);
    const aspect = this.camera.aspect || 1.6;
    const planD = Math.max((e.zSpan / 2 + 0.6) / t, (e.xSpan / 2 + 0.6) / (t * aspect));

    if (name === 'plan') return { pos: e.center.clone().add(V(0, planD, -0.01)), target: e.center.clone(), fov: BASE_FOV };
    if (name === 'sensor') {
      return mount === 'ceiling'
        ? { pos: V(0, h - 0.05, -0.02), target: V(0, 0, 0), fov: 100 }
        : { pos: V(0, h + 0.05, 0.15), target: V(0, 0.8, e.r * 0.55), fov: 70 };
    }
    const dir = mount === 'ceiling' ? V(-0.55, 0.68, -0.48) : V(-0.32, 0.62, -0.72);
    const target = e.center.clone().add(V(0, 0.3, 0));
    return { pos: target.clone().add(dir.normalize().multiplyScalar(planD * 0.95)), target, fov: BASE_FOV };
  }

  // ---------- lifecycle ----------

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this._frame();
    };
    loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose() {
    this.stop();
    this.ro.disconnect();
    this.container.removeEventListener('wheel', this._onWheel, { capture: true });
    this.container.removeEventListener('pointerdown', this._onPointer, { capture: true });
    this.controls.dispose();
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) [].concat(o.material).forEach((m) => m.dispose());
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }

  _resize() {
    const w = this.container.clientWidth, hgt = this.container.clientHeight;
    if (!w || !hgt) return;
    this.renderer.setSize(w, hgt);
    this.labels.setSize(w, hgt);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
  }

  // ---------- building ----------

  _makeTarget(i) {
    const color = new Color('#888888');
    const g = new Group();
    const pivot = new Group();
    const bodyMat = new MeshStandardMaterial({ color, roughness: 0.5, emissive: color, emissiveIntensity: 0.2, transparent: true });
    const body = new Mesh(this.bodyGeo.standing, bodyMat);
    const head = new Mesh(this.headGeo, bodyMat);
    body.castShadow = head.castShadow = true;
    pivot.add(body, head);
    const ring = flat(new RingGeometry(0.27, 0.33, 48), color, 0.9, 0.012);
    const disc = flat(new CircleGeometry(0.27, 48), color, 0.14, 0.011);
    const el = document.createElement('div');
    el.className = 'tag';
    el.innerHTML = `<i></i><b>T${i + 1}</b><span></span>`;
    const label = new CSS2DObject(el);
    g.add(pivot, ring, disc, label);
    g.visible = false;
    this.scene.add(g);

    const ray = new Line(new BufferGeometry().setFromPoints([V(0, 0, 0), V(0, 1, 1)]),
      new LineDashedMaterial({ color, dashSize: 0.12, gapSize: 0.09, transparent: true, opacity: 0.5 }));
    ray.visible = false;
    this.scene.add(ray);

    const trailGeo = new BufferGeometry();
    trailGeo.setAttribute('position', new BufferAttribute(new Float32Array(600 * 3), 3));
    trailGeo.setAttribute('color', new BufferAttribute(new Float32Array(600 * 3), 3));
    trailGeo.setDrawRange(0, 0);
    const trail = new Line(trailGeo, new LineBasicMaterial({ vertexColors: true }));
    this.scene.add(trail);

    const t = {
      i, color, g, pivot, body, head, bodyMat, ring, disc, el, label, info: el.querySelector('span'), dot: el.querySelector('i'),
      ray, trail, trailGeo, hist: [], goal: V(0, 0, 0), pos: V(0, 0, 0), aimY: 1.1,
      present: false, presence: 0, hover: false, hl: 0, pose: null,
    };
    this._applyPose(t, 'standing');
    return t;
  }

  _applyPose(t, posture) {
    const p = POSES[posture] ?? POSES.standing;
    if (t.pose === p) return;
    t.pose = p;
    t.body.geometry = posture === 'sitting' ? this.bodyGeo.sitting : this.bodyGeo.standing;
    t.body.position.y = p.bodyY;
    t.head.position.y = p.headY;
    t.pivot.rotation.z = p.lying ? Math.PI / 2 : 0;
    t.pivot.position.set(p.lying ? 0.82 : 0, p.lying ? 0.2 : 0, 0);
    t.label.position.set(0, p.top + 0.3, 0);
  }

  _buildStatic() {
    clearGroup(this.staticGroup);
    const g = this.staticGroup;
    const th = this.theme;
    const { mount, h } = this.layout;
    const e = this._extent();
    const floorCol = mix(th.bg, th.fg, th.dark ? 0.045 : 0.035);
    const gridCol = mix(th.bg, th.fg, th.dark ? 0.11 : 0.1);
    const reach = Math.max(e.xSpan, e.zSpan);

    for (const t of this.targets) t.dot.style.background = th.targets[t.i];
    this.scene.fog = new Fog(th.bg, reach * 2.2, reach * 4.5);
    this.sun.position.set(-3, 9, mount === 'ceiling' ? -1 : 1);
    this.sun.target.position.copy(e.center);
    Object.assign(this.sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 30 });
    this.sun.shadow.camera.updateProjectionMatrix();

    const ground = new Mesh(new PlaneGeometry(80, 80), new MeshBasicMaterial({ color: floorCol }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.copy(e.center);
    const catcher = new Mesh(new PlaneGeometry(80, 80), new ShadowMaterial({ opacity: th.dark ? 0.4 : 0.18 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.copy(e.center).setY(0.001);
    catcher.receiveShadow = true;
    g.add(ground, catcher);

    // 1 m grid
    const gx = Math.ceil(e.xSpan / 2), z0 = mount === 'ceiling' ? -Math.ceil(e.zSpan / 2) : 0;
    const z1 = mount === 'ceiling' ? Math.ceil(e.zSpan / 2) : Math.ceil(e.zSpan);
    const grid = [];
    for (let x = -gx; x <= gx; x++) grid.push(V(x, 0.002, z0), V(x, 0.002, z1));
    for (let z = z0; z <= z1; z++) grid.push(V(-gx, 0.002, z), V(gx, 0.002, z));
    g.add(segments(grid, gridCol, 1));

    const sensorEye = V(0, h, 0);
    const housing = new Mesh(new BoxGeometry(0.18, 0.11, 0.05), new MeshStandardMaterial({ color: mix(th.bg, th.fg, 0.25), roughness: 0.6 }));
    const lens = new Mesh(new PlaneGeometry(0.11, 0.055), new MeshBasicMaterial({ color: th.accent, side: DoubleSide }));
    const sensor = new Group();
    sensor.add(housing, lens);
    sensor.position.copy(sensorEye);
    housing.castShadow = true;

    if (mount === 'ceiling') {
      const r = e.r;
      housing.rotation.x = Math.PI / 2;
      lens.rotation.x = Math.PI / 2;
      lens.position.y = -0.03;
      g.add(flat(new CircleGeometry(r, 96), th.accent, 0.06, 0.004));
      g.add(line(circlePts(r, 0.005), th.accent, 0.55));
      for (let k = 1; k < r; k++) g.add(line(circlePts(k, 0.005), th.accent, k % 2 ? 0.1 : 0.22));
      for (let k = 2; k < r; k += 2) g.add(label(`${k} m`, 'axis', V(-k * 0.71 - 0.15, 0.02, -k * 0.71 - 0.15)));
      const beam = [];
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) beam.push(sensorEye, V(Math.sin(a) * r, 0, Math.cos(a) * r));
      g.add(segments(beam, th.accent, 0.16));
      const plumb = new Line(new BufferGeometry().setFromPoints([sensorEye, V(0, 0, 0)]),
        new LineDashedMaterial({ color: th.fg2, dashSize: 0.08, gapSize: 0.08, transparent: true, opacity: 0.5 }));
      plumb.computeLineDistances();
      g.add(plumb);
      this.pulse = flat(new RingGeometry(0.985, 1, 96), th.accent, 0, 0.006);
    } else {
      const { half, r, rx } = e;
      lens.position.z = 0.026;
      housing.position.z = 0.025;
      lens.position.z = 0.051;
      const wallW = rx + 0.5, wallH = Math.max(2.6, h + 0.4);
      g.add(line([V(-wallW, 0, 0), V(-wallW, wallH, 0), V(wallW, wallH, 0), V(wallW, 0, 0), V(-wallW, 0, 0)], th.fg2, 0.25));
      const shape = new Shape();
      shape.moveTo(0, 0);
      arcPts(r, half, 0).forEach((p) => shape.lineTo(p.x, p.z));
      shape.lineTo(0, 0);
      g.add(flat(new ShapeGeometry(shape), th.accent, 0.06, 0.004));
      g.add(line([V(0, 0.005, 0), ...arcPts(r, half, 0.005), V(0, 0.005, 0)], th.accent, 0.55));
      for (let k = 1; k < r; k++) g.add(line(arcPts(k, half, 0.005), th.accent, k % 2 ? 0.1 : 0.22));
      for (let k = 2; k <= r; k += 2) {
        const a = -half - 0.07;
        g.add(label(`${k} m`, 'axis', V(Math.sin(a) * k, 0.02, Math.cos(a) * k)));
      }
      const beam = [];
      for (const a of [-half, 0, half]) beam.push(sensorEye, V(Math.sin(a) * r, 0, Math.cos(a) * r));
      g.add(segments(beam, th.accent, 0.16));
      this.pulse = flat(new RingGeometry(0.985, 1, 96, 1, Math.PI / 2 - half, 2 * half), th.accent, 0, 0.006);
    }
    g.add(sensor, this.pulse);
    g.add(label(`${this.layout.label} · ${this.layout.heightText}`, 'axis', V(0, h + 0.2, 0)));
    this.sensorEye = sensorEye;
  }

  _buildZones(zones, names) {
    clearGroup(this.zoneGroup);
    const th = this.theme;
    const idle = new Color(th.fg2), active = new Color(th.accent), exclude = new Color(th.exclude);
    this.zoneObjs = zones.map((z, i) => {
      const xa = -z.x1, xb = -z.x2;
      const w = Math.abs(xa - xb), d = Math.abs(z.y1 - z.y2);
      const cx = (xa + xb) / 2, cz = (z.y1 + z.y2) / 2;
      const y0 = z.z1 === null ? 0 : Math.max(0, z.z1);
      const y1 = z.z2 === null ? ZONE_HEIGHT : Math.max(y0 + 0.05, z.z2);
      const isExclude = z.kind === 'filter' || z.kind === 'interference';
      const base = isExclude ? exclude : idle;

      const fill = flat(new PlaneGeometry(w, d), base, isExclude ? 0.1 : 0.07, 0.008 + i * 0.001);
      fill.position.set(cx, fill.position.y, cz);
      const edgesMat = z.kind === 'dwell'
        ? new LineDashedMaterial({ color: base, dashSize: 0.1, gapSize: 0.07, transparent: true, opacity: 0.6 })
        : new LineBasicMaterial({ color: base, transparent: true, opacity: isExclude ? 0.55 : 0.4 });
      const edges = new LineSegments(new EdgesGeometry(new BoxGeometry(w, y1 - y0, d)), edgesMat);
      edges.position.set(cx, (y0 + y1) / 2, cz);
      if (z.kind === 'dwell') edges.computeLineDistances();
      const el = label(names[i] ?? '', 'zlabel', V(cx, y1 + 0.12, cz));
      this.zoneGroup.add(fill, edges, el);
      return { fill, edges, el: el.element, base, active, glow: 0, on: 0, isExclude };
    });
  }

  // ---------- frame ----------

  _frame() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const follow = 1 - Math.exp(-dt * 7), fade = 1 - Math.exp(-dt * 5);

    for (const t of this.targets) {
      t.pos.lerp(t.goal, follow);
      t.presence += ((t.present ? 1 : 0) - t.presence) * fade;
      t.hl += ((t.hover ? 1 : 0) - t.hl) * (1 - Math.exp(-dt * 10));
      const p = t.presence, on = p > 0.02;
      t.g.visible = on;
      t.g.position.copy(t.pos);
      t.bodyMat.opacity = p;
      t.bodyMat.emissiveIntensity = 0.2 + 0.5 * t.hl;
      t.ring.material.opacity = 0.9 * p;
      t.disc.material.opacity = (0.14 + 0.2 * t.hl) * p;
      t.ring.scale.setScalar(1 + 0.45 * t.hl);
      t.el.style.opacity = p.toFixed(2);
      t.ray.visible = on && !!this.sensorEye;
      if (t.ray.visible) {
        const a = t.ray.geometry.attributes.position;
        a.setXYZ(0, this.sensorEye.x, this.sensorEye.y, this.sensorEye.z);
        a.setXYZ(1, t.pos.x, t.aimY, t.pos.z);
        a.needsUpdate = true;
        t.ray.computeLineDistances();
        t.ray.material.opacity = 0.5 * p;
      }
    }

    this.trailAcc += dt;
    if (this.trailAcc >= 1 / TRAIL_HZ) {
      this.trailAcc %= 1 / TRAIL_HZ;
      for (const t of this.targets) {
        if (t.present) t.hist.push(t.pos.clone());
        else if (t.hist.length) t.hist.shift();
        while (t.hist.length > this.trailSamples) t.hist.shift();
        this._writeTrail(t);
      }
    }

    for (const z of this.zoneObjs) {
      if (z.isExclude) continue;
      z.glow += (z.on - z.glow) * fade;
      z.edges.material.color.lerpColors(z.base, z.active, z.glow);
      z.edges.material.opacity = 0.4 + 0.5 * z.glow;
      z.fill.material.color.lerpColors(z.base, z.active, z.glow);
      z.fill.material.opacity = 0.07 + 0.1 * z.glow;
      z.el.dataset.on = String(z.on === 1);
    }

    if (this.pulse && this.layout) {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const r = this._extent().r;
      const s = (now % 2800) / 2800;
      this.pulse.scale.set(0.3 + s * (r - 0.3), 0.3 + s * (r - 0.3), 1);
      this.pulse.material.opacity = reduced ? 0 : 0.24 * (1 - s);
    }

    if (this.tween) {
      const tw = this.tween;
      const s = Math.min(1, (now - tw.t0) / tw.dur), k = ease(s);
      this.camera.position.lerpVectors(tw.fromPos, tw.pos, k);
      this.controls.target.lerpVectors(tw.fromTarget, tw.target, k);
      this.camera.fov = tw.fromFov + (tw.fov - tw.fromFov) * k;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.controls.target);
      if (s >= 1) {
        this.tween = null;
        this.controls.enabled = true;
        this.controls.update();
      }
    } else {
      this.controls.update();
    }

    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  _writeTrail(t) {
    const pos = t.trailGeo.attributes.position, col = t.trailGeo.attributes.color;
    const n = Math.min(t.hist.length, pos.count);
    const bg = new Color(this.theme?.bg ?? '#000000'), c = new Color();
    for (let k = 0; k < n; k++) {
      const p = t.hist[t.hist.length - n + k];
      pos.setXYZ(k, p.x, 0.02, p.z);
      c.lerpColors(bg, t.color, Math.pow((k + 1) / n, 1.6));
      col.setXYZ(k, c.r, c.g, c.b);
    }
    pos.needsUpdate = col.needsUpdate = true;
    t.trailGeo.setDrawRange(0, n);
    t.trail.visible = this.showTrail && n > 1;
  }
}

// ---------- helpers ----------

function flat(geo, color, opacity, y) {
  const m = new Mesh(geo, new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: DoubleSide }));
  m.rotation.x = Math.PI / 2;     // XY plane → floor (shape Y becomes +Z)
  m.position.y = y;
  return m;
}

function line(points, color, opacity) {
  return new Line(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color, transparent: true, opacity }));
}

function segments(points, color, opacity) {
  return new LineSegments(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color, transparent: true, opacity }));
}

function label(text, cls, position) {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  const o = new CSS2DObject(el);
  o.position.copy(position);
  return o;
}

function arcPts(r, half, y, n = 72) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = -half + (2 * half * i) / n;
    return V(Math.sin(a) * r, y, Math.cos(a) * r);
  });
}

function circlePts(r, y, n = 96) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return V(Math.sin(a) * r, y, Math.cos(a) * r);
  });
}

function clearGroup(group) {
  group.traverse((o) => {
    if (o.isCSS2DObject) o.element.remove();
    if (o === group) return;
    o.geometry?.dispose();
    if (o.material) [].concat(o.material).forEach((m) => m.dispose());
  });
  group.clear();
}
