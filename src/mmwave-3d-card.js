import { buildFrame, detectDevices, getAdapter, resolveEntities } from './adapters/index.js';
import { normalizeConfig, VIEWS } from './config.js';
import { strings } from './i18n.js';
import { RadarScene } from './scene.js';
import { readTheme } from './theme.js';

const VERSION = typeof __VERSION__ === 'undefined' ? 'dev' : __VERSION__;

const STYLE = `
  :host { display: block; }
  ha-card { overflow: hidden; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; }
  .title { font-size: 16px; font-weight: 500; color: var(--primary-text-color); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip { display: inline-flex; align-items: center; gap: 7px; flex: none; font-size: 12px; font-weight: 500; padding: 6px 10px;
    border: 1px solid var(--divider-color); border-radius: 999px; color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
  .chip::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--primary-color); }
  .chip[data-state="empty"] { color: var(--secondary-text-color); }
  .chip[data-state="empty"]::before { background: var(--disabled-text-color, var(--secondary-text-color)); }

  .viewport { position: relative; border-block: 1px solid var(--divider-color); overflow: hidden; }
  .viewport canvas { display: block; }
  .labels { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
  .status[hidden] { display: none; }
  .status { position: absolute; inset: 0; z-index: 3; display: grid; place-items: center; padding: 24px; text-align: center;
    color: var(--secondary-text-color); background: color-mix(in srgb, var(--card-background-color, #fff) 82%, transparent); }
  .toolbar { position: absolute; left: 10px; right: 10px; bottom: 10px; z-index: 2; display: flex; flex-wrap: wrap;
    justify-content: space-between; gap: 8px; pointer-events: none; }
  .seg { pointer-events: auto; display: flex; gap: 2px; padding: 3px; border-radius: 8px; border: 1px solid var(--divider-color);
    background: color-mix(in srgb, var(--card-background-color, #fff) 85%, transparent); backdrop-filter: blur(6px); }
  .seg button { font: inherit; font-size: 12px; font-weight: 500; color: var(--secondary-text-color); background: none; border: 0;
    border-radius: 6px; padding: 8px 10px; min-height: 32px; cursor: pointer; }
  .seg button:hover { color: var(--primary-text-color); background: color-mix(in srgb, var(--primary-text-color) 8%, transparent); }
  .seg button[aria-pressed="true"] { color: var(--text-primary-color, #fff); background: var(--primary-color); }
  button:focus-visible, tr:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

  .tag { display: flex; align-items: center; gap: 6px; padding: 3px 7px; font-size: 11px; line-height: 1.2; white-space: nowrap;
    color: var(--primary-text-color); background: color-mix(in srgb, var(--card-background-color, #fff) 85%, transparent);
    border: 1px solid var(--divider-color); border-radius: 4px; font-variant-numeric: tabular-nums; }
  .tag i { width: 7px; height: 7px; border-radius: 50%; }
  .tag b { font-weight: 600; }
  .tag span { color: var(--secondary-text-color); }
  .axis { font-size: 10px; color: var(--secondary-text-color); white-space: nowrap; }
  .zlabel { font-size: 10px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--secondary-text-color); white-space: nowrap; }
  .zlabel[data-on="true"] { color: var(--primary-color); }

  .readout { padding: 4px 16px 14px; display: grid; gap: 12px; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
  th { font-size: 11px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--secondary-text-color);
    text-align: right; padding: 10px 8px 8px; border-bottom: 1px solid var(--divider-color); white-space: nowrap; }
  td { text-align: right; padding: 8px; border-bottom: 1px solid var(--divider-color); white-space: nowrap; color: var(--primary-text-color); }
  th:first-child, td:first-child { text-align: left; padding-left: 2px; }
  th:last-child, td:last-child { text-align: left; }
  tbody tr:hover, tbody tr:focus-visible { background: color-mix(in srgb, var(--primary-text-color) 5%, transparent); }
  tr[data-absent="true"] td { color: var(--secondary-text-color); }
  .who { display: inline-flex; align-items: center; gap: 8px; font-weight: 500; }
  .sw { width: 10px; height: 10px; border-radius: 50%; background: var(--c); }
  .zones { display: flex; flex-wrap: wrap; gap: 6px; }
  .zones:empty { display: none; }
  .zone { font-size: 12px; padding: 6px 9px; border: 1px solid var(--divider-color); border-radius: 6px; color: var(--secondary-text-color);
    font-variant-numeric: tabular-nums; }
  .zone[data-on="true"] { color: var(--primary-text-color); border-color: var(--primary-color); }
  .zone[data-kind="filter"], .zone[data-kind="interference"] { border-style: dashed; }
`;

const THEME_VARS = ['--ha-card-background', '--card-background-color', '--primary-text-color', '--primary-color', '--divider-color'];

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

