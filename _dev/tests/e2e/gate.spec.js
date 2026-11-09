const { test, expect } = require('@playwright/test');
const { waitForBuild, assertRestored } = require('./helpers');

test.setTimeout(120000);

test('second load in the same session shows the normal page', async ({ page }) => {
  await page.goto('/'); await waitForBuild(page);
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass(/sw-pre/);
  await page.waitForTimeout(2000);
  await expect(page.locator('#sw-bar')).toHaveCount(0);
});
test('?swarm=on replays in the same session', async ({ page }) => {
  await page.goto('/'); await waitForBuild(page);
  await page.goto('/?swarm=on'); await expect(page.locator('#sw-bar')).toBeVisible({ timeout: 5000 });
});
test('?swarm=off never runs', async ({ page }) => {
  await page.goto('/?swarm=off'); await page.waitForTimeout(2500);
  await expect(page.locator('#sw-bar')).toHaveCount(0);
});
test('a #hash link skips the swarm and lands on the section', async ({ page }) => {
  await page.goto('/#thoughts'); await page.waitForTimeout(2500);
  await expect(page.locator('#sw-bar')).toHaveCount(0);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(300);
});
test('reduced motion skips unless forced', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await page.waitForTimeout(2500);
  await expect(page.locator('#sw-bar')).toHaveCount(0);
  await page.goto('/?swarm=on'); await expect(page.locator('#sw-bar')).toBeVisible({ timeout: 5000 });
});
test('failsafe reveals the page if the script never loads', async ({ page }) => {
  await page.route('**/swarm.js', r => r.abort());
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass(/sw-pre/, { timeout: 5500 });
});
test('a script that loads after the failsafe does not start', async ({ page }) => {
  await page.route('**/swarm.js', async r => { await new Promise(s => setTimeout(s, 6000)); r.continue(); });
  await page.goto('/'); await page.waitForTimeout(8000);
  await expect(page.locator('#sw-bar')).toHaveCount(0);
  expect(await page.locator('.sw-t').count()).toBe(0);
});
test('a hidden tab shows the page instead of waiting', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, 'visibilityState', { get: () => 'hidden' }));
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass(/sw-pre/, { timeout: 3000 });
  await expect(page.locator('#sw-bar')).toHaveCount(0);
});
test('reload mid-run shows the normal page', async ({ page }) => {
  await page.goto('/'); await page.waitForTimeout(3000);
  await page.reload(); await page.waitForTimeout(1500);
  await expect(page.locator('#sw-bar')).toHaveCount(0);
  await assertRestored(page);
});
