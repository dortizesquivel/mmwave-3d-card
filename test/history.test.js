import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexAt, parseHistory, historySpan, statesAt } from '../src/history.js';
import { blur, buildHeatmap, combine } from '../src/heatmap.js';

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

test('buildHeatmap adds up the time each target spends in each cell', () => {
  const map = buildHeatmap({
    start: 0, end: 10000, step: 1000, cell: 1,
    bounds: { x1: -2, x2: 2, y1: 0, y2: 4 },
    sampleAt: (t) => [
      { id: 1, present: true, x: 0.5, y: 1.5 },
      { id: 2, present: t < 5000, x: -1.5, y: 3.5 },
      { id: 3, present: false },
    ],
  });
  assert.equal(map.cols, 4);
  assert.equal(map.rows, 4);
  assert.deepEqual(map.totals, [10, 5, 0]);
  const sum = (layer) => layer.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum(map.layers[0]) - 10) < 1e-4, 'blur keeps each target\'s time');
  assert.ok(Math.abs(sum(map.layers[1]) - 5) < 1e-4);
  assert.equal(sum(map.layers[2]), 0);
});

test('combine paints each cell with the target that spent most time there, and honours hidden targets', () => {
  const map = { cols: 2, rows: 1, layers: [new Float32Array([4, 1]), new Float32Array([1, 3])], totals: [5, 4] };
  const both = combine(map, [true, true]);
  assert.deepEqual([...both.values], [5, 4]);
  assert.deepEqual([...both.owner], [0, 1]);
  assert.equal(both.max, 5);
  assert.equal(both.total, 9);
  const onlySecond = combine(map, [false, true]);
  assert.deepEqual([...onlySecond.values], [1, 3]);
  assert.deepEqual([...onlySecond.owner], [1, 1]);
  assert.equal(onlySecond.total, 4);
});

test('blur spreads a point to its neighbours', () => {
  const src = new Float32Array(9); src[4] = 16;
  assert.deepEqual([...blur(src, 3, 3)], [1, 2, 1, 2, 4, 2, 1, 2, 1]);
});
