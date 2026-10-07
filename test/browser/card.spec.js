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
  const params = new URLSearchParams({ seed: '1', t: '48', frozen: '1' });
  for (const [k, v] of new URLSearchParams(query)) params.set(k, v);     // the test's own values win
  await page.goto(`/demo/?${params}`);
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

test('renders the four demo cards with live data', async ({ page }) => {
  const errors = await openDemo(page);
  await expect(page.locator('mmwave-3d-card')).toHaveCount(4);
  for (let i = 0; i < 4; i++) await expect(card(page, i).locator('canvas')).toBeVisible();
  for (let i = 0; i < 3; i++) await expect(card(page, i).locator('tbody tr')).toHaveCount(3);
  await expect(card(page, 3).locator('thead th')).toHaveText(['Detection', 'Distance', 'Energy', 'Gate']);
  await expect(card(page, 3).locator('tbody tr')).toHaveText([/^Moving/, /^Still/]);
  await expect(card(page, 0).locator('thead th')).toHaveText(['Target', 'Position (m)', 'Speed', 'Zone']);
  await expect(card(page, 1).locator('thead th')).toHaveText(['Target', 'Position (m)', 'Height', 'Posture', 'Zone']);
  await expect(card(page, 0).locator('.chip')).toHaveText('3 people');
  await expect(card(page, 1).locator('.zones')).toContainText('Interference 1');
  await expect(card(page, 1).locator('tbody')).toContainText('Lying');
  expect(errors).toEqual([]);
});

test('a card off screen draws nothing until it is scrolled into view', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 700 });
  await openDemo(page, 'capture=1');                       // one column: the last card starts below the window
  const frames = (i) => card(page, i).evaluate((el) => el._scene.framesDrawn);
  expect(await frames(0)).toBeGreaterThan(0);
  expect(await frames(3)).toBe(0);
  await card(page, 3).scrollIntoViewIfNeeded();
  await expect.poll(() => frames(3)).toBeGreaterThan(0);
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
  // One chip per person, in their colour, with their time; tapping one hides that person's trail of colour.
  await expect(c.locator('.heat-chip')).toHaveCount(3);
  await expect(c.locator('.heat-chip').first()).toContainText('T1 ·');
  await expect(c.locator('.panel')).toContainText('in one spot');
  await c.locator('.heat-chip[data-heat="0"]').click();
  await expect(c.locator('.heat-chip[data-heat="0"]')).toHaveAttribute('aria-pressed', 'false');
  expect(await c.evaluate((el) => el._heatVisible)).toEqual([false, true, true]);
  expect(await c.evaluate((el) => el._scene.heatOn)).toBe(true);
  await c.locator('[data-mode="replay"]').click();
  await expect(c.locator('.panel input[type="range"]')).toBeVisible();
  const before = await c.locator('.panel .time').textContent();
  await c.locator('[data-act="play"]').click();
  await expect.poll(() => c.locator('.panel .time').textContent()).not.toBe(before);
});

test('replay keeps the table and its controls still while playing', async ({ page }) => {
  await openDemo(page, 'cards=ld6004');
  const c = card(page);
  await c.locator('[data-mode="replay"]').click();
  await expect(c.locator('.panel input[type="range"]')).toBeVisible();
  const layout = () => c.evaluate((el) => {
    const box = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.width)]; };
    const q = (s) => el.shadowRoot.querySelector(s), qa = (s) => [...el.shadowRoot.querySelectorAll(s)];
    return {
      columns: qa('thead th').map(box),
      slider: box(q('.panel input[type="range"]')),
      play: box(q('[data-act="play"]')),
      time: box(q('.panel .time')),
      chips: qa('.zones .zone').map(box),
    };
  });
  await c.locator('[data-speed="60"]').click();
  const before = await layout();
  const times = new Set();
  await c.locator('[data-act="play"]').click();
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(400);
    expect(await layout()).toEqual(before);
    times.add(await c.locator('.panel .time').textContent());
  }
  expect(times.size).toBeGreaterThan(3);              // it really was playing
});

