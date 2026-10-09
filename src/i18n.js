const STRINGS = {
  es: {
    view3d: '3D', plan: 'Planta', sensorView: 'Sensor', trail: 'Rastro', zones: 'Zonas',
    zoomIn: 'Acercar', zoomOut: 'Alejar',
    live: 'En vivo', replay: 'Repetición', heatmap: 'Mapa de calor',
    target: 'Objetivo', position: 'Posición (m)', distance: 'Distancia', speed: 'Velocidad', height: 'Altura', posture: 'Postura', zone: 'Zona',
    nobody: 'Nadie', onePerson: '1 persona', people: (n) => `${n} personas`,
    absent: 'Sin detección', free: 'libre', zoneN: (n) => `Zona ${n}`,
    standing: 'De pie', sitting: 'Sentado', lying: 'Tumbado',
    kindN: { filter: (n) => `Excluida ${n}`, interference: (n) => `Interferencia ${n}`, dwell: (n) => `Permanencia ${n}` },
    missing: (id) => `No encuentro ${id}. Revisa "prefix" o "entities" en la configuración.`,
    noWebgl: 'Este navegador no puede mostrar WebGL.',
    modelError: (url) => `No puedo cargar el modelo de la habitación (${url}).`,
    // Zone editing
    editZones: 'Editar zonas', done: 'Listo', addZone: 'Añadir zona', deleteZone: 'Borrar zona', cancel: 'Cancelar',
    newZone: 'Zona nueva', zoneKind: 'Tipo de zona', full: '(llena)',
    kindLabel: { detection: 'Detección', interference: 'Interferencia', dwell: 'Permanencia', filter: 'Exclusión' },
    drawHint: 'Arrastra sobre el suelo para dibujar la zona, o toca para poner un cuadrado de 1 m.',
    editHint: 'Arrastra una zona para moverla o una esquina para cambiar su tamaño. Los cambios se guardan en el sensor.',
    saving: 'Guardando…', saved: (n) => `${n} guardada en el sensor.`, deleted: (n) => `${n} borrada del sensor.`,
    saveFailed: (m) => `No se pudo guardar: ${m}`, notConfirmed: 'El sensor no ha confirmado el cambio.',
    noFreeSlot: 'El sensor no tiene más zonas libres.',
    editUnsupported: {
      zonesDisabled: 'Las zonas están desactivadas en el sensor (Zone Type = Disabled). Actívalas para editarlas.',
      missingNumbers: 'No encuentro las entidades number de las zonas del sensor.',
      serviceNotFound: 'No encuentro el servicio esphome.<nodo>_set_detection_zone. Añádelo al YAML de ESPHome o indícalo con "zone_service".',
      serviceAmbiguous: 'Hay varios servicios set_detection_zone. Indica el de este sensor con "zone_service".',
    },
    // History
    lastHours: (h) => `${h} h`, play: 'Reproducir', pause: 'Pausa',
    skipQuiet: 'Saltar vacíos', skipQuietHint: 'Salta los ratos en los que no se detecta a nadie', activity: 'Cuándo se detectó a alguien',
    // 1D sensors
    moving: 'Movimiento', still: 'Quieto', detection: 'Detección', energy: 'Energía', gate: 'Puerta', presenceOn: 'Presencia',
    moveLimit: 'Límite de movimiento', stillLimit: 'Límite en quieto', limit: 'Límite', threshold: 'umbral', gatesTitle: 'Energía por puerta',
    engineeringOff: 'Activa el modo ingeniería del sensor para ver la energía de cada puerta.',
    engineeringIsOn: 'Modo ingeniería activo: el sensor envía muchos más datos.',
    engineeringStart: 'Activar modo ingeniería', engineeringStop: 'Desactivar modo ingeniería',
    loadingHistory: 'Cargando historial…',
    noHistory: 'No hay historial de estas entidades en este periodo. ¿Están excluidas del recorder?',
    historyFailed: (m) => `No se pudo cargar el historial: ${m}`,
    timeHere: 'Tiempo de cada persona', heatPeak: (d) => `Hasta ${d} en un mismo punto`,
  },
  en: {
    view3d: '3D', plan: 'Plan', sensorView: 'Sensor', trail: 'Trail', zones: 'Zones',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out',
    live: 'Live', replay: 'Replay', heatmap: 'Heatmap',
    target: 'Target', position: 'Position (m)', distance: 'Distance', speed: 'Speed', height: 'Height', posture: 'Posture', zone: 'Zone',
    nobody: 'Nobody', onePerson: '1 person', people: (n) => `${n} people`,
    absent: 'Not detected', free: 'free', zoneN: (n) => `Zone ${n}`,
    standing: 'Standing', sitting: 'Sitting', lying: 'Lying',
    kindN: { filter: (n) => `Excluded ${n}`, interference: (n) => `Interference ${n}`, dwell: (n) => `Dwell ${n}` },
    missing: (id) => `Cannot find ${id}. Check "prefix" or "entities" in the card config.`,
    noWebgl: 'This browser cannot display WebGL.',
    modelError: (url) => `Cannot load the room model (${url}).`,
    editZones: 'Edit zones', done: 'Done', addZone: 'Add zone', deleteZone: 'Delete zone', cancel: 'Cancel',
    newZone: 'New zone', zoneKind: 'Zone kind', full: '(full)',
    kindLabel: { detection: 'Detection', interference: 'Interference', dwell: 'Dwell', filter: 'Filter' },
    drawHint: 'Drag on the floor to draw the zone, or tap to drop a 1 m square.',
    editHint: 'Drag a zone to move it or a corner to resize it. Changes are saved to the sensor.',
    saving: 'Saving…', saved: (n) => `${n} saved to the sensor.`, deleted: (n) => `${n} deleted from the sensor.`,
    saveFailed: (m) => `Could not save: ${m}`, notConfirmed: 'The sensor did not confirm the change.',
    noFreeSlot: 'The sensor has no free zones left.',
    editUnsupported: {
      zonesDisabled: 'Zones are disabled on the sensor (Zone Type = Disabled). Enable them to edit them.',
      missingNumbers: "Cannot find the sensor's zone number entities.",
      serviceNotFound: 'Cannot find the esphome.<node>_set_detection_zone service. Add it to the ESPHome YAML or set "zone_service".',
      serviceAmbiguous: 'There are several set_detection_zone services. Set the one for this sensor with "zone_service".',
    },
    lastHours: (h) => `${h} h`, play: 'Play', pause: 'Pause',
    skipQuiet: 'Skip quiet time', skipQuietHint: 'Skips the stretches where nobody is detected', activity: 'When someone was detected',
    moving: 'Moving', still: 'Still', detection: 'Detection', energy: 'Energy', gate: 'Gate', presenceOn: 'Presence',
    moveLimit: 'Move limit', stillLimit: 'Still limit', limit: 'Limit', threshold: 'threshold', gatesTitle: 'Energy per gate',
    engineeringOff: "Turn on the sensor's engineering mode to see each gate's energy.",
    engineeringIsOn: 'Engineering mode is on: the sensor sends a lot more data.',
    engineeringStart: 'Turn on engineering mode', engineeringStop: 'Turn off engineering mode',
    loadingHistory: 'Loading history…',
    noHistory: 'No history for these entities in this period. Are they excluded from the recorder?',
    historyFailed: (m) => `Could not load the history: ${m}`,
    timeHere: 'Time per person', heatPeak: (d) => `Up to ${d} in one spot`,
  },
};

/** Label for a zone: detection zones use `names` or "Zone N"; the other kinds have their own numbering. */
export function zoneName(zone, t, names = []) {
  if (zone.kind === 'detection') return names[zone.id - 1] || t.zoneN(zone.id);
  return t.kindN[zone.kind]?.(zone.id) ?? t.zoneN(zone.id);
}

/** 45 s, 12 min, 3 h 20 min. */
export function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export function strings(language) {
  return language?.startsWith('es') ? STRINGS.es : STRINGS.en;
}
