const { test, expect } = require('@playwright/test');
const { trackErrors, waitForBuild, assertRestored, sampleAgents } = require('./helpers');

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
