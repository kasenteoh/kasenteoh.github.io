// Edge cases from the final review: content above the document top, keyboard
// focus, buttons, printing, scroll restoration and sideways overflow.
const { test, expect } = require('@playwright/test');
const { waitForBuild, assertRestored } = require('./helpers');

const isTouch = (info) => /phone|iphone/.test(info.project.name);
const targetMs = async (page) => ((await page.evaluate(() => innerWidth)) < 600 ? 20000 : 15000);

// Wait until agents are at work, so the input lands mid-build.
async function midRun(page) {
  await page.locator('.sw-agent:not(.idle)').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  expect(await page.locator('.sw-t').count(), 'build already over').toBeGreaterThan(0);
}

test('a skip link above the document top does not stall the build', async ({ page }) => {
  await page.route(
    (url) => new URL(url).pathname === '/',
    async (r) => {
      const res = await r.fetch();
      const html = (await res.text()).replace(
        /<body[^>]*>/,
        (m) => `${m}<a href="#about" style="position:absolute;top:-40px">skip</a>`
      );
      await r.fulfill({ response: res, body: html });
    }
  );
  await page.goto('/?swarm=on');
  await waitForBuild(page);
  await assertRestored(page);
  const ms = await page.evaluate(() => Number(document.documentElement.dataset.swarmBuildMs));
  console.log(`[edge] off-top build ${ms} ms`);
  expect(ms).toBeLessThanOrEqual(await targetMs(page));
});

test('Tab mid-run finishes the build', async ({ page }) => {
  await page.goto('/?swarm=on');
  await midRun(page);
  await page.keyboard.press('Tab');
  await expect(page.locator('.sw-t')).toHaveCount(0, { timeout: 2500 });
  await expect(page.locator('#sw-bar')).toHaveCount(0, { timeout: 4000 });
  await assertRestored(page);
  expect(await page.evaluate(() => Number(document.documentElement.dataset.swarmBuildMs))).toBeGreaterThan(0);
});

test('printing mid-run finishes the build', async ({ page }) => {
  await page.goto('/?swarm=on');
  await midRun(page);
  // the print snapshot is taken right after beforeprint, so the page must be whole
  // synchronously: no hidden text left, no box still clipped
  const left = await page.evaluate(() => {
    dispatchEvent(new Event('beforeprint'));
    return {
      hiddenText: [...document.querySelectorAll('.sw-rest')].filter((s) => s.textContent).length,
      clipped: [...document.querySelectorAll('[style]')].filter((e) => /inset/.test(e.style.clipPath)).length,
    };
  });
  expect(left).toEqual({ hiddenText: 0, clipped: 0 });
  await expect(page.locator('.sw-t')).toHaveCount(0, { timeout: 2500 });
  await expect(page.locator('#sw-bar')).toHaveCount(0, { timeout: 4000 });
  await assertRestored(page);
});

test('scroll restoration is put back on skip and on pagehide', async ({ page }) => {
  await page.goto('/?swarm=on');
  await midRun(page);
  expect(await page.evaluate(() => history.scrollRestoration)).toBe('manual');
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  expect(await page.evaluate(() => history.scrollRestoration)).toBe('auto');

  await page.goto('/?swarm=on');
  await midRun(page);
  await page.keyboard.press('Escape');
  // finishAll() restores it at once, before the bar has even left
  expect(await page.evaluate(() => history.scrollRestoration)).toBe('auto');
  await expect(page.locator('#sw-bar')).toHaveCount(0, { timeout: 4000 });
  await assertRestored(page);
});

test('opening the mobile menu mid-run finishes the build', async ({ page }, info) => {
  test.skip(!isTouch(info)); // the toggle only shows on phones
  await page.goto('/?swarm=on');
  const toggle = page.locator('#sidebarToggle');
  // wait for the toggle (and its icon) to be framed: a clip-path also clips hit testing.
  // #sw-bar attaches after the snapshot, so an unclipped toggle then means framed.
  await page.locator('#sw-bar').waitFor({ state: 'attached', timeout: 10000 });
  await page.waitForFunction(
    () => {
      const t = document.getElementById('sidebarToggle');
      return t && [t, ...t.querySelectorAll('*')].every((e) => !e.style.clipPath);
    },
    null,
    { timeout: 10000, polling: 50 }
  );
  expect(await page.locator('.sw-t').count(), 'build already over').toBeGreaterThan(0);
  await toggle.tap();
  await expect(page.locator('.sw-t')).toHaveCount(0, { timeout: 1500 });
  await expect(page.locator('#sidebar')).toHaveClass(/is-open/);
  await expect(page.locator('#sw-bar')).toHaveCount(0, { timeout: 4000 });
  await assertRestored(page);
});

test('agent tags stay inside the viewport', async ({ page }, info) => {
  await page.goto('/?swarm=on');
  await page.locator('#sw-bar').waitFor({ state: 'attached', timeout: 10000 });
  const bad = new Set();
  let samples = 0;
  let wide = 0;
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    const s = await page.evaluate(() => {
      const out = [];
      for (const tag of document.querySelectorAll('.sw-agent .sw-tag')) {
        if (getComputedStyle(tag.parentElement).opacity === '0') continue;
        const r = tag.getBoundingClientRect();
        if (r.right > innerWidth + 0.5) out.push(`${tag.textContent} right ${r.right.toFixed(0)}`);
      }
      return {
        bar: !!document.getElementById('sw-bar'),
        out,
        wide: document.documentElement.scrollWidth > innerWidth,
      };
    });
    samples++;
    s.out.forEach((b) => bad.add(b));
    if (s.wide) wide++;
    if (!s.bar) break;
    await page.waitForTimeout(100);
  }
  expect(samples).toBeGreaterThan(20);
  expect([...bad], 'tags past the right edge').toEqual([]);
  if (isTouch(info)) expect(wide, 'samples with scrollWidth > innerWidth').toBe(0);
});
