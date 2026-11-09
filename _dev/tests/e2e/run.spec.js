const { test, expect } = require('@playwright/test');
const { trackErrors, waitForBuild, assertRestored, sampleAgents, sampleClipViolations } = require('./helpers');

const textShape = () =>
  [...document.querySelectorAll('main h2, main h3, main h4, main p')].map((e) => [
    e.textContent,
    Math.round(e.getBoundingClientRect().height),
  ]);

// Mobile WebKit has no mouse wheel; fall back to a scripted scroll there.
async function userScroll(page, dy) {
  try {
    await page.mouse.wheel(0, dy);
  } catch {
    await page.evaluate((d) => scrollBy({ top: d, behavior: 'instant' }), dy);
  }
}

test('builds on first visit and restores the page exactly', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?swarm=off');
  await page.evaluate(() => document.fonts.ready); // measure with the web font loaded, as after the run
  const before = await page.evaluate(textShape);
  await page.goto('/?swarm=on');
  await expect(page.locator('#sw-bar')).toBeVisible({ timeout: 5000 });
  const leadTop0 = await page.locator('#about .lead').evaluate((e) => e.getBoundingClientRect().top + scrollY);
  await waitForBuild(page);
  await assertRestored(page);
  expect(await page.locator('#about .lead').evaluate((e) => e.getBoundingClientRect().top + scrollY)).toBeCloseTo(leadTop0, 0);
  const after = await page.evaluate(textShape);
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
});

test('busy agents stay on screen', async ({ page }) => {
  await page.goto('/?swarm=on');
  const s = await sampleAgents(page, true);
  expect(s.busy).toBeGreaterThan(50);
  expect(s.off / s.busy).toBeLessThanOrEqual(0.02);
});

test('survives a resize mid-run', async ({ page }) => {
  await page.goto('/?swarm=on');
  await page.waitForTimeout(4000);
  await page.setViewportSize({ width: 700, height: 600 });
  await waitForBuild(page);
  await assertRestored(page);
});

test('camera resumes after manual scroll', async ({ page }) => {
  await page.goto('/?swarm=on');
  await page.waitForTimeout(5000);
  await userScroll(page, -2000);
  await waitForBuild(page);
  await assertRestored(page);
});

test('camera returns after scrolling down past the build', async ({ page }) => {
  await page.goto('/?swarm=on');
  await page.waitForTimeout(4000);
  await userScroll(page, 4000);
  const totals = { busy: 0, off: 0 };
  const end = Date.now() + 2500;
  while (Date.now() < end) {
    const s = await sampleAgents(page, false);
    totals.busy += s.busy;
    totals.off += s.off;
    await page.waitForTimeout(250);
  }
  await waitForBuild(page);
  await assertRestored(page);
  expect(totals.off, `off-screen busy samples ${JSON.stringify(totals)}`).toBeLessThanOrEqual(0.1 * totals.busy);
});

test('runs when web fonts are blocked', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto('/?swarm=on');
  await waitForBuild(page);
  await assertRestored(page);
});

test('Esc mid-run leaves no glow and exits at once', async ({ page }) => {
  await page.goto('/?swarm=on');
  await page.locator('.sw-agent:not(.idle)').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  const glowing = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.sw-t span')].filter((s) => s.style.color || s.style.textShadow).length
    );
  for (let i = 0; i < 8; i++) {
    expect(await glowing(), 'glowing text spans after Esc').toBe(0);
    await page.waitForTimeout(100);
  }
  await expect(page.locator('#sw-bar .msg')).toHaveText(/^✓ skipped · \d+ agents exited$/, { timeout: 1000 });
  await expect(page.locator('.sw-t')).toHaveCount(0, { timeout: 2500 });
  await expect(page.locator('#sw-bar')).toHaveCount(0, { timeout: 3000 });
  await assertRestored(page);
});

test('boot log rows are verbatim and fully visible', async ({ page }) => {
  await page.goto('/?swarm=on');
  await expect(page.locator('#sw-boot .bd')).toContainText('top-down', { timeout: 8000 });
  const boot = await page.evaluate(() => {
    const bd = document.querySelector('#sw-boot .bd');
    const rows = [...bd.children];
    return {
      rows: rows.map((r) => r.textContent),
      clipped: [bd, ...rows].filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent),
      overflow: (() => {
        const box = document.getElementById('sw-boot').getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(bd);
        return [...range.getClientRects()].some((r) => r.right > box.right + 0.5 || r.left < box.left - 0.5);
      })(),
    };
  });
  const n = (await page.evaluate(() => innerWidth)) < 600 ? 7 : 12;
  expect(boot.rows[0]).toBe(`kasen@portfolio:~$ swarm up --agents ${n}`);
  expect(boot.rows[1]).toMatch(/^\s*snapshot \.{10} \d+ sections · \d+ frames · \d+ strings$/);
  expect(boot.rows[2]).toMatch(new RegExp(`^\\s*credentials \\.{7} ${n} agent tokens signed \\(vexis-sdk\\)$`));
  expect(boot.rows[3]).toMatch(/^\s*dispatch \.{10} frame×\d+ write×\d+ · top-down$/);
  expect(boot.clipped, 'clipped boot rows').toEqual([]);
  expect(boot.overflow, 'boot text overflows its window').toBe(false);
});

test('status bar reads N/N busy', async ({ page }) => {
  await page.goto('/?swarm=on');
  await expect(page.locator('#sw-bar')).toBeVisible({ timeout: 5000 });
  const n = (await page.evaluate(() => innerWidth)) < 600 ? 7 : 12;
  await expect(page.locator('#sw-bar')).toContainText(new RegExp(`(^|\\s)\\d+/${n} busy`));
  await expect(page.locator('#sw-bar')).not.toContainText('agents');
});

// Writers may follow a box's scanline down instead of waiting for the whole box,
// so no typed character may ever sit where an ancestor's clip-path still hides it.
test('typed text never sits under a box clip', async ({ page }) => {
  await page.goto('/?swarm=on');
  await page.locator('#sw-bar').waitFor({ state: 'attached', timeout: 10000 });
  const { samples, bad } = await sampleClipViolations(page);
  expect(samples).toBeGreaterThan(20);
  expect(bad).toEqual([]);
});
