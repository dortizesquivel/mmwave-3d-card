import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { modelPlacement, modelSensorHeight, modelToScene, normalizeModel } from '../src/model.js';

const STUDY = { url: '/local/room.glb', sensor: { position: [3.54, 2.25, 5.88], heading: 180 } };
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} ≈ ${b}`));

test('model: defaults and checks', () => {
  const m = normalizeModel(STUDY);
  assert.deepEqual({ units: m.units, scale: m.scale, up: m.up, floor: m.floor, opacity: m.opacity, style: m.style },
    { units: 'm', scale: 1, up: 'y', floor: 0, opacity: 1, style: 'textured' });
  assert.equal(normalizeModel({ ...STUDY, style: 'futuristic' }).style, 'futuristic');
  assert.equal(m.color, null);
  assert.equal(normalizeModel({ ...STUDY, color: '#ff00aa' }).color, '#ff00aa');
  assert.equal(normalizeModel(null), null);
  assert.equal(normalizeModel({ ...STUDY, units: 'cm' }).scale, 0.01);
  assert.equal(normalizeModel({ ...STUDY, sensor: { position: [0, 2, 0] } }).sensor.heading, 0);
  const bad = (m) => () => normalizeModel(m);
  assert.throws(bad('room.glb'), /"model" must be an object/);
  assert.throws(bad({ sensor: STUDY.sensor }), /model.url/);
  assert.throws(bad({ ...STUDY, units: 'yd' }), /model.units/);
  assert.throws(bad({ ...STUDY, up: 'x' }), /model.up/);
  assert.throws(bad({ url: 'a.glb' }), /model.sensor.position/);
  assert.throws(bad({ url: 'a.glb', sensor: { position: [1, 2] } }), /model.sensor.position/);
  assert.throws(bad({ ...STUDY, opacity: 0 }), /model.opacity/);
  assert.throws(bad({ ...STUDY, style: 'neon' }), /model.style/);
  assert.throws(bad({ ...STUDY, floor: 3 }), /above "model.floor"/);
  assert.throws(bad({ ...STUDY, sensor: { ...STUDY.sensor, heading: 'north' } }), /model.sensor.heading/);
});

test('model: the sensor lands at the origin, facing +Z, with the floor at 0', () => {
  const m = normalizeModel(STUDY);
  const h = modelSensorHeight(m);
  assert.equal(h, 2.25);
  near(modelToScene(m, [3.54, 2.25, 5.88]), [0, h, 0]);
  // facing -z in the model (heading 180): a point 1 m in front of the sensor is 1 m along +Z
  near(modelToScene(m, [3.54, 2.25, 4.88]), [0, h, 1]);
  // its right is the model's +x, and the radar's right is the scene's -X
  near(modelToScene(m, [4.54, 0, 5.88]), [-1, 0, 0]);
  // a raised floor still ends up at 0
  const raised = normalizeModel({ ...STUDY, floor: 0.5, sensor: { position: [0, 2.5, 0], heading: 90 } });
  near(modelToScene(raised, [0, 0.5, 0]), [0, 0, 0]);
  near(modelToScene(raised, [1, 2.5, 0]), [0, 2, 1]);       // heading 90: the model's +x is ahead
});

test('model: placement for z-up files and other units', () => {
  const t = modelPlacement(normalizeModel({ ...STUDY, up: 'z', units: 'mm' }));
  assert.equal(t.upRotX, -Math.PI / 2);
  assert.equal(t.scale, 0.001);
  assert.deepEqual(t.offset, [-3.54, -2.25, -5.88]);
  assert.equal(modelPlacement(normalizeModel(STUDY)).upRotX, 0);
});

test('config: the model gives the mount height unless it is set', () => {
  assert.equal(normalizeConfig({ device: 'ld2450', prefix: 'x', model: STUDY }).mount_height, 2.25);
  assert.equal(normalizeConfig({ device: 'ld2450', prefix: 'x', model: STUDY, mount_height: 2.1 }).mount_height, 2.1);
  assert.equal(normalizeConfig({ device: 'ld2450', prefix: 'x' }).model, null);
  assert.throws(() => normalizeConfig({ device: 'ld2450', prefix: 'x', model: { url: 'a.glb' } }), /model.sensor.position/);
});