test('replay skips the quiet stretches and marks when someone was there', async ({ page }) => {
  await openDemo(page, 'cards=ld2410');                                     // the demo hallway: 45 s busy every 6 min
  const c = card(page);
  await c.locator('[data-mode="replay"]').click();
  await expect(c.locator('.panel input[type="range"]')).toBeVisible();
  const activity = await c.evaluate((el) => el._activity);
  expect(activity.length).toBeGreaterThan(5);
  await expect(c.locator('.activity i')).toHaveCount(activity.length);      // one mark per detection on the strip
  await expect(c.locator('[data-speed]')).toHaveText(['×1', '×10', '×60', '×600']);
  await expect(c.locator('[data-act="skip"]')).toHaveAttribute('aria-pressed', 'true');

  // From just after a detection, at ×1: with skipping, it lands 1 s before the next one at once.
  const [, end1] = activity[0], [start2] = activity[1];
  const playFrom = async (t) => {
    await c.evaluate((el, at) => { el._replay.t = at; }, t);
    await c.locator('[data-speed="1"]').click();
    await c.locator('[data-act="play"]').click();
    await page.waitForTimeout(600);
    await c.locator('[data-act="play"]').click();                           // pause
    return c.evaluate((el) => el._replay.t);
  };
  expect(await playFrom(end1 + 1000)).toBeGreaterThanOrEqual(start2 - 1000);
  await c.locator('[data-act="skip"]').click();                             // off: it plays the quiet time as it was
  await expect(c.locator('[data-act="skip"]')).toHaveAttribute('aria-pressed', 'false');
  expect(await playFrom(end1 + 1000)).toBeLessThan(end1 + 5000);
});

test('the LD2410 card shows its detection, the energy per gate and engineering mode', async ({ page }) => {
  await openDemo(page, 'cards=ld2410&t=45');
  const c = card(page);
  await expect(c.locator('.chip')).toHaveText('Presence');
  const moving = c.locator('tbody tr').first();
  await expect(moving).toContainText(/\d\.\d\d m/);
  await expect(moving).toContainText(/G\d/);
  const gate = (await moving.locator('td').last().textContent()).trim();
  await expect(c.locator('.glabels .here')).toContainText(gate);       // the chart marks the gate it is in
  await expect(c.locator('.gcol')).toHaveCount(9);
  await expect(c.locator('.gbar.off')).toHaveCount(6);                 // gates 6–8 are beyond the 4.5 m limits
  expect(await c.evaluate((el) => el._scene.arcs.moving.present)).toBe(true);
  expect(await page.evaluate(() => window.demo.calls.length)).toBe(0);

  await c.locator('[data-act="engineering"]').click();                 // it was on in the demo
  await expect.poll(() => page.evaluate(() => window.demo.calls.at(-1))).toMatchObject({ domain: 'switch', service: 'turn_off',
    data: { entity_id: 'switch.esp32_pasillo_engineering_mode' } });
  await page.evaluate(() => { window.demo.sim.advance(1); window.demo.push(); });
  await expect(c.locator('.gates .note')).toContainText("Turn on the sensor's engineering mode");
  await expect(c.locator('.gbar b')).toHaveCount(0);                   // no energies, thresholds only
  await expect(c.locator('.gbar i')).toHaveCount(18);
});

test('the LD2410 heatmap and replay work by distance', async ({ page }) => {
  await openDemo(page, 'cards=ld2410');
  const c = card(page);
  await expect(c.locator('[data-act="edit"]')).toBeHidden();             // no zones on this sensor
  await c.locator('[data-mode="heatmap"]').click();
  await expect(c.locator('.heat-chip')).toHaveText([/^Moving · /, /^Still · /]);
  expect(await c.evaluate((el) => el._scene.heatOn)).toBe(true);
  await c.locator('[data-mode="replay"]').click();
  await expect(c.locator('.panel input[type="range"]')).toBeVisible();
  await c.locator('[data-speed="60"]').click();
  const before = await c.locator('tbody').textContent();
  await c.locator('[data-act="play"]').click();
  await expect.poll(() => c.locator('tbody').textContent()).not.toBe(before);
});