class MmwaveRadar3dCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._scene = null;
  }

  static getStubConfig(hass) {
    const found = hass ? detectDevices(hass)[0] : null;
    return found ? { device: found.device, prefix: found.prefix } : { device: 'ld2450', prefix: 'my_radar' };
  }

  setConfig(config) {
    const cfg = normalizeConfig(config);
    this._config = cfg;
    this._adapter = getAdapter(cfg.device);
    this._entities = resolveEntities(this._adapter, cfg);
    this._ids = this._adapter.entityIds(this._entities).filter(Boolean);
    this._ui = { view: cfg.view, trail: cfg.show_trail, zones: cfg.show_zones };
    this._renderShell();
    this._mountScene();
    this._update(true);
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    this._mountScene();
    this._update(true);
  }

  disconnectedCallback() {
    // WebGL contexts are limited per page, so release ours while the card is off screen.
    this._unmountScene();
  }

  getCardSize() {
    const c = this._config;
    return c ? Math.ceil(c.height / 50) + (c.show_table ? 3 : 0) + 1 : 8;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  // ---------- DOM ----------

  _language() {
    return this._hass?.locale?.language ?? this._hass?.language ?? navigator.language;
  }

  _renderShell() {
    this._unmountScene();
    const c = this._config;
    const t = (this._t = strings(this._language()));
    this._lang = this._language();
    this._fmt = {
      m2: new Intl.NumberFormat(this._lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      m1: new Intl.NumberFormat(this._lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      x: new Intl.NumberFormat(this._lang, { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' }),
    };
    const a = this._adapter;
    const viewLabel = { '3d': t.view3d, plan: t.plan, sensor: t.sensorView };
    // Distance is already on each target's floating label, so the table leaves it out to fit narrow cards.
    const cols = [t.target, t.position, ...(a.hasZ ? [t.height, t.posture] : []), ...(a.hasSpeed ? [t.speed] : []), t.zone];

    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="head">
          <div class="title">${esc(c.title || a.label)}</div>
          <span class="chip" data-state="empty">${t.nobody}</span>
        </div>
        <div class="viewport" style="height:${c.height}px">
          <div class="status" hidden></div>
          <div class="toolbar">
            <div class="seg" role="group" aria-label="View">
              ${VIEWS.map((v) => `<button type="button" data-view="${v}" aria-pressed="${v === this._ui.view}">${viewLabel[v]}</button>`).join('')}
            </div>
            <div class="seg" role="group" aria-label="Layers">
              <button type="button" data-toggle="trail" aria-pressed="${this._ui.trail}">${t.trail}</button>
              <button type="button" data-toggle="zones" aria-pressed="${this._ui.zones}">${t.zones}</button>
            </div>
          </div>
        </div>
        ${c.show_table ? `
        <div class="readout">
          <div class="table-wrap">
            <table>
              <thead><tr>${cols.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
              <tbody></tbody>
            </table>
          </div>
          <div class="zones"></div>
        </div>` : ''}
      </ha-card>`;

    const root = this.shadowRoot;
    this._el = {
      chip: root.querySelector('.chip'),
      viewport: root.querySelector('.viewport'),
      status: root.querySelector('.status'),
      tbody: root.querySelector('tbody'),
      zones: root.querySelector('.zones'),
    };

    root.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
      this._ui.view = b.dataset.view;
      root.querySelectorAll('[data-view]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      this._scene?.setView(this._ui.view);
    }));
    root.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.toggle;
      this._ui[key] = !this._ui[key];
      b.setAttribute('aria-pressed', String(this._ui[key]));
      if (key === 'trail') this._scene?.setTrail(c.trail_seconds, this._ui.trail);
      if (key === 'zones' && this._scene) {
        const z = this._scene.lastZones;
        this._scene.setZones(z.zones, z.names, this._ui.zones);
      }
    }));

    this._rows = [];
    if (this._el.tbody) {
      for (let i = 0; i < 3; i++) {
        const tr = document.createElement('tr');
        tr.tabIndex = 0;
        tr.innerHTML = `<td><span class="who"><span class="sw"></span>T${i + 1}</span></td>` +
          '<td></td>'.repeat(cols.length - 1);
        const on = () => this._scene?.setHighlight(i, true), off = () => this._scene?.setHighlight(i, false);
        tr.addEventListener('pointerenter', on);
        tr.addEventListener('pointerleave', off);
        tr.addEventListener('focus', on);
        tr.addEventListener('blur', off);
        this._el.tbody.appendChild(tr);
        this._rows.push({ tr, sw: tr.querySelector('.sw'), cells: [...tr.children].slice(1) });
      }
    }
  }

  _mountScene() {
    if (this._scene || !this._config || !this.isConnected) return;
    try {
      this._scene = new RadarScene(this._el.viewport);
    } catch (err) {
      console.warn('mmwave-3d-card:', err);
      this._setStatus(this._t.noWebgl);
      return;
    }
    this._scene.view = this._ui.view;
    this._scene.setTrail(this._config.trail_seconds, this._ui.trail);
    this._themeKey = null;
    this._sig = null;
    this._io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) this._scene?.start();
      else this._scene?.stop();
    });
    this._io.observe(this._el.viewport);
  }

  _unmountScene() {
    this._io?.disconnect();
    this._io = null;
    this._scene?.dispose();
    this._scene = null;
  }

  _setStatus(text) {
    if (!this._el?.status) return;
    this._el.status.hidden = !text;
    this._el.status.textContent = text ?? '';
  }

  // ---------- data ----------

  _update(force = false) {
    const hass = this._hass, c = this._config;
    if (!hass || !c || !this._el) return;

    if (this._language() !== this._lang) {
      this._renderShell();
      this._mountScene();
      force = true;
    }

    // hass is replaced on every state change in HA; skip the work unless one of our entities or the theme changed.
    // The theme key includes the resolved CSS variables because HA can apply them after hass.themes changes.
    const cs = getComputedStyle(this);
    const themeKey = [hass.themes?.darkMode, ...THEME_VARS.map((v) => cs.getPropertyValue(v))].join('|');
    const sig = this._ids.map((id) => hass.states[id]?.state ?? '').join('|');
    if (!force && sig === this._sig && themeKey === this._themeKey) return;
    this._sig = sig;

    const frame = buildFrame(this._adapter, hass, this._entities, {
      invertX: c.invert_x,
      zOffset: c.z_offset ?? c.mount_height,
      posture: c.posture,
    });
    const firstX = this._entities.targets[0]?.x;
    this._setStatus(firstX && !hass.states[firstX] ? this._t.missing(firstX) : null);

    const scene = this._scene;
    if (scene) {
      if (themeKey !== this._themeKey) {
        this._themeKey = themeKey;
        this._theme = readTheme(this, !!hass.themes?.darkMode);
        scene.setTheme(this._theme);
        this._rows.forEach((r, i) => r.sw.style.setProperty('--c', this._theme.targets[i]));
      }
      scene.setLayout({
        mount: c.mount === 'auto' ? frame.mount ?? 'wall' : c.mount,
        h: c.mount_height,
        range: c.max_range,
        fov: c.fov,
        label: this._adapter.label,
        heightText: `${this._fmt.m1.format(c.mount_height)} m`,
      });
      scene.setZones(frame.zones, frame.zones.map((z) => this._zoneName(z)), this._ui.zones);
      scene.setTargets(frame.targets, (t) => this._targetLabel(t));
    }
    this._renderReadout(frame);
  }

  _zoneName(z) {
    const t = this._t;
    if (z.kind === 'detection') return this._config.zone_names[z.id - 1] || t.zoneN(z.id);
    return `${t.zoneN(z.id)} · ${t[z.kind]}`;
  }

  _targetLabel(target) {
    const m = (v) => `${this._fmt.m2.format(v)} m`;
    return target.z === null ? m(target.distance) : `${m(target.distance)} · ↑${m(target.z)}`;
  }

  _renderReadout(frame) {
    const t = this._t, f = this._fmt, a = this._adapter;
    const n = frame.targets.filter((x) => x.present).length;
    this._el.chip.textContent = n === 0 ? t.nobody : n === 1 ? t.onePerson : t.people(n);
    this._el.chip.dataset.state = n ? 'on' : 'empty';
    if (!this._config.show_table) return;

    frame.targets.forEach((target, i) => {
      const row = this._rows[i];
      if (!row) return;
      row.tr.dataset.absent = String(!target.present);
      const values = target.present
        ? [
          `${f.x.format(target.x)}, ${f.m2.format(target.y)}`,
          ...(a.hasZ ? [target.z === null ? '—' : `${f.m2.format(target.z)} m`, target.posture ? t[target.posture] : '—'] : []),
          ...(a.hasSpeed ? [target.speed === null ? '—' : `${f.m1.format(Math.abs(target.speed))} m/s`] : []),
          target.zone ? this._zoneName(target.zone) : '—',
        ]
        : ['—', ...(a.hasZ ? ['—', '—'] : []), ...(a.hasSpeed ? ['—'] : []), t.absent];
      values.forEach((v, k) => { row.cells[k].textContent = v; });
    });

    this._el.zones.replaceChildren(...frame.zones.map((z) => {
      const chip = document.createElement('span');
      chip.className = 'zone';
      chip.dataset.kind = z.kind;
      if (z.kind === 'detection') {
        chip.dataset.on = String(z.occupied);
        chip.textContent = `${this._zoneName(z)} · ${z.occupied ? (z.count ?? z.inside) || '✓' : t.free}`;
      } else {
        chip.textContent = this._zoneName(z);
      }
      return chip;
    }));
  }
}

if (!customElements.get('mmwave-3d-card')) {
  customElements.define('mmwave-3d-card', MmwaveRadar3dCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'mmwave-3d-card',
    name: 'mmWave 3D Card',
    description: '3D view of HLK-LD2450 / HLK-LD6004 mmWave radar targets and zones',
    documentationURL: 'https://github.com/dortizesquivel/mmwave-3d-card',
  });
  console.info(`%c MMWAVE-3D-CARD %c v${VERSION} `, 'color:#fff;background:#3987e5;font-weight:600', 'color:#3987e5;background:transparent');
}
