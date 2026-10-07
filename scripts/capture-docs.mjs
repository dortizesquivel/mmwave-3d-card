// Regenerates the README images and GIFs from the demo. Needs a build (npm run build),
// Playwright's Chromium and ffmpeg.
//   npm run docs:capture              all of them
//   npm run docs:capture -- replay    only the ones whose name contains "replay"
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8767;
const BASE = `http://localhost:${PORT}/demo/`;
const BG = { dark: '0x111111', light: '0xfafafa' };    // demo page background, used between composed images
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = mkdtempSync(join(tmpdir(), 'mmwave-docs-'));
mkdirSync('docs/images', { recursive: true });
mkdirSync('docs/gifs', { recursive: true });

const server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT)], { stdio: 'ignore' });
let browser;

// ---------- helpers ----------

async function open({ query, theme = 'dark', width = 760, height = 800, still = true, video = false, capture = true }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: still ? 2 : 1,
    colorScheme: theme,
    reducedMotion: still ? 'reduce' : 'no-preference',
    ...(video ? { recordVideo: { dir: tmp, size: { width, height } } } : {}),
  });
  const page = await ctx.newPage();
  const started = Date.now();
  await page.goto(`${BASE}?theme=${theme}&seed=1${capture ? '&capture=1' : ''}&${query}`);
  await page.waitForFunction(() => window.demo?.cards?.every((c) => c._scene));
  if (still) {
    // Cards stop drawing while off screen, so a still capture must fit the whole page in the window.
    const full = await page.evaluate(() => document.documentElement.scrollHeight);
    if (full > height) await page.setViewportSize({ width, height: full });
  }
  await page.mouse.move(width * 0.5, height * 0.95);
  await wait(1200);
  return { ctx, page, card: page.locator('mmwave-3d-card').first(), skip: (Date.now() - started) / 1000, started };
}

/** Moves the visible cursor to an element (or point) and clicks it, like a person would. */
async function tap(page, target, { steps = 18, pause = 250 } = {}) {
  let x, y;
  if ('x' in target) ({ x, y } = target);
  else {
    const b = await target.boundingBox();
    x = b.x + b.width / 2; y = b.y + b.height / 2;
  }
  await page.mouse.move(x, y, { steps });
  await wait(pause);
  await page.mouse.down();
  await wait(90);
  await page.mouse.up();
}

async function drag(page, from, to, steps = 40) {
  await page.mouse.move(from.x, from.y, { steps: 18 });
  await wait(250);
  await page.mouse.down();
  await wait(150);
  await page.mouse.move(to.x, to.y, { steps });
  await wait(150);
  await page.mouse.up();
}

/** Screen point of a floor position (display frame: x to the sensor's right, y forward). */
function floorPoint(card, x, y) {
  return card.evaluate((el, [px, py]) => {
    const s = el._scene;
    s.camera.updateMatrixWorld();
    const v = new s.camera.position.constructor(-px, 0, py).project(s.camera);
    const r = s.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, [x, y]);
}

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);

/** Side by side with a gap, scaled down to `width`. */
function compose(inputs, out, { theme = 'dark', width = 1800, gap = 32 } = {}) {
  const n = inputs.length;
  const pads = inputs.map((_, i) => (i < n - 1 ? `[${i}]pad=iw+${gap}:ih:0:0:color=${BG[theme]}[p${i}]` : `[${i}]copy[p${i}]`));
  const chain = `${pads.join(';')};${inputs.map((_, i) => `[p${i}]`).join('')}hstack=inputs=${n},scale='min(${width},iw)':-2:flags=lanczos`;
  ffmpeg(...inputs.flatMap((f) => ['-i', f]), '-filter_complex', chain, out);
}

/** Video → optimised GIF, cropped to `box` (CSS px). */
function gif(video, out, { skip, duration, box, width = 520, fps = 10, colors = 64 }) {
  const crop = `crop=${Math.round(box.width)}:${Math.round(box.height)}:${Math.round(box.x)}:${Math.round(box.y)}`;
  ffmpeg('-ss', String(skip), '-t', String(duration), '-i', video, '-vf',
    `${crop},fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];` +
    '[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', '-loop', '0', out);
}

