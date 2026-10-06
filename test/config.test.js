import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';

test('fills device defaults', () => {
  const c = normalizeConfig({ device: 'ld6004', prefix: 'radar' });
  assert.equal(c.mount, 'auto');
  assert.equal(c.max_range, 6);
  assert.equal(c.fov, 120);
  assert.equal(c.mount_height, 1.5);
  assert.equal(c.view, '3d');
  assert.equal(c.z_offset, null);
  assert.deepEqual(c.posture, { sitting: 0.95, lying: 0.45 });
  assert.equal(normalizeConfig({ device: 'ld2450', prefix: 'x' }).mount, 'wall');
});

test('rejects configs HA should flag', () => {
  assert.throws(() => normalizeConfig({ prefix: 'x' }), /device/);
  assert.throws(() => normalizeConfig({ device: 'ld9999', prefix: 'x' }), /Unsupported device/);
  assert.throws(() => normalizeConfig({ device: 'ld2450' }), /prefix/);
  assert.throws(() => normalizeConfig({ device: 'ld2450', prefix: 'x', view: 'top' }), /view/);
  assert.throws(() => normalizeConfig({ device: 'ld2450', prefix: 'x', mount_height: 'high' }), /mount_height/);
  assert.throws(() => normalizeConfig({ device: 'ld6004', prefix: 'x', posture: { sitting: 0.4, lying: 0.6 } }), /posture/);
});

test('entities.targets is enough without a prefix', () => {
  const c = normalizeConfig({ device: 'ld2450', entities: { targets: [{ x: 'sensor.a', y: 'sensor.b' }] } });
  assert.equal(c.prefix, '');
});
