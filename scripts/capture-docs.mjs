// Regenerates the README images from the demo: docs/screenshot.png and docs/demo.gif.
// Needs a build (npm run build), Playwright's Chromium and ffmpeg. Usage: npm run docs:capture
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8767;
const base = `http://localhost:${PORT}/demo/`;
const server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT)], { stdio: 'ignore' });
const tmp = mkdtempSync(join(tmpdir(), 'mmwave-docs-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await wait(500);
  const browser = await chromium.launch();

  // Screenshot: the three demo cards, dark theme.
  const shot = await browser.newContext({ viewport: { width: 1400, height: 770 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const sp = await shot.newPage();
  await sp.goto(`${base}?theme=dark&seed=1&t=48&frozen=1`);
  await sp.waitForFunction(() => window.demo?.cards?.every((c) => c._scene));
  await wait(2000);
  await sp.locator('main').screenshot({ path: 'docs/screenshot.png' });
  await shot.close();

  // GIF: one LD6004 card going through live 3D, heatmap, zone editing and replay.
  const W = 760, H = 800;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: 'dark', recordVideo: { dir: tmp, size: { width: W, height: H } } });
  const p = await ctx.newPage();
  const started = Date.now();
  await p.goto(`${base}?theme=dark&seed=1&t=43.5&cards=ld6004&capture=1`);
  await p.waitForFunction(() => window.demo?.cards?.every((c) => c._scene));
  await wait(1200);
  const skip = (Date.now() - started) / 1000;
  const card = p.locator('mmwave-3d-card').first();
  const click = (sel) => card.locator(sel).click();
  const floorPoint = (x, y) => card.evaluate((el, [px, py]) => {
    const s = el._scene;
    s.camera.updateMatrixWorld();
    const v = new s.camera.position.constructor(-px, 0, py).project(s.camera);
    const r = s.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, [x, y]);

  await wait(3500);                                   // live, 3D
  await click('[data-mode="heatmap"]');
  await wait(1500);
  await click('[data-view="plan"]');
  await wait(3500);                                   // heatmap in plan view
  await click('[data-mode="live"]');
  await click('[data-act="edit"]');
  await wait(1500);
  const from = await floorPoint(0.6, 2.6), to = await floorPoint(1.3, 3.0);
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 40 });
  await p.mouse.up();
  await wait(2200);                                   // "Desk saved to the sensor."
  await click('[data-act="done"]');
  await wait(1200);
  await click('[data-mode="replay"]');
  await wait(1500);
  await card.locator('[data-speed="60"]').click();
  await click('[data-act="play"]');
  await wait(3500);                                   // replay at ×60
  const total = (Date.now() - started) / 1000 - skip;
  const video = await p.video().path();
  await ctx.close();
  await browser.close();

  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(skip), '-t', String(total), '-i', video, '-vf',
    `crop=${W - 24}:${H - 24}:12:12,fps=10,scale=520:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    '-loop', '0', 'docs/demo.gif']);
  console.log('docs/screenshot.png and docs/demo.gif updated');
} finally {
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}
