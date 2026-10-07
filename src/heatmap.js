// Time spent per floor cell, per target, from targets sampled at a fixed step.

/**
 * bounds: { x1, x2, y1, y2 } in metres (display frame); cell: metres per cell;
 * sampleAt(t) returns the targets at time t ([{ id, present, x, y }], id 1…targets); start/end/step in ms.
 * Returns { cols, rows, cell, x1, y1, layers: one grid of seconds per target (lightly blurred), totals: seconds per target }.
 */
export function buildHeatmap({ start, end, step, cell, bounds, sampleAt, targets = 3 }) {
  const cols = Math.max(1, Math.ceil((bounds.x2 - bounds.x1) / cell));
  const rows = Math.max(1, Math.ceil((bounds.y2 - bounds.y1) / cell));
  const raw = Array.from({ length: targets }, () => new Float32Array(cols * rows));
  const totals = new Array(targets).fill(0);
  const dt = step / 1000;
  for (let t = start; t < end; t += step) {
    for (const p of sampleAt(t)) {
      const k = (p.id ?? 1) - 1;
      if (!p.present || k < 0 || k >= targets) continue;
      const i = Math.floor((p.x - bounds.x1) / cell), j = Math.floor((p.y - bounds.y1) / cell);
      if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
      raw[k][j * cols + i] += dt;
      totals[k] += dt;
    }
  }
  return { cols, rows, cell, x1: bounds.x1, y1: bounds.y1, layers: raw.map((r) => blur(r, cols, rows)), totals };
}

/**
 * 1D version for distance-only sensors: time per distance bin (metres), one layer per kind
 * (moving, still). sampleAt(t) returns [{ id: 1 | 2, present, distance }]. Works with combine().
 */
export function buildRingHeatmap({ start, end, step, bin, maxRange, sampleAt }) {
  const bins = Math.max(1, Math.ceil(maxRange / bin));
  const raw = [new Float32Array(bins), new Float32Array(bins)];
  const totals = [0, 0];
  const dt = step / 1000;
  for (let t = start; t < end; t += step) {
    for (const p of sampleAt(t)) {
      const k = p.id - 1;
      if (!p.present || k < 0 || k > 1 || p.distance === null) continue;
      const i = Math.floor(p.distance / bin);
      if (i < 0 || i >= bins) continue;
      raw[k][i] += dt;
      totals[k] += dt;
    }
  }
  return { rings: true, bin, cols: bins, rows: 1, layers: raw, totals };
}

/**
 * The chosen targets together: time per cell, the target that spent the most of it there (its colour
 * paints the cell), the busiest cell and the total time. visible: one boolean per target.
 */
export function combine(map, visible) {
  const n = map.cols * map.rows;
  const values = new Float32Array(n), owner = new Uint8Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0, best = 0, bestValue = 0;
    map.layers.forEach((layer, k) => {
      if (!visible[k]) return;
      sum += layer[i];
      if (layer[i] > bestValue) { bestValue = layer[i]; best = k; }
    });
    values[i] = sum;
    owner[i] = best;
    if (sum > max) max = sum;
  }
  const total = map.totals.reduce((acc, t, k) => acc + (visible[k] ? t : 0), 0);
  return { values, owner, max, total };
}

// 3×3 kernel (1-2-1) so radar jitter doesn't paint a checkerboard. Keeps the total time.
export function blur(src, cols, rows) {
  const out = new Float32Array(src.length);
  const k = [1, 2, 1];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = src[j * cols + i];
      if (!v) continue;
      let wsum = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const x = i + di, y = j + dj;
        if (x >= 0 && y >= 0 && x < cols && y < rows) wsum += k[di + 1] * k[dj + 1];
      }
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const x = i + di, y = j + dj;
        if (x >= 0 && y >= 0 && x < cols && y < rows) out[y * cols + x] += (v * k[di + 1] * k[dj + 1]) / wsum;
      }
    }
  }
  return out;
}