test('the LD2410 draws its beam in 3D: shells at the measured distance, the fan at the sensor height', async ({ page }) => {
  await openDemo(page, 'cards=ld2410&t=45&frozen=1');
  const c = card(page);
  await expect(c.locator('[data-toggle]')).toHaveCount(0);                 // no trails or zones on this sensor
  const d = Number((await c.locator('tbody tr').first().locator('td').nth(1).textContent()).match(/\d+\.\d+/)[0]);
  const info = () => c.evaluate((el) => {
    const s = el._scene, a = s.arcs.moving, u = a.shellMat.uniforms;
    return { fanY: s._fanY(), vol: s.vol.group.visible, layers: a.layers.filter((m) => m.visible).length, r0: u.r0.value, r1: u.r1.value };
  });
  await expect.poll(async () => { const i = await info(); return i.layers === 6 && i.r0 < d && i.r1 > d; }).toBe(true);
  const i = await info();
  expect(i.fanY).toBe(1.5);                                                // mount_height: the fan is the slice through the sensor
  expect(i.vol).toBe(true);
  expect(i.r1 - i.r0).toBeCloseTo(0.75, 2);                                // one gate thick
  await c.locator('[data-view="plan"]').click();
  await expect.poll(async () => (await info()).vol).toBe(false);           // the plan view shows only the fan
});

test('a tilted LD2410 turns its beam and fan down and keeps each detection at its measured distance', async ({ page }) => {
  await openDemo(page, 'cards=ld2410&t=45&frozen=1');
  const c = card(page);
  await c.evaluate((el) => el.setConfig({ type: 'custom:mmwave-3d-card', device: 'ld2410', prefix: 'esp32_pasillo', mount_height: 2.4, tilt: 20 }));
  await page.evaluate(() => window.demo.push());
  const d = Number((await c.locator('tbody tr').first().locator('td').nth(1).textContent()).match(/\d+\.\d+/)[0]);
  const geo = () => c.evaluate((el) => {
    const s = el._scene, a = s.arcs.moving, V3 = s.camera.position.constructor;
    s.scene.updateMatrixWorld(true);
    const pos = a.arc.geometry.attributes.position, p = new V3(), sensor = new V3(0, s.layout.h, 0);
    const dists = [], ys = [];
    for (let i = 0; i < pos.count; i += 8) {
      p.fromBufferAttribute(pos, i).applyMatrix4(a.arc.matrixWorld);
      dists.push(p.distanceTo(sensor));
      ys.push(p.y);
    }
    const ax = a.shellMat.uniforms.axis.value;
    return { dists, maxY: Math.max(...ys), axis: [ax.x, ax.y, ax.z], label: el.shadowRoot.textContent.includes('2.4 m · 20°') };
  });
  await expect.poll(async () => (await geo()).dists.every((x) => Math.abs(x - d) < 0.05)).toBe(true);   // on the sphere of radius d
  const g = await geo();
  const t = (20 * Math.PI) / 180;
  expect(g.axis[1]).toBeCloseTo(-Math.sin(t), 3);                           // the beam points 20° down
  expect(g.axis[2]).toBeCloseTo(Math.cos(t), 3);
  expect(g.maxY).toBeLessThan(2.4);                                         // the whole arc lies below the sensor
  expect(g.label).toBe(true);                                               // "HLK-LD2410 · 2.4 m · 20°"
});

