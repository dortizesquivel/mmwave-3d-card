// Property-based tests (fuzzing): whatever Home Assistant and the YAML throw at the card, it reads what it can
// and never crashes or draws non-finite numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { ADAPTERS, buildFrame, resolveEntities } from '../src/adapters/index.js';
import { parseZones } from '../src/adapters/ld6004.js';
import { normalizeConfig } from '../src/config.js';
import { modelPlacement, modelSensorHeight, modelToScene, normalizeModel } from '../src/model.js';

const RUNS = { numRuns: 300 };
const opts = { invertX: false, zOffset: 1.5, posture: { sitting: 0.95, lying: 0.45 } };

// What an entity's state can look like: numbers in any form, HA's special states, booleans, text, JSON.
const stateText = fc.oneof(
  fc.double().map(String),
  fc.integer({ min: -100000, max: 100000 }).map(String),
  fc.constantFrom('unknown', 'unavailable', '', 'on', 'off', 'NaN', 'Infinity', '-0', '1e309', 'Detection', 'Filter', 'Side', 'Top'),
  fc.string(),
  fc.json(),
);
const unit = fc.option(fc.constantFrom('mm', 'cm', 'm', 'km', 'mm/s', 'm/s', 'in', '°', ''), { nil: undefined });
const entityState = fc.record({ state: stateText, attributes: fc.record({ unit_of_measurement: unit }) });

/** Every entity id an adapter reads for a prefix. */
function entityIds(value, out = new Set()) {
  if (typeof value === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(value)) out.add(value);
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => entityIds(v, out));
  return [...out];
}

const finiteOrNull = (v) => v === null || Number.isFinite(v);

for (const [name, adapter] of Object.entries(ADAPTERS)) {
  test(`fuzz: ${name} reads any states without crashing or drawing non-finite numbers`, () => {
    const ent = resolveEntities(adapter, { prefix: 'room' });
    const ids = entityIds(ent);
    assert.ok(ids.length > 3);
    fc.assert(fc.property(fc.array(fc.option(entityState, { nil: null }), { minLength: ids.length, maxLength: ids.length }), (states) => {
      const hass = { states: Object.fromEntries(ids.map((id, i) => [id, states[i]]).filter(([, s]) => s)) };
      const frame = buildFrame(adapter, hass, ent, opts);
      for (const t of frame.targets) {
        if (!t.present) continue;
        assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y), `target at ${t.x}, ${t.y}`);
        assert.ok(finiteOrNull(t.z) && Number.isFinite(t.distance) && t.distance >= 0);
      }
      for (const z of frame.zones) {
        assert.ok([z.x1, z.x2, z.y1, z.y2].every(Number.isFinite), `zone ${JSON.stringify(z)}`);
        assert.ok(finiteOrNull(z.z1) && finiteOrNull(z.z2));
      }
    }), RUNS);
  });
}

test('fuzz: LD6004 zone text never breaks the parser', () => {
  const zoneJson = fc.array(fc.record({ x0: fc.anything(), x1: fc.anything(), y0: fc.anything(), y1: fc.anything(), z0: fc.anything(), z1: fc.anything() }), { maxLength: 5 })
    .map((zs) => JSON.stringify(zs));
  fc.assert(fc.property(fc.oneof(fc.string(), fc.json(), zoneJson), (text) => {
    for (const z of parseZones(text)) {
      if (z === null) continue;
      assert.ok([z.x1, z.x2, z.y1, z.y2].every(Number.isFinite) && finiteOrNull(z.z1) && finiteOrNull(z.z2));
    }
  }), RUNS);
});

test('fuzz: any YAML either gives a valid config or a readable error', () => {
  const value = fc.oneof(fc.anything(), fc.double(), fc.string(), fc.constantFrom('ld2450', 'ld6004', 'ld2410', 'wall', 'ceiling', 'auto', '3d', 'plan'));
  const yaml = fc.record({
    device: fc.oneof(fc.constantFrom('ld2450', 'ld6004', 'ld2410'), value), prefix: fc.oneof(fc.constant('room'), value),
    mount: value, mount_height: value, tilt: value, max_range: value, fov: value, view: value, posture: value,
    room: value, model: value, zone_names: value, entities: value,
  }, { requiredKeys: [] });
  fc.assert(fc.property(yaml, (c) => {
    let cfg;
    try {
      cfg = normalizeConfig(c);
    } catch (err) {
      assert.ok(err instanceof Error && typeof err.message === 'string' && err.message.length > 0);
      return;
    }
    assert.ok(Number.isFinite(cfg.mount_height) && cfg.mount_height > 0);
    assert.ok(Number.isFinite(cfg.max_range) && cfg.max_range > 0);
    assert.ok(cfg.fov > 0 && cfg.fov <= 180 && cfg.tilt >= 0 && cfg.tilt <= 90);
  }), RUNS);
});

test('fuzz: placing a model is a rigid move that puts the sensor on the radar', () => {
  const coord = fc.double({ min: -50, max: 50, noNaN: true });
  const point = fc.tuple(coord, coord, coord);
  fc.assert(fc.property(point, fc.double({ min: -720, max: 720, noNaN: true }), fc.double({ min: 0.1, max: 5, noNaN: true }), point, point,
    ([sx, sy, sz], heading, above, p, q) => {
      const floor = sy - above;
      const m = normalizeModel({ url: 'room.glb', floor, sensor: { position: [sx, sy, sz], heading } });
      const at = modelToScene(m, [sx, sy, sz]);
      [0, modelSensorHeight(m), 0].forEach((v, i) => assert.ok(Math.abs(at[i] - v) < 1e-6, `sensor at ${at}`));
      assert.ok(Math.abs(modelToScene(m, [sx, floor, sz])[1]) < 1e-6, 'floor at 0');
      const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      assert.ok(Math.abs(d(modelToScene(m, p), modelToScene(m, q)) - d(p, q)) < 1e-6, 'distances kept');
      assert.equal(modelPlacement(m).upRotX, 0);
    }), RUNS);
});
