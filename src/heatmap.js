// Time spent per floor cell, from targets sampled at a fixed step.

/**
 * bounds: { x1, x2, y1, y2 } in metres (display frame); cell: metres per cell;
 * sampleAt(t) returns the targets at time t ([{ present, x, y }]); start/end/step in ms.
 * Returns { cols, rows, cell, x1, y1, values (seconds per cell, lightly blurred), max, total }.
 */
export function buildHeatmap({ start, end, step, cell, bounds, sampleAt }) {
  const cols = Math.max(1, Math.ceil((bounds.x2 - bounds.x1) / cell));
  const rows = Math.max(1, Math.ceil((bounds.y2 - bounds.y1) / cell));
  const raw = new Float32Array(cols * rows);
  const dt = step / 1000;
  let total = 0;
  for (let t = start; t < end; t += step) {
    for (const p of sampleAt(t)) {
      if (!p.present) continue;
      const i = Math.floor((p.x - bounds.x1) / cell), j = Math.floor((p.y - bounds.y1) / cell);
      if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
      raw[j * cols + i] += dt;
      total += dt;
    }
  }
  const values = blur(raw, cols, rows);
  let max = 0;
  for (const v of values) if (v > max) max = v;
  return { cols, rows, cell, x1: bounds.x1, y1: bounds.y1, values, max, total };
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
