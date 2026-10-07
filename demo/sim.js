// Fake Home Assistant for the demo and the browser tests: three people walk around a room and the
// simulator publishes the same entities the ESPHome components create, for an LD2450 and an LD6004 on
// the same wall (1.5 m high) and an LD6004 on the ceiling (2.7 m, above the middle of the room).
// Positions are in metres in the wall sensors' frame: x to the sensor's right, y forward.

const WALL_H = 1.5;
const CEIL_H = 2.7;
const CEIL_Y = 3.0;                       // the ceiling sensor sits above y = 3 m
const CENTROID = { standing: 1.05, sitting: 0.7, lying: 0.3 };   // height of the reflection centre

const SCRIPTS = [
  [{ at: [-0.2, 1.5] }, { wait: 5 }, { walk: [1.9, 3.3], v: 0.9 }, { wait: 6 }, { walk: [-0.3, 4.3], v: 0.8 },
    { wait: 2.5 }, { walk: [-0.2, 1.5], v: 0.9 }],
  [{ at: [-0.8, 1.8] }, { wait: 12, posture: 'sitting' }, { walk: [-1.9, 4.2], v: 0.65 }, { wait: 10, posture: 'lying' },
    { walk: [-0.8, 1.8], v: 0.65 }],
  [{ hide: 9 }, { at: [2.7, 5.2] }, { walk: [2.4, 4.0], v: 1.0 }, { wait: 6 }, { walk: [2.7, 5.2], v: 1.0 }],
];

// Zones in the wall frame; z is height above the floor.
const ZONES = [
  { x1: -1.2, x2: 0.6, y1: 0.9, y2: 2.6, z1: 0, z2: 1.3 },     // desk
  { x1: 0.9, x2: 3.0, y1: 2.2, y2: 4.6, z1: 0, z2: 2.2 },
  { x1: -2.9, x2: -0.9, y1: 3.2, y2: 5.2, z1: 0, z2: 1.0 },    // sofa
];
const FAN = { x1: -2.6, x2: -2.0, y1: 1.0, y2: 1.6, z1: 0, z2: 1.2 };

