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

async function open({ query, theme = 'light', width = 760, height = 800, still = true, video = false, capture = true }) {
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
function compose(inputs, out, { theme = 'light', width = 1800, gap = 32 } = {}) {
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

async function record(fn, { query, out, width = 760, height = 800, crop, gifWidth, ...gifOpts }) {
  const s = await open({ query, width, height, still: false, video: true });
  await fn(s);
  const duration = (Date.now() - s.started) / 1000 - s.skip;
  const box = crop ? await crop(s) : { x: 12, y: 12, width: width - 24, height: height - 24 };
  const video = await s.page.video().path();
  await s.ctx.close();
  gif(video, out, { skip: s.skip, duration, box, ...(gifWidth ? { width: gifWidth } : {}), ...gifOpts });
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

  // Hero GIF, two cards side by side. Left: an LD6004 in live 3D and its heatmap in plan. Right: an LD2450 in a
  // 3D model of the room: orbit, zoom, the sensor's and the plan views, then the same room in the futuristic style.
  // Zone editing and replay have their own GIFs further down.
  async demo() {
    await record(async ({ page }) => {
      const [left, right] = [0, 1].map((i) => page.locator('mmwave-3d-card').nth(i));
      await page.waitForFunction(() => window.demo.cards[1]._scene?.modelBox);
      await wait(1900);
      const v = await viewport(right).boundingBox();
      await drag(page, { x: v.x + v.width * 0.6, y: v.y + v.height * 0.55 }, { x: v.x + v.width * 0.38, y: v.y + v.height * 0.45 }, 50);
      await wait(500);
      await tap(page, right.locator('[data-zoom="in"]'));
      await wait(500);
      await tap(page, right.locator('[data-zoom="in"]'));
      await wait(1000);
      await tap(page, right.locator('[data-zoom="out"]'));
      await wait(500);
      await tap(page, left.locator('[data-mode="heatmap"]'));
      await wait(700);
      await tap(page, left.locator('[data-view="plan"]'));
      await wait(1400);
      await tap(page, right.locator('[data-view="sensor"]'));
      await wait(1800);
      await tap(page, right.locator('[data-view="plan"]'));
      await wait(1400);
      await tap(page, left.locator('[data-mode="live"]'));
      await tap(page, left.locator('[data-view="3d"]'));
      await tap(page, right.locator('[data-view="3d"]'));
      await wait(1200);
      // The same room as a hologram: what `style: futuristic` in the card's YAML gives.
      await right.evaluate((el) => {
        const m = el._config.model;
        el.setConfig({
          type: 'custom:mmwave-3d-card', device: 'ld2450', prefix: 'kin_estudio_piscina', title: 'Living room · futuristic',
          model: { url: m.url, style: 'futuristic', sensor: { position: m.sensor.position, heading: m.sensor.heading } },
        });
      });
      await page.waitForFunction(() => window.demo.cards[1]._scene?.holo);
      await wait(1600);
      const h = await viewport(right).boundingBox();
      await drag(page, { x: h.x + h.width * 0.35, y: h.y + h.height * 0.5 }, { x: h.x + h.width * 0.6, y: h.y + h.height * 0.42 }, 50);
      await wait(1100);
      await tap(page, right.locator('[data-view="plan"]'));
      await wait(1900);
      await tap(page, right.locator('[data-view="sensor"]'));
      await wait(1900);
    }, {
      query: 't=43.5&cards=ld6004,model&two=1&cursor=1', out: 'docs/demo.gif', width: 1500, height: 900,
      gifWidth: 1000, fps: 8, colors: 72,
      // Both cards from their title down to just under the view, where the replay and heatmap panel appears.
      crop: async ({ page }) => {
        const cards = page.locator('mmwave-3d-card');
        const a = await cards.nth(0).boundingBox(), b = await cards.nth(1).boundingBox();
        const va = await viewport(cards.nth(0)).boundingBox(), vb = await viewport(cards.nth(1)).boundingBox();
        const top = Math.min(a.y, b.y), bottom = Math.max(va.y + va.height, vb.y + vb.height) + 66;
        return { x: a.x, y: top, width: b.x + b.width - a.x, height: bottom - top };
      },
    });
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

  // A room with walls, a door and furniture, in 3D and in plan.
  async room() {
    const { ctx, card } = await open({ query: 't=48&frozen=1&cards=ld6004' });
    const files = [];
    for (const v of ['3d', 'plan']) {
      await card.locator(`[data-view="${v}"]`).click();
      await wait(600);
      const f = join(tmp, `room-${v}.png`);
      await viewport(card).screenshot({ path: f });
      files.push(f);
    }
    await ctx.close();
    compose(files, 'docs/images/room.png', { width: 1600 });
  },

  // A room model: the example living room textured and in the futuristic style, side by side.
  async model() {
    const files = [];
    for (const key of ['model', 'holo']) {
      const { ctx, page, card } = await open({ query: `t=48&frozen=1&cards=${key}` });
      await page.waitForFunction(() => window.demo.cards.every((c) => c._scene.modelBox));
      await wait(900);
      const f = join(tmp, `model-${key}.png`);
      await viewport(card).screenshot({ path: f });
      files.push(f);
      await ctx.close();
    }
    compose(files, 'docs/images/model.png', { width: 1600 });
  },

  // An LD2410: distance arcs, limits and the energy per gate.
  async ld2410() {
    const { ctx, card } = await open({ query: 't=45&frozen=1&cards=ld2410', width: 760 });
    await card.screenshot({ path: 'docs/images/ld2410.png' });
    await ctx.close();
  },

  // LD2410 tour: a still target breathing and a moving one rippling away, a turn of the camera around the
  // beam's volume, both in one gate taking turns, the plan view, and someone walking back to the sensor.
  async 'ld2410-tour'() {
    await record(async ({ page, card }) => {
      await wait(4000);
      const b = await viewport(card).boundingBox();
      await drag(page, { x: b.x + b.width * 0.45, y: b.y + b.height * 0.62 }, { x: b.x + b.width * 0.49, y: b.y + b.height * 0.61 }, 40);
      await wait(4500);
      await tap(page, card.locator('[data-view="plan"]'));
      await wait(3500);
      await tap(page, card.locator('[data-view="3d"]'));
      await wait(1800);
    }, {
      query: 't=4.5&cards=ld2410&cursor=1', out: 'docs/gifs/ld2410.gif', height: 860, fps: 8, width: 480, colors: 48,
      crop: async ({ card }) => card.boundingBox(),
    });
  },

  // The same LD2410 2.4 m up a wall, level and tilted 20° down.
  async tilt() {
    const files = [];
    for (const tilt of [0, 20]) {
      const { ctx, page, card } = await open({ query: 't=7&frozen=1&cards=ld2410', width: 760 });
      await page.evaluate((t) => window.demo.cards[0].setConfig({
        type: 'custom:mmwave-3d-card', device: 'ld2410', prefix: 'esp32_pasillo', title: 'Hallway · HLK-LD2410', mount_height: 2.4, tilt: t,
      }), tilt);
      await page.evaluate(() => window.demo.push());
      await wait(1500);
      const f = join(tmp, `tilt-${tilt}.png`);
      await viewport(card).screenshot({ path: f });
      files.push(f);
      await ctx.close();
    }
    compose(files, 'docs/images/tilt.png', { width: 1600 });
  },

  // A preview per sensor for the gallery: the whole card, and a few seconds of its 3D view.
  async sensors() {
    mkdirSync('docs/sensors', { recursive: true });
    for (const [name, cards, t] of [['ld2450', 'ld2450', 48], ['ld6004-wall', 'ld6004', 48], ['ld6004-ceiling', 'ceiling', 48], ['ld2410', 'ld2410', 13]]) {
      const { ctx, card } = await open({ query: `t=${t}&frozen=1&cards=${cards}`, width: 760 });
      await card.screenshot({ path: `docs/sensors/${name}.png` });
      await ctx.close();
      await record(async ({ page, card: c }) => {
        await wait(1500);
        const b = await viewport(c).boundingBox();
        await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.6);
        await drag(page, { x: b.x + b.width * 0.4, y: b.y + b.height * 0.6 }, { x: b.x + b.width * 0.58, y: b.y + b.height * 0.56 }, 60);
        await wait(3500);
      }, {
        query: `t=${t}&cards=${cards}`, out: `docs/sensors/${name}.gif`, height: 560,
        crop: async ({ card: c }) => viewport(c).boundingBox(),
      });
    }
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

  // The heatmap in plan view and in 3D.
  async heatmap() {
    const files = [];
    for (const view of ['plan', '3d']) {
      const { ctx, card } = await open({ query: `t=48&frozen=1&cards=ld6004&view=${view}` });
      await card.locator('[data-mode="heatmap"]').click();
      await card.locator('.heat-chip').first().waitFor();
      await wait(600);
      const f = join(tmp, `heat-${view}.png`);
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