test.describe('with motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('the scan wave grows out of the sensor, and stays subtle', async ({ page }) => {
    await openDemo(page, 'cards=ld2450,ld2410');
    const sample = () => page.evaluate(() => {
      const [a, b] = window.demo.cards;
      return { ring: a._scene.pulse.material.opacity, scale: a._scene.pulse.scale.x, shell: b._scene.vol.pulse.material.uniforms.opacity.value };
    });
    let ring = 0, shell = 0;
    const scales = new Set();
    for (let k = 0; k < 16; k++) {                                         // a little more than one 2.8 s cycle
      const s = await sample();
      ring = Math.max(ring, s.ring);
      shell = Math.max(shell, s.shell);
      scales.add(Math.round(s.scale * 4));
      await page.waitForTimeout(200);
    }
    expect(ring).toBeGreaterThan(0.05);
    expect(ring).toBeLessThanOrEqual(0.14);                                // on the floor: a hint, not a feature
    expect(shell).toBeGreaterThan(0.05);
    expect(shell).toBeLessThanOrEqual(0.32);                               // in 3D (LD2410): the same
    expect(scales.size).toBeGreaterThan(3);                                // it grows
  });

  test('LD2410: moving and still in one gate take turns, and the ripples follow the target', async ({ page }) => {
    await openDemo(page, 'cards=ld2410&t=15&frozen=1');                    // someone walking away, seen as moving and still at 3.8 m
    const c = card(page);
    const state = () => c.evaluate((el) => {
      const s = el._scene;
      return { swap: s.swap, dir: s.arcs.moving.dir, m: s.arcs.moving.band.material.uniforms.opacity.value, st: s.arcs.still.band.material.uniforms.opacity.value };
    });
    await expect.poll(async () => (await state()).swap).toBeGreaterThan(0.9);
    const lead = { m: 0, st: 0 };
    for (let k = 0; k < 16; k++) {                                         // over a whole turn (2.4 s) each colour gets its moment
      const s = await state();
      lead.m = Math.max(lead.m, s.m - s.st);
      lead.st = Math.max(lead.st, s.st - s.m);
      await page.waitForTimeout(200);
    }
    expect(lead.m).toBeGreaterThan(0.5);
    expect(lead.st).toBeGreaterThan(0.5);

    const step = (s) => page.evaluate((sec) => { window.demo.sim.advance(sec); window.demo.push(); }, s);
    await step(5);                                                          // t = 20: walking back from 4.1 m
    await page.waitForTimeout(400);
    await step(1);                                                          // 3.1 m
    await expect.poll(async () => (await state()).dir).toBe(-1);          // towards the sensor
  });
});

