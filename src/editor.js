import { ADAPTERS, detectDevices } from './adapters/index.js';

// Visual editor. Inside Home Assistant it uses <ha-form>, like the built-in cards; where that element
// isn't available (older frontends, the demo) it falls back to a plain form built from the same schema.
// Room, furniture and entity overrides stay in YAML.

const LABELS = {
  es: {
    device: 'Sensor', prefix: 'Prefijo de las entidades', title: 'Título', mount: 'Montaje', mount_height: 'Altura del sensor (m)',
    max_range: 'Alcance (m)', fov: 'Apertura (°)', view: 'Vista inicial', height: 'Alto de la vista 3D (px)',
    zone_names: 'Nombres de las zonas (separados por comas)', trail_seconds: 'Rastro (s)', show_trail: 'Mostrar rastro',
    show_zones: 'Mostrar zonas', show_table: 'Mostrar tabla', show_interference: 'Mostrar zonas de interferencia',
    allow_zone_editing: 'Permitir editar zonas', invert_x: 'Invertir izquierda y derecha',
    posture_sitting: 'Sentado por debajo de (m)', posture_lying: 'Tumbado por debajo de (m)', z_offset: 'Desfase de Z (m)',
    zone_service: 'Servicio de zonas (esphome.…_set_detection_zone)',
    display: 'Visualización', heightPosture: 'Altura y postura', yamlNote: 'La habitación, los muebles y las entidades sueltas se configuran en el editor de código.',
    auto: 'Automático', wall: 'Pared', ceiling: 'Techo', '3d': '3D', plan: 'Planta', sensor: 'Sensor',
  },
  en: {
    device: 'Sensor', prefix: 'Entity prefix', title: 'Title', mount: 'Mounting', mount_height: 'Sensor height (m)',
    max_range: 'Range (m)', fov: 'Opening (°)', view: 'Initial view', height: '3D view height (px)',
    zone_names: 'Zone names (comma separated)', trail_seconds: 'Trail (s)', show_trail: 'Show trail',
    show_zones: 'Show zones', show_table: 'Show table', show_interference: 'Show interference zones',
    allow_zone_editing: 'Allow zone editing', invert_x: 'Swap left and right',
    posture_sitting: 'Sitting below (m)', posture_lying: 'Lying below (m)', z_offset: 'Z offset (m)',
    zone_service: 'Zone service (esphome.…_set_detection_zone)',
    display: 'Display', heightPosture: 'Height and posture', yamlNote: 'Room, furniture and single entities are set in the code editor.',
    auto: 'Automatic', wall: 'Wall', ceiling: 'Ceiling', '3d': '3D', plan: 'Plan', sensor: 'Sensor',
  },
};

const num = (min, max, step, mode = 'box') => ({ number: { min, max, step, mode } });

export function editorSchema(config, hass, L) {
  const prefixes = hass ? detectDevices(hass).filter((d) => d.device === config.device).map((d) => d.prefix) : [];
  const opts = (values) => values.map((v) => ({ value: v, label: L[v] ?? v }));
  const schema = [
    { name: 'device', selector: { select: { mode: 'dropdown', options: Object.values(ADAPTERS).map((a) => ({ value: a.type, label: a.label })) } } },
    { name: 'prefix', selector: { select: { mode: 'dropdown', custom_value: true, options: prefixes.map((p) => ({ value: p, label: p })) } } },
    { name: 'title', selector: { text: {} } },
    { type: 'grid', name: '', schema: [
      { name: 'mount', selector: { select: { mode: 'dropdown', options: opts(['auto', 'wall', 'ceiling']) } } },
      { name: 'mount_height', selector: num(0.3, 4, 0.05) },
    ] },
    { type: 'grid', name: '', schema: [
      { name: 'max_range', selector: num(1, 12, 0.5) },
      { name: 'fov', selector: num(30, 180, 5) },
    ] },
    { type: 'grid', name: '', schema: [
      { name: 'view', selector: { select: { mode: 'dropdown', options: opts(['3d', 'plan', 'sensor']) } } },
      { name: 'height', selector: num(200, 900, 10) },
    ] },
    { name: 'zone_names', selector: { text: {} } },
    { type: 'expandable', name: '', title: L.display, schema: [
      { name: 'trail_seconds', selector: num(0, 60, 1) },
      { name: 'show_trail', selector: { boolean: {} } },
      { name: 'show_zones', selector: { boolean: {} } },
      { name: 'show_interference', selector: { boolean: {} } },
      { name: 'show_table', selector: { boolean: {} } },
      { name: 'allow_zone_editing', selector: { boolean: {} } },
      { name: 'invert_x', selector: { boolean: {} } },
    ] },
  ];
  if (ADAPTERS[config.device]?.hasZ) {
    schema.push({ type: 'expandable', name: '', title: L.heightPosture, schema: [
      { name: 'posture_sitting', selector: num(0.2, 2, 0.05) },
      { name: 'posture_lying', selector: num(0.1, 1.5, 0.05) },
      { name: 'z_offset', selector: num(-3, 5, 0.05) },
      { name: 'zone_service', selector: { text: {} } },
    ] });
  }
  return schema;
}

const DEFAULTS = { show_trail: true, show_zones: true, show_table: true, show_interference: true, allow_zone_editing: true };

