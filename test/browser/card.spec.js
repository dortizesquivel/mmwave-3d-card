import { expect, test } from '@playwright/test';

// The demo with a fixed seed, scene time and clock renders the same frame on every run.
const FIXED_NOW = new Date('2026-10-06T12:00:00Z');
// Fonts and software WebGL differ between operating systems, so screenshots are only compared on Linux (CI).
const compareScreenshots = process.platform === 'linux' || !!process.env.VISUAL;

async function openDemo(page, query = '') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text()); });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto(`/demo/?seed=1&t=48&frozen=1&${query}`);
  await page.waitForFunction(() => window.demo?.cards?.length && window.demo.cards.every((c) => c._scene));
  await page.waitForTimeout(1000);          // let the figures settle on their positions
  return errors;
}

const card = (page, i = 0) => page.locator('mmwave-3d-card').nth(i);

/** Screen point of a floor position in the display frame (x to the sensor's right, y forward). */
function floorPoint(cardEl, x, y) {
  return cardEl.evaluate((el, [px, py]) => {
    const s = el._scene;
    s.camera.updateMatrixWorld();             // the view may have changed since the last rendered frame
    const v = new s.camera.position.constructor(-px, 0, py).project(s.camera);
    const r = s.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, [x, y]);
}

test('renders the three demo cards with live data', async ({ page }) => {
  const errors = await openDemo(page);
  await expect(page.locator('mmwave-3d-card')).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(card(page, i).locator('canvas')).toBeVisible();
    await expect(card(page, i).locator('tbody tr')).toHaveCount(3);
  }
  await expect(card(page, 0).locator('thead th')).toHaveText(['Target', 'Position (m)', 'Speed', 'Zone']);
  await expect(card(page, 1).locator('thead th')).toHaveText(['Target', 'Position (m)', 'Height', 'Posture', 'Zone']);
  await expect(card(page, 0).locator('.chip')).toHaveText('3 people');
  await expect(card(page, 1).locator('.zones')).toContainText('Interference 1');
  await expect(card(page, 1).locator('tbody')).toContainText('Lying');
  expect(errors).toEqual([]);
});

test('view buttons move the camera', async ({ page }) => {
  await openDemo(page, 'cards=ld2450');
  const c = card(page);
  await c.locator('[data-view="plan"]').click();
  await expect(c.locator('[data-view="plan"]')).toHaveAttribute('aria-pressed', 'true');
  const [, height] = await c.evaluate((el) => el._scene.camera.position.toArray());
  expect(height).toBeGreaterThan(5);
});

test('tapping a person opens its more-info dialog', async ({ page }) => {
  await openDemo(page, 'cards=ld6004');
  const p = await card(page).evaluate((el) => el._scene.projectTarget(0));
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => page.evaluate(() => window.demo.moreInfo)).toContain('sensor.radar_ld6004_target_0_x');
});

test('dragging a zone corner writes the zone to the LD2450', async ({ page }) => {
  await openDemo(page, 'cards=ld2450');
  const c = card(page);
  await c.locator('[data-act="edit"]').click();
  await expect(c.locator('.panel')).toContainText('Drag a zone');
  // Zone 1 spans x -1.2…0.6 m, y 0.9…2.6 m: drag its far-right corner 40 cm right and 30 cm further.
  const from = await floorPoint(c, 0.6, 2.6), to = await floorPoint(c, 1.0, 2.9);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect(c.locator('.panel .msg')).toContainText('saved to the sensor');
  const calls = await page.evaluate(() => window.demo.calls.map((x) => [x.data.entity_id, x.data.value]));
  const value = (key) => calls.find(([id]) => id === `number.kin_estudio_piscina_zone_1_${key}`)?.[1];
  expect(value('x1')).toBe(-1200);
  expect(Math.abs(value('x2') - 1000)).toBeLessThanOrEqual(50);
  expect(Math.abs(value('y2') - 2900)).toBeLessThanOrEqual(50);
  await expect(c.locator('.panel .msg')).not.toHaveAttribute('data-error', 'true');
});