test('trail and zone buttons hide those layers', async ({ page }) => {
  await openDemo(page, 'cards=ld2450');
  const c = card(page);
  const layers = () => c.evaluate((el) => ({ trail: el._scene.showTrail, zones: el._scene.zoneGroup.visible }));
  expect(await layers()).toEqual({ trail: true, zones: true });
  await c.locator('[data-toggle="trail"]').click();
  await c.locator('[data-toggle="zones"]').click();
  await expect(c.locator('[data-toggle="trail"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(c.locator('[data-toggle="zones"]')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(layers).toEqual({ trail: false, zones: false });
});

test('a zone chip and a table row open their more-info dialogs', async ({ page }) => {
  await openDemo(page, 'cards=ld2450,ld2410');
  await card(page, 0).locator('.zones .zone').first().click();
  await expect.poll(() => page.evaluate(() => window.demo.moreInfo.at(-1))).toBe('sensor.kin_estudio_piscina_zone_1_all_target_count');
  await card(page, 0).locator('tbody tr').nth(1).click();
  await expect.poll(() => page.evaluate(() => window.demo.moreInfo.at(-1))).toBe('sensor.kin_estudio_piscina_target_2_x');
  await card(page, 1).locator('tbody tr').nth(1).click();                  // LD2410: the still target's distance
  await expect.poll(() => page.evaluate(() => window.demo.moreInfo.at(-1))).toBe('sensor.esp32_pasillo_still_distance');
});

test('the card follows Home Assistant into Spanish', async ({ page }) => {
  await openDemo(page, 'cards=ld6004,ld2410&lang=es');
  await expect(card(page, 0).locator('[data-mode]')).toHaveText(['En vivo', 'Repetición', 'Mapa de calor']);
  await expect(card(page, 0).locator('[data-view]')).toHaveText(['3D', 'Planta', 'Sensor']);
  await expect(card(page, 0).locator('thead th')).toHaveText(['Objetivo', 'Posición (m)', 'Altura', 'Postura', 'Zona']);
  await expect(card(page, 0).locator('.chip')).toHaveText('3 personas');
  await expect(card(page, 1).locator('thead th')).toHaveText(['Detección', 'Distancia', 'Energía', 'Puerta']);
});

test('a missing entity says which one, so the prefix can be fixed', async ({ page }) => {
  await openDemo(page, 'cards=ld2450');
  const c = card(page);
  await c.evaluate((el) => el.setConfig({ type: 'custom:mmwave-3d-card', device: 'ld2450', prefix: 'nope' }));
  await page.evaluate(() => window.demo.push());
  await expect(c.locator('.status')).toBeVisible();
  await expect(c.locator('.status')).toContainText('Cannot find sensor.nope_target_1_x');
});

test('show_table and show_interference leave the table and the interference zones out', async ({ page }) => {
  await openDemo(page, 'cards=ld6004');
  const c = card(page);
  await expect(c.locator('.zones')).toContainText('Interference 1');
  await c.evaluate((el) => el.setConfig({ type: 'custom:mmwave-3d-card', device: 'ld6004', prefix: 'radar_ld6004', show_interference: false }));
  await page.evaluate(() => window.demo.push());
  await expect(c.locator('.zones .zone')).toHaveCount(3);
  await expect(c.locator('.zones')).not.toContainText('Interference');
  expect(await c.evaluate((el) => el._scene.lastZones.zones.some((z) => z.kind === 'interference'))).toBe(false);
  await c.evaluate((el) => el.setConfig({ type: 'custom:mmwave-3d-card', device: 'ld6004', prefix: 'radar_ld6004', show_table: false }));
  await page.evaluate(() => window.demo.push());
  await expect(c.locator('table')).toHaveCount(0);
  await expect(c.locator('canvas')).toBeVisible();
});

test('the card registers in the card picker with a stub that finds a sensor', async ({ page }) => {
  await openDemo(page, 'cards=ld2450');
  const info = await page.evaluate(() => {
    const Card = customElements.get('mmwave-3d-card');
    const hass = window.demo.cards[0].hass;
    return {
      picker: (window.customCards ?? []).filter((c) => c.type === 'mmwave-3d-card').map((c) => ({ name: c.name, preview: c.preview })),
      stub: Card.getStubConfig(hass),
      editor: Card.getConfigElement().localName,
    };
  });
  expect(info.picker).toHaveLength(1);
  expect(info.picker[0].name).toContain('mmWave');
  expect(info.stub.device).toMatch(/^ld(2450|6004|2410)$/);
  expect(info.stub.prefix).toBeTruthy();
  expect(info.editor).toBe('mmwave-3d-card-editor');
});

test('leaving the view releases WebGL, and coming back draws again', async ({ page }) => {
  await openDemo(page, 'cards=ld2450');
  const lost = await page.evaluate(async () => {
    const el = window.demo.cards[0], parent = el.parentElement;
    const gl = el._scene.renderer.getContext();
    el.remove();
    await new Promise((r) => setTimeout(r, 100));
    const gone = { scene: el._scene, lost: gl.isContextLost() };
    parent.append(el);
    return gone;
  });
  expect(lost).toEqual({ scene: null, lost: true });
  await expect.poll(() => card(page).evaluate((el) => el._scene?.framesDrawn ?? 0)).toBeGreaterThan(0);
});

test('with reduced motion an idle card stops drawing and the scan wave stays off', async ({ page }) => {
  await openDemo(page, 'cards=ld2450,ld2410');
  await page.waitForTimeout(1500);                                          // trails drain, figures settle
  const frames = () => card(page, 0).evaluate((el) => el._scene.framesDrawn);
  const before = await frames();
  await page.waitForTimeout(1000);
  expect(await frames()).toBe(before);
  const wave = await card(page, 1).evaluate((el) => ({ ring: el._scene.pulse.material.opacity, shell: el._scene.vol.pulse.visible }));
  expect(wave).toEqual({ ring: 0, shell: false });
});

test('only admins get the button to edit zones', async ({ page }) => {
  await openDemo(page, 'cards=ld2450');
  // Two fresh cards on the same data: one seen by an admin, one by a user who isn't (HA reloads when the user changes).
  const visible = await page.evaluate(async () => {
    const make = (admin) => {
      const el = document.createElement('mmwave-3d-card');
      el.setConfig({ type: 'custom:mmwave-3d-card', device: 'ld2450', prefix: 'kin_estudio_piscina' });
      el.hass = { ...window.demo.cards[0].hass, user: { is_admin: admin } };
      document.getElementById('cards').append(el);
      return el;
    };
    const admin = make(true), user = make(false);
    await new Promise((r) => setTimeout(r, 1000));
    const shown = (el) => !el.shadowRoot.querySelector('[data-act="edit"]').hidden;
    return { admin: shown(admin), user: shown(user) };
  });
  expect(visible).toEqual({ admin: true, user: false });
});

test('switching the theme repaints the scene in the new colours', async ({ page }) => {
  await openDemo(page, 'cards=ld2450&theme=light');
  const theme = () => card(page).evaluate((el) => ({ dark: el._scene.theme.dark, bg: el._scene.theme.bg }));
  const light = await theme();
  expect(light.dark).toBe(false);
  await page.locator('#theme').click();
  await expect.poll(async () => (await theme()).dark).toBe(true);
  expect((await theme()).bg).not.toBe(light.bg);
});

test('a room draws its walls and furniture', async ({ page }) => {
  await openDemo(page, 'cards=ld6004');
  const room = await card(page).evaluate((el) => ({
    objects: el._scene.roomGroup.children.length,
    labels: [...el.shadowRoot.querySelectorAll('.label, .axis, .furniture, div')].map((d) => d.textContent).filter((t) => /^(Desk|Shelf|Sofa)$/.test(t)),
  }));
  expect(room.objects).toBeGreaterThan(3);
  expect(new Set(room.labels)).toEqual(new Set(['Desk', 'Shelf', 'Sofa']));
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

  test('all demo cards, dark theme', async ({ page }) => {
    await openDemo(page, 'theme=dark');
    await expect(page.locator('main')).toHaveScreenshot('overview-dark.png');
  });

  test('LD2410 with its gate chart, light theme', async ({ page }) => {
    await openDemo(page, 'theme=light&cards=ld2410&t=45&capture=1');
    await expect(card(page)).toHaveScreenshot('ld2410-light.png');
  });

  test('LD6004 with a room, light theme, plan view', async ({ page }) => {
    await openDemo(page, 'theme=light&cards=ld6004&view=plan&capture=1');
    await expect(card(page)).toHaveScreenshot('room-light-plan.png');
  });

  test('heatmap, dark theme', async ({ page }) => {
    await openDemo(page, 'theme=dark&cards=ld6004&view=plan&capture=1');
    await card(page).locator('[data-mode="heatmap"]').click();
    await expect(card(page).locator('.heat-chip')).toHaveCount(3);
    await expect(card(page)).toHaveScreenshot('heatmap-dark.png');
  });

  test('zone editing on the ceiling sensor', async ({ page }) => {
    await openDemo(page, 'theme=dark&cards=ceiling&capture=1');
    await card(page).locator('[data-act="edit"]').click();
    await expect(card(page)).toHaveScreenshot('edit-ceiling.png');
  });
});