/** Card config → flat form data. */
export function toFormData(config) {
  return {
    ...DEFAULTS,
    ...config,
    zone_names: (config.zone_names ?? []).join(', '),
    posture_sitting: config.posture?.sitting,
    posture_lying: config.posture?.lying,
  };
}

/** Flat form data → card config, keeping keys the form doesn't edit (room, entities…) and dropping defaults. */
export function fromFormData(data, previous) {
  const { posture_sitting, posture_lying, zone_names, ...rest } = data;
  const config = { ...previous, ...rest };
  const names = String(zone_names ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (names.length) config.zone_names = names; else delete config.zone_names;
  const posture = { ...(previous.posture ?? {}) };
  if (posture_sitting !== undefined && posture_sitting !== '') posture.sitting = Number(posture_sitting); else delete posture.sitting;
  if (posture_lying !== undefined && posture_lying !== '') posture.lying = Number(posture_lying); else delete posture.lying;
  if (Object.keys(posture).length) config.posture = posture; else delete config.posture;
  for (const [k, v] of Object.entries(config)) {
    if (v === '' || v === undefined || v === null || DEFAULTS[k] === v) delete config[k];
  }
  return config;
}

class MmwaveCardEditor extends HTMLElement {
  setConfig(config) {
    const deviceChanged = this._config && this._config.device !== config.device;
    this._config = { ...config };
    if (this._form) {
      this._form.data = toFormData(this._config);
      if (deviceChanged) this._form.schema = editorSchema(this._config, this._hass, this._labels());
    } else if (!this._fallback || deviceChanged) {
      this._render();
    }
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (this._form) {
      this._form.hass = hass;
      if (first) this._form.schema = editorSchema(this._config, hass, this._labels());
    } else if (first) {
      this._render();
    }
  }

  async connectedCallback() {
    await loadHaForm();
    this._render();
  }

  _labels() {
    const lang = this._hass?.locale?.language ?? navigator.language;
    return lang?.startsWith('es') ? LABELS.es : LABELS.en;
  }

  _render() {
    if (!this._config) return;
    const L = this._labels();
    const schema = editorSchema(this._config, this._hass, L);
    this.replaceChildren();
    const note = document.createElement('p');
    note.textContent = L.yamlNote;
    note.style.cssText = 'margin: 16px 0 0; color: var(--secondary-text-color); font-size: 12px;';
    if (customElements.get('ha-form')) {
      const form = document.createElement('ha-form');
      form.hass = this._hass;
      form.data = toFormData(this._config);
      form.schema = schema;
      form.computeLabel = (s) => L[s.name] ?? s.name;
      form.addEventListener('value-changed', (e) => this._changed(e.detail.value));
      this._form = form;
      this._fallback = null;
      this.append(form, note);
    } else {
      this._form = null;
      this._fallback = plainForm(schema, toFormData(this._config), L, (data) => this._changed(data));
      this.append(this._fallback, note);
    }
  }

  _changed(data) {
    const config = fromFormData(data, this._config);
    const deviceChanged = config.device !== this._config.device;
    this._config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
    if (deviceChanged) this._render();
  }
}

/** HA lazy-loads <ha-form>; creating a built-in card's editor once is the usual way to make it available. */
async function loadHaForm() {
  if (customElements.get('ha-form')) return;
  try {
    const helpers = await window.loadCardHelpers?.();
    const card = await helpers?.createCardElement({ type: 'entities', entities: [] });
    await card?.constructor?.getConfigElement?.();
  } catch { /* fall back to the plain form */ }
}

function plainForm(schema, data, L, onChange) {
  const form = document.createElement('form');
  form.style.cssText = 'display: grid; gap: 10px; font: inherit;';
  form.addEventListener('submit', (e) => e.preventDefault());
  const leaves = (items) => items.flatMap((s) => (s.schema ? leaves(s.schema) : [s]));
  const current = { ...data };
  for (const field of leaves(schema)) {
    const id = `mmwave-${field.name}`;
    const row = document.createElement('label');
    row.htmlFor = id;
    row.style.cssText = 'display: grid; gap: 4px; font-size: 13px; color: var(--primary-text-color);';
    row.append(L[field.name] ?? field.name);
    const sel = field.selector;
    let input;
    if (sel.boolean) {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = current[field.name] !== false;
      row.style.cssText += 'grid-template-columns: auto 1fr; align-items: center;';
      row.prepend(input);
    } else if (sel.select && !sel.select.custom_value) {
      input = document.createElement('select');
      for (const o of sel.select.options) input.append(new Option(o.label, o.value, false, o.value === current[field.name]));
      row.append(input);
    } else {
      input = document.createElement('input');
      if (sel.number) Object.assign(input, { type: 'number', min: sel.number.min, max: sel.number.max, step: sel.number.step });
      if (sel.select?.custom_value) {
        const list = document.createElement('datalist');
        list.id = `${id}-list`;
        for (const o of sel.select.options) list.append(new Option(o.label, o.value));
        input.setAttribute('list', list.id);
        row.append(list);
      }
      input.value = current[field.name] ?? '';
      row.append(input);
    }
    input.id = id;
    input.name = field.name;
    input.addEventListener('change', () => {
      current[field.name] = sel.boolean ? input.checked : sel.number ? (input.value === '' ? '' : Number(input.value)) : input.value;
      onChange({ ...current });
    });
    form.append(row);
  }
  return form;
}

if (!customElements.get('mmwave-3d-card-editor')) customElements.define('mmwave-3d-card-editor', MmwaveCardEditor);
