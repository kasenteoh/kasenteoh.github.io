// Shared helpers for swarm-intro e2e tests.

/** Collect console errors and uncaught page errors. Returns the live array. */
function trackErrors(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** Resolve once #sw-bar has been attached and then detached (build finished). */
async function waitForBuild(page, timeoutMs = 45000) {
  const bar = page.locator('#sw-bar');
  await bar.waitFor({ state: 'attached', timeout: timeoutMs });
  await bar.waitFor({ state: 'detached', timeout: timeoutMs });
}

/** Assert the page is back to its authored state after a swarm run. */
async function assertRestored(page) {
  const { expect } = require('@playwright/test');
  const state = await page.evaluate(() => ({
    wrappers: document.querySelectorAll('.sw-t').length,
    clipped: [...document.querySelectorAll('[style]')]
      .filter((el) => /clip-path/i.test(el.getAttribute('style') || ''))
      .map((el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')),
    leftovers: ['sw-layer', 'sw-bar', 'sw-boot', 'sw-style'].filter((id) => document.getElementById(id)),
    pre: document.documentElement.classList.contains('sw-pre'),
  }));
  expect(state.wrappers, 'leftover .sw-t wrappers').toBe(0);
  expect(state.clipped, 'elements with inline clip-path').toEqual([]);
  expect(state.leftovers, 'leftover swarm elements').toEqual([]);
  expect(state.pre, 'html.sw-pre still set').toBe(false);
}

/**
 * Count agent-samples every 250 ms: `busy` adds the number of working agents,
 * `off` adds how many of those are off-screen. With untilDone, keeps sampling
 * until #sw-bar has attached and then detached (cap ~60 s); otherwise one sample.
 */
async function sampleAgents(page, untilDone) {
  const sample = () =>
    page.evaluate(() => {
      const bar = !!document.getElementById('sw-bar');
      let busy = 0;
      let off = 0;
      for (const el of document.querySelectorAll('.sw-agent:not(.idle)')) {
        busy++;
        const m = /translate3d\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(el.style.transform || '');
        if (m) {
          const y = parseFloat(m[2]);
          if (y < -20 || y > innerHeight) off++;
        }
      }
      return { bar, busy, off };
    });

  const totals = { busy: 0, off: 0 };
  if (!untilDone) {
    const s = await sample();
    return { busy: s.busy, off: s.off };
  }
  const deadline = Date.now() + 60000;
  let seenBar = false;
  while (Date.now() < deadline) {
    const s = await sample();
    totals.busy += s.busy;
    totals.off += s.off;
    if (s.bar) seenBar = true;
    else if (seenBar) break;
    await page.waitForTimeout(250);
  }
  return totals;
}

module.exports = { trackErrors, waitForBuild, assertRestored, sampleAgents };
