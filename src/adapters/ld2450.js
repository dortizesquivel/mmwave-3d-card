import { findPrefixes, readLength, readNumber, readSpeed, readText } from './common.js';

// HLK-LD2450 with the official ESPHome `ld2450` component.
// Entity ids follow the names in its docs ("Target-1 X", "Zone-1 X1", ...).
// Coordinates are in mm; with no target it publishes X = Y = 0.
export const ld2450 = {
  type: 'ld2450',
  label: 'HLK-LD2450',
  hasZ: false,
  hasSpeed: true,
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
      return { id: i + 1, kind, x1, x2, y1, y2, z1: null, z2: null, count: readNumber(hass, e.count), occupied: null };
    }).filter(Boolean);

    return { targets, zones, mount: null };
  },

  entityIds(ent) {
    return [
      ...ent.targets.flatMap((t) => [t.x, t.y, t.speed]),
      ...ent.zones.flatMap((z) => [z.x1, z.y1, z.x2, z.y2, z.count]),
      ent.zoneType,
    ];
  },
};
