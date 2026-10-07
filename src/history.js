// Recorder history for replay and heatmap.

/** Fetches the history of `ids` between `start` and `end` (Dates) through HA's websocket API. */
export async function fetchHistory(hass, ids, start, end) {
  const res = await hass.callWS({
    type: 'history/history_during_period',
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    entity_ids: ids,
    minimal_response: true,
    no_attributes: true,
    significant_changes_only: false,
  });
  return parseHistory(res, ids);
}

/**
 * HA answers with compressed states ({ s, lu, lc }) or, on older versions, full ones
 * ({ state, last_updated }). Returns Map id → { t: ms[], s: state[] }, sorted by time.
 */
export function parseHistory(res, ids) {
  const out = new Map();
  for (const id of ids) {
    const rows = [];
    for (const e of res?.[id] ?? []) {
      const sec = e.lu ?? e.lc;
      const ms = sec !== undefined ? sec * 1000 : Date.parse(e.last_updated ?? e.last_changed);
      const state = e.s ?? e.state;
      if (Number.isFinite(ms) && state !== undefined) rows.push([ms, String(state)]);
    }
    rows.sort((a, b) => a[0] - b[0]);
    out.set(id, { t: rows.map((r) => r[0]), s: rows.map((r) => r[1]) });
  }
  return out;
}

/** Index of the last sample at or before `t`, or -1. */
export function indexAt(series, t) {
  let lo = 0, hi = series.t.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series.t[mid] <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/**
 * A hass-like `states` object as of time `t`: entities with history take their state at `t`
 * ("unavailable" before their first sample); the rest keep `base` (the current states).
 * Attributes always come from `base`, so units still convert.
 */
export function statesAt(history, t, base) {
  const states = { ...base };
  for (const [id, series] of history) {
    const i = indexAt(series, t);
    states[id] = { state: i < 0 ? 'unavailable' : series.s[i], attributes: base[id]?.attributes ?? {} };
  }
  return states;
}

/** Time span covered by the history, or null when nothing was recorded. */
export function historySpan(history) {
  let first = Infinity, last = -Infinity;
  for (const s of history.values()) {
    if (!s.t.length) continue;
    first = Math.min(first, s.t[0]);
    last = Math.max(last, s.t[s.t.length - 1]);
  }
  return Number.isFinite(first) ? { first, last } : null;
}

/**
 * When something was detected: [from, to] intervals within [start, end]. `isActive(t)` says whether
 * anyone is detected at time t; it is only asked at start and at each recorded change, since nothing
 * can change in between.
 */
export function activityIntervals(history, start, end, isActive) {
  const times = new Set();
  for (const s of history.values()) for (const t of s.t) if (t > start && t <= end) times.add(t);
  const out = [];
  let from = isActive(start) ? start : null;
  for (const t of [...times].sort((a, b) => a - b)) {
    const on = isActive(t);
    if (on && from === null) from = t;
    else if (!on && from !== null) { out.push([from, t]); from = null; }
  }
  if (from !== null) out.push([from, end]);
  return out;
}

/**
 * Where playback goes next when quiet stretches are skipped: t itself while something is detected or the
 * next detection is under `minGap` away, else `lead` ms before the next detection, or null after the last.
 */
export function skipQuiet(intervals, t, { minGap = 5000, lead = 1000 } = {}) {
  for (const [from, to] of intervals) {
    if (t < from) return from - t < minGap ? t : from - lead;
    if (t < to) return t;
  }
  return null;
}
