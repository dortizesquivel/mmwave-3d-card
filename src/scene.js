import {
  BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CapsuleGeometry, CircleGeometry, Color, CylinderGeometry,
  DataTexture, DirectionalLight, DoubleSide, EdgesGeometry, Fog, Group, HemisphereLight, Line, LinearFilter, LineBasicMaterial,
  LineDashedMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, Plane,
  PlaneGeometry, Raycaster, RepeatWrapping, RGBAFormat, RingGeometry, Scene, ShadowMaterial, Shape, ShapeGeometry,
  ShaderMaterial, SphereGeometry, SRGBColorSpace, TOUCH, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { combine } from './heatmap.js';
import { mix } from './theme.js';

// The scene is in metres with the sensor at the origin, `h` m above the floor. Radar → world:
// x (positive to the sensor's right) → -X, y (forward) → +Z, height → +Y.

const V = (x, y, z) => new Vector3(x, y, z);
const TRAIL_HZ = 10;
const ZONE_HEIGHT = 1.0;      // drawn height for zones without Z limits
const BASE_FOV = 42;
const MIN_ZONE = 0.2;         // edited zones stay at least 20 cm wide

// Figure per posture. Lying is the standing figure turned 90° onto the floor.
const POSES = {
  standing: { bodyY: 0.66, headY: 1.52, top: 1.65, lying: false },
  sitting: { bodyY: 0.45, headY: 1.0, top: 1.13, lying: false },
  lying: { bodyY: 0.66, headY: 1.52, top: 0.45, lying: true },
};

const ease = (s) => (s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2);

// Detections of a distance-only sensor. The same shader draws the band on the fan (`flatBand`: 1 when the
// fan is the floor, radius measured on it; 2 when the fan goes through the sensor, radius measured from
// the sensor, whatever its tilt) and, in 3D, the spherical shells around the sensor where the target can be
// (radius measured from the sensor, cut at the floor and the ceiling, faded at the beam's edge).
// Moving: one crest per `wave` metres runs the way the target is going (phase grows away from the sensor
// or towards it). Still: the whole band breathes. With moving = 0 and breath = 1 it is a plain glow, used
// for the scan wave and the coverage.
const BEAM_SHADER = {
  vertexShader: `
    varying vec3 vW;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: `
    uniform vec3 color, origin, axis;
    uniform float opacity, moving, phase, breath, r0, r1, wave, flatBand, yMax, cosHalf;
    varying vec3 vW;
    void main() {
      vec3 d = vW - origin;
      float r = flatBand > 0.5 && flatBand < 1.5 ? length(vW.xz) : length(d);     // 1: on the floor; 0, 2: from the sensor
      float shade = 1.0;
      if (flatBand < 0.5) {
        if (vW.y < 0.0 || vW.y > yMax) discard;
        vec3 n = normalize(d);
        float facing = abs(dot(n, normalize(cameraPosition - vW)));
        shade = (0.45 + 0.9 * (1.0 - facing)) * smoothstep(cosHalf, cosHalf + 0.12, dot(n, axis));
      }
      float u = clamp((r - r0) / max(r1 - r0, 0.001), 0.0, 1.0);
      float edge = smoothstep(0.0, 0.2, u) * smoothstep(0.0, 0.2, 1.0 - u);
      float crest = pow(0.5 + 0.5 * cos(6.2832 * (r - phase) / wave), 3.0);
      float a = mix(0.1 + 0.16 * breath, 0.08 + 0.5 * crest, moving);
      gl_FragColor = vec4(color, a * edge * shade * opacity);
      #include <colorspace_fragment>
    }`,
};
const beamMaterial = (uniforms) => new ShaderMaterial({
  ...BEAM_SHADER,
  uniforms: Object.fromEntries(Object.entries({
    color: new Color(), origin: new Vector3(), axis: new Vector3(0, 0, 1), opacity: 0, moving: 0, phase: 0, breath: 0.5,
    r0: -100, r1: 100, wave: 0.25, flatBand: 0, yMax: 100, cosHalf: -1, ...uniforms,
  }).map(([k, v]) => [k, { value: v }])),
  transparent: true, depthWrite: false, side: DoubleSide,
});
const SHELL_LAYERS = 6;       // a detection in 3D: this many shells across its gate…
const SHELL_GAIN = 0.45;      // …each one fainter than the floor band, as they add up
const RIPPLE_SPEED = 0.6;     // m/s the crests travel
const BREATH_HZ = 0.35;
const SWAP_S = 2.4;           // moving and still in the same gate take turns, one colour each half

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
    this.roomGroup = new Group();
    this.heatGroup = new Group();
    this.rangeGroup = new Group();       // 1D sensors: gates, limits and the distance arcs
    this.rangeSig = '';
    this.ranges = null;
    this.arcs = null;
    this.vol = null;            // 1D sensors in 3D: the beam's volume, its scan wave and the detection shells
    this.zoneGroup = new Group();
    this.scene.add(this.staticGroup, this.roomGroup, this.heatGroup, this.zoneGroup, this.rangeGroup);
    this.zoneObjs = [];
    this.zoneSig = '';
    this.lastZones = { zones: [], nameFor: () => '', visible: true, canEdit: () => false };
    this.room = null;
    this.roomSig = '';

    // Tap to pick, drag to edit zones. Callbacks are set by the card.
    this.onPick = null;          // ({ kind: 'target' | 'zone', index }) => void
    this.onZoneEdit = null;      // (zone, rect) => void, rect in the display frame (metres)
    this.onZoneSelect = null;    // (zone | null) => void
    this.onZoneDraw = null;      // (rect) => void, a new zone drawn in draw mode
    this.drawKind = null;        // kind of zone being drawn, or null
    this.draft = null;           // rectangle being drawn
    this.editing = false;
    this.selectedKey = null;
    this.drag = null;
    this.override = null;        // { key, rect } while a dragged zone waits for the sensor to confirm it
    this.raycaster = new Raycaster();
    this.floorPlane = new Plane(V(0, 1, 0), 0);
    this._onDown = (e) => this._pointerDown(e);
    this._onMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e);
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this._onDown);
    el.addEventListener('pointermove', this._onMove);
    el.addEventListener('pointerup', this._onUp);
    el.addEventListener('pointercancel', this._onUp);

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
    // Frames are only drawn while something moves or after a change, so an idle card costs nothing.
    this.dirty = true;
    this.framesDrawn = 0;
    this.controls.addEventListener('change', () => { this.dirty = true; });

    this.ro = new ResizeObserver(() => this._resize());
    this.ro.observe(container);
    this._resize();
  }

  // ---------- configuration ----------

  /** layout: { mount: 'wall'|'ceiling', h, range, fov (grados), label } */
  setLayout(layout) {
    this.dirty = true;
    const changed = JSON.stringify(layout) !== JSON.stringify(this.layout);
    this.layout = layout;
    if (changed && this.theme) {
      this._buildStatic();
      this.setView(this.view, true);
      if (this.ranges) { this.rangeSig = ''; this.setRanges(this.ranges, this.rangeLabels); }
    }
  }

  setTheme(theme) {
    this.dirty = true;
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
      this._buildRoom();
      if (first) this.setView(this.view, true);
    }
    this.zoneSig = '';
    this._refreshZones();
    if (this.ranges) { this.rangeSig = ''; this.setRanges(this.ranges, this.rangeLabels); }
  }

  /** room: normalised `room` config with x already in the display frame, or null. */
  setRoom(room) {
    const sig = JSON.stringify(room);
    if (sig === this.roomSig) return;
    this.roomSig = sig;
    this.dirty = true;
    this.room = room;
    if (this.layout && this.theme) {
      this._buildStatic();
      this._buildRoom();
      this.setView(this.view, true);
      if (this.ranges) this.setRanges(this.ranges, this.rangeLabels);     // the beam is cut at the room's ceiling
    }
  }

  setTrail(seconds, visible) {
    this.dirty = true;
    this.trailSamples = Math.max(1, Math.round(seconds * TRAIL_HZ));
    this.showTrail = visible;
  }

  // ---------- data ----------

  /** targets: from buildFrame(); labelFor(t) returns the floating label text. */
  setTargets(targets, labelFor) {
    this.dirty = true;
    targets.forEach((d, i) => {
      const t = this.targets[i];
      if (!t) return;
      const was = t.present;
      t.present = d.present;
      if (!d.present) return;
      // Someone lying inside a piece of furniture's footprint (a sofa, a bed) lies on top of it.
      const under = d.posture === 'lying' ? this.room?.furniture.find((f) => d.x >= f.x[0] && d.x <= f.x[1] && d.y >= f.y[0] && d.y <= f.y[1]) : null;
      t.goal.set(-d.x, under ? under.height : 0, d.y);
      if (!was || t.presence < 0.05) t.pos.copy(t.goal);
      this._applyPose(t, d.posture);
      t.aimY = d.z === null ? 1.1 : Math.min(2.2, Math.max(0.2, d.z));
      t.info.textContent = labelFor(d);
    });
  }

  /** zones: from buildFrame(); opts: { nameFor(zone) → label, visible, canEdit(zone) → whether edit mode may change it }. */
  setZones(zones, opts = {}) {
    this.lastZones = { zones, nameFor: opts.nameFor ?? (() => ''), visible: opts.visible ?? true, canEdit: opts.canEdit ?? (() => false) };
    // The sensor has confirmed a dragged zone once it reports (almost) the same rectangle.
    if (this.override) {
      const z = zones.find((x) => zoneKey(x) === this.override.key);
      if (z && sameRect(rectOf(z), this.override.rect, (this.layout?.zoneStep ?? 0.05) / 2 + 0.002)) this.override = null;
    }
    this._refreshZones();
  }

  /** Drops a pending drag preview, e.g. when writing it to the sensor failed. */
  clearOverride() {
    this.override = null;
    this._refreshZones();
  }

  /** Shows a zone just written to the sensor, new ones included, until the sensor reports it back. */
  setPending(zone, rect) {
    this.override = { key: zoneKey(zone), rect: roundRect(rect), zone };
    this._refreshZones();
  }

  /** Draw mode for a new zone of `kind` (null leaves it): drag on the floor, or tap for a 1 m square. */
  setDrawMode(kind) {
    this.drawKind = kind;
    this.draft = null;
    this.renderer.domElement.style.cursor = kind ? 'crosshair' : '';
    this._refreshZones();
  }

  /** The zones as drawn: sensor zones with any pending edit applied, a pending new zone and the draft. */
  _shownZones() {
    const { zones } = this.lastZones;
    const o = this.override;
    const shown = zones.map((z) => (o && zoneKey(z) === o.key ? { ...z, ...o.rect } : z));
    if (o?.zone && !zones.some((z) => zoneKey(z) === o.key)) {
      shown.push({ ...o.zone, ...o.rect, occupied: false, inside: 0, count: null, entity: null, preview: true });
    }
    if (this.draft) {
      shown.push({ kind: this.drawKind, slot: -1, id: 0, ...this.draft, z1: null, z2: null, occupied: false, preview: true, draft: true });
    }
    return shown;
  }

  _refreshZones() {
    this.dirty = true;
    const { nameFor, visible, canEdit } = this.lastZones;
    this.zoneGroup.visible = visible || this.editing;
    if (!this.theme) return;
    const shown = this._shownZones();
    const names = shown.map((z) => nameFor(z));
    const editable = shown.map((z) => this.editing && !z.preview && canEdit(z));
    const sig = JSON.stringify([shown.map((z) => [z.kind, z.slot, z.x1, z.x2, z.y1, z.y2, z.z1, z.z2, !!z.preview]), names, editable,
      this.editing, this.selectedKey]);
    if (sig !== this.zoneSig) {
      this.zoneSig = sig;
      this._buildZones(shown, names, editable);
    }
    shown.forEach((z, i) => {
      if (this.zoneObjs[i]) this.zoneObjs[i].on = z.kind === 'detection' && z.occupied ? 1 : 0;
    });
  }

  /** Edit mode: zones can be dragged and resized, and orbiting is off so drags don't turn the camera. */
  setEditMode(on) {
    this.editing = on;
    this.controls.enableRotate = !on;
    this.controls.enablePan = !on;
    if (!on) { this.drag = null; this.selectedKey = null; this.drawKind = null; this.draft = null; this.renderer.domElement.style.cursor = ''; }
    this._refreshZones();
  }

  /**
   * map: from buildHeatmap() in the display frame, or null to remove it. opts.visible: which targets to include.
   * Each cell takes the colour of the target that spent the most time there; its opacity grows with the time.
   */
  setHeatmap(map, opts = {}) {
    this.dirty = true;
    clearGroup(this.heatGroup);
    this.heatOn = false;
    if (!map || !this.theme) return;
    const { values, owner, max } = combine(map, opts.visible ?? map.layers.map(() => true));
    if (!max) return;
    if (map.rings) { this._ringHeat(map, values, owner, max); return; }
    const { cols, rows, cell, x1, y1 } = map;
    const colors = this.theme.targets.map((h) => new Color(h).getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace));
    const data = new Uint8Array(cols * rows * 4);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const v = values[j * cols + i];
        if (!v) continue;
        const n = Math.pow(v / max, 0.5);
        const c = colors[owner[j * cols + i]];
        const o = (j * cols + (cols - 1 - i)) * 4;   // texture u runs along world X, which is -x
        data[o] = c.r * 255; data[o + 1] = c.g * 255; data[o + 2] = c.b * 255;
        data[o + 3] = Math.round(255 * (0.3 + 0.62 * n));
      }
    }
    const tex = new DataTexture(data, cols, rows, RGBAFormat);
    tex.colorSpace = SRGBColorSpace;
    tex.magFilter = tex.minFilter = LinearFilter;
    tex.needsUpdate = true;
    const w = cols * cell, d = rows * cell;
    const m = new Mesh(new PlaneGeometry(w, d), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: DoubleSide }));
    m.rotation.x = Math.PI / 2;
    m.position.set(-(x1 + w / 2), 0.02, y1 + d / 2);   // above the zone fills
    m.renderOrder = 2;
    this.heatGroup.add(m);
    this.heatOn = true;
  }

  /** 1D heatmap: a band per distance bin, coloured by whichever kind (moving or still) spent most time there. */
  _ringHeat(map, values, owner, max) {
    const colors = this.theme.targets.map((h) => new Color(h));
    const fy = this._fanY(), fan = this._fanGroup(this.heatGroup);
    values.forEach((v, i) => {
      if (!v) return;
      const n = Math.pow(v / max, 0.5);
      const r0 = this._horizontal(i * map.bin), r1 = this._horizontal((i + 1) * map.bin);
      const pts = this._rangeArc(1, 0), pos = [];
      for (let k = 0; k < pts.length - 1; k++) {
        const [p0, p1] = [pts[k], pts[k + 1]];
        const q = (p, rad) => [p.x * rad, fy + 0.02, p.z * rad];
        pos.push(...q(p0, r0), ...q(p0, r1), ...q(p1, r1), ...q(p0, r0), ...q(p1, r1), ...q(p1, r0));
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      const m = new Mesh(geo, new MeshBasicMaterial({ color: colors[owner[i]], transparent: true, opacity: 0.18 + 0.6 * n, depthWrite: false, side: DoubleSide }));
      m.renderOrder = 2;
      fan.add(m);
    });
    this.heatOn = true;
  }

  /** Floor area worth mapping, in the display frame: the coverage plus the room. */
  floorBounds() {
    const b = this._extent().bounds;
    return { x1: -b.maxX, x2: -b.minX, y1: b.minZ, y2: b.maxZ };
  }

  // ---------- 1D sensors ----------

  /**
   * ranges: from buildFrame() for a distance-only sensor (LD2410), or null.
   * labels: { moving(track), still(track), gate(index), moveLimit, stillLimit } → text.
   * Without a direction, a detection is an arc at its distance across the whole field of view, with a band
   * one gate wide around it: the sensor can't place it any closer than that.
   */
  setRanges(ranges, labels) {
    this.dirty = true;
    this.ranges = ranges;
    this.rangeLabels = labels;
    if (!ranges || !this.theme || !this.layout) {
      if (!ranges) { clearGroup(this.rangeGroup); this.rangeSig = ''; this.arcs = null; this.vol = null; }
      return;
    }
    const sig = JSON.stringify([ranges.resolution, ranges.gates.length, ranges.moveLimit, ranges.stillLimit,
      this.layout.mount, this.layout.fov, this.layout.h, this.room?.wall_height, this.theme, labels.moveLimit, labels.stillLimit, labels.bothLimits]);
    if (sig !== this.rangeSig) {
      this.rangeSig = sig;
      this._buildRanges();
    }
    for (const kind of ['moving', 'still']) {
      const a = this.arcs[kind], t = ranges[kind];
      a.present = t.present;
      if (t.present) {
        const goal = this._horizontal(t.distance);
        // Ripples follow the target: away from the sensor or towards it. Small jitter keeps the last way.
        if (a.shown !== null && a.presence >= 0.05 && Math.abs(goal - a.goal) > 0.05) a.dir = Math.sign(goal - a.goal);
        a.goal = goal;
        if (a.shown === null || a.presence < 0.05) a.shown = a.goal;
        a.text.textContent = labels[kind](t);
      }
    }
  }

  /**
   * Height of the coverage fan. A distance-only sensor on a wall draws it as the horizontal slice through
   * the sensor, in the middle of its beam: there a measured distance is the radius as it is. Otherwise the
   * fan lies on the floor.
   */
  _fanY() {
    return this.layout?.slice && this.layout.mount !== 'ceiling' ? this.layout.h : 0;
  }

  /** Tilt below the horizontal of a wall sensor, in radians (0 on the ceiling). */
  _tilt() {
    return this.layout && this.layout.mount !== 'ceiling' ? ((this.layout.tilt ?? 0) * Math.PI) / 180 : 0;
  }

  /** The beam's axis: forward, turned down by the tilt; straight down on the ceiling. */
  _axis() {
    const t = this._tilt();
    return this.layout?.mount === 'ceiling' ? V(0, -1, 0) : V(0, -Math.sin(t), Math.cos(t));
  }

  /**
   * Where to add what lies on the fan. A fan at the sensor's height turns with the sensor's tilt, so it
   * stays the beam's middle plane: things built at y = fanY (plus a hair) go into a group that pivots
   * about the sensor. Otherwise it's the parent itself.
   */
  _fanGroup(parent) {
    const fy = this._fanY(), t = this._tilt();
    if (!fy || !t) return parent;
    const pivot = new Group(), inner = new Group();
    pivot.position.set(0, fy, 0);
    pivot.rotation.x = t;
    inner.position.set(0, -fy, 0);
    pivot.add(inner);
    parent.add(pivot);
    return inner;
  }

  /** Radius on the fan for a measured (slant) distance. On the floor, the target's centre is about 1 m up. */
  _horizontal(d) {
    if (this._fanY()) return d;
    const dh = Math.max(0, (this.layout?.h ?? 1.5) - 1);
    return Math.sqrt(Math.max(0, d * d - dh * dh));
  }

  /** The measured distance back from a radius on the fan. */
  _slant(r) {
    if (this._fanY()) return r;
    const dh = Math.max(0, (this.layout?.h ?? 1.5) - 1);
    return Math.sqrt(r * r + dh * dh);
  }

  _rangeArc(r, y) {
    const e = this._extent();
    return this.layout.mount === 'ceiling' ? circlePts(r, y) : arcPts(r, e.half, y);
  }

  _buildRanges() {
    clearGroup(this.rangeGroup);
    const th = this.theme, r = this.ranges, L = this.rangeLabels;
    const g = this._fanGroup(this.rangeGroup);           // gates, limits and detections on the fan
    const e = this._extent();
    const ceiling = this.layout.mount === 'ceiling';
    const outer = Math.min(e.r, r.gates.length * r.resolution);
    const fy = this._fanY();
    // Gate boundaries, with each gate's number at its middle just outside the fan.
    for (let k = 1; k * r.resolution <= outer + 1e-6; k++) g.add(line(this._rangeArc(this._horizontal(k * r.resolution), fy + 0.006), th.fg2, 0.35));
    r.gates.forEach((gate) => {
      const mid = this._horizontal((gate.from + gate.to) / 2);
      if (mid > e.r) return;
      const a = ceiling ? Math.PI * 1.25 : e.half + 0.05;     // opposite side to the distance labels
      g.add(label(L.gate(gate.index), 'axis', V(Math.sin(a) * mid, fy + 0.02, Math.cos(a) * mid)));
    });
    // How far the sensor is set to look, for movement and for still targets.
    const limit = (dist, color, text, angle) => {
      if (dist === null) return;
      const rr = this._horizontal(dist);
      const l = new Line(new BufferGeometry().setFromPoints(this._rangeArc(rr, fy + 0.012)),
        new LineDashedMaterial({ color, dashSize: 0.14, gapSize: 0.1, transparent: true, opacity: 0.9 }));
      l.computeLineDistances();
      g.add(l, label(text, 'axis', V(Math.sin(angle) * (rr + 0.2), fy + 0.02, Math.cos(angle) * (rr + 0.2))));
    };
    const same = r.moveLimit !== null && r.moveLimit === r.stillLimit;
    // On the wall, on the centre line: clear of the gate numbers on one side and the detections on the other.
    limit(r.moveLimit, th.targets[0], same ? L.bothLimits ?? `${L.moveLimit} · ${L.stillLimit}` : L.moveLimit, ceiling ? Math.PI * 0.75 : 0);
    if (!same) limit(r.stillLimit, th.targets[1], L.stillLimit, ceiling ? Math.PI * 0.6 : 0);

    // The beam in 3D: the sensor sees a cone (±fov/2) around its axis, so a distance is a spherical shell
    // inside that cone, cut by the floor and the ceiling. Shown in the 3D and sensor views.
    const half = e.half;
    const cap = new SphereGeometry(1, 72, 18, 0, Math.PI * 2, 0, Math.min(half, Math.PI / 2));
    const axis = this._axis();
    const origin = V(0, this.layout.h, 0);
    const yMax = this.room ? this.room.wall_height : ceiling ? this.layout.h + 0.01 : Math.max(2.6, this.layout.h + 0.4);
    const shared = { origin, axis, yMax, cosHalf: Math.cos(Math.min(half, Math.PI / 2)) };
    const shell = (material, radius) => {
      const m = new Mesh(cap, material);
      m.position.copy(origin);
      m.rotation.x = ceiling ? Math.PI : Math.PI / 2 + this._tilt();      // the cap opens around +Y: turn it to the beam's axis
      m.scale.setScalar(radius);
      m.renderOrder = 3;
      return m;
    };
    const vol = new Group();
    const reach = Math.max(r.moveLimit ?? 0, r.stillLimit ?? 0) || r.gates.length * r.resolution || this.layout.range;
    vol.add(shell(beamMaterial({ ...shared, color: new Color(th.accent), opacity: th.dark ? 0.45 : 0.4, breath: 0 }), reach));
    const pulse = shell(beamMaterial({ ...shared, color: new Color(th.accent), breath: 1 }), 1);
    vol.add(pulse);
    this.rangeGroup.add(vol);
    this.vol = { group: vol, pulse, reach, cap };

    // The two detections: an animated band one gate wide on the floor, a bright line at the measured
    // distance and, in 3D, shells one gate thick.
    this.arcs = {};
    ['moving', 'still'].forEach((kind, i) => {
      const color = new Color(th.targets[i]);
      const moving = kind === 'moving' ? 1 : 0;
      const band = new Mesh(new BufferGeometry(), beamMaterial({ color, moving, flatBand: fy ? 2 : 1, origin }));
      const shellMat = beamMaterial({ ...shared, color, moving, wave: r.resolution });
      const layers = Array.from({ length: SHELL_LAYERS }, () => shell(shellMat, 1));
      vol.add(...layers);
      const arc = new Line(new BufferGeometry(), new LineBasicMaterial({ color, transparent: true, opacity: 0 }));
      const el = document.createElement('div');
      el.className = 'tag';
      el.innerHTML = `<i style="background:${th.targets[i]}"></i><span></span>`;
      const tag = new CSS2DObject(el);
      g.add(band, arc, tag);
      this.arcs[kind] = {
        band, arc, tag, el, layers, shellMat, text: el.querySelector('span'),
        present: false, presence: 0, goal: 0, shown: null, built: -1, dir: 1, phase: 0,
      };
    });
    this.swap = 0;      // 0…1: how much the two bands are taking turns (they overlap)
  }

  /** Rebuilds an arc's band and line at floor radius r (they change size, so they can't just be scaled). */
  _placeArc(a, r) {
    const half = Math.max(0.05, (this.ranges.resolution) / 2);
    const inner = Math.max(0, r - half), outerR = r + half;
    const fy = this._fanY();
    const pts = this._rangeArc(1, 0);
    const pos = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const [p0, p1] = [pts[k], pts[k + 1]];
      const q = (p, rad) => [p.x * rad, fy + 0.01, p.z * rad];
      pos.push(...q(p0, inner), ...q(p0, outerR), ...q(p1, outerR), ...q(p0, inner), ...q(p1, outerR), ...q(p1, inner));
    }
    a.band.geometry.dispose();
    a.band.geometry = new BufferGeometry();
    a.band.geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    a.band.material.uniforms.r0.value = inner;
    a.band.material.uniforms.r1.value = outerR;
    // The shells sit at the measured (slant) distance, one gate thick.
    const d = this._slant(r), s0 = Math.max(0.05, d - half), s1 = d + half;
    a.shellMat.uniforms.r0.value = s0;
    a.shellMat.uniforms.r1.value = s1;
    a.layers.forEach((m, i) => m.scale.setScalar(s0 + ((i + 0.5) * (s1 - s0)) / a.layers.length));
    a.arc.geometry.dispose();
    a.arc.geometry = new BufferGeometry().setFromPoints(this._rangeArc(r, fy + 0.014));
    // Both on the side away from the sensor's label, stacked when they meet: moving just outside its arc
    // and higher, still just inside and lower.
    const ceiling = this.layout.mount === 'ceiling', out = a === this.arcs.moving ? 1 : -1;
    const ang = ceiling ? Math.PI : -this._extent().half * 0.45, rr = Math.max(0.2, r + 0.25 * out);
    a.tag.position.set(Math.sin(ang) * rr, fy + (out > 0 ? 0.45 : 0.1), Math.cos(ang) * rr);
    a.built = r;
  }

  clearTrails() {
    this.dirty = true;
    for (const t of this.targets) { t.hist = []; this._writeTrail(t); }
  }

  /** Screen position (client px) of target i, or null when it isn't shown. */
  projectTarget(i) {
    const t = this.targets[i];
    if (!t?.g.visible) return null;
    this.camera.updateMatrixWorld();
    const v = t.g.position.clone().setY(0.9).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  /** What is under a screen point: a target, then a zone. */
  pick(clientX, clientY) {
    this.raycaster.setFromCamera(this._ndc(clientX, clientY), this.camera);
    const shown = this.targets.filter((t) => t.g.visible && t.presence > 0.3);
    const hit = this.raycaster.intersectObjects(shown.map((t) => t.hit), false)[0];
    if (hit) return { kind: 'target', index: this.targets.findIndex((t) => t.hit === hit.object) };
    if (this.zoneGroup.visible) {
      const boxes = this.zoneObjs.map((z) => z.pick);
      const zh = this.raycaster.intersectObjects(boxes, false)[0];
      if (zh) return { kind: 'zone', index: boxes.indexOf(zh.object) };
    }
    return null;
  }

  // ---------- pointer ----------

  _ndc(clientX, clientY) {
    this.camera.updateMatrixWorld();         // the camera may have moved since the last rendered frame
    const r = this.renderer.domElement.getBoundingClientRect();
    return new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  /** Floor point under the pointer, in the display frame. */
  _floorAt(e) {
    this.raycaster.setFromCamera(this._ndc(e.clientX, e.clientY), this.camera);
    const p = new Vector3();
    return this.raycaster.ray.intersectPlane(this.floorPlane, p) ? { x: -p.x, y: p.z } : null;
  }

  _editableZones() {
    const { zones, canEdit } = this.lastZones;
    if (!this.editing) return [];
    return zones.filter((z) => canEdit(z))
      .map((z) => ({ z, rect: this.override && zoneKey(z) === this.override.key ? this.override.rect : rectOf(z) }));
  }

  _snap(v) {
    const step = this.layout?.zoneStep ?? 0.05;
    return Math.round(v / step) * step;
  }

  _pointerDown(e) {
    if (e.button !== 0) return;
    this.press = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (!this.editing) return;
    const p = this._floorAt(e);
    if (!p) return;
    if (this.drawKind) {
      this.drag = { mode: 'draw', start: p, moved: false };
      this.renderer.domElement.setPointerCapture?.(e.pointerId);
      return;
    }
    const tol = 0.035 * this.camera.position.distanceTo(this.controls.target);
    const list = this._editableZones();
    let hit = null;
    for (const { z, rect } of list) {
      for (const [cx, cy, ax, ay] of [[rect.x1, rect.y1, rect.x2, rect.y2], [rect.x2, rect.y1, rect.x1, rect.y2],
        [rect.x1, rect.y2, rect.x2, rect.y1], [rect.x2, rect.y2, rect.x1, rect.y1]]) {
        if (Math.hypot(p.x - cx, p.y - cy) < tol) { hit = { z, rect, mode: 'corner', anchor: { x: ax, y: ay } }; break; }
      }
      if (hit) break;
    }
    if (!hit) {
      const inside = list.filter(({ rect }) => p.x >= rect.x1 && p.x <= rect.x2 && p.y >= rect.y1 && p.y <= rect.y2)
        .sort((a, b) => area(a.rect) - area(b.rect))[0];
      if (inside) hit = { z: inside.z, rect: inside.rect, mode: 'move' };
    }
    this.selectedKey = hit ? zoneKey(hit.z) : null;
    this.onZoneSelect?.(hit ? hit.z : null);
    this._refreshZones();
    if (!hit) return;
    this.drag = { ...hit, start: p, moved: false };
    this.renderer.domElement.setPointerCapture?.(e.pointerId);
  }

  _pointerMove(e) {
    const d = this.drag;
    if (!d) return;
    const p = this._floorAt(e);
    if (!p) return;
    const snap = (v) => this._snap(v);
    if (d.mode === 'draw') {
      d.moved = d.moved || Math.hypot(p.x - d.start.x, p.y - d.start.y) > 0.1;
      const [ax, ay, bx, by] = [snap(d.start.x), snap(d.start.y), snap(p.x), snap(p.y)];
      this.draft = roundRect({ x1: Math.min(ax, bx), x2: Math.max(ax, bx), y1: Math.min(ay, by), y2: Math.max(ay, by) });
      this._refreshZones();
      return;
    }
    let rect;
    if (d.mode === 'move') {
      const dx = snap(p.x - d.start.x), dy = snap(p.y - d.start.y);
      rect = { x1: d.rect.x1 + dx, x2: d.rect.x2 + dx, y1: d.rect.y1 + dy, y2: d.rect.y2 + dy };
    } else {
      const x = snap(p.x), y = snap(p.y);
      const x1 = Math.min(d.anchor.x, x), x2 = Math.max(d.anchor.x, x), y1 = Math.min(d.anchor.y, y), y2 = Math.max(d.anchor.y, y);
      rect = {
        x1: x2 - x1 < MIN_ZONE ? (x < d.anchor.x ? d.anchor.x - MIN_ZONE : d.anchor.x) : x1,
        x2: x2 - x1 < MIN_ZONE ? (x < d.anchor.x ? d.anchor.x : d.anchor.x + MIN_ZONE) : x2,
        y1: y2 - y1 < MIN_ZONE ? (y < d.anchor.y ? d.anchor.y - MIN_ZONE : d.anchor.y) : y1,
        y2: y2 - y1 < MIN_ZONE ? (y < d.anchor.y ? d.anchor.y : d.anchor.y + MIN_ZONE) : y2,
      };
    }
    rect = roundRect(rect);
    if (!d.moved && sameRect(rect, d.rect)) return;     // a tap selects; only a real drag becomes an edit
    d.moved = true;
    this.override = { key: zoneKey(d.z), rect };
    this._refreshZones();
  }

  _pointerUp(e) {
    const press = this.press;
    this.press = null;
    if (this.drag) {
      const d = this.drag;
      this.drag = null;
      this.renderer.domElement.releasePointerCapture?.(e.pointerId);
      if (d.mode === 'draw') {
        let rect;
        if (d.moved && this.draft) {
          const r = this.draft;
          rect = { x1: r.x1, x2: Math.max(r.x2, r.x1 + MIN_ZONE), y1: r.y1, y2: Math.max(r.y2, r.y1 + MIN_ZONE) };
        } else {
          const cx = this._snap(d.start.x), cy = this._snap(d.start.y);
          rect = { x1: cx - 0.5, x2: cx + 0.5, y1: cy - 0.5, y2: cy + 0.5 };
        }
        this.draft = null;
        if (e.type !== 'pointercancel') this.onZoneDraw?.(roundRect(rect));
        this._refreshZones();
        return;
      }
      if (d.moved && this.override) this.onZoneEdit?.(d.z, this.override.rect);
      this._refreshZones();
      return;
    }
    if (this.editing || !press || e.type === 'pointercancel') return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6 && performance.now() - press.t < 500) {
      const hit = this.pick(e.clientX, e.clientY);
      if (hit) this.onPick?.(hit);
    }
  }


  setHighlight(i, on) {
    if (this.targets[i]) this.targets[i].hover = on;
  }

  // ---------- camera ----------

  setView(name, instant = false) {
    this.view = name;
    this.dirty = true;
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

  /** Coverage geometry plus world bounds of everything worth framing (coverage and room). */
  _extent() {
    const { mount, h, range } = this.layout;
    const half = (this.layout.fov / 2) * Math.PI / 180;
    let e;
    if (mount === 'ceiling') {
      const r = half >= Math.PI / 2 - 0.01 ? range : Math.min(range, h * Math.tan(half));
      e = { half, r, bounds: { minX: -r, maxX: r, minZ: -r, maxZ: r } };
    } else {
      const rx = half >= Math.PI / 2 ? range : range * Math.sin(half);
      const reach = this._fanY() ? range * Math.cos(this._tilt()) : range;     // a tilted fan reaches less far along the floor
      e = { half, r: range, rx, bounds: { minX: -rx, maxX: rx, minZ: 0, maxZ: reach } };
    }
    const b = e.bounds;
    const pts = [...(this.room?.walls ?? []), ...(this.room?.furniture ?? []).flatMap((f) => [[f.x[0], f.y[0]], [f.x[1], f.y[1]]])];
    for (const [x, y] of pts) {
      b.minX = Math.min(b.minX, -x); b.maxX = Math.max(b.maxX, -x);
      b.minZ = Math.min(b.minZ, y); b.maxZ = Math.max(b.maxZ, y);
    }
    e.xSpan = b.maxX - b.minX;
    e.zSpan = b.maxZ - b.minZ;
    e.center = V((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    return e;
  }

  _pose(name) {
    const { mount, h } = this.layout;
    const e = this._extent();
    const t = Math.tan((BASE_FOV / 2) * Math.PI / 180);
    const aspect = this.camera.aspect || 1.6;
    const planD = Math.max((e.zSpan / 2 + 0.6) / t, (e.xSpan / 2 + 0.6) / (t * aspect));

    const fy = this._fanY(), tilt = this._tilt();
    const mid = fy - Math.sin(tilt) * e.r * 0.5;           // height of the fan's middle (it slopes down with the tilt)
    if (name === 'plan') return { pos: e.center.clone().add(V(0, mid + planD, -0.01)), target: e.center.clone().setY(mid), fov: BASE_FOV };
    if (name === 'sensor') {
      return mount === 'ceiling'
        ? { pos: V(0, h - 0.05, -0.02), target: V(0, 0, 0), fov: 100 }
        : fy
          ? { pos: V(0, h + 0.6, tilt ? 0.3 : -0.3), target: V(0, h - 0.5 - Math.sin(tilt) * e.r * 0.55, Math.cos(tilt) * e.r * 0.55), fov: 70 }     // just above the fan, or it is edge-on; ahead of the housing when tilted
          : { pos: V(0, h + 0.05, 0.15), target: V(0, 0.8, e.r * 0.55), fov: 70 };
    }
    // A fan at the sensor's height is seen from lower down, so the beam's volume above and below it shows;
    // tilted, the camera turns with it and sees the fan as it would level.
    const dir = mount === 'ceiling' ? V(-0.55, 0.68, -0.48) : fy ? V(-0.4, 0.4, -0.8).applyAxisAngle(V(1, 0, 0), tilt) : V(-0.32, 0.62, -0.72);
    const target = e.center.clone().add(V(0, fy ? mid * 0.7 : 0.3, 0));
    return { pos: target.clone().add(dir.normalize().multiplyScalar(planD * 1.05)), target, fov: BASE_FOV };
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
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this._onDown);
    el.removeEventListener('pointermove', this._onMove);
    el.removeEventListener('pointerup', this._onUp);
    el.removeEventListener('pointercancel', this._onUp);
    this.controls.dispose();
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) [].concat(o.material).forEach(disposeMaterial);
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
    this.dirty = true;
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
    // Generous invisible cylinder so a person is easy to tap at dashboard sizes.
    const hit = new Mesh(new CylinderGeometry(0.4, 0.4, 1.8, 12), new MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.9;
    g.add(pivot, ring, disc, label, hit);
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
      i, color, g, pivot, body, head, bodyMat, ring, disc, el, label, hit, info: el.querySelector('span'), dot: el.querySelector('i'),
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
    const b = e.bounds;
    const x0 = Math.floor(b.minX), x1 = Math.ceil(b.maxX), z0 = Math.floor(b.minZ), z1 = Math.ceil(b.maxZ);
    const grid = [];
    for (let x = x0; x <= x1; x++) grid.push(V(x, 0.002, z0), V(x, 0.002, z1));
    for (let z = z0; z <= z1; z++) grid.push(V(x0, 0.002, z), V(x1, 0.002, z));
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
      const fy = this._fanY();
      const fan = this._fanGroup(g);         // a fan at the sensor's height tilts with it
      sensor.rotation.x = this._tilt();
      housing.position.z = 0.025;
      lens.position.z = 0.051;
      if (!this.room?.walls.length) {     // without a room, a hint of the wall the sensor hangs on
        const wallW = rx + 0.5, wallH = Math.max(2.6, h + 0.4);
        g.add(line([V(-wallW, 0, 0), V(-wallW, wallH, 0), V(wallW, wallH, 0), V(wallW, 0, 0), V(-wallW, 0, 0)], th.fg2, 0.25));
      }
      const shape = new Shape();
      shape.moveTo(0, 0);
      arcPts(r, half, 0).forEach((p) => shape.lineTo(p.x, p.z));
      shape.lineTo(0, 0);
      fan.add(flat(new ShapeGeometry(shape), th.accent, 0.06, fy + 0.004));
      fan.add(line([V(0, fy + 0.005, 0), ...arcPts(r, half, fy + 0.005), V(0, fy + 0.005, 0)], th.accent, 0.55));
      for (let k = 1; k < r; k++) fan.add(line(arcPts(k, half, fy + 0.005), th.accent, k % 2 ? 0.1 : 0.22));
      for (let k = 2; k <= r; k += 2) {
        const a = -half - 0.07;
        fan.add(label(`${k} m`, 'axis', V(Math.sin(a) * k, fy + 0.02, Math.cos(a) * k)));
      }
      const beam = [];
      for (const a of [-half, 0, half]) beam.push(sensorEye, V(Math.sin(a) * r, fy, Math.cos(a) * r));
      fan.add(segments(beam, th.accent, 0.16));
      if (fy) {     // the fan floats at the sensor's height: a plumb line shows how high that is
        const plumb = new Line(new BufferGeometry().setFromPoints([sensorEye, V(0, 0, 0)]),
          new LineDashedMaterial({ color: th.fg2, dashSize: 0.08, gapSize: 0.08, transparent: true, opacity: 0.5 }));
        plumb.computeLineDistances();
        g.add(plumb);
      }
      this.pulse = flat(new RingGeometry(0.985, 1, 96, 1, Math.PI / 2 - half, 2 * half), th.accent, 0, fy + 0.006);
      fan.add(this.pulse);
    }
    g.add(sensor);
    if (!this.pulse.parent) g.add(this.pulse);
    // Above the sensor, or halfway down the plumb line when the fan sits at the sensor's height.
    g.add(label(`${this.layout.label} · ${this.layout.heightText}`, 'axis', this._fanY() ? V(0, h * 0.5, -0.6) : V(0, h + 0.45, 0)));
    this.sensorEye = sensorEye;
  }

  _buildRoom() {
    clearGroup(this.roomGroup);
    const r = this.room, th = this.theme;
    if (!r || !th) return;
    const g = this.roomGroup;
    const W = ([x, y], height = 0) => V(-x, height, y);

    if (r.walls.length) {
      const shape = new Shape();
      r.walls.forEach(([x, y], i) => (i ? shape.lineTo(-x, y) : shape.moveTo(-x, y)));
      g.add(flat(new ShapeGeometry(shape), mix(th.bg, th.fg, th.dark ? 0.09 : 0.07), 0.6, 0.003));

      const H = r.wall_height, doorH = Math.min(H, 2.05);
      const panelMat = new MeshBasicMaterial({ color: th.fg2, transparent: true, opacity: 0.07, depthWrite: false, side: DoubleSide });
      const edgePts = [], doorPts = [];
      r.walls.forEach((a, i) => {
        const bPt = r.walls[(i + 1) % r.walls.length];
        const A = W(a), B = W(bPt), len = A.distanceTo(B);
        if (len < 0.01) return;
        const dir = B.clone().sub(A).divideScalar(len);
        // Doors on this wall become gaps with a frame.
        const gaps = r.doors.map((d) => [W(d.from), W(d.to)])
          .filter(([P, Q]) => distToLine(P, A, dir) < 0.2 && distToLine(Q, A, dir) < 0.2)
          .map(([P, Q]) => [P.clone().sub(A).dot(dir), Q.clone().sub(A).dot(dir)].sort((m, n) => m - n))
          .map(([t0, t1]) => [Math.max(0, t0), Math.min(len, t1)])
          .filter(([t0, t1]) => t1 - t0 > 0.05)
          .sort((m, n) => m[0] - n[0]);
        let t = 0;
        for (const [t0, t1] of [...gaps, [len, len]]) {
          if (t0 - t > 0.01) {
            const P = A.clone().addScaledVector(dir, t), Q = A.clone().addScaledVector(dir, t0);
            const panel = new Mesh(new PlaneGeometry(t0 - t, H), panelMat);
            panel.position.copy(P.clone().add(Q).multiplyScalar(0.5)).setY(H / 2);
            panel.rotation.y = -Math.atan2(dir.z, dir.x);
            g.add(panel);
            edgePts.push(P.clone().setY(H), Q.clone().setY(H), P.clone().setY(0.004), Q.clone().setY(0.004));
          }
          if (t1 > t0) {
            const P = A.clone().addScaledVector(dir, t0), Q = A.clone().addScaledVector(dir, t1);
            doorPts.push(P.clone().setY(0), P.clone().setY(doorH), P.clone().setY(doorH), Q.clone().setY(doorH),
              Q.clone().setY(doorH), Q.clone().setY(0), P.clone().setY(0.006), Q.clone().setY(0.006));
          }
          t = Math.max(t, t1);
        }
        edgePts.push(A.clone().setY(0), A.clone().setY(H));
      });
      g.add(segments(edgePts, th.fg2, 0.45));
      if (doorPts.length) g.add(segments(doorPts, th.fg, 0.55));
    }

    const furnCol = mix(th.bg, th.fg, th.dark ? 0.24 : 0.17);
    for (const f of r.furniture) {
      const w = f.x[1] - f.x[0], d = f.y[1] - f.y[0];
      const box = new Mesh(new BoxGeometry(w, f.height, d), new MeshStandardMaterial({ color: furnCol, roughness: 0.9 }));
      box.position.set(-(f.x[0] + f.x[1]) / 2, f.height / 2, (f.y[0] + f.y[1]) / 2);
      box.castShadow = box.receiveShadow = true;
      const edges = new LineSegments(new EdgesGeometry(box.geometry), new LineBasicMaterial({ color: th.fg2, transparent: true, opacity: 0.35 }));
      edges.position.copy(box.position);
      g.add(box, edges);
      if (f.name) g.add(label(f.name, 'flabel', V(box.position.x, f.height + 0.08, box.position.z)));
    }
  }

  _buildZones(zones, names, editable = []) {
    clearGroup(this.zoneGroup);
    const th = this.theme;
    const idle = new Color(th.fg2), active = new Color(th.accent), exclude = new Color(th.exclude);
    const dims = new Intl.NumberFormat(this.layout?.locale ?? 'en', { maximumFractionDigits: 2 });
    this.zoneObjs = zones.map((z, i) => {
      const xa = -z.x1, xb = -z.x2;
      const w = Math.abs(xa - xb), d = Math.abs(z.y1 - z.y2);
      const cx = (xa + xb) / 2, cz = (z.y1 + z.y2) / 2;
      const y0 = z.z1 === null ? 0 : Math.max(0, z.z1);
      const y1 = z.z2 === null ? ZONE_HEIGHT : Math.max(y0 + 0.05, z.z2);
      const isExclude = z.kind === 'filter' || z.kind === 'interference';
      const base = isExclude ? exclude : idle;

      // Excluded zones get diagonal hatching so they read as "ignored" at a glance.
      const fill = isExclude
        ? hatched(w, d, base, 0.008 + i * 0.001)
        : flat(new PlaneGeometry(w, d), base, 0.07, 0.008 + i * 0.001);
      fill.position.set(cx, fill.position.y, cz);
      const edgesMat = z.kind === 'dwell'
        ? new LineDashedMaterial({ color: base, dashSize: 0.1, gapSize: 0.07, transparent: true, opacity: 0.6 })
        : new LineBasicMaterial({ color: base, transparent: true, opacity: isExclude ? 0.55 : 0.4 });
      const edges = new LineSegments(new EdgesGeometry(new BoxGeometry(w, y1 - y0, d)), edgesMat);
      edges.position.set(cx, (y0 + y1) / 2, cz);
      if (z.kind === 'dwell') edges.computeLineDistances();
      const canEdit = editable[i];
      const preview = !!z.preview;              // being drawn, or written and waiting for the sensor
      const selected = canEdit && zoneKey(z) === this.selectedKey;
      const editCol = isExclude ? exclude : z.kind === 'dwell' ? idle : active;   // keep each kind's colour while editing
      const text = canEdit || preview ? `${names[i] ?? ''} · ${dims.format(w)} × ${dims.format(d)} m` : names[i] ?? '';
      const el = label(text, 'zlabel', V(cx, y1 + 0.12, cz));
      // Invisible box for tapping the zone.
      const pick = new Mesh(new BoxGeometry(w, y1 - y0, d), new MeshBasicMaterial({ visible: false }));
      pick.position.copy(edges.position);
      this.zoneGroup.add(fill, edges, el, pick);
      if (canEdit || preview) {
        el.element.dataset.edit = 'true';
        edges.material.color.copy(editCol);
        edges.material.opacity = selected || preview ? 1 : 0.7;
        if (preview && !isExclude) fill.material.opacity = 0.16;
      }
      if (canEdit) {
        for (const [hx, hz] of [[xa, z.y1], [xa, z.y2], [xb, z.y1], [xb, z.y2]]) {
          const handle = flat(new CircleGeometry(selected ? 0.11 : 0.08, 24), editCol, 0.95, 0.03);
          handle.position.set(hx, 0.03, hz);
          this.zoneGroup.add(handle);
        }
      }
      return { fill, edges, el: el.element, pick, base, active, glow: 0, on: 0, isExclude, fixed: canEdit || preview };
    });
  }

  // ---------- frame ----------

  _frame() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const follow = 1 - Math.exp(-dt * 7), fade = 1 - Math.exp(-dt * 5);
    let animating = !!this.tween;

    for (const t of this.targets) {
      if (t.pos.distanceToSquared(t.goal) > 1e-6 || Math.abs(t.presence - (t.present ? 1 : 0)) > 0.002
        || Math.abs(t.hl - (t.hover ? 1 : 0)) > 0.002) animating = true;
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
        // A trail that still has length keeps changing as it drains.
        if (t.hist.length > 1 && t.hist[0].distanceToSquared(t.hist[t.hist.length - 1]) > 1e-6) this.trailMoving = true;
      }
    }
    if (this.trailMoving) { animating = true; this.trailMoving = false; }

    if (this.arcs) {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const { moving, still } = this.arcs;
      const vol = this.view !== 'plan';
      // Moving and still in the same gate (often one person): the bands take turns, one colour at a time,
      // instead of blending into a third colour.
      const overlap = moving.present && still.present && moving.shown !== null && still.shown !== null
        && Math.abs(moving.shown - still.shown) < this.ranges.resolution;
      const swapGoal = overlap && !reduced ? 1 : 0;
      if (Math.abs(this.swap - swapGoal) > 0.002) animating = true;
      this.swap += (swapGoal - this.swap) * fade;
      const c = 0.5 + 0.5 * Math.cos((2 * Math.PI * now) / 1000 / SWAP_S);
      const s = Math.min(1, Math.max(0, (c - 0.25) / 0.5)), turn = s * s * (3 - 2 * s);   // 1: moving's turn
      for (const [kind, a] of Object.entries(this.arcs)) {
        if (Math.abs(a.presence - (a.present ? 1 : 0)) > 0.002) animating = true;
        a.presence += ((a.present ? 1 : 0) - a.presence) * fade;
        if (a.shown !== null) {
          if (Math.abs(a.goal - a.shown) > 0.002) { a.shown += (a.goal - a.shown) * follow; animating = true; }
          if (Math.abs(a.shown - a.built) > 0.005) this._placeArc(a, a.shown);
        }
        const on = a.presence > 0.02 && a.shown !== null;
        a.band.visible = a.arc.visible = a.tag.visible = on;
        const share = kind === 'moving' ? turn : 1 - turn;
        const opacity = a.presence * (1 - this.swap + this.swap * share);
        if (on && !reduced) {
          a.phase = (a.phase + a.dir * RIPPLE_SPEED * dt) % 3;     // 3 m: a whole number of crests for any wave
          animating = true;
        }
        const breath = reduced ? 0.5 : 0.5 + 0.5 * Math.sin((2 * Math.PI * BREATH_HZ * now) / 1000);
        a.band.material.uniforms.opacity.value = opacity;
        a.shellMat.uniforms.opacity.value = opacity * SHELL_GAIN;
        for (const u of [a.band.material.uniforms, a.shellMat.uniforms]) {
          u.phase.value = a.phase;
          u.breath.value = breath;
        }
        for (const m of a.layers) m.visible = on && vol;
        a.arc.material.opacity = 0.95 * a.presence;
        a.el.style.opacity = a.presence.toFixed(2);
      }
    }

    for (const z of this.zoneObjs) {
      if (z.isExclude || z.fixed) continue;
      if (Math.abs(z.on - z.glow) > 0.002) animating = true;
      z.glow += (z.on - z.glow) * fade;
      z.edges.material.color.lerpColors(z.base, z.active, z.glow);
      z.edges.material.opacity = 0.4 + 0.5 * z.glow;
      z.fill.material.color.lerpColors(z.base, z.active, z.glow);
      z.fill.material.opacity = (0.07 + 0.1 * z.glow) * (this.heatOn ? 0.3 : 1);   // let the heatmap show through
      z.el.dataset.on = String(z.on === 1);
    }

    if (this.pulse && this.layout) {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const r = this._extent().r;
      const s = (now % 2800) / 2800;
      // Distance-only sensors scan a volume: in 3D the wave is a growing shell instead of a ring on the floor.
      const vol = this.vol && this.view !== 'plan';
      this.pulse.visible = !vol;
      this.pulse.scale.set(0.3 + s * (r - 0.3), 0.3 + s * (r - 0.3), 1);
      this.pulse.material.opacity = reduced ? 0 : 0.14 * (1 - s);     // a hint of the scan, not a feature
      if (this.vol) {
        this.vol.group.visible = vol;
        const p = this.vol.pulse;
        p.scale.setScalar(0.15 + s * (this.vol.reach - 0.15));
        p.material.uniforms.opacity.value = reduced ? 0 : 0.32 * Math.min(1, s * 8) * (1 - s);
        p.visible = !reduced;
      }
      if (!reduced) animating = true;
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
    } else if (this.controls.update()) {
      animating = true;
    }

    if (!animating && !this.dirty) return;
    this.dirty = false;
    this.framesDrawn++;
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

let stripeCanvas;
function hatched(w, d, color, y) {
  if (!stripeCanvas) {
    // One 64 px tile of 45° stripes that repeats seamlessly; the material colour tints it.
    stripeCanvas = document.createElement('canvas');
    stripeCanvas.width = stripeCanvas.height = 64;
    const g = stripeCanvas.getContext('2d');
    g.strokeStyle = '#ffffff';
    g.lineWidth = 16;
    for (const x of [-64, 0, 64]) {
      g.beginPath();
      g.moveTo(x, 64);
      g.lineTo(x + 64, 0);
      g.stroke();
    }
  }
  const tex = new CanvasTexture(stripeCanvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(w / 0.16, d / 0.16);         // one stripe every ~11 cm
  const m = new Mesh(new PlaneGeometry(w, d), new MeshBasicMaterial({
    color, map: tex, transparent: true, opacity: 0.65, depthWrite: false, side: DoubleSide,
  }));
  m.rotation.x = Math.PI / 2;
  m.position.y = y;
  return m;
}

const zoneKey = (z) => `${z.kind}:${z.slot}`;
const rectOf = (z) => ({ x1: Math.min(z.x1, z.x2), x2: Math.max(z.x1, z.x2), y1: Math.min(z.y1, z.y2), y2: Math.max(z.y1, z.y2) });
const sameRect = (a, b, tol = 0.011) => ['x1', 'x2', 'y1', 'y2'].every((k) => Math.abs(a[k] - b[k]) < tol);
const area = (r) => (r.x2 - r.x1) * (r.y2 - r.y1);
const roundRect = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));

function distToLine(P, A, dir) {
  const ap = P.clone().sub(A);
  return ap.sub(dir.clone().multiplyScalar(ap.dot(dir))).length();
}

function disposeMaterial(m) {
  m.map?.dispose();
  m.dispose();
}

function clearGroup(group) {
  group.traverse((o) => {
    if (o.isCSS2DObject) o.element.remove();
    if (o === group) return;
    o.geometry?.dispose();
    if (o.material) [].concat(o.material).forEach(disposeMaterial);
  });
  group.clear();
}
