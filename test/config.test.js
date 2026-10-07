import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';

test('fills device defaults', () => {
  const c = normalizeConfig({ device: 'ld6004', prefix: 'radar' });
  assert.equal(c.mount, 'auto');
  assert.equal(c.max_range, 6);
  assert.equal(c.fov, 120);
  assert.equal(c.mount_height, 1.5);
  assert.equal(c.tilt, 0);
  assert.equal(c.view, '3d');
  assert.equal(c.z_offset, null);
  assert.deepEqual(c.posture, { sitting: 0.95, lying: 0.45 });
  assert.equal(c.show_interference, true);
  assert.equal(normalizeConfig({ device: 'ld6004', prefix: 'radar', show_interference: false }).show_interference, false);
  assert.equal(normalizeConfig({ device: 'ld2450', prefix: 'x' }).mount, 'wall');
});

test('rejects configs HA should flag', () => {
  assert.throws(() => normalizeConfig({ prefix: 'x' }), /device/);
  assert.throws(() => normalizeConfig({ device: 'ld9999', prefix: 'x' }), /Unsupported device/);
  assert.throws(() => normalizeConfig({ device: 'ld2450' }), /prefix/);
  assert.throws(() => normalizeConfig({ device: 'ld2450', prefix: 'x', view: 'top' }), /view/);
  assert.throws(() => normalizeConfig({ device: 'ld2450', prefix: 'x', mount_height: 'high' }), /mount_height/);
  assert.throws(() => normalizeConfig({ device: 'ld2410', prefix: 'x', tilt: 95 }), /tilt/);
  assert.throws(() => normalizeConfig({ device: 'ld2410', prefix: 'x', tilt: -5 }), /tilt/);
  assert.equal(normalizeConfig({ device: 'ld2410', prefix: 'x', tilt: '20' }).tilt, 20);
  assert.throws(() => normalizeConfig({ device: 'ld6004', prefix: 'x', posture: { sitting: 0.4, lying: 0.6 } }), /posture/);
});

test('entities.targets is enough without a prefix', () => {
  const c = normalizeConfig({ device: 'ld2450', entities: { targets: [{ x: 'sensor.a', y: 'sensor.b' }] } });
  assert.equal(c.prefix, '');
});

test('room: walls, doors and furniture are checked and filled in', () => {
  const room = normalizeConfig({
    device: 'ld2450', prefix: 'x',
    room: { walls: [[-2, 0], [2, 0], [2, 5], [-2, 5]], doors: [{ from: [2, 1], to: [2, 1.9] }], furniture: [{ name: 'Desk', x: [0.6, -1.2], y: [2.6, 0.9] }] },
  }).room;
  assert.equal(room.wall_height, 2.4);
  assert.deepEqual(room.doors, [{ from: [2, 1], to: [2, 1.9] }]);
  assert.deepEqual(room.furniture, [{ name: 'Desk', x: [-1.2, 0.6], y: [0.9, 2.6], height: 0.75 }]);   // ranges sorted, default height
  assert.equal(normalizeConfig({ device: 'ld2450', prefix: 'x' }).room, null);
  const bad = (room) => () => normalizeConfig({ device: 'ld2450', prefix: 'x', room });
  assert.throws(bad('kitchen'), /"room" must be an object/);
  assert.throws(bad({ walls: [[0, 0], [1, 0]] }), /at least 3 corners/);
  assert.throws(bad({ walls: [[0, 0], [1, 'a'], [1, 1]] }), /room\.walls\[1\]/);
  assert.throws(bad({ doors: [{ from: [0, 0] }] }), /room\.doors\[0\]\.to/);
  assert.throws(bad({ furniture: [{ x: [1, 1], y: [0, 1] }] }), /room\.furniture\[0\]\.x" must span/);
  assert.throws(bad({ wall_height: 'tall' }), /room\.wall_height/);
});

test('zone_service must be an ESPHome service', () => {
  assert.equal(normalizeConfig({ device: 'ld6004', prefix: 'x', zone_service: 'esphome.hlk_set_detection_zone' }).zone_service, 'esphome.hlk_set_detection_zone');
  assert.throws(() => normalizeConfig({ device: 'ld6004', prefix: 'x', zone_service: 'light.turn_on' }), /zone_service/);
});
