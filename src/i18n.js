const STRINGS = {
  es: {
    view3d: '3D', plan: 'Planta', sensorView: 'Sensor', trail: 'Rastro', zones: 'Zonas',
    target: 'Objetivo', position: 'Posición (m)', distance: 'Distancia', speed: 'Velocidad', height: 'Altura', posture: 'Postura', zone: 'Zona',
    nobody: 'Nadie', onePerson: '1 persona', people: (n) => `${n} personas`,
    absent: 'Sin detección', free: 'libre', zoneN: (n) => `Zona ${n}`,
    standing: 'De pie', sitting: 'Sentado', lying: 'Tumbado',
    filter: 'excluida', interference: 'interferencia', dwell: 'permanencia',
    missing: (id) => `No encuentro ${id}. Revisa "prefix" o "entities" en la configuración.`,
    noWebgl: 'Este navegador no puede mostrar WebGL.',
  },
  en: {
    view3d: '3D', plan: 'Plan', sensorView: 'Sensor', trail: 'Trail', zones: 'Zones',
    target: 'Target', position: 'Position (m)', distance: 'Distance', speed: 'Speed', height: 'Height', posture: 'Posture', zone: 'Zone',
    nobody: 'Nobody', onePerson: '1 person', people: (n) => `${n} people`,
    absent: 'Not detected', free: 'free', zoneN: (n) => `Zone ${n}`,
    standing: 'Standing', sitting: 'Sitting', lying: 'Lying',
    filter: 'excluded', interference: 'interference', dwell: 'dwell',
    missing: (id) => `Cannot find ${id}. Check "prefix" or "entities" in the card config.`,
    noWebgl: 'This browser cannot display WebGL.',
  },
};

export function strings(language) {
  return language?.startsWith('es') ? STRINGS.es : STRINGS.en;
}
