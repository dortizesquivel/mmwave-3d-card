import { findPrefixes, readBool, readLength, readText } from './common.js';

// HLK-LD6004 with the external ESPHome component github.com/javierconfoie/esphome-ld6004.
// Entity ids follow the names in its example YAML ("Target 0 X", "Zone 0 Presence", ...).
// Coordinates are in metres, Z relative to the sensor. With no target it publishes NaN ("unknown" in HA).
export const ld6004 = {
  type: 'ld6004',
  label: 'HLK-LD6004',
  hasZ: true,
  hasSpeed: false,       // it only reports an internal Doppler index, not m/s
  editableKinds: ['detection', 'interference', 'dwell'],
  zoneStep: 0.1,         // m; the component reports zones with one decimal, so edits snap to 10 cm
  defaults: { mount: 'auto', maxRange: 6, fov: 120 },

  detect(hass) {
    return findPrefixes(hass, /^sensor\.(.+)_target_0_z$/).filter((p) => hass.states[`sensor.${p}_target_0_x`]);
  },

  entities(prefix) {
    const sensor = (key) => `sensor.${prefix}_${key}`;
    return {
      targets: [0, 1, 2].map((i) => ({
        x: sensor(`target_${i}_x`),
        y: sensor(`target_${i}_y`),
        z: sensor(`target_${i}_z`),
      })),
      zoneSets: [
        {
          kind: 'detection',
          text: sensor('detection_zones'),
          presence: [0, 1, 2, 3].map((i) => `binary_sensor.${prefix}_zone_${i}_presence`),
        },
        { kind: 'interference', text: sensor('interference_zones') },
        { kind: 'dwell', text: sensor('dwell_zones') },
      ],
      installMethod: `select.${prefix}_install_method`,
    };
  },

  read(hass, ent) {
    const targets = ent.targets.map((e, i) => {
      const x = readLength(hass, e.x, 'm');
      const y = readLength(hass, e.y, 'm');
      const present = x !== null && y !== null;
      return {
        id: i + 1,
        present,
        x: present ? x : null,
        y: present ? y : null,
        z: present ? readLength(hass, e.z, 'm') : null,
        speed: null,
      };
    });

    const zones = [];
    for (const set of ent.zoneSets) {
      parseZones(readText(hass, set.text)).forEach((z, i) => {
        if (!z) return;
        const occupied = set.presence ? readBool(hass, set.presence[i]) : null;
        zones.push({ id: i + 1, slot: i, kind: set.kind, ...z, count: null, occupied, entity: set.presence?.[i] ?? set.text });
      });
    }

    const method = readText(hass, ent.installMethod);   // Top | Side
    const mount = method === 'Top' ? 'ceiling' : method === 'Side' ? 'wall' : null;
    return { targets, zones, mount };
  },

  /**
   * Zones are written through the ESPHome services in the component's example YAML:
   * esphome.<node>_set_detection_zone, _set_interference_zone and _set_dwell_zone, four zones each.
   * The node name can't be derived from the entity prefix, so it is found automatically when there is
   * only one LD6004, or taken from `zone_service`. Kinds whose service is missing can't be edited.
   */
  zoneEditing(hass, ent, cfg) {
    const services = Object.keys(hass.services?.esphome ?? {});
    let node;
    if (cfg.zone_service) {
      node = cfg.zone_service.replace(/^esphome\./, '').replace(/_set_(detection|interference|dwell)_zone$/, '');
      if (!services.includes(`${node}_set_detection_zone`)) return { supported: false, reason: 'serviceNotFound' };
    } else {
      const found = services.filter((s) => s.endsWith('_set_detection_zone'));
      if (found.length !== 1) return { supported: false, reason: found.length ? 'serviceAmbiguous' : 'serviceNotFound' };
      node = found[0].replace(/_set_detection_zone$/, '');
    }
    const kinds = ['detection', 'interference', 'dwell'].filter((k) => services.includes(`${node}_set_${k}_zone`));
    return { supported: true, node, kinds, slots: 4 };
  },

  /** Writes `zone` (its kind and slot) in the sensor frame, metres, Z relative to the sensor; null clears it. */
  writeZone(hass, ent, zone, rect, editing) {
    const mm = (n) => Math.round(n * 1000) / 1000;      // 1.3 - 1.5 would otherwise send -0.19999999999999996
    const v = rect
      ? {
        x_min: mm(Math.min(rect.x1, rect.x2)), x_max: mm(Math.max(rect.x1, rect.x2)),
        y_min: mm(Math.min(rect.y1, rect.y2)), y_max: mm(Math.max(rect.y1, rect.y2)),
        z_min: mm(rect.z1), z_max: mm(rect.z2),
      }
      : { x_min: 0, x_max: 0, y_min: 0, y_max: 0, z_min: 0, z_max: 0 };
    return hass.callService('esphome', `${editing.node}_set_${zone.kind}_zone`, { zone_index: zone.slot, ...v });
  },

  entityIds(ent) {
    return [
      ...ent.targets.flatMap((t) => [t.x, t.y, t.z]),
      ...ent.zoneSets.flatMap((s) => [s.text, ...(s.presence ?? [])]),
      ent.installMethod,
    ];
  },
};

/**
 * Zones from the component's text sensor: `[{"x0":..,"x1":..,"y0":..,"y1":..,"z0":..,"z1":..}, ...]` in metres.
 * Returns one entry per zone, keeping the index, with null for empty or unreadable zones.
 */
export function parseZones(text) {
  if (!text) return [];
  let list;
  try { list = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.map((z) => {
    const v = [z?.x0, z?.x1, z?.y0, z?.y1, z?.z0, z?.z1].map(Number);
    if (v.some((n) => !Number.isFinite(n))) return null;
    const [x1, x2, y1, y2, z1, z2] = v;
    if (x1 === x2 || y1 === y2) return null;
    const hasZ = z1 !== z2;
    return { x1, x2, y1, y2, z1: hasZ ? Math.min(z1, z2) : null, z2: hasZ ? Math.max(z1, z2) : null };
  });
}
