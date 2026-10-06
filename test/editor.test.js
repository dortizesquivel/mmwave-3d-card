import { test } from 'node:test';
import assert from 'node:assert/strict';

// editor.js defines a custom element at import time; give it the minimum it needs under Node.
globalThis.HTMLElement ??= class {};
globalThis.customElements ??= { get: () => undefined, define: () => {} };
const { editorSchema, fromFormData, toFormData } = await import('../src/editor.js');

const L = new Proxy({}, { get: (_, k) => String(k) });
const names = (schema) => schema.flatMap((s) => (s.schema ? names(s.schema) : [s.name]));

test('form data round-trips and keeps keys the form does not edit', () => {
  const config = {
    type: 'custom:mmwave-3d-card', device: 'ld6004', prefix: 'radar', zone_names: ['Desk', 'Sofa'],
    posture: { sitting: 0.9 }, room: { walls: [[0, 0], [1, 0], [1, 1]] },
  };
  const data = toFormData(config);
  assert.equal(data.zone_names, 'Desk, Sofa');
  assert.equal(data.posture_sitting, 0.9);
  assert.equal(data.show_trail, true);
  assert.deepEqual(fromFormData(data, config), config);
});

test('the form shows the defaults for the chosen sensor', () => {
  const ld6004 = toFormData({ device: 'ld6004', prefix: 'x' });
  assert.equal(ld6004.mount, 'auto');
  assert.equal(ld6004.max_range, 6);
  assert.equal(ld6004.invert_x, false);
  assert.equal(ld6004.posture_lying, 0.45);
  assert.equal(toFormData({ device: 'ld2450', prefix: 'x' }).mount, 'wall');
});

test('fromFormData drops defaults and empty values', () => {
  const prev = { type: 'custom:mmwave-3d-card', device: 'ld2450', prefix: 'x', title: 'Old', posture: { lying: 0.4 } };
  const out = fromFormData({ ...toFormData(prev), title: '', show_table: false, zone_names: ' A , ,B ', posture_lying: '' }, prev);
  assert.deepEqual(out, { type: 'custom:mmwave-3d-card', device: 'ld2450', prefix: 'x', show_table: false, zone_names: ['A', 'B'] });
});

test('height and posture fields only appear for sensors with Z', () => {
  assert.ok(!names(editorSchema({ device: 'ld2450' }, null, L)).includes('posture_sitting'));
  assert.ok(names(editorSchema({ device: 'ld6004' }, null, L)).includes('zone_service'));
});

test('the prefix list offers the detected devices of the chosen model', () => {
  const st = { state: '0', attributes: {} };
  const hass = { states: {
    'sensor.study_target_1_x': st, 'sensor.study_target_3_x': st,
    'sensor.radar_target_0_x': st, 'sensor.radar_target_0_z': st,
  } };
  const prefix = editorSchema({ device: 'ld2450' }, hass, L).find((s) => s.name === 'prefix');
  assert.deepEqual(prefix.selector.select.options.map((o) => o.value), ['study']);
});