// The two LD6004s, keyed by the ESPHome node name their services would carry.
export const LD6004_NODES = {
  hlk_ld6004: { prefix: 'radar_ld6004', dy: 0, h: WALL_H, method: 'Side' },
  hlk_techo: { prefix: 'radar_techo', dy: CEIL_Y, h: CEIL_H, method: 'Top' },
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// LD2410 on the same wall (prefix esp32_pasillo, like the real one): ESPHome's default thresholds,
// 0.75 m gates, detecting up to gate 6 (4.5 m) for movement and for still targets.
const LD2410 = {
  prefix: 'esp32_pasillo', res: 0.75, maxGate: 6, half: Math.PI / 3,
  move: [50, 50, 40, 30, 20, 15, 15, 15, 15], still: [0, 0, 40, 40, 30, 30, 20, 20, 20],
};

const st = (state, unit, extra = {}) => ({ state: String(state), attributes: { ...(unit ? { unit_of_measurement: unit } : {}), ...extra } });
const MM = { min: -6000, max: 6000, step: 1 };

class Person {
  constructor(script) {
    this.script = script;
    this.idx = -1;
    this.x = 0;
    this.y = 0;
    this.present = false;
    this.posture = 'standing';
    this.next();
  }

  get z() { return CENTROID[this.posture]; }

  next() {
    this.idx = (this.idx + 1) % this.script.length;
    const a = (this.act = this.script[this.idx]);
    this.t = 0;
    this.dur = 0;
    this.posture = a.posture ?? 'standing';
    if (a.at) { [this.x, this.y] = a.at; this.present = true; }
    if (a.wait) this.dur = a.wait;
    if (a.hide !== undefined) { this.present = false; this.dur = a.hide; }
    if (a.walk) { this.from = [this.x, this.y]; this.dur = Math.hypot(a.walk[0] - this.x, a.walk[1] - this.y) / a.v; }
  }

  step(dt) {
    this.t += dt;
    for (let guard = 0; this.t >= this.dur && guard < 8; guard++) {
      const over = this.t - this.dur;
      if (this.act.walk) [this.x, this.y] = this.act.walk;
      this.next();
      this.t = over;
    }
    if (this.act.walk) {
      const s = Math.min(1, this.t / this.dur);
      const e = 0.7 * s + 0.3 * (s - Math.sin(2 * Math.PI * s) / (2 * Math.PI));
      this.x = this.from[0] + (this.act.walk[0] - this.from[0]) * e;
      this.y = this.from[1] + (this.act.walk[1] - this.from[1]) * e;
    }
  }
}

const zoneJson = (zones, dy, h) => JSON.stringify([0, 1, 2, 3].map((i) => {
  const z = zones[i];
  if (!z) return { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 };
  const r = (v) => Math.round(v * 10) / 10;      // the component publishes one decimal
  return { x0: r(z.x1), x1: r(z.x2), y0: r(z.y1 - dy), y1: r(z.y2 - dy), z0: r(z.z1 - h), z1: r(z.z2 - h) };
}));

export class Sim {
  /** opts: { seed (deterministic noise), start (s into the scene), coarse (publish once a second) } */
  constructor(opts = {}) {
    this.rng = opts.seed !== undefined ? mulberry32(opts.seed) : Math.random;
    this.coarse = !!opts.coarse;
    this.people = SCRIPTS.map((s) => new Person(s));
    this.clock = 0;
    this.lastDist = [0, 0, 0];
    this.states = {};
    this.onPublish = null;
    this._statics();
    this.advance(opts.start ?? 13);   // start mid-scene so the first frame already has people in it
  }

  gauss() {
    return (this.rng() + this.rng() + this.rng() - 1.5) / 1.5;
  }

  _statics() {
    const s = this.states;
    ZONES.forEach((z, i) => {
      const p = `number.kin_estudio_piscina_zone_${i + 1}`;
      s[`${p}_x1`] = st(Math.round(z.x1 * 1000), 'mm', MM);
      s[`${p}_y1`] = st(Math.round(z.y1 * 1000), 'mm', MM);
      s[`${p}_x2`] = st(Math.round(z.x2 * 1000), 'mm', MM);
      s[`${p}_y2`] = st(Math.round(z.y2 * 1000), 'mm', MM);
    });
    s['select.kin_estudio_piscina_zone_type'] = st('Detection');
    const p2410 = LD2410.prefix;
    for (let g = 0; g < 9; g++) {
      s[`number.${p2410}_g${g}_move_threshold`] = st(LD2410.move[g], '%', { min: 0, max: 100, step: 1 });
      s[`number.${p2410}_g${g}_still_threshold`] = st(LD2410.still[g], '%', { min: 0, max: 100, step: 1 });
    }
    s[`number.${p2410}_max_move_distance_gate`] = st(LD2410.maxGate, null, { min: 2, max: 8, step: 1 });
    s[`number.${p2410}_max_still_distance_gate`] = st(LD2410.maxGate, null, { min: 2, max: 8, step: 1 });
    s[`select.${p2410}_distance_resolution`] = st('0.75m', null, { options: ['0.2m', '0.75m'] });
    s[`switch.${p2410}_engineering_mode`] = st('on');
    s[`sensor.${p2410}_moving_distance`] = st(0, 'cm');
    s[`sensor.${p2410}_still_distance`] = st(0, 'cm');
    for (const { prefix, dy, h, method } of Object.values(LD6004_NODES)) {
      s[`sensor.${prefix}_detection_zones`] = st(zoneJson(ZONES, dy, h));
      s[`sensor.${prefix}_interference_zones`] = st(zoneJson([FAN], dy, h));
      s[`sensor.${prefix}_dwell_zones`] = st(zoneJson([], dy, h));
      s[`select.${prefix}_install_method`] = st(method);
    }
  }

  /** Advances by `seconds`, publishing like ESPHome: LD2450 every 0.5 s, LD6004 every 0.2 s (1 s each when coarse). */
  advance(seconds) {
    const DT = 0.1;
    for (let k = 0; k < Math.round(seconds / DT); k++) {
      this.people.forEach((p) => p.step(DT));
      this.clock += DT;
      const tick = Math.round(this.clock * 10);
      const ld6004 = this.coarse ? tick % 10 === 0 : tick % 2 === 0;
      const ld2450 = this.coarse ? tick % 10 === 0 : tick % 5 === 0;
      if (ld6004) this._publishLd6004();
      if (ld2450) { this._publishLd2450(); this._publishLd2410(); }
      if ((ld6004 || ld2450) && this.onPublish) this.onPublish(this.states, this.clock);
    }
  }

  /** Current LD2450 zones, read back from the number entities (they can be edited). */
  _ld2450Zones() {
    return [1, 2, 3].map((i) => {
      const v = ['x1', 'y1', 'x2', 'y2'].map((k) => Number(this.states[`number.kin_estudio_piscina_zone_${i}_${k}`].state) / 1000);
      return { x1: Math.min(v[0], v[2]), x2: Math.max(v[0], v[2]), y1: Math.min(v[1], v[3]), y2: Math.max(v[1], v[3]) };
    });
  }

  /** Current LD6004 detection zones in the wall frame, read back from the text sensor. */
  _ld6004Zones({ prefix, dy, h }) {
    return JSON.parse(this.states[`sensor.${prefix}_detection_zones`].state).map((z) => ({
      x1: Math.min(z.x0, z.x1), x2: Math.max(z.x0, z.x1), y1: Math.min(z.y0, z.y1) + dy, y2: Math.max(z.y0, z.y1) + dy,
      z1: z.z0 === z.z1 ? -Infinity : Math.min(z.z0, z.z1) + h, z2: z.z0 === z.z1 ? Infinity : Math.max(z.z0, z.z1) + h,
      empty: z.x0 === z.x1 || z.y0 === z.y1,
    }));
  }

  _publishLd2450() {
    const s = { ...this.states };
    this.people.forEach((p, i) => {
      const k = `sensor.kin_estudio_piscina_target_${i + 1}`;
      if (!p.present) {
        s[`${k}_x`] = st(0, 'mm'); s[`${k}_y`] = st(0, 'mm'); s[`${k}_speed`] = st(0, 'mm/s');
        return;
      }
      const moving = !!p.act.walk, n = moving ? 60 : 35;
      const d = Math.hypot(p.x, p.y);
      s[`${k}_x`] = st(Math.round((p.x + this.gauss() * n / 1000) * 1000), 'mm');
      s[`${k}_y`] = st(Math.round((p.y + this.gauss() * n / 1000) * 1000), 'mm');
      s[`${k}_speed`] = st(moving ? Math.round(((d - this.lastDist[i]) / 0.5) * 1000) : 0, 'mm/s');
      this.lastDist[i] = d;
    });
    this._ld2450Zones().forEach((z, i) => {
      const count = this.people.filter((p) => p.present && p.x >= z.x1 && p.x <= z.x2 && p.y >= z.y1 && p.y <= z.y2).length;
      s[`sensor.kin_estudio_piscina_zone_${i + 1}_all_target_count`] = st(count);
    });
    this.states = s;
  }

  /** One moving and one still target (the nearest of each), gate energies peaking at each person's distance. */
  _publishLd2410() {
    const s = { ...this.states }, p = LD2410.prefix, cfg = LD2410;
    const seen = this.people.map((q) => ({ q, d: Math.hypot(q.x, q.y), a: Math.atan2(q.x, q.y) }))
      .filter(({ q, d, a }) => q.present && Math.abs(a) <= cfg.half && d <= cfg.maxGate * cfg.res);
    const moving = seen.filter(({ q }) => q.act.walk).sort((m, n) => m.d - n.d);
    // Like the real module, someone walking also shows up as the still target when nobody nearer is still.
    const still = [...seen].sort((m, n) => m.d - n.d);
    const energy = (d) => Math.max(20, Math.min(100, 100 - d * 14 + this.gauss() * 4));
    const pub = (kind, list, energyKey) => {
      const on = list.length > 0;
      s[`binary_sensor.${p}_${kind}_target`] = st(on ? 'on' : 'off');
      // Like the real sensor, the distance keeps its last value when the target goes away.
      if (on) s[`sensor.${p}_${kind}_distance`] = st(Math.round((list[0].d + this.gauss() * 0.12) * 100), 'cm');
      s[`sensor.${p}_${energyKey}_energy`] = st(on ? Math.round(energy(list[0].d) * (kind === 'still' ? 0.55 : 1)) : Math.round(this.rng() * 5), '%');
    };
    pub('moving', moving, 'move');
    pub('still', still, 'still');
    s[`binary_sensor.${p}_presence`] = st(moving.length || still.length ? 'on' : 'off');
    const nearest = [...moving, ...still].sort((m, n) => m.d - n.d)[0];
    s[`sensor.${p}_detection_distance`] = st(nearest ? Math.round(nearest.d * 100) : 0, 'cm');
    const engineering = s[`switch.${p}_engineering_mode`].state === 'on';
    for (let g = 0; g < 9; g++) {
      const c = (g + 0.5) * cfg.res;
      const peak = (list, scale) => list.reduce((m, { d }) => Math.max(m, scale * energy(d) * Math.exp(-((d - c) ** 2) / (2 * 0.45 ** 2))), 0);
      const noise = () => 2 + this.rng() * 6;
      s[`sensor.${p}_g${g}_move_energy`] = st(engineering ? Math.round(Math.min(100, peak(moving, 1) + noise())) : 'unknown', '%');
      s[`sensor.${p}_g${g}_still_energy`] = st(engineering ? Math.round(Math.min(100, peak(still, 0.6) + noise())) : 'unknown', '%');
    }
    this.states = s;
  }

  _publishLd6004() {
    const s = { ...this.states };
    for (const node of Object.values(LD6004_NODES)) {
      const { prefix, dy, h } = node;
      this.people.forEach((p, i) => {
        const k = `sensor.${prefix}_target_${i}`;
        if (!p.present) {
          s[`${k}_x`] = st('unknown', 'm'); s[`${k}_y`] = st('unknown', 'm'); s[`${k}_z`] = st('unknown', 'm');
          return;
        }
        s[`${k}_x`] = st((p.x + this.gauss() * 0.07).toFixed(3), 'm');
        s[`${k}_y`] = st((p.y - dy + this.gauss() * 0.07).toFixed(3), 'm');
        s[`${k}_z`] = st((p.z - h + this.gauss() * 0.04).toFixed(3), 'm');
      });
      this._ld6004Zones(node).forEach((z, i) => {
        const on = !z.empty && this.people.some((p) => p.present && p.x >= z.x1 && p.x <= z.x2 && p.y >= z.y1 && p.y <= z.y2 && p.z >= z.z1 && p.z <= z.z2);
        s[`binary_sensor.${prefix}_zone_${i}_presence`] = st(on ? 'on' : 'off');
      });
    }
    this.states = s;
  }

  /** What HA's number.set_value and the component's esphome.<node>_set_detection_zone would do. */
  callService(domain, service, data) {
    const s = { ...this.states };
    if (domain === 'switch' && (service === 'turn_on' || service === 'turn_off')) {
      const old = s[data.entity_id];
      if (!old) throw new Error(`Unknown entity ${data.entity_id}`);
      s[data.entity_id] = { ...old, state: service === 'turn_on' ? 'on' : 'off' };
    } else if (domain === 'number' && service === 'set_value') {
      const old = s[data.entity_id];
      if (!old) throw new Error(`Unknown entity ${data.entity_id}`);
      s[data.entity_id] = { ...old, state: String(data.value) };
    } else if (domain === 'esphome' && /_set_(detection|interference|dwell)_zone$/.test(service)) {
      const [, nodeName, kind] = service.match(/^(.+)_set_(detection|interference|dwell)_zone$/);
      const node = LD6004_NODES[nodeName];
      if (!node) throw new Error(`Unknown service esphome.${service}`);
      const id = `sensor.${node.prefix}_${kind}_zones`;
      const list = JSON.parse(s[id].state);
      const r = (v) => Math.round(v * 10) / 10;
      list[data.zone_index] = { x0: r(data.x_min), x1: r(data.x_max), y0: r(data.y_min), y1: r(data.y_max), z0: r(data.z_min), z1: r(data.z_max) };
      s[id] = { ...s[id], state: JSON.stringify(list) };
    } else {
      throw new Error(`Service ${domain}.${service} is not simulated`);
    }
    this.states = s;
  }

  /**
   * Recorder-style history for `ids` over the last `seconds` before `endMs`, from a fresh run of the
   * same scene: { id: [{ s, lu }] } like history/history_during_period with minimal_response.
   */
  static history(ids, seconds, endMs, seed = 1) {
    const sim = new Sim({ seed, start: 0, coarse: seconds > 3600 });
    const out = Object.fromEntries(ids.map((id) => [id, []]));
    const t0 = endMs / 1000 - seconds;
    // A hallway is empty most of the time: in the recorded history the LD2410 sees someone for 45 s
    // every 6 minutes, so replay has quiet stretches to skip.
    const hallQuiet = (clock) => clock % 360 >= 45;
    const hallBinary = new RegExp(`^binary_sensor\\.${LD2410.prefix}_(moving_target|still_target|presence)$`);
    sim.onPublish = (states, clock) => {
      for (const id of ids) {
        const s = hallQuiet(clock) && hallBinary.test(id) ? 'off' : states[id]?.state, list = out[id];
        if (s !== undefined && (!list.length || list[list.length - 1].s !== s)) list.push({ s, lu: t0 + clock });
      }
    };
    sim.advance(seconds);
    return out;
  }
}
