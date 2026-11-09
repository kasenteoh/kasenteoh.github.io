const { test, expect } = require('@playwright/test');
const { waitForBuild, assertRestored } = require('./helpers');

const buildMs = (page) => page.evaluate(() => Number(document.documentElement.dataset.swarmBuildMs));
const targetMs = async (page) => ((await page.evaluate(() => innerWidth)) < 600 ? 20000 : 15000);

test('goes live within the target', async ({ page }, info) => {
  await page.goto('/?swarm=on');
  await waitForBuild(page);
  const ms = await buildMs(page);
  info.annotations.push({ type: 'buildMs', description: String(ms) });
  console.log(`[speed] ${info.project.name} build ${ms} ms`);
  expect(ms).toBeLessThanOrEqual(await targetMs(page));
});

test('boot log and spawn take at most 2.5 s', async ({ page }, info) => {
  await page.goto('/?swarm=on');
  await expect(page.locator('#sw-bar')).toBeVisible({ timeout: 5000 });
  const t0 = Date.now();
  await page.locator('.sw-agent:not(.idle)').first().waitFor({ timeout: 5000 });
  const ms = Date.now() - t0;
  console.log(`[speed] ${info.project.name} boot ${ms} ms`);
  expect(ms).toBeLessThanOrEqual(2500);
});

test('goes live quickly when the page is three times longer', async ({ page }, info) => {
  await page.route(
    (url) => new URL(url).pathname === '/',
    async (r) => {
      const res = await r.fetch();
      let html = await res.text();
      const grid = html.match(/<ul class="project-grid">[\s\S]*?<\/ul>/)[0];
      html = html.replace(grid, grid + grid + grid);
      await r.fulfill({ response: res, body: html });
    }
  );
  await page.goto('/?swarm=on');
  await waitForBuild(page, 60000);
  await assertRestored(page);
  const ms = await buildMs(page);
  console.log(`[speed] ${info.project.name} 3x build ${ms} ms`);
  expect(ms).toBeLessThanOrEqual((await targetMs(page)) * 1.5 + 8000);
});
