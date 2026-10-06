import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strings, zoneName } from '../src/i18n.js';

test('detection zones use zone_names, the other kinds have their own numbering', () => {
  const en = strings('en');
  assert.equal(zoneName({ kind: 'detection', id: 1 }, en, ['Desk']), 'Desk');
  assert.equal(zoneName({ kind: 'detection', id: 2 }, en, ['Desk']), 'Zone 2');
  assert.equal(zoneName({ kind: 'interference', id: 1 }, en, ['Desk']), 'Interference 1');
  assert.equal(zoneName({ kind: 'filter', id: 3 }, en), 'Excluded 3');
  assert.equal(zoneName({ kind: 'dwell', id: 2 }, en), 'Dwell 2');
  assert.equal(zoneName({ kind: 'interference', id: 1 }, strings('es-ES')), 'Interferencia 1');
});
