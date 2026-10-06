// Fake Home Assistant for the demo: three people walk around a room and the simulator publishes
// the same entities the ESPHome components create, for an LD2450 and an LD6004 on the same wall
// (1.5 m high) and an LD6004 on the ceiling (2.7 m, above the middle of the room).
// Positions are in metres in the wall sensors' frame: x to the sensor's right, y forward.

const WALL_H = 1.5;
const CEIL_H = 2.7;
const CEIL_Y = 3.0;                       // ceiling sensor sits above y = 3 m
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

const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
const st = (state, unit, extra = {}) => ({ state: String(state), attributes: { ...(unit ? { unit_of_measurement: unit } : {}), ...extra } });
const inside = (p, z) => p.present && p.x >= z.x1 && p.x <= z.x2 && p.y >= z.y1 && p.y <= z.y2 && p.z >= z.z1 && p.z <= z.z2;

class Person {
  constructor(script) {
    this.script = script;
    this.idx = -1;
    this.t = 0;
    this.dur = 0;
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
  return { x0: z.x1, x1: z.x2, y0: z.y1 - dy, y1: z.y2 - dy, z0: z.z1 - h, z1: z.z2 - h };
}));

export class Sim {
  constructor() {
    this.people = SCRIPTS.map((s) => new Person(s));
    this.clock = 0;
    this.lastDist = [0, 0, 0];
    this.states = {};
    this._statics();
    this.advance(13);          // start mid-scene so the first frame already has people in it
  }

  _statics() {
    const s = this.states;
    ZONES.forEach((z, i) => {
      const p = `number.kin_estudio_piscina_zone_${i + 1}`;
      s[`${p}_x1`] = st(Math.round(z.x1 * 1000), 'mm');
      s[`${p}_y1`] = st(Math.round(z.y1 * 1000), 'mm');
      s[`${p}_x2`] = st(Math.round(z.x2 * 1000), 'mm');
      s[`${p}_y2`] = st(Math.round(z.y2 * 1000), 'mm');
    });
    s['select.kin_estudio_piscina_zone_type'] = st('Detection');
    for (const [prefix, dy, h, method] of [['radar_ld6004', 0, WALL_H, 'Side'], ['radar_techo', CEIL_Y, CEIL_H, 'Top']]) {
      s[`sensor.${prefix}_detection_zones`] = st(zoneJson(ZONES, dy, h));
      s[`sensor.${prefix}_interference_zones`] = st(zoneJson([FAN], dy, h));
      s[`sensor.${prefix}_dwell_zones`] = st(zoneJson([], dy, h));
      s[`select.${prefix}_install_method`] = st(method);
    }
  }

  /** Advances the people by `seconds`, publishing like ESPHome: LD2450 every 0.5 s, LD6004 every 0.2 s. */
  advance(seconds) {
    const DT = 0.1;
    for (let k = 0; k < Math.round(seconds / DT); k++) {
      this.people.forEach((p) => p.step(DT));
      this.clock += DT;
      const tick = Math.round(this.clock * 10);
      if (tick % 2 === 0) this._publishLd6004();
      if (tick % 5 === 0) this._publishLd2450();
    }
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
      s[`${k}_x`] = st(Math.round((p.x + gauss() * n / 1000) * 1000), 'mm');
      s[`${k}_y`] = st(Math.round((p.y + gauss() * n / 1000) * 1000), 'mm');
      s[`${k}_speed`] = st(moving ? Math.round(((d - this.lastDist[i]) / 0.5) * 1000) : 0, 'mm/s');
      this.lastDist[i] = d;
    });
    ZONES.forEach((z, i) => {
      const count = this.people.filter((p) => p.present && p.x >= z.x1 && p.x <= z.x2 && p.y >= z.y1 && p.y <= z.y2).length;
      s[`sensor.kin_estudio_piscina_zone_${i + 1}_all_target_count`] = st(count);
    });
    this.states = s;
  }

  _publishLd6004() {
    const s = { ...this.states };
    for (const [prefix, dy, h] of [['radar_ld6004', 0, WALL_H], ['radar_techo', CEIL_Y, CEIL_H]]) {
      this.people.forEach((p, i) => {
        const k = `sensor.${prefix}_target_${i}`;
        if (!p.present) {
          s[`${k}_x`] = st('unknown', 'm'); s[`${k}_y`] = st('unknown', 'm'); s[`${k}_z`] = st('unknown', 'm');
          return;
        }
        s[`${k}_x`] = st((p.x + gauss() * 0.07).toFixed(3), 'm');
        s[`${k}_y`] = st((p.y - dy + gauss() * 0.07).toFixed(3), 'm');
        s[`${k}_z`] = st((p.z - h + gauss() * 0.04).toFixed(3), 'm');
      });
      ZONES.forEach((z, i) => {
        s[`binary_sensor.${prefix}_zone_${i}_presence`] = st(this.people.some((p) => inside(p, z)) ? 'on' : 'off');
      });
    }
    this.states = s;
  }
}
