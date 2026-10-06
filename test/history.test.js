import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexAt, parseHistory, historySpan, statesAt } from '../src/history.js';
import { blur, buildHeatmap } from '../src/heatmap.js';

test('parseHistory reads compressed and full states, sorted by time', () => {
  const h = parseHistory({
    'sensor.a': [{ s: '10', lu: 2 }, { s: '5', lu: 1 }],
    'sensor.b': [{ state: 'on', last_updated: '1970-01-01T00:00:03Z' }],
  }, ['sensor.a', 'sensor.b', 'sensor.c']);
  assert.deepEqual(h.get('sensor.a'), { t: [1000, 2000], s: ['5', '10'] });
  assert.deepEqual(h.get('sensor.b'), { t: [3000], s: ['on'] });
  assert.deepEqual(h.get('sensor.c'), { t: [], s: [] });
  assert.deepEqual(historySpan(h), { first: 1000, last: 3000 });
});

test('indexAt finds the last sample at or before t', () => {
  const s = { t: [10, 20, 30], s: ['a', 'b', 'c'] };
  assert.equal(indexAt(s, 5), -1);
  assert.equal(indexAt(s, 10), 0);
  assert.equal(indexAt(s, 25), 1);
  assert.equal(indexAt(s, 99), 2);
});

test('statesAt keeps attributes from the current states and marks the past as unavailable', () => {
  const history = new Map([['sensor.x', { t: [1000], s: ['-820'] }]]);
  const base = { 'sensor.x': { state: '0', attributes: { unit_of_measurement: 'mm' } }, 'number.z': { state: '5', attributes: {} } };
  assert.deepEqual(statesAt(history, 1500, base)['sensor.x'], { state: '-820', attributes: { unit_of_measurement: 'mm' } });
  assert.equal(statesAt(history, 500, base)['sensor.x'].state, 'unavailable');
  assert.equal(statesAt(history, 1500, base)['number.z'].state, '5');
});

test('buildHeatmap adds the time each target spends in a cell', () => {
  const map = buildHeatmap({
    start: 0, end: 10000, step: 1000, cell: 1,
    bounds: { x1: -2, x2: 2, y1: 0, y2: 4 },
    sampleAt: (t) => [{ present: true, x: 0.5, y: 1.5 }, { present: t < 5000, x: -1.5, y: 3.5 }, { present: false }],
  });
  assert.equal(map.cols, 4);
  assert.equal(map.rows, 4);
  assert.ok(Math.abs(map.total - 15) < 1e-9);
  const sum = map.values.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 15) < 1e-4, 'blur keeps the total time');
  assert.ok(map.values[1 * 4 + 2] === map.max, 'the busiest cell is where the first target stood');
});

test('blur spreads a point to its neighbours', () => {
  const src = new Float32Array(9); src[4] = 16;
  assert.deepEqual([...blur(src, 3, 3)], [1, 2, 1, 2, 4, 2, 1, 2, 1]);
});
