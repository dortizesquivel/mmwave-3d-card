import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, strings, zoneName } from '../src/i18n.js';

test('detection zones use zone_names, the other kinds have their own numbering', () => {
  const en = strings('en');
  assert.equal(zoneName({ kind: 'detection', id: 1 }, en, ['Desk']), 'Desk');
  assert.equal(zoneName({ kind: 'detection', id: 2 }, en, ['Desk']), 'Zone 2');
  assert.equal(zoneName({ kind: 'interference', id: 1 }, en, ['Desk']), 'Interference 1');
  assert.equal(zoneName({ kind: 'filter', id: 3 }, en), 'Excluded 3');
  assert.equal(zoneName({ kind: 'dwell', id: 2 }, en), 'Dwell 2');
  assert.equal(zoneName({ kind: 'interference', id: 1 }, strings('es-ES')), 'Interferencia 1');
});

test('durations read as seconds, minutes or hours', () => {
  assert.equal(formatDuration(45), '45 s');
  assert.equal(formatDuration(89), '1 min');
  assert.equal(formatDuration(59 * 60), '59 min');
  assert.equal(formatDuration(2 * 3600), '2 h');
  assert.equal(formatDuration(3 * 3600 + 20 * 60), '3 h 20 min');
});

test('Spanish for any Spanish locale, English otherwise', () => {
  assert.equal(strings('es-ES').nobody, 'Nadie');
  assert.equal(strings('es').heatmap, 'Mapa de calor');
  assert.equal(strings('en-GB').nobody, 'Nobody');
  assert.equal(strings('fr').nobody, 'Nobody');
  assert.equal(strings(undefined).nobody, 'Nobody');
  // every key exists in both languages
  assert.deepEqual(Object.keys(strings('es')).sort(), Object.keys(strings('en')).sort());
});

test('every message with a value fills it in, in both languages', () => {
  for (const lang of ['en', 'es']) {
    const t = strings(lang);
    const fns = [];
    const walk = (o, path) => {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'function') fns.push([`${path}${k}`, v]);
        else if (v && typeof v === 'object') walk(v, `${path}${k}.`);
      }
    };
    walk(t, '');
    assert.ok(fns.length > 10);
    for (const [name, fn] of fns) {
      const out = fn(7);
      assert.equal(typeof out, 'string', `${lang} ${name}`);
      assert.ok(out.includes('7') && !out.includes('undefined'), `${lang} ${name}: ${out}`);
    }
  }
});
