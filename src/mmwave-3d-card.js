import { buildFrame, detectDevices, getAdapter, resolveEntities } from './adapters/index.js';
import { normalizeConfig, VIEWS } from './config.js';
import './editor.js';
import { buildHeatmap } from './heatmap.js';
import { fetchHistory, historySpan, statesAt } from './history.js';
import { formatDuration, strings, zoneName } from './i18n.js';
import { RadarScene } from './scene.js';
import { readTheme } from './theme.js';

const VERSION = typeof __VERSION__ === 'undefined' ? 'dev' : __VERSION__;

const MODES = ['live', 'replay', 'heatmap'];
const PERIODS = [1, 6, 24];                       // hours of history
const SPEEDS = [1, 10, 60];
const HEAT_STEP = { 1: 1000, 6: 2000, 24: 5000 };  // ms between heatmap samples
const HEAT_CELL = 0.2;                            // m
const CONFIRM_TIMEOUT = 8000;                     // ms to wait for the sensor to report an edited zone

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
  .modes { position: absolute; top: 10px; right: 10px; z-index: 2; }
  .toolbar { position: absolute; left: 10px; right: 10px; bottom: 10px; z-index: 2; display: flex; flex-wrap: wrap;
    justify-content: space-between; gap: 8px; pointer-events: none; }
  .seg { pointer-events: auto; display: flex; gap: 2px; padding: 3px; border-radius: 8px; border: 1px solid var(--divider-color);
    background: color-mix(in srgb, var(--card-background-color, #fff) 85%, transparent); backdrop-filter: blur(6px); }
  .seg button { font: inherit; font-size: 12px; font-weight: 500; color: var(--secondary-text-color); background: none; border: 0;
    border-radius: 6px; padding: 8px 10px; min-height: 32px; cursor: pointer; }
  .seg button[hidden] { display: none; }
  .seg button:disabled { opacity: .45; cursor: default; }
  .seg button:hover { color: var(--primary-text-color); background: color-mix(in srgb, var(--primary-text-color) 8%, transparent); }
  .seg button[aria-pressed="true"] { color: var(--text-primary-color, #fff); background: var(--primary-color); }
  button:focus-visible, tr:focus-visible, input:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

  .panel { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 10px 16px;
    border-bottom: 1px solid var(--divider-color); font-size: 13px; color: var(--secondary-text-color); }
  .panel[hidden] { display: none; }
  .panel .seg { backdrop-filter: none; background: none; }
  .panel input[type="range"] { flex: 1 1 160px; min-width: 120px; accent-color: var(--primary-color); }
  .panel .time { min-width: 64px; color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
  .panel .btn { font: inherit; font-size: 12px; font-weight: 500; color: var(--primary-text-color); background: none;
    border: 1px solid var(--divider-color); border-radius: 6px; padding: 7px 10px; min-height: 32px; cursor: pointer; }
  .panel .btn.primary { color: var(--text-primary-color, #fff); background: var(--primary-color); border-color: transparent; }
  .panel .btn:disabled { opacity: .45; cursor: default; }
  .panel .hint { flex: 1 1 220px; min-width: 0; }
  .panel .msg { flex-basis: 100%; color: var(--primary-text-color); }
  .panel .msg[data-error="true"] { color: var(--error-color, #db4437); }
  .legend { display: inline-flex; align-items: center; gap: 8px; font-variant-numeric: tabular-nums; }
  .legend .ramp { width: 110px; height: 8px; border-radius: 4px; }

  .tag { display: flex; align-items: center; gap: 6px; padding: 3px 7px; font-size: 11px; line-height: 1.2; white-space: nowrap;
    color: var(--primary-text-color); background: color-mix(in srgb, var(--card-background-color, #fff) 85%, transparent);
    border: 1px solid var(--divider-color); border-radius: 4px; font-variant-numeric: tabular-nums; }
  .tag i { width: 7px; height: 7px; border-radius: 50%; }
  .tag b { font-weight: 600; }
  .tag span { color: var(--secondary-text-color); }
  .axis, .flabel { font-size: 10px; color: var(--secondary-text-color); white-space: nowrap; }
  .zlabel { font-size: 10px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--secondary-text-color); white-space: nowrap; }
  .zlabel[data-on="true"], .zlabel[data-edit="true"] { color: var(--primary-color); }
  .zlabel[data-edit="true"] { text-transform: none; letter-spacing: 0; }

  .readout { padding: 4px 16px 14px; display: grid; gap: 12px; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
  th { font-size: 11px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--secondary-text-color);
    text-align: right; padding: 10px 8px 8px; border-bottom: 1px solid var(--divider-color); white-space: nowrap; }
  td { text-align: right; padding: 8px; border-bottom: 1px solid var(--divider-color); white-space: nowrap; color: var(--primary-text-color); }
  th:first-child, td:first-child { text-align: left; padding-left: 2px; }
  th:last-child, td:last-child { text-align: left; }
  tbody tr { cursor: pointer; }
  tbody tr:hover, tbody tr:focus-visible { background: color-mix(in srgb, var(--primary-text-color) 5%, transparent); }
  tr[data-absent="true"] td { color: var(--secondary-text-color); }
  .who { display: inline-flex; align-items: center; gap: 8px; font-weight: 500; }
  .sw { width: 10px; height: 10px; border-radius: 50%; background: var(--c); }
  .zones { display: flex; flex-wrap: wrap; gap: 6px; }
  .zones:empty { display: none; }
  .zone { font: inherit; font-size: 12px; padding: 6px 9px; border: 1px solid var(--divider-color); border-radius: 6px; background: none;
    color: var(--secondary-text-color); font-variant-numeric: tabular-nums; cursor: pointer; }
  .zone[data-on="true"] { color: var(--primary-text-color); border-color: var(--primary-color); }
  .zone[data-kind="filter"], .zone[data-kind="interference"] { border-style: dashed; }
`;

const THEME_VARS = ['--ha-card-background', '--card-background-color', '--primary-text-color', '--primary-color', '--divider-color'];
const EXCLUDED = new Set(['filter', 'interference']);

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

class MmwaveRadar3dCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._scene = null;
    this._mode = 'live';
    this._period = 1;
    this._replay = { t: 0, playing: false, speed: 10 };
  }

  static getConfigElement() {
    return document.createElement('mmwave-3d-card-editor');
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
    this._stopReplay();
    this._mode = 'live';
    this._editing = false;
    this._history = null;
    this._heat = null;
    this._panelMsg = null;
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
    this._stopReplay();
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
      time: new Intl.DateTimeFormat(this._lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
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
          <span class="chip" data-state="empty">${esc(t.nobody)}</span>
        </div>
        <div class="viewport" style="height:${Number(c.height)}px">
          <div class="status" hidden></div>
          <div class="seg modes" role="group" aria-label="Mode">
            ${MODES.map((m) => `<button type="button" data-mode="${m}" aria-pressed="${m === this._mode}">${esc(t[m])}</button>`).join('')}
          </div>
          <div class="toolbar">
            <div class="seg" role="group" aria-label="View">
              ${VIEWS.map((v) => `<button type="button" data-view="${v}" aria-pressed="${v === this._ui.view}">${esc(viewLabel[v])}</button>`).join('')}
            </div>
            <div class="seg" role="group" aria-label="Layers">
              <button type="button" data-toggle="trail" aria-pressed="${this._ui.trail}">${esc(t.trail)}</button>
              <button type="button" data-toggle="zones" aria-pressed="${this._ui.zones}">${esc(t.zones)}</button>
              <button type="button" data-act="edit" aria-pressed="false" hidden>${esc(t.editZones)}</button>
            </div>
          </div>
        </div>
        <div class="panel" hidden></div>
        ${c.show_table ? `
        <div class="readout">
          <div class="table-wrap">
            <table>
              <thead><tr>${cols.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
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
      panel: root.querySelector('.panel'),
      edit: root.querySelector('[data-act="edit"]'),
      tbody: root.querySelector('tbody'),
      zones: root.querySelector('.zones'),
    };

    root.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => this._setView(b.dataset.view)));
    root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => this._setMode(b.dataset.mode)));
    root.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.toggle;
      this._ui[key] = !this._ui[key];
      b.setAttribute('aria-pressed', String(this._ui[key]));
      if (key === 'trail') this._scene?.setTrail(c.trail_seconds, this._ui.trail);
      if (key === 'zones') this._update(true);
    }));
    this._el.edit.addEventListener('click', () => (this._editing ? this._exitEdit() : this._enterEdit()));
    this._el.zones?.addEventListener('click', (e) => {
      const id = e.target.closest('[data-entity]')?.dataset.entity;
      if (id) this._moreInfo(id);
    });

    this._rows = [];
    if (this._el.tbody) {
      for (let i = 0; i < 3; i++) {
        const tr = document.createElement('tr');
        tr.tabIndex = 0;
        tr.innerHTML = `<td><span class="who"><span class="sw"></span>T${i + 1}</span></td>` + '<td></td>'.repeat(cols.length - 1);
        const on = () => this._scene?.setHighlight(i, true), off = () => this._scene?.setHighlight(i, false);
        const open = () => this._moreInfo(this._entities.targets[i]?.x);
        tr.addEventListener('pointerenter', on);
        tr.addEventListener('pointerleave', off);
        tr.addEventListener('focus', on);
        tr.addEventListener('blur', off);
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
        this._el.tbody.appendChild(tr);
        this._rows.push({ tr, sw: tr.querySelector('.sw'), cells: [...tr.children].slice(1) });
      }
    }
    this._renderPanel();
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
    const s = this._scene;
    s.view = this._ui.view;
    s.setTrail(this._config.trail_seconds, this._ui.trail);
    s.onPick = (hit) => this._onPick(hit);
    s.onZoneEdit = (zone, rect) => this._saveZone(zone, rect);
    s.onZoneSelect = (zone) => { this._selectedZone = zone; this._renderPanel(); };
    s.onZoneDraw = (rect) => this._finishAdd(rect);
    if (this._editing && this._editInfo?.supported) s.setEditMode(true);
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

  _setView(view) {
    this._ui.view = view;
    this.shadowRoot.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    this._scene?.setView(view);
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId } }));
  }

  _onPick(hit) {
    if (hit.kind === 'target') this._moreInfo(this._entities.targets[hit.index]?.x);
    else this._moreInfo(this._shownZones?.[hit.index]?.entity);
  }

  // ---------- data ----------

  _frameOpts() {
    const c = this._config;
    return { invertX: c.invert_x, zOffset: c.z_offset ?? c.mount_height, posture: c.posture };
  }

  _visibleZones(zones) {
    return this._config.show_interference ? zones : zones.filter((z) => !EXCLUDED.has(z.kind));
  }

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

    const frame = buildFrame(this._adapter, hass, this._entities, this._frameOpts());
    this._frame = frame;
    // While editing, every zone is shown, including the ones show_interference hides.
    const zones = this._editing ? frame.zones : this._visibleZones(frame.zones);
    this._shownZones = zones;
    const firstX = this._entities.targets[0]?.x;
    this._setStatus(firstX && !hass.states[firstX] ? this._t.missing(firstX) : null);
    this._el.edit.hidden = !(c.allow_zone_editing && hass.user?.is_admin && this._mode === 'live');

    const scene = this._scene;
    if (scene) {
      if (themeKey !== this._themeKey) {
        this._themeKey = themeKey;
        this._theme = readTheme(this, !!hass.themes?.darkMode);
        scene.setTheme(this._theme);
        this._rows.forEach((r, i) => r.sw.style.setProperty('--c', this._theme.targets[i]));
        if (this._mode === 'heatmap' && this._heat) { scene.setHeatmap(this._heat); this._renderPanel(); }
      }
      scene.setLayout({
        mount: c.mount === 'auto' ? frame.mount ?? 'wall' : c.mount,
        h: c.mount_height,
        range: c.max_range,
        fov: c.fov,
        label: this._adapter.label,
        heightText: `${this._fmt.m1.format(c.mount_height)} m`,
        locale: this._lang,
        zoneStep: this._adapter.zoneStep,
      });
      scene.setRoom(c.room);
      scene.setZones(zones, {
        nameFor: (z) => (z.draft ? this._t.newZone : this._zoneName(z)),
        visible: this._ui.zones,
        canEdit: (z) => (this._editInfo?.kinds ?? []).includes(z.kind),
      });
      if (this._mode !== 'replay') scene.setTargets(frame.targets, (t) => this._targetLabel(t));
    }
    if (this._mode !== 'replay') this._renderReadout(frame.targets, zones);
  }

  _zoneName(z) {
    return zoneName(z, this._t, this._config.zone_names);
  }

  _targetLabel(target) {
    const m = (v) => `${this._fmt.m2.format(v)} m`;
    return target.z === null ? m(target.distance) : `${m(target.distance)} · ↑${m(target.z)}`;
  }

  _renderReadout(targets, zones) {
    const t = this._t, f = this._fmt, a = this._adapter;
    const n = targets.filter((x) => x.present).length;
    this._el.chip.textContent = n === 0 ? t.nobody : n === 1 ? t.onePerson : t.people(n);
    this._el.chip.dataset.state = n ? 'on' : 'empty';
    if (!this._config.show_table) return;

    targets.forEach((target, i) => {
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

    this._el.zones.replaceChildren(...zones.map((z) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'zone';
      chip.dataset.kind = z.kind;
      if (z.entity) chip.dataset.entity = z.entity;
      if (z.kind === 'detection') {
        chip.dataset.on = String(z.occupied);
        chip.textContent = `${this._zoneName(z)} · ${z.occupied ? (z.count ?? z.inside) || '✓' : t.free}`;
      } else {
        chip.textContent = this._zoneName(z);
      }
      return chip;
    }));
  }

  // ---------- modes: live, replay, heatmap ----------

  async _setMode(mode) {
    if (mode === this._mode) return;
    if (this._editing) this._exitEdit();
    this._mode = mode;
    this.shadowRoot.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    this._stopReplay();
    this._heat = null;
    this._panelMsg = null;
    this._scene?.setHeatmap(null);
    this._scene?.clearTrails();
    this._renderPanel();
    if (mode === 'live') {
      this._update(true);
      return;
    }
    this._update(true);
    await this._loadHistory();
  }

  _historyIds() {
    return [...new Set(this._entities.targets.flatMap((t) => [t.x, t.y, t.z, t.speed]).filter(Boolean))];
  }

  async _loadHistory() {
    const hass = this._hass, t = this._t;
    const end = Date.now(), start = end - this._period * 3600e3;
    const token = (this._historyToken = {});
    this._history = null;
    this._heat = null;
    this._scene?.setHeatmap(null);
    this._panelMsg = { text: t.loadingHistory };
    this._renderPanel();
    try {
      if (!hass?.callWS) throw new Error('no websocket connection');
      const ids = this._historyIds();
      const data = await fetchHistory(hass, ids, new Date(start), new Date(end));
      if (token !== this._historyToken) return;               // a newer request replaced this one
      const span = historySpan(data);
      if (!span) {
        this._panelMsg = { text: t.noHistory, error: true };
      } else {
        const base = Object.fromEntries([...this._ids, ...ids].map((id) => [id, hass.states[id] ?? { state: 'unavailable', attributes: {} }]));
        this._history = { data, start, end, base };
        this._panelMsg = null;
        if (this._mode === 'replay') {
          this._replay.t = Math.max(start, span.first);
          this._showReplayFrame();
        } else if (this._mode === 'heatmap') {
          this._computeHeatmap();
        }
      }
    } catch (err) {
      if (token !== this._historyToken) return;
      this._panelMsg = { text: t.historyFailed(err?.message ?? String(err)), error: true };
    }
    this._renderPanel();
  }

  /** Targets as they were at time t, from the history. Zone occupancy comes from those positions. */
  _frameAt(t) {
    const states = statesAt(this._history.data, t, this._history.base);
    const frame = buildFrame(this._adapter, { states }, this._entities, this._frameOpts());
    for (const z of frame.zones) { z.occupied = z.inside > 0; z.count = null; }
    return frame;
  }

  _showReplayFrame() {
    if (!this._history) return;
    const frame = this._frameAt(this._replay.t);
    this._scene?.setTargets(frame.targets, (t) => this._targetLabel(t));
    this._renderReadout(frame.targets, this._visibleZones(frame.zones));
    this._syncReplayControls();
  }

  _syncReplayControls() {
    const p = this._el.panel;
    const range = p.querySelector('input[type="range"]');
    if (range && this.shadowRoot.activeElement !== range) range.value = String(this._replay.t);   // not while it's being dragged
    const time = p.querySelector('.time');
    if (time) time.textContent = this._fmt.time.format(this._replay.t);
    const play = p.querySelector('[data-act="play"]');
    if (play) play.textContent = this._replay.playing ? this._t.pause : this._t.play;
  }

  _togglePlay() {
    if (!this._history) return;
    if (this._replay.playing) { this._stopReplay(); this._syncReplayControls(); return; }
    if (this._replay.t >= this._history.end) this._replay.t = this._history.start;
    this._replay.playing = true;
    let last = performance.now();
    this._replayTimer = setInterval(() => {
      const now = performance.now();
      this._replay.t = Math.min(this._history.end, this._replay.t + (now - last) * this._replay.speed);
      last = now;
      if (this._replay.t >= this._history.end) this._stopReplay();
      this._showReplayFrame();
    }, 100);
    this._syncReplayControls();
  }

  _stopReplay() {
    clearInterval(this._replayTimer);
    this._replayTimer = null;
    if (this._replay) this._replay.playing = false;
  }

  _computeHeatmap() {
    const h = this._history, scene = this._scene;
    if (!h || !scene) return;
    this._heat = buildHeatmap({
      start: h.start,
      end: h.end,
      step: HEAT_STEP[this._period],
      cell: HEAT_CELL,
      bounds: scene.floorBounds(),
      sampleAt: (t) => buildFrame(this._adapter, { states: statesAt(h.data, t, h.base) }, this._entities, this._frameOpts()).targets,
    });
    scene.setHeatmap(this._heat);
  }

  // ---------- zone editing ----------

  _enterEdit() {
    const t = this._t;
    this._editInfo = this._adapter.zoneEditing(this._hass, this._entities, this._config);
    this._editing = true;
    this._selectedZone = null;
    this._panelMsg = this._editInfo.supported ? null : { text: t.editUnsupported[this._editInfo.reason], error: true };
    this._el.edit.setAttribute('aria-pressed', 'true');
    this._viewBeforeEdit = this._ui.view;
    this._setView('plan');
    this._scene?.setEditMode(this._editInfo.supported);
    this._renderPanel();
    this._update(true);      // show every zone, with handles on the editable ones
  }

  _exitEdit() {
    this._editing = false;
    this._adding = null;
    clearTimeout(this._confirmTimer);
    this._el.edit.setAttribute('aria-pressed', 'false');
    this._scene?.setEditMode(false);
    this._setView(this._viewBeforeEdit ?? this._ui.view);
    this._panelMsg = null;
    this._renderPanel();
    this._update(true);
  }

  /** rect in the display frame, or null to clear the zone on the sensor. */
  async _saveZone(zone, rect) {
    const c = this._config, t = this._t;
    const sx = c.invert_x ? -1 : 1, zOff = c.z_offset ?? c.mount_height;
    const sensorRect = rect && {
      x1: rect.x1 * sx, x2: rect.x2 * sx, y1: rect.y1, y2: rect.y2,
      z1: zone.z1 === null ? 0 : zone.z1 - zOff,
      z2: zone.z2 === null ? 0 : zone.z2 - zOff,
    };
    clearTimeout(this._confirmTimer);
    this._panelMsg = { text: t.saving };
    this._renderPanel();
    try {
      await this._adapter.writeZone(this._hass, this._entities, zone, sensorRect, this._editInfo);
      this._panelMsg = { text: rect ? t.saved(this._zoneName(zone)) : t.deleted(this._zoneName(zone)) };
      this._confirmTimer = setTimeout(() => {
        if (!this._scene?.override) return;
        this._scene.clearOverride();
        this._panelMsg = { text: t.notConfirmed, error: true };
        this._renderPanel();
      }, CONFIRM_TIMEOUT);
    } catch (err) {
      this._scene?.clearOverride();
      this._panelMsg = { text: t.saveFailed(err?.message ?? String(err)), error: true };
    }
    this._renderPanel();
  }

  /** First slot of `kind` the sensor isn't using, or undefined. */
  _freeSlot(kind) {
    const used = new Set(this._frame.zones.filter((z) => z.kind === kind).map((z) => z.slot));
    return [...Array(this._editInfo.slots).keys()].find((i) => !used.has(i));
  }

  /** Add zone: pick a kind (LD6004), then draw it on the floor or tap to drop a 1 m square. */
  _startAdd(kind) {
    const kinds = this._editInfo.kinds.filter((k) => this._freeSlot(k) !== undefined);
    if (!kinds.length) {
      this._panelMsg = { text: this._t.noFreeSlot, error: true };
      this._renderPanel();
      return;
    }
    this._adding = { kind: kinds.includes(kind) ? kind : kinds[0] };
    this._selectedZone = null;
    this._panelMsg = null;
    this._scene?.setDrawMode(this._adding.kind);
    this._renderPanel();
  }

  _cancelAdd() {
    this._adding = null;
    this._scene?.setDrawMode(null);
    this._renderPanel();
  }

  _finishAdd(rect) {
    const kind = this._adding?.kind;
    this._adding = null;
    this._scene?.setDrawMode(null);
    const slot = kind ? this._freeSlot(kind) : undefined;
    if (slot === undefined) {
      this._panelMsg = { text: this._t.noFreeSlot, error: true };
      this._renderPanel();
      return;
    }
    const hasZ = this._adapter.hasZ;
    const zone = { kind, slot, id: slot + 1, z1: hasZ ? 0 : null, z2: hasZ ? 2.2 : null };   // new LD6004 zones: floor to 2.2 m
    this._scene?.setPending(zone, rect);
    this._saveZone(zone, rect);
  }

  _deleteZone() {
    const zone = this._selectedZone;
    if (!zone) return;
    this._selectedZone = null;
    this._saveZone(zone, null);
  }

  // ---------- panel under the 3D view ----------

  _renderPanel() {
    const p = this._el?.panel;
    if (!p) return;
    const t = this._t;
    const msg = this._panelMsg ? `<span class="msg" data-error="${!!this._panelMsg.error}">${esc(this._panelMsg.text)}</span>` : '';
    if (this._editing && this._adding) {
      const kinds = this._editInfo.kinds;
      const chooser = kinds.length > 1 ? `<div class="seg" role="group" aria-label="${esc(t.zoneKind)}">${kinds.map((k) => {
        const full = this._freeSlot(k) === undefined;
        return `<button type="button" data-kind="${k}" aria-pressed="${k === this._adding.kind}" ${full ? 'disabled' : ''}>`
          + `${esc(t.kindLabel[k])}${full ? ` ${esc(t.full)}` : ''}</button>`;
      }).join('')}</div>` : '';
      p.innerHTML = `<span class="hint">${esc(t.drawHint)}</span>${chooser}
        <button type="button" class="btn" data-act="cancel">${esc(t.cancel)}</button>${msg}`;
    } else if (this._editing) {
      const ok = this._editInfo?.supported;
      p.innerHTML = (ok ? `<span class="hint">${esc(t.editHint)}</span>
        <button type="button" class="btn" data-act="add">${esc(t.addZone)}</button>
        <button type="button" class="btn" data-act="delete" ${this._selectedZone ? '' : 'disabled'}>${esc(t.deleteZone)}</button>` : '')
        + `<button type="button" class="btn primary" data-act="done">${esc(t.done)}</button>${msg}`;
    } else if (this._mode === 'live') {
      p.hidden = true;
      p.replaceChildren();
      return;
    } else {
      const periods = `<div class="seg" role="group" aria-label="Period">${PERIODS.map((h) =>
        `<button type="button" data-period="${h}" aria-pressed="${h === this._period}">${esc(t.lastHours(h))}</button>`).join('')}</div>`;
      const h = this._history;
      if (this._mode === 'replay') {
        p.innerHTML = periods + (h ? `
          <button type="button" class="btn" data-act="play">${esc(this._replay.playing ? t.pause : t.play)}</button>
          <input type="range" min="${h.start}" max="${h.end}" step="1000" value="${this._replay.t}" aria-label="${esc(t.replay)}">
          <span class="time"></span>
          <div class="seg" role="group" aria-label="Speed">${SPEEDS.map((s) =>
            `<button type="button" data-speed="${s}" aria-pressed="${s === this._replay.speed}">×${s}</button>`).join('')}</div>` : '') + msg;
      } else {
        const heat = this._heat;
        p.innerHTML = periods + (heat?.max ? `
          <span class="legend"><span>${esc(t.timeHere)}</span>
            <span class="ramp" style="background:linear-gradient(to right, ${this._theme.ramp.join(', ')})"></span>
            <span>0 – ${esc(formatDuration(heat.max))}</span></span>
          <span>${esc(t.heatTotal(formatDuration(heat.total)))}</span>` : '') + msg;
      }
    }
    p.hidden = false;

    p.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => {
      this._period = Number(b.dataset.period);
      this._stopReplay();
      this._scene?.clearTrails();
      this._loadHistory();
    }));
    p.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
      this._replay.speed = Number(b.dataset.speed);
      p.querySelectorAll('[data-speed]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    }));
    p.querySelector('[data-act="play"]')?.addEventListener('click', () => this._togglePlay());
    p.querySelector('input[type="range"]')?.addEventListener('input', (e) => {
      const next = Number(e.target.value);
      if (Math.abs(next - this._replay.t) > 3000) this._scene?.clearTrails();
      this._replay.t = next;
      this._showReplayFrame();
    });
    p.querySelector('[data-act="add"]')?.addEventListener('click', () => this._startAdd());
    p.querySelector('[data-act="cancel"]')?.addEventListener('click', () => this._cancelAdd());
    p.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => this._startAdd(b.dataset.kind)));
    p.querySelector('[data-act="delete"]')?.addEventListener('click', () => this._deleteZone());
    p.querySelector('[data-act="done"]')?.addEventListener('click', () => this._exitEdit());
    this._syncReplayControls();
  }
}

if (!customElements.get('mmwave-3d-card')) {
  customElements.define('mmwave-3d-card', MmwaveRadar3dCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'mmwave-3d-card',
    name: 'mmWave 3D Card',
    description: '3D view of HLK-LD2450 / HLK-LD6004 mmWave radar targets and zones',
    preview: false,
    documentationURL: 'https://github.com/dortizesquivel/mmwave-3d-card',
  });
  console.info(`%c MMWAVE-3D-CARD %c v${VERSION} `, 'color:#fff;background:#3987e5;font-weight:600', 'color:#3987e5;background:transparent');
}
