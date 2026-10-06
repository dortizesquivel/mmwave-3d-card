import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrame, classifyPosture, detectDevices, getAdapter, resolveEntities } from '../src/adapters/index.js';
import { parseZones } from '../src/adapters/ld6004.js';

const st = (state, unit) => ({ state: String(state), attributes: unit ? { unit_of_measurement: unit } : {} });
const opts = { invertX: false, zOffset: 1.5, posture: { sitting: 0.95, lying: 0.45 } };

function ld2450States(p) {
  return {
    [`sensor.${p}_target_1_x`]: st(-820, 'mm'),
    [`sensor.${p}_target_1_y`]: st(1960, 'mm'),
    [`sensor.${p}_target_1_speed`]: st(-350, 'mm/s'),
    [`sensor.${p}_target_2_x`]: st(0, 'mm'),
    [`sensor.${p}_target_2_y`]: st(0, 'mm'),
    [`sensor.${p}_target_3_x`]: st('unavailable'),
    [`sensor.${p}_target_3_y`]: st('unavailable'),
    [`number.${p}_zone_1_x1`]: st(-1200, 'mm'),
    [`number.${p}_zone_1_y1`]: st(900, 'mm'),
    [`number.${p}_zone_1_x2`]: st(600, 'mm'),
    [`number.${p}_zone_1_y2`]: st(2600, 'mm'),
    [`number.${p}_zone_2_x1`]: st(0, 'mm'),
    [`number.${p}_zone_2_y1`]: st(0, 'mm'),
    [`number.${p}_zone_2_x2`]: st(0, 'mm'),
    [`number.${p}_zone_2_y2`]: st(0, 'mm'),
    [`select.${p}_zone_type`]: st('Detection'),
  };
}

function ld6004States(p) {
  return {
    [`sensor.${p}_target_0_x`]: st(0.4, 'm'),
    [`sensor.${p}_target_0_y`]: st(2.1, 'm'),
    [`sensor.${p}_target_0_z`]: st(-0.8, 'm'),
    [`sensor.${p}_target_1_x`]: st('unknown', 'm'),
    [`sensor.${p}_target_1_y`]: st('unknown', 'm'),
    [`sensor.${p}_target_1_z`]: st('unknown', 'm'),
    [`sensor.${p}_target_2_x`]: st('unknown', 'm'),
    [`sensor.${p}_target_2_y`]: st('unknown', 'm'),
    [`sensor.${p}_target_2_z`]: st('unknown', 'm'),
    [`sensor.${p}_detection_zones`]: st(JSON.stringify([
      { x0: -0.5, x1: 1.0, y0: 1.5, y1: 3.0, z0: -1.5, z1: 0.5 },
      { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 },
    ])),
    [`binary_sensor.${p}_zone_0_presence`]: st('on'),
    [`select.${p}_install_method`]: st('Side'),
  };
}

test('LD2450: mm to metres, 0,0 and unavailable count as absent', () => {
  const a = getAdapter('ld2450');
  const hass = { states: ld2450States('estudio') };
  const f = buildFrame(a, hass, resolveEntities(a, { prefix: 'estudio' }), opts);
  assert.deepEqual(f.targets.map((t) => t.present), [true, false, false]);
  assert.equal(f.targets[0].x, -0.82);
  assert.equal(f.targets[0].y, 1.96);
  assert.equal(f.targets[0].speed, -0.35);
  assert.equal(f.targets[0].z, null);
  assert.ok(Math.abs(f.targets[0].distance - Math.hypot(0.82, 1.96)) < 1e-9);
});

test('LD2450: zero-area zones are skipped and occupancy comes from coordinates', () => {
  const a = getAdapter('ld2450');
  const hass = { states: ld2450States('estudio') };
  const f = buildFrame(a, hass, resolveEntities(a, { prefix: 'estudio' }), opts);
  assert.equal(f.zones.length, 1);
  assert.equal(f.zones[0].kind, 'detection');
  assert.equal(f.zones[0].occupied, true);
  assert.equal(f.targets[0].zone, f.zones[0]);
});

