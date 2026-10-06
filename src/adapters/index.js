import { ld2450 } from './ld2450.js';
import { ld6004 } from './ld6004.js';

// Each adapter maps one ESPHome component's entities to a common model:
// sensor coordinates in metres (x sideways, y forward, z up) and zones as boxes.
export const ADAPTERS = { ld2450, ld6004 };

export function getAdapter(type) {
  const adapter = ADAPTERS[type];
  if (!adapter) throw new Error(`Unsupported device "${type}". Options: ${Object.keys(ADAPTERS).join(', ')}`);
  return adapter;
}

/** Supported devices found in HA: [{ device, prefix }]. */
export function detectDevices(hass) {
  return Object.values(ADAPTERS).flatMap((a) => a.detect(hass).map((prefix) => ({ device: a.type, prefix })));
}

/** Entities for the prefix, with any `entities.targets` overrides from the config. */
export function resolveEntities(adapter, config) {
  const ent = adapter.entities(config.prefix || '');
  (config.entities?.targets ?? []).forEach((override, i) => {
    if (ent.targets[i] && override) ent.targets[i] = { ...ent.targets[i], ...override };
  });
  return ent;
}

export function classifyPosture(z, thresholds) {
  if (z >= thresholds.sitting) return 'standing';
  if (z >= thresholds.lying) return 'sitting';
  return 'lying';
}

const between = (v, a, b) => v >= Math.min(a, b) && v <= Math.max(a, b);

export function inZone(target, zone) {
  if (!target.present) return false;
  if (!between(target.x, zone.x1, zone.x2) || !between(target.y, zone.y1, zone.y2)) return false;
  if (zone.z1 !== null && target.z !== null) return between(target.z, zone.z1, zone.z2);
  return true;
}

/**
 * One complete reading, ready to draw.
 * opts: { invertX, zOffset (metres added to the sensor-relative Z to get height above the floor), posture: { sitting, lying } }
 */
export function buildFrame(adapter, hass, ent, opts) {
  const raw = adapter.read(hass, ent);
  const sx = opts.invertX ? -1 : 1;
  const lift = (z) => (z === null ? null : z + opts.zOffset);

  const targets = raw.targets.map((t) => {
    if (!t.present) return { ...t, distance: null, posture: null, zone: null };
    const z = lift(t.z);
    return {
      ...t,
      x: t.x * sx,
      z,
      distance: Math.hypot(t.x, t.y),
      posture: z === null ? null : classifyPosture(z, opts.posture),
      zone: null,
    };
  });

  const zones = raw.zones.map((z) => ({ ...z, x1: z.x1 * sx, x2: z.x2 * sx, z1: lift(z.z1), z2: lift(z.z2) }));
  for (const zone of zones) {
    zone.inside = targets.filter((t) => inZone(t, zone)).length;
    if (zone.occupied === null) zone.occupied = zone.count !== null ? zone.count > 0 : zone.inside > 0;
  }
  for (const t of targets) t.zone = zones.find((z) => z.kind === 'detection' && inZone(t, z)) ?? null;

  return { targets, zones, mount: raw.mount };
}
