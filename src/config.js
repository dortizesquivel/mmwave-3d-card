import { getAdapter } from './adapters/index.js';
import { modelSensorHeight, normalizeModel } from './model.js';

export const VIEWS = ['3d', 'plan', 'sensor'];
const MOUNTS = ['auto', 'wall', 'ceiling'];

function num(value, fallback, name) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`"${name}" must be a number`);
  return n;
}

function point(p, name) {
  const v = Array.isArray(p) ? p.map(Number) : [];
  if (v.length !== 2 || !v.every(Number.isFinite)) throw new Error(`"${name}" must be a point like [1.2, 3.4] (metres)`);
  return v;
}

function range(r, name) {
  const v = point(r, name);
  if (v[0] === v[1]) throw new Error(`"${name}" must span some distance`);
  return [Math.min(...v), Math.max(...v)];
}

/** room: { walls: [[x, y], ...], wall_height, doors: [{ from, to }], furniture: [{ name, x: [a, b], y: [a, b], height }] } */
function normalizeRoom(r) {
  if (!r) return null;
  if (typeof r !== 'object') throw new Error('"room" must be an object');
  const walls = (r.walls ?? []).map((p, i) => point(p, `room.walls[${i}]`));
  if (walls.length && walls.length < 3) throw new Error('"room.walls" needs at least 3 corners');
  return {
    walls,
    wall_height: num(r.wall_height, 2.4, 'room.wall_height'),
    doors: (r.doors ?? []).map((d, i) => ({ from: point(d?.from, `room.doors[${i}].from`), to: point(d?.to, `room.doors[${i}].to`) })),
    furniture: (r.furniture ?? []).map((f, i) => ({
      name: f?.name ? String(f.name) : '',
      x: range(f?.x, `room.furniture[${i}].x`),
      y: range(f?.y, `room.furniture[${i}].y`),
      height: num(f?.height, 0.75, `room.furniture[${i}].height`),
    })),
  };
}

/** Validates the YAML config and fills in defaults. Throws so HA shows its error card. */
export function normalizeConfig(c) {
  if (!c || typeof c !== 'object') throw new Error('Invalid configuration');
  if (!c.device) throw new Error('Set "device": ld2450 or ld6004');
  const adapter = getAdapter(c.device);
  if (!c.prefix && !c.entities?.targets) {
    throw new Error('Set "prefix" (the part of the entity id before _target_…) or "entities.targets"');
  }
  const view = c.view ?? '3d';
  if (!VIEWS.includes(view)) throw new Error(`"view" must be one of: ${VIEWS.join(', ')}`);
  const mount = c.mount ?? adapter.defaults.mount;
  if (!MOUNTS.includes(mount)) throw new Error(`"mount" must be one of: ${MOUNTS.join(', ')}`);

  const model = normalizeModel(c.model);
  const cfg = {
    device: adapter.type,
    prefix: c.prefix ?? '',
    title: c.title ?? '',
    mount,
    mount_height: num(c.mount_height, model ? modelSensorHeight(model) : 1.5, 'mount_height'),
    tilt: num(c.tilt, 0, 'tilt'),
    max_range: num(c.max_range, adapter.defaults.maxRange, 'max_range'),
    fov: num(c.fov, adapter.defaults.fov, 'fov'),
    invert_x: c.invert_x === true,
    z_offset: c.z_offset === undefined || c.z_offset === null ? null : num(c.z_offset, 0, 'z_offset'),
    posture: {
      sitting: num(c.posture?.sitting, 0.95, 'posture.sitting'),
      lying: num(c.posture?.lying, 0.45, 'posture.lying'),
    },
    view,
    height: num(c.height, 380, 'height'),
    trail_seconds: num(c.trail_seconds, 8, 'trail_seconds'),
    show_trail: c.show_trail !== false,
    show_zones: c.show_zones !== false,
    show_table: c.show_table !== false,
    show_interference: c.show_interference !== false,
    zone_names: Array.isArray(c.zone_names) ? c.zone_names.map(String) : [],
    allow_zone_editing: c.allow_zone_editing !== false,
    zone_service: c.zone_service ? String(c.zone_service) : null,
    room: normalizeRoom(c.room),
    model,
    entities: c.entities ?? null,
  };
  if (cfg.zone_service && !/^esphome\.[a-z0-9_]+$/.test(cfg.zone_service)) {
    throw new Error('"zone_service" must look like esphome.<node>_set_detection_zone');
  }
  if (cfg.mount_height <= 0) throw new Error('"mount_height" must be greater than 0');
  if (cfg.max_range <= 0) throw new Error('"max_range" must be greater than 0');
  if (cfg.fov <= 0 || cfg.fov > 180) throw new Error('"fov" must be between 1 and 180 degrees');
  if (cfg.tilt < 0 || cfg.tilt > 90) throw new Error('"tilt" must be between 0 and 90 degrees');
  if (cfg.posture.lying >= cfg.posture.sitting) throw new Error('"posture.lying" must be lower than "posture.sitting"');
  return cfg;
}