test('dragging a zone writes it to the LD6004 service with its height', async ({ page }) => {
  await openDemo(page, 'cards=ld6004');
  const c = card(page);
  await c.locator('[data-act="edit"]').click();
  // Move the whole desk zone (x -1.2…0.6, y 0.9…2.6) half a metre to the right.
  const from = await floorPoint(c, -0.3, 1.75), to = await floorPoint(c, 0.2, 1.75);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect(c.locator('.panel .msg')).toContainText('Desk saved to the sensor');
  const call = await page.evaluate(() => window.demo.calls.at(-1));
  expect(call.service).toBe('hlk_ld6004_set_detection_zone');
  expect(call.data).toMatchObject({ zone_index: 0, x_min: -0.7, x_max: 1.1, y_min: 0.9, y_max: 2.6, z_min: -1.5, z_max: -0.2 });
});

async function dragFloor(page, c, from, to) {
  const a = await floorPoint(c, ...from), b = await floorPoint(c, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
}

async function tapFloor(page, c, x, y) {
  const p = await floorPoint(c, x, y);
  await page.mouse.click(p.x, p.y);
}

const lastCall = (page) => page.evaluate(() => window.demo.calls.at(-1));

test('an LD2450 zone can be deleted, and drawing a new one fills its slot', async ({ page }) => {
  await openDemo(page, 'cards=ld2450');
  const c = card(page);
  const zone3 = () => page.evaluate(() => Object.fromEntries(['x1', 'y1', 'x2', 'y2']
    .map((k) => [k, Number(window.demo.sim.states[`number.kin_estudio_piscina_zone_3_${k}`].state)])));
  await c.locator('[data-act="edit"]').click();
  await expect(c.locator('[data-act="delete"]')).toBeDisabled();

  // Zone 3 spans x -2.9…-0.9, y 3.2…5.2: tap inside it to select it, then delete it.
  await tapFloor(page, c, -1.5, 4.8);
  await expect(c.locator('[data-act="delete"]')).toBeEnabled();
  await c.locator('[data-act="delete"]').click();
  await expect(c.locator('.panel .msg')).toContainText('Zone 3 deleted from the sensor');
  await expect(c.locator('.zones')).not.toContainText('Zone 3');
  expect(await zone3()).toEqual({ x1: 0, y1: 0, x2: 0, y2: 0 });

  // Add zone → draw it on the floor; it goes into the free slot.
  await c.locator('[data-act="add"]').click();
  await expect(c.locator('.panel')).toContainText('Drag on the floor');
  await expect(c.locator('.panel [data-kind]')).toHaveCount(0);          // the LD2450's zones all share one kind
  await dragFloor(page, c, [-2.5, 3.5], [-1.5, 4.5]);
  await expect(c.locator('.panel .msg')).toContainText('Zone 3 saved to the sensor');
  await expect(c.locator('.zones')).toContainText('Zone 3');
  const z = await zone3();
  for (const [k, v] of Object.entries({ x1: -2500, y1: 3500, x2: -1500, y2: 4500 })) expect(Math.abs(z[k] - v), k).toBeLessThanOrEqual(50);
});

test('adding a zone with every slot taken says so', async ({ page }) => {
  await openDemo(page, 'cards=ld2450');
  const c = card(page);
  await c.locator('[data-act="edit"]').click();
  await c.locator('[data-act="add"]').click();
  await expect(c.locator('.panel .msg')).toContainText('no free zones left');
  expect(await page.evaluate(() => window.demo.calls.length)).toBe(0);
});

test('the LD6004 adds an interference zone through its own service, then deletes it', async ({ page }) => {
  await openDemo(page, 'cards=ld6004');
  const c = card(page);
  await c.locator('[data-act="edit"]').click();
  await c.locator('[data-act="add"]').click();
  await expect(c.locator('.panel [data-kind]')).toHaveText(['Detection', 'Interference', 'Dwell']);
  await c.locator('.panel [data-kind="interference"]').click();
  await expect(c.locator('.panel [data-kind="interference"]')).toHaveAttribute('aria-pressed', 'true');

  await tapFloor(page, c, 1.5, 1.0);                                // a tap drops a 1 m square
  await expect(c.locator('.panel .msg')).toContainText('Interference 2 saved to the sensor');
  expect(await lastCall(page)).toMatchObject({ service: 'hlk_ld6004_set_interference_zone',
    data: { zone_index: 1, x_min: 1, x_max: 2, y_min: 0.5, y_max: 1.5, z_min: -1.5, z_max: 0.7 } });
  await expect(c.locator('.zones')).toContainText('Interference 2');

  await tapFloor(page, c, 1.5, 1.0);
  await c.locator('[data-act="delete"]').click();
  await expect(c.locator('.panel .msg')).toContainText('Interference 2 deleted from the sensor');
  expect(await lastCall(page)).toMatchObject({ service: 'hlk_ld6004_set_interference_zone', data: { zone_index: 1, x_min: 0, x_max: 0 } });
  await expect(c.locator('.zones')).not.toContainText('Interference 2');
});

test('the LD6004 draws a dwell zone, and Cancel leaves without writing', async ({ page }) => {
  await openDemo(page, 'cards=ld6004');
  const c = card(page);
  await c.locator('[data-act="edit"]').click();
  await c.locator('[data-act="add"]').click();
  await c.locator('[data-act="cancel"]').click();
  await expect(c.locator('.panel')).toContainText('Drag a zone to move it');
  expect(await page.evaluate(() => window.demo.calls.length)).toBe(0);

  await c.locator('[data-act="add"]').click();
  await c.locator('.panel [data-kind="dwell"]').click();
  await dragFloor(page, c, [-2.9, 3.0], [-0.9, 5.0]);
  await expect(c.locator('.panel .msg')).toContainText('Dwell 1 saved to the sensor');
  expect(await lastCall(page)).toMatchObject({ service: 'hlk_ld6004_set_dwell_zone',
    data: { zone_index: 0, x_min: -2.9, x_max: -0.9, y_min: 3, y_max: 5 } });
  await expect(c.locator('.zones')).toContainText('Dwell 1');
});

test('the LD6004 interference zone can be moved like a detection zone', async ({ page }) => {
  await openDemo(page, 'cards=ld6004');
  const c = card(page);
  await c.locator('[data-act="edit"]').click();
  // The fan's zone spans x -2.6…-2.0, y 1.0…1.6: drag it half a metre to the right.
  await dragFloor(page, c, [-2.3, 1.3], [-1.8, 1.3]);
  await expect(c.locator('.panel .msg')).toContainText('Interference 1 saved to the sensor');
  expect(await lastCall(page)).toMatchObject({ service: 'hlk_ld6004_set_interference_zone',
    data: { zone_index: 0, x_min: -2.1, x_max: -1.5, y_min: 1, y_max: 1.6, z_min: -1.5, z_max: -0.3 } });
});

test('heatmap and replay read the recorder history', async ({ page }) => {
  await openDemo(page, 'cards=ld6004');
  const c = card(page);
  await c.locator('[data-mode="heatmap"]').click();
  await expect(c.locator('.legend')).toBeVisible();
  await expect(c.locator('.panel')).toContainText('of presence in total');
  await c.locator('[data-mode="replay"]').click();
  await expect(c.locator('.panel input[type="range"]')).toBeVisible();
  const before = await c.locator('.panel .time').textContent();
  await c.locator('[data-act="play"]').click();
  await expect.poll(() => c.locator('.panel .time').textContent()).not.toBe(before);
});

test('the visual editor changes the card', async ({ page }) => {
  await openDemo(page, 'cards=ld2450');
  await page.locator('#editor-box > summary').click();
  const title = page.locator('#editor input[name="title"]');
  await title.fill('Office');
  await title.dispatchEvent('change');
  await expect(card(page).locator('.title')).toHaveText('Office');
  await expect(page.locator('#yaml')).toContainText('"title": "Office"');
});

test.describe('screenshots', () => {
  test.skip(!compareScreenshots, 'screenshot baselines are made on Linux in CI');

  test('three cards, dark theme', async ({ page }) => {
    await openDemo(page, 'theme=dark');
    await expect(page.locator('main')).toHaveScreenshot('overview-dark.png');
  });

  test('LD6004 with a room, light theme, plan view', async ({ page }) => {
    await openDemo(page, 'theme=light&cards=ld6004&view=plan&capture=1');
    await expect(card(page)).toHaveScreenshot('room-light-plan.png');
  });

  test('heatmap, dark theme', async ({ page }) => {
    await openDemo(page, 'theme=dark&cards=ld6004&view=plan&capture=1');
    await card(page).locator('[data-mode="heatmap"]').click();
    await expect(card(page).locator('.legend')).toBeVisible();
    await expect(card(page)).toHaveScreenshot('heatmap-dark.png');
  });

  test('zone editing on the ceiling sensor', async ({ page }) => {
    await openDemo(page, 'theme=dark&cards=ceiling&capture=1');
    await card(page).locator('[data-act="edit"]').click();
    await expect(card(page)).toHaveScreenshot('edit-ceiling.png');
  });
});
