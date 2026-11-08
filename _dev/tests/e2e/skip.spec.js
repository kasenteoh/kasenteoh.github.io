const { test, expect } = require('@playwright/test');
const { assertRestored } = require('./helpers');

const isTouch = (info) => /phone|iphone/.test(info.project.name);

test('Esc skips to the finished page', async ({ page }) => {
  await page.goto('/?swarm=on');
  await expect(page.locator('#sw-bar')).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.sw-t')).toHaveCount(0, { timeout: 2500 });
  await expect(page.locator('#sw-bar')).toHaveCount(0, { timeout: 3000 });
  await assertRestored(page);
});

test('hint text matches the device', async ({ page }, info) => {
  await page.goto('/?swarm=on');
  await expect(page.locator('#sw-bar .msg')).toHaveText(isTouch(info) ? 'tap to skip' : 'esc to skip', { timeout: 5000 });
  await expect(page.locator('#sw-bar .msg')).toBeVisible();
  await expect(page.locator('#sw-bar button')).toHaveCount(0);
});

test('tapping the status bar skips on touch screens', async ({ page }, info) => {
  test.skip(!isTouch(info));
  await page.goto('/?swarm=on');
  await page.locator('#sw-bar').tap({ timeout: 5000 });
  await expect(page.locator('#sw-bar')).toHaveCount(0, { timeout: 3000 });
  await assertRestored(page);
});

test('clicking a nav link mid-run finishes the build and follows the link', async ({ page }, info) => {
  test.skip(isTouch(info)); // sidebar is off-canvas on phones
  await page.goto('/?swarm=on');
  await page.waitForTimeout(4000);
  await page.locator('a.nav-link[href="#projects"]').click();
  await expect(page).toHaveURL(/#projects$/);
  await expect(page.locator('.sw-t')).toHaveCount(0, { timeout: 2500 });
  await expect(page.locator('#sw-bar')).toHaveCount(0, { timeout: 4000 });
  await assertRestored(page);
  const top = await page.locator('#projects').evaluate((e) => e.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(-5);
  expect(top).toBeLessThan(await page.evaluate(() => innerHeight));
});

test('copy-email still works when clicked mid-run', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'chromium-desktop');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?swarm=on');
  await page.waitForTimeout(4000);
  await page.locator('#emailLink').click();
  await expect(page.locator('#emailLink .link-label')).toHaveText('copied!');
  await expect(page.locator('#emailLink .link-label')).toHaveText('email', { timeout: 3000 });
  // the click already finished the run, so the bar is on its way out (waitForBuild would wait for it to attach)
  await expect(page.locator('#sw-bar')).toHaveCount(0, { timeout: 4000 });
  await assertRestored(page);
});

// Nothing in the status bar may be clipped by its overflow:hidden.
async function barClipping(page) {
  return page.evaluate(() => {
    const bar = document.getElementById('sw-bar');
    const b = bar.getBoundingClientRect();
    const outside = [...bar.children]
      .filter((c) => getComputedStyle(c).display !== 'none')
      .filter((c) => {
        const r = c.getBoundingClientRect();
        return r.left < b.left - 0.5 || r.right > b.right + 0.5;
      })
      .map((c) => c.className);
    return { scrollWidth: bar.scrollWidth, clientWidth: bar.clientWidth, outside, text: bar.textContent.replace(/\s+/g, ' ') };
  });
}
function expectUnclipped(c) {
  expect(c.scrollWidth, c.text).toBeLessThanOrEqual(c.clientWidth);
  expect(c.outside, c.text).toEqual([]);
}

test('phone status bar is not clipped mid-run or when skipped', async ({ page }, info) => {
  test.skip(!isTouch(info));
  await page.goto('/?swarm=on');
  await expect(page.locator('#sw-bar .msg')).toHaveText('tap to skip', { timeout: 5000 });
  await expect(page.locator('#sw-bar .a')).toBeVisible();
  await page.waitForTimeout(1500);
  expectUnclipped(await barClipping(page));
  await page.keyboard.press('Escape');
  await expect(page.locator('#sw-bar .msg')).toContainText('✓ skipped', { timeout: 5000 });
  expectUnclipped(await barClipping(page));
});

test('phone status bar is not clipped when the build completes', async ({ page }, info) => {
  test.skip(!isTouch(info));
  await page.goto('/?swarm=on');
  await page.waitForFunction(() => /build complete/.test(document.querySelector('#sw-bar .msg')?.textContent || ''), null, { timeout: 60000, polling: 100 });
  expectUnclipped(await barClipping(page));
});
