// Reads Home Assistant states normalised to metres and m/s.

// Divisors to metres and m/s: -820 / 1000 gives -0.82, while -820 * 0.001 gives -0.8200000000000001.
const LENGTH = { mm: 1000, cm: 100, m: 1 };
const SPEED = { 'mm/s': 1000, 'cm/s': 100, 'm/s': 1, 'km/h': 3.6 };
// These radars see about 10 m. A length past this is a corrupt state, not a reading (and it would overflow
// the distances drawn from it; found by the fuzz tests).
export const MAX_LENGTH = 1000;

export function stateOf(hass, entityId) {
  return entityId ? hass.states[entityId] : undefined;
}

/** Numeric state, or null when the entity is missing, unavailable or NaN. */
export function readNumber(hass, entityId) {
  const s = stateOf(hass, entityId);
  if (!s) return null;
  const v = Number.parseFloat(s.state);
  return Number.isFinite(v) ? v : null;
}

function readScaled(hass, entityId, table, fallbackUnit) {
  const v = readNumber(hass, entityId);
  if (v === null) return null;
  const unit = stateOf(hass, entityId).attributes?.unit_of_measurement;
  return v / (table[unit] ?? table[fallbackUnit] ?? 1);
}

/** Length in metres, from unit_of_measurement or `fallbackUnit` when the entity has none; null past MAX_LENGTH. */
export function readLength(hass, entityId, fallbackUnit) {
  const v = readScaled(hass, entityId, LENGTH, fallbackUnit);
  return v !== null && Math.abs(v) <= MAX_LENGTH ? v : null;
}

/** Speed in m/s. */
export const readSpeed = (hass, entityId, fallbackUnit) => readScaled(hass, entityId, SPEED, fallbackUnit);

export function readText(hass, entityId) {
  const s = stateOf(hass, entityId);
  if (!s || s.state === 'unknown' || s.state === 'unavailable') return null;
  return s.state;
}

export function readBool(hass, entityId) {
  const s = stateOf(hass, entityId);
  if (s?.state === 'on') return true;
  if (s?.state === 'off') return false;
  return null;
}

/** Device prefixes of entities matching `pattern` (a regex with the prefix in group 1). */
export function findPrefixes(hass, pattern) {
  const found = new Set();
  for (const id of Object.keys(hass.states)) {
    const m = pattern.exec(id);
    if (m) found.add(m[1]);
  }
  return [...found].sort();
}