test('LD2450: zone_type Filter marks exclusion zones and Disabled removes them', () => {
  const a = getAdapter('ld2450');
  const ent = resolveEntities(a, { prefix: 'estudio' });
  const states = ld2450States('estudio');
  states['select.estudio_zone_type'] = st('Filter');
  let f = buildFrame(a, { states }, ent, opts);
  assert.equal(f.zones[0].kind, 'filter');
  assert.equal(f.targets[0].zone, null);
  states['select.estudio_zone_type'] = st('Disabled');
  f = buildFrame(a, { states }, ent, opts);
  assert.equal(f.zones.length, 0);
});

test('LD6004: NaN is absent, Z above the floor, posture and JSON zones', () => {
  const a = getAdapter('ld6004');
  const hass = { states: ld6004States('radar') };
  const f = buildFrame(a, hass, resolveEntities(a, { prefix: 'radar' }), opts);
  assert.deepEqual(f.targets.map((t) => t.present), [true, false, false]);
  assert.ok(Math.abs(f.targets[0].z - 0.7) < 1e-9);
  assert.equal(f.targets[0].posture, 'sitting');
  assert.equal(f.mount, 'wall');
  assert.equal(f.zones.length, 1);
  assert.ok(Math.abs(f.zones[0].z1 - 0) < 1e-9);
  assert.ok(Math.abs(f.zones[0].z2 - 2.0) < 1e-9);
  assert.equal(f.zones[0].occupied, true);
  assert.equal(f.targets[0].zone, f.zones[0]);
});

test('LD6004: install_method Top means ceiling mount', () => {
  const a = getAdapter('ld6004');
  const states = ld6004States('radar');
  states['select.radar_install_method'] = st('Top');
  assert.equal(buildFrame(a, { states }, resolveEntities(a, { prefix: 'radar' }), opts).mount, 'ceiling');
});

test('invert_x mirrors targets and zones', () => {
  const a = getAdapter('ld2450');
  const f = buildFrame(a, { states: ld2450States('e') }, resolveEntities(a, { prefix: 'e' }), { ...opts, invertX: true });
  assert.equal(f.targets[0].x, 0.82);
  assert.deepEqual([f.zones[0].x1, f.zones[0].x2], [1.2, -0.6]);
  assert.equal(f.zones[0].occupied, true);
});

test('entities.targets overrides single entities from the prefix', () => {
  const a = getAdapter('ld2450');
  const ent = resolveEntities(a, { prefix: 'e', entities: { targets: [{ x: 'sensor.otro_x' }] } });
  assert.equal(ent.targets[0].x, 'sensor.otro_x');
  assert.equal(ent.targets[0].y, 'sensor.e_target_1_y');
});

test('detectDevices tells LD2450 (target_1..3) from LD6004 (target_0..2 with Z)', () => {
  const hass = { states: { ...ld2450States('estudio'), ...ld6004States('radar') } };
  assert.deepEqual(detectDevices(hass), [
    { device: 'ld2450', prefix: 'estudio' },
    { device: 'ld6004', prefix: 'radar' },
  ]);
});

test('parseZones keeps the zone index and ignores broken JSON', () => {
  assert.deepEqual(parseZones('not json'), []);
  const zones = parseZones('[{"x0":0,"x1":0,"y0":0,"y1":0,"z0":0,"z1":0},{"x0":-1,"x1":1,"y0":1,"y1":2,"z0":0,"z1":0}]');
  assert.equal(zones[0], null);
  assert.deepEqual(zones[1], { x1: -1, x2: 1, y1: 1, y2: 2, z1: null, z2: null });
});

test('classifyPosture uses the configured thresholds', () => {
  const th = { sitting: 0.95, lying: 0.45 };
  assert.equal(classifyPosture(1.1, th), 'standing');
  assert.equal(classifyPosture(0.7, th), 'sitting');
  assert.equal(classifyPosture(0.3, th), 'lying');
});
