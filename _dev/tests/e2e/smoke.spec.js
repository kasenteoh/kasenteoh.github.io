const { test, expect } = require('@playwright/test');
const { trackErrors } = require('./helpers');

test('home page loads with no errors and swarm off', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?swarm=off');
  await expect(page.locator('#about .lead')).toContainText("Hi, I'm Kasen");
  await expect(page.locator('html')).not.toHaveClass(/sw-pre/);
  expect(errors).toEqual([]);
});
