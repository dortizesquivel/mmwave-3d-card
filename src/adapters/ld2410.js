import { findPrefixes, readBool, readLength, readNumber, readText } from './common.js';

// HLK-LD2410 (and its B/C versions) with the official ESPHome `ld2410` component. It only measures
// distance: one moving and one still target, nine distance gates (0.75 m or 0.2 m each) with an energy
// and a threshold per gate. Entity ids follow the names in the ESPHome docs ("Moving Distance",
// "g0 move threshold", ...). The distances keep their last value when nobody is there, so presence
// comes from the moving/still binary sensors.
const GATES = 9;

export const ld2410 = {
  type: 'ld2410',
  label: 'HLK-LD2410',
  oneD: true,
  hasZ: false,
  hasSpeed: false,
  editableKinds: [],
  zoneStep: 0.05,
  defaults: { mount: 'wall', maxRange: 6, fov: 120 },

  detect(hass) {
    return findPrefixes(hass, /^sensor\.(.+)_moving_distance$/).filter((p) => hass.states[`sensor.${p}_still_distance`]);
  },

  entities(prefix) {
    const id = (domain, key) => `${domain}.${prefix}_${key}`;
    return {
      moving: { distance: id('sensor', 'moving_distance'), energy: id('sensor', 'move_energy'), on: id('binary_sensor', 'moving_target') },
      still: { distance: id('sensor', 'still_distance'), energy: id('sensor', 'still_energy'), on: id('binary_sensor', 'still_target') },
      presence: id('binary_sensor', 'presence'),
      detection: id('sensor', 'detection_distance'),
      resolution: id('select', 'distance_resolution'),
      maxMoveGate: id('number', 'max_move_distance_gate'),
      maxStillGate: id('number', 'max_still_distance_gate'),
      engineering: id('switch', 'engineering_mode'),
      gates: Array.from({ length: GATES }, (_, g) => ({
        moveEnergy: id('sensor', `g${g}_move_energy`),
        stillEnergy: id('sensor', `g${g}_still_energy`),
        moveThreshold: id('number', `g${g}_move_threshold`),
        stillThreshold: id('number', `g${g}_still_threshold`),
      })),
      targets: [],          // no positions; kept so code shared with the other sensors finds nothing to draw
    };
  },

  read(hass, ent) {
    const resolution = Number.parseFloat(readText(hass, ent.resolution) ?? '') || 0.75;   // "0.75m" | "0.2m"
    const track = (t) => {
      const distance = readLength(hass, t.distance, 'cm');
      const energy = readNumber(hass, t.energy);
      const on = readBool(hass, t.on);
      const present = (on ?? (energy !== null && energy > 0)) && distance !== null && distance > 0;
      return { present, distance: present ? distance : null, energy: present ? energy : null, gate: present ? Math.min(GATES - 1, Math.floor(distance / resolution)) : null };
    };
    const gates = ent.gates
      .map((g, i) => ({
        index: i,
        from: i * resolution,
        to: (i + 1) * resolution,
        moveEnergy: readNumber(hass, g.moveEnergy),
        stillEnergy: readNumber(hass, g.stillEnergy),
        moveThreshold: readNumber(hass, g.moveThreshold),
        stillThreshold: readNumber(hass, g.stillThreshold),
        exists: [g.moveEnergy, g.moveThreshold, g.stillThreshold].some((e) => hass.states[e]),
      }))
      .filter((g) => g.exists);
    const maxMove = readNumber(hass, ent.maxMoveGate), maxStill = readNumber(hass, ent.maxStillGate);
    return {
      targets: [],
      zones: [],
      mount: null,
      ranges: {
        resolution,
        moving: track(ent.moving),
        still: track(ent.still),
        presence: readBool(hass, ent.presence),
        detection: readLength(hass, ent.detection, 'cm'),
        gates,
        // The sensor detects up to gate N, that is N × resolution metres.
        moveLimit: maxMove === null ? null : maxMove * resolution,
        stillLimit: maxStill === null ? null : maxStill * resolution,
        engineering: readBool(hass, ent.engineering),
      },
    };
  },

  historyIds(ent) {
    return [ent.moving.distance, ent.moving.energy, ent.moving.on, ent.still.distance, ent.still.energy, ent.still.on];
  },

  entityIds(ent) {
    return [
      ...this.historyIds(ent), ent.presence, ent.detection, ent.resolution, ent.maxMoveGate, ent.maxStillGate, ent.engineering,
      ...ent.gates.flatMap((g) => [g.moveEnergy, g.stillEnergy, g.moveThreshold, g.stillThreshold]),
    ];
  },
};
