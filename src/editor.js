import { ADAPTERS, detectDevices } from './adapters/index.js';

// Visual editor. Inside Home Assistant it uses <ha-form>, like the built-in cards; where that element
// isn't available (older frontends, the demo) it falls back to a plain form built from the same schema.
// Room, furniture and entity overrides stay in YAML.

const LABELS = {
  es: {
    device: 'Sensor', prefix: 'Prefijo de las entidades', title: 'Título', mount: 'Montaje', mount_height: 'Altura del sensor (m)',
    tilt: 'Inclinación hacia abajo (°)',
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
    tilt: 'Tilt down (°)',
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
      { name: 'tilt', selector: num(0, 90, 1) },
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

/** What the card uses when an option is left out, so the form can show it and the YAML can skip it. */
function defaultsFor(device) {
  const d = ADAPTERS[device]?.defaults ?? {};
  return {
    show_trail: true, show_zones: true, show_table: true, show_interference: true, allow_zone_editing: true, invert_x: false,
    mount: d.mount ?? 'wall', mount_height: 1.5, tilt: 0, max_range: d.maxRange ?? 6, fov: d.fov ?? 120, view: '3d', height: 380,
    trail_seconds: 8, posture_sitting: 0.95, posture_lying: 0.45,
  };
}

/** Card config → flat form data, with the defaults filled in. */
export function toFormData(config) {
  const def = defaultsFor(config.device);
  return {
    ...def,
    ...config,
    zone_names: (config.zone_names ?? []).join(', '),
    posture_sitting: config.posture?.sitting ?? def.posture_sitting,
    posture_lying: config.posture?.lying ?? def.posture_lying,
  };
}

/** Flat form data → card config, keeping keys the form doesn't edit (room, entities…) and dropping defaults. */
export function fromFormData(data, previous) {
  const { posture_sitting, posture_lying, zone_names, ...rest } = data;
  const config = { ...previous, ...rest };
  const def = defaultsFor(config.device);
  const names = String(zone_names ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (names.length) config.zone_names = names; else delete config.zone_names;
  const posture = { ...(previous.posture ?? {}) };
  const setPosture = (key, value, fallback) => {
    if (value === undefined || value === '' || Number(value) === fallback) delete posture[key];
    else posture[key] = Number(value);
  };
  setPosture('sitting', posture_sitting, def.posture_sitting);
  setPosture('lying', posture_lying, def.posture_lying);
  if (Object.keys(posture).length) config.posture = posture; else delete config.posture;
  for (const [k, v] of Object.entries(config)) {
    if (v === '' || v === undefined || v === null || def[k] === v) delete config[k];
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

const FORM_CSS = `
  .mmwave-form { display: grid; gap: 14px; font: inherit; color: var(--primary-text-color); }
  .mmwave-form .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .mmwave-form .field { display: grid; gap: 4px; font-size: 12px; color: var(--secondary-text-color); }
  .mmwave-form input:not([type="checkbox"]), .mmwave-form select {
    font: inherit; font-size: 14px; color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-radius: 6px; padding: 8px 10px; min-height: 38px; width: 100%; box-sizing: border-box; }
  .mmwave-form input:focus-visible, .mmwave-form select:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
  .mmwave-form .check { display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--primary-text-color); }
  .mmwave-form .check input { width: 18px; height: 18px; margin: 0; accent-color: var(--primary-color); }
  .mmwave-form details { border: 1px solid var(--divider-color); border-radius: 8px; padding: 0 14px; }
  .mmwave-form details[open] { padding-bottom: 14px; }
  .mmwave-form summary { cursor: pointer; padding: 12px 0; font-size: 14px; font-weight: 500; color: var(--primary-text-color); }
  .mmwave-form .group { display: grid; gap: 12px; }
`;

/** A plain form with the same schema, for frontends without <ha-form>: rows for grids, <details> for expandables. */
function plainForm(schema, data, L, onChange) {
  const form = document.createElement('form');
  form.className = 'mmwave-form';
  form.addEventListener('submit', (e) => e.preventDefault());
  const style = document.createElement('style');
  style.textContent = FORM_CSS;
  form.append(style);
  const current = { ...data };

  const field = (f) => {
    const id = `mmwave-${f.name}`;
    const sel = f.selector;
    const row = document.createElement('label');
    row.htmlFor = id;
    let input;
    if (sel.boolean) {
      row.className = 'check';
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = current[f.name] === true;
      row.append(input, L[f.name] ?? f.name);
    } else {
      row.className = 'field';
      row.append(L[f.name] ?? f.name);
      if (sel.select && !sel.select.custom_value) {
        input = document.createElement('select');
        for (const o of sel.select.options) input.append(new Option(o.label, o.value, false, o.value === current[f.name]));
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
        input.value = current[f.name] ?? '';
      }
      row.append(input);
    }
    input.id = id;
    input.name = f.name;
    input.addEventListener('change', () => {
      current[f.name] = sel.boolean ? input.checked : sel.number ? (input.value === '' ? '' : Number(input.value)) : input.value;
      onChange({ ...current });
    });
    return row;
  };

  const render = (items, parent) => {
    for (const s of items) {
      if (s.type === 'grid') {
        const row = document.createElement('div');
        row.className = 'row';
        render(s.schema, row);
        parent.append(row);
      } else if (s.type === 'expandable') {
        const box = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = s.title;
        const group = document.createElement('div');
        group.className = 'group';
        render(s.schema, group);
        box.append(summary, group);
        parent.append(box);
      } else {
        parent.append(field(s));
      }
    }
  };
  render(schema, form);
  return form;
}

if (!customElements.get('mmwave-3d-card-editor')) customElements.define('mmwave-3d-card-editor', MmwaveCardEditor);
