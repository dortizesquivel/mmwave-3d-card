import { findPrefixes, readLength, readNumber, readSpeed, readText, stateOf } from './common.js';

const PER_METRE = { mm: 1000, cm: 100, m: 1 };

// HLK-LD2450 with the official ESPHome `ld2450` component.
// Entity ids follow the names in its docs ("Target-1 X", "Zone-1 X1", ...).
// Coordinates are in mm; with no target it publishes X = Y = 0.
export const ld2450 = {
  type: 'ld2450',
  label: 'HLK-LD2450',
  hasZ: false,
  hasSpeed: true,
  editableKinds: ['detection', 'filter'],   // Filter zones use the same number entities
  zoneStep: 0.05,                           // m; the number entities take whole millimetres
  defaults: { mount: 'wall', maxRange: 6, fov: 120 },

  detect(hass) {
    return findPrefixes(hass, /^sensor\.(.+)_target_3_x$/).filter(
      (p) => hass.states[`sensor.${p}_target_1_x`] && !hass.states[`sensor.${p}_target_0_x`],
    );
  },

  entities(prefix) {
    const sensor = (key) => `sensor.${prefix}_${key}`;
    const number = (key) => `number.${prefix}_${key}`;
    return {
      targets: [1, 2, 3].map((i) => ({
        x: sensor(`target_${i}_x`),
        y: sensor(`target_${i}_y`),
        speed: sensor(`target_${i}_speed`),
      })),
      zones: [1, 2, 3].map((i) => ({
        x1: number(`zone_${i}_x1`),
        y1: number(`zone_${i}_y1`),
        x2: number(`zone_${i}_x2`),
        y2: number(`zone_${i}_y2`),
        count: sensor(`zone_${i}_all_target_count`),
      })),
      zoneType: `select.${prefix}_zone_type`,
    };
  },

  read(hass, ent) {
    const targets = ent.targets.map((e, i) => {
      const x = readLength(hass, e.x, 'mm');
      const y = readLength(hass, e.y, 'mm');
      const present = x !== null && y !== null && !(x === 0 && y === 0);
      return {
        id: i + 1,
        present,
        x: present ? x : null,
        y: present ? y : null,
        z: null,
        speed: present ? readSpeed(hass, e.speed, 'mm/s') : null,
      };
    });

    // Disabled | Detection | Filter. Without the entity, zones are treated as detection zones.
    const zoneType = readText(hass, ent.zoneType);
    const kind = zoneType === 'Filter' ? 'filter' : 'detection';
    const zones = zoneType === 'Disabled' ? [] : ent.zones.map((e, i) => {
      const [x1, y1, x2, y2] = [e.x1, e.y1, e.x2, e.y2].map((id) => readLength(hass, id, 'mm'));
      if ([x1, y1, x2, y2].includes(null) || x1 === x2 || y1 === y2) return null;  // not configured
      return {
        id: i + 1, slot: i, kind, x1, x2, y1, y2, z1: null, z2: null, count: readNumber(hass, e.count), occupied: null,
        entity: hass.states[e.count] ? e.count : e.x1,
      };
    }).filter(Boolean);

    return { targets, zones, mount: null };
  },

  /** Whether the card can move this sensor's zones. */
  zoneEditing(hass, ent) {
    if (readText(hass, ent.zoneType) === 'Disabled') return { supported: false, reason: 'zonesDisabled' };
    const ok = ent.zones.every((z) => [z.x1, z.y1, z.x2, z.y2].every((id) => hass.states[id]));
    return ok ? { supported: true, slots: ent.zones.length } : { supported: false, reason: 'missingNumbers' };
  },

  /** Writes a zone (sensor frame, metres) to the four number entities of `slot`; null clears it. */
  async writeZone(hass, ent, slot, rect) {
    const e = ent.zones[slot];
    const v = rect
      ? { x1: Math.min(rect.x1, rect.x2), y1: Math.min(rect.y1, rect.y2), x2: Math.max(rect.x1, rect.x2), y2: Math.max(rect.y1, rect.y2) }
      : { x1: 0, y1: 0, x2: 0, y2: 0 };
    await Promise.all(Object.entries(v).map(([key, metres]) => setNumber(hass, e[key], metres)));
  },

  entityIds(ent) {
    return [
      ...ent.targets.flatMap((t) => [t.x, t.y, t.speed]),
      ...ent.zones.flatMap((z) => [z.x1, z.y1, z.x2, z.y2, z.count]),
      ent.zoneType,
    ];
  },
};

// number.set_value in the entity's own unit, rounded to its step and kept inside its min/max.
function setNumber(hass, entityId, metres) {
  const a = stateOf(hass, entityId)?.attributes ?? {};
  const step = Number(a.step) || 1;
  let value = Math.round((metres * (PER_METRE[a.unit_of_measurement] ?? 1000)) / step) * step;
  if (Number.isFinite(Number(a.min))) value = Math.max(Number(a.min), value);
  if (Number.isFinite(Number(a.max))) value = Math.min(Number(a.max), value);
  return hass.callService('number', 'set_value', { entity_id: entityId, value });
}