async function record(fn, { query, out, width = 760, height = 800, crop }) {
  const s = await open({ query, width, height, still: false, video: true });
  await fn(s);
  const duration = (Date.now() - s.started) / 1000 - s.skip;
  const box = crop ? await crop(s) : { x: 12, y: 12, width: width - 24, height: height - 24 };
  const video = await s.page.video().path();
  await s.ctx.close();
  gif(video, out, { skip: s.skip, duration, box });
}

const viewport = (card) => card.locator('.viewport');

// ---------- assets ----------

const ASSETS = {
  // Hero image: the three demo cards.
  async screenshot() {
    const { ctx, page } = await open({ query: 't=48&frozen=1', width: 1400, height: 770, capture: false });
    await page.locator('main').screenshot({ path: 'docs/screenshot.png' });
    await ctx.close();
  },

  // Hero GIF: one card through live 3D, heatmap, zone editing and replay.
  async demo() {
    await record(async ({ page, card }) => {
      await wait(3000);
      await tap(page, card.locator('[data-mode="heatmap"]'));
      await wait(1200);
      await tap(page, card.locator('[data-view="plan"]'));
      await wait(3000);
      await tap(page, card.locator('[data-mode="live"]'));
      await tap(page, card.locator('[data-act="edit"]'));
      await wait(1300);
      await drag(page, await floorPoint(card, 0.6, 2.6), await floorPoint(card, 1.3, 3.0));
      await wait(2000);
      await tap(page, card.locator('[data-act="done"]'));
      await wait(1000);
      await tap(page, card.locator('[data-mode="replay"]'));
      await wait(1200);
      await tap(page, card.locator('[data-speed="60"]'));
      await tap(page, card.locator('[data-act="play"]'));
      await wait(3000);
    }, { query: 't=43.5&cards=ld6004&cursor=1', out: 'docs/demo.gif' });
  },

  // The same card in its three views.
  async views() {
    const { ctx, card } = await open({ query: 't=48&frozen=1&cards=ld6004' });
    const files = [];
    for (const v of ['3d', 'plan', 'sensor']) {
      await card.locator(`[data-view="${v}"]`).click();
      await wait(600);
      const f = join(tmp, `view-${v}.png`);
      await viewport(card).screenshot({ path: f });
      files.push(f);
    }
    await ctx.close();
    compose(files, 'docs/images/views.png');
  },

  // Standing, sitting and lying, from the LD6004's height.
  async posture() {
    const files = [];
    for (const t of [10.5, 48]) {   // t=10.5: someone sits at the desk; t=48: someone lies on the sofa
      const { ctx, card } = await open({ query: `t=${t}&frozen=1&cards=ld6004`, width: 640 });
      const f = join(tmp, `posture-${t}.png`);
      await viewport(card).screenshot({ path: f });
      files.push(f);
      await ctx.close();
    }
    compose(files, 'docs/images/posture.png', { width: 1600 });
  },

  // A room with walls, a door and furniture, in 3D and in plan, light theme.
  async room() {
    const { ctx, card } = await open({ query: 't=48&frozen=1&cards=ld6004', theme: 'light' });
    const files = [];
    for (const v of ['3d', 'plan']) {
      await card.locator(`[data-view="${v}"]`).click();
      await wait(600);
      const f = join(tmp, `room-${v}.png`);
      await viewport(card).screenshot({ path: f });
      files.push(f);
    }
    await ctx.close();
    compose(files, 'docs/images/room.png', { theme: 'light', width: 1600 });
  },

  // The visual editor next to the card it edits.
  async editor() {
    const { ctx, page } = await open({ query: 't=48&frozen=1&cards=ld6004&editor=1', width: 1180, height: 1180 });
    await page.locator('#editor details').first().evaluate((d) => { d.open = true; });   // "Display"; HA starts with them closed
    await wait(300);
    const box = await page.evaluate(() => {
      const a = document.querySelector('main').getBoundingClientRect(), b = document.querySelector('#editor-box').getBoundingClientRect();
      return { x: 0, y: 0, width: b.right + 12, height: Math.max(a.bottom, b.bottom) + 12 };
    });
    await page.screenshot({ path: 'docs/images/editor.png', clip: box });
    await ctx.close();
  },

  // The heatmap in plan view, dark and light.
  async heatmap() {
    const files = [];
    for (const theme of ['dark', 'light']) {
      const { ctx, card } = await open({ query: 't=48&frozen=1&cards=ld6004&view=plan', theme });
      await card.locator('[data-mode="heatmap"]').click();
      await card.locator('.heat-chip').first().waitFor();
      await wait(600);
      const f = join(tmp, `heat-${theme}.png`);
      const top = await card.boundingBox(), panel = await card.locator('.panel').boundingBox();
      await card.page().screenshot({ path: f, clip: { x: top.x, y: top.y, width: top.width, height: panel.y + panel.height - top.y } });
      files.push(f);
      await ctx.close();
    }
    compose(files, 'docs/images/heatmap.png', { width: 1600 });
  },

  // Editing zones: resize, move, draw a new interference zone, delete it, then Done.
  async 'zone-editing'() {
    await record(async ({ page, card }) => {
      await wait(800);
      await tap(page, card.locator('[data-act="edit"]'));
      await wait(1500);
      await drag(page, await floorPoint(card, 0.6, 2.6), await floorPoint(card, 1.2, 3.1));        // resize the desk zone
      await wait(1500);
      await drag(page, await floorPoint(card, 2.0, 3.4), await floorPoint(card, 2.0, 4.2));        // move the reading zone
      await wait(1500);
      await tap(page, card.locator('[data-act="add"]'));
      await wait(900);
      await tap(page, card.locator('.panel [data-kind="interference"]'));
      await wait(700);
      await drag(page, await floorPoint(card, 1.4, 0.6), await floorPoint(card, 2.4, 1.6), 30);   // draw it on the floor
      await wait(1800);
      await tap(page, await floorPoint(card, 1.9, 1.1));                                            // select it
      await wait(700);
      await tap(page, card.locator('[data-act="delete"]'));
      await wait(1600);
      await tap(page, card.locator('[data-act="done"]'));
      await wait(1500);
    }, {
      query: 't=48&cards=ld6004&cursor=1', out: 'docs/gifs/zone-editing.gif',
      crop: async ({ card }) => { const b = await card.boundingBox(); return { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, 560) }; },
    });
  },

  // Tapping a person and a zone chip; in HA this opens the more-info dialog.
  async 'more-info'() {
    await record(async ({ page, card }) => {
      await wait(800);
      const p = await card.evaluate((el) => el._scene.projectTarget(0));
      await tap(page, p);
      await wait(2200);
      await tap(page, card.locator('.zones .zone').first());
      await wait(2200);
    }, { query: 't=48&frozen=1&cards=ld6004&cursor=1', out: 'docs/gifs/more-info.gif', height: 560 });
  },

  // Replay: open it, speed it up, play, then scrub.
  async replay() {
    await record(async ({ page, card }) => {
      await wait(800);
      await tap(page, card.locator('[data-mode="replay"]'));
      await card.locator('.panel input[type="range"]').waitFor();
      await wait(800);
      await tap(page, card.locator('[data-speed="60"]'));
      await tap(page, card.locator('[data-act="play"]'));
      await wait(3500);
      const r = await card.locator('.panel input[type="range"]').boundingBox();
      await drag(page, { x: r.x + r.width * 0.12, y: r.y + r.height / 2 }, { x: r.x + r.width * 0.7, y: r.y + r.height / 2 }, 30);
      await wait(2500);
    }, {
      query: 't=48&cards=ld2450&cursor=1', out: 'docs/gifs/replay.gif',
      crop: async ({ card }) => { const b = await card.boundingBox(); return { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, 620) }; },
    });
  },
};

try {
  await wait(500);
  browser = await chromium.launch();
  const only = process.argv.slice(2);
  for (const [name, make] of Object.entries(ASSETS)) {
    if (only.length && !only.some((o) => name.includes(o))) continue;
    process.stdout.write(`${name}… `);
    await make();
    console.log('done');
  }
} finally {
  await browser?.close();
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}
