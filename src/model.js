// A 3D model of the room (glTF/GLB) drawn around the radar. The config gives where the sensor sits in the
// model; the scene moves and turns the model so that point lands on the sensor and its heading on +Z.

const UNITS = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 };
export const MODEL_STYLES = ['textured', 'futuristic'];

function num(value, fallback, name) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`"${name}" must be a number`);
  return n;
}

/**
 * model: { url, units, up, floor, opacity, style, color, sensor: { position: [x, y, z], heading } }
 * Positions are in the model's own frame after `units` and `up` are applied: metres, y up.
 * heading: where the sensor faces, in degrees around the vertical: 0 = the model's +z, 90 = +x.
 * style: 'textured' draws the file as it is; 'futuristic' keeps the shapes and draws them as a hologram, in violet or `color`.
 */
export function normalizeModel(m) {
  if (!m) return null;
  if (typeof m !== 'object') throw new Error('"model" must be an object');
  if (!m.url || typeof m.url !== 'string') throw new Error('"model.url" must be the URL of a .glb or .gltf file');
  const units = m.units ?? 'm';
  if (!(units in UNITS)) throw new Error(`"model.units" must be one of: ${Object.keys(UNITS).join(', ')}`);
  const up = m.up ?? 'y';
  if (up !== 'y' && up !== 'z') throw new Error('"model.up" must be y or z');
  const p = Array.isArray(m.sensor?.position) ? m.sensor.position.map(Number) : [];
  if (p.length !== 3 || !p.every(Number.isFinite)) {
    throw new Error('"model.sensor.position" must be where the sensor is in the model, like [1.2, 2.3, 4.5]');
  }
  const opacity = num(m.opacity, 1, 'model.opacity');
  if (opacity <= 0 || opacity > 1) throw new Error('"model.opacity" must be between 0 and 1');
  const style = m.style ?? 'textured';
  if (!MODEL_STYLES.includes(style)) throw new Error(`"model.style" must be one of: ${MODEL_STYLES.join(', ')}`);
  const floor = num(m.floor, 0, 'model.floor');
  if (p[1] <= floor) throw new Error('"model.sensor.position" must be above "model.floor"');
  return {
    url: m.url,
    units,
    scale: UNITS[units],
    up,
    floor,
    opacity,
    style,
    color: m.color ? String(m.color) : null,
    sensor: { position: p, heading: num(m.sensor.heading, 0, 'model.sensor.heading') },
  };
}

/** Sensor height above the model's floor, in metres. */
export const modelSensorHeight = (m) => m.sensor.position[1] - m.floor;

/**
 * How to place the model so the sensor sits at (0, h, 0) facing +Z, with the floor at y = 0:
 * apply `upRotX` and `scale` to the raw model, then `offset`, then turn by `rotY` and lift by `lift`.
 */
export function modelPlacement(m) {
  const [x, y, z] = m.sensor.position;
  return {
    scale: m.scale,
    upRotX: m.up === 'z' ? -Math.PI / 2 : 0,
    offset: [-x, -y, -z],
    rotY: (-m.sensor.heading * Math.PI) / 180,
    lift: y - m.floor,
  };
}

/** Where a point of the model (metres, y up) ends up in the scene. Mirrors what the scene does with modelPlacement. */
export function modelToScene(m, [px, py, pz]) {
  const t = modelPlacement(m);
  const x = px + t.offset[0], y = py + t.offset[1], z = pz + t.offset[2];
  const c = Math.cos(t.rotY), s = Math.sin(t.rotY);
  return [x * c + z * s, y + t.lift, -x * s + z * c];
}
