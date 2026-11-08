import test from 'node:test';
import assert from 'node:assert/strict';
import {
  targetSeconds, isReleased, pickTask, cameraTarget, speedFactor, revealCount,
} from '../../../assets/js/swarm-core.js';

test('targetSeconds', () => { assert.equal(targetSeconds(1280), 15); assert.equal(targetSeconds(600), 15); assert.equal(targetSeconds(599), 20); });
test('isReleased', () => {
  const t = (o) => ({ kind: 'box', done: false, claimed: false, deps: [], docY: 0, fixed: false, ...o });
  assert.equal(isReleased(t({ docY: 100, h: 50 }), 400, 1000), false);
  assert.equal(isReleased(t({ docY: 100, h: 400 }), 400, 1000), true);
  assert.equal(isReleased(t({ docY: 99999, fixed: true }), 400, 1000), true);
  assert.equal(isReleased(t({ docY: 1299 }), 400, 1000), true);
  assert.equal(isReleased(t({ docY: 1300 }), 400, 1000), false);
});
test('pickTask prefers own kind, respects deps and release', () => {
  const box = { kind: 'box', done: false, claimed: false, deps: [], docY: 0, fixed: false };
  const txt = { kind: 'text', done: false, claimed: false, deps: [box], docY: 0, fixed: false };
  const t2 = { kind: 'text', done: false, claimed: false, deps: [], docY: 10, fixed: false };
  const far = { kind: 'text', done: false, claimed: false, deps: [], docY: 5000, fixed: false };
  const rel = (t) => isReleased(t, 0, 800);
  assert.equal(pickTask([box, txt, t2, far], 'write', rel), t2);   // txt blocked by box
  assert.equal(pickTask([box, txt, t2, far], 'frame', rel), box);
  assert.equal(pickTask([far], 'write', rel), null);               // off-screen never picked
  box.done = true; assert.equal(pickTask([box, txt, t2], 'write', rel), txt);
});
test('cameraTarget', () => {
  const base = { scrollY: 0, viewportH: 1000, maxScroll: 5000, nextHiddenY: null, idleAgents: 0 };
  assert.equal(cameraTarget({ ...base, frontierY: 1000 }), 850);
  assert.equal(cameraTarget({ ...base, frontierY: 1000, idleAgents: 3, nextHiddenY: 2000 }), 960);
  assert.equal(cameraTarget({ ...base, frontierY: 1000, idleAgents: 3, nextHiddenY: 1500 }), 850);
  assert.equal(cameraTarget({ ...base, frontierY: 500, scrollY: 400 }), 400);  // frontier visible: never scrolls up
  assert.equal(cameraTarget({ ...base, frontierY: 100, scrollY: 400 }), 0);    // frontier above viewport: comes back
  assert.equal(cameraTarget({ ...base, frontierY: 9000 }), 5000);              // clamped
  assert.equal(cameraTarget({ ...base, frontierY: null, scrollY: 42 }), 42);
});
test('speedFactor', () => {
  assert.equal(speedFactor(10, 15), 1); assert.equal(speedFactor(22.5, 15), 1);
  assert.equal(speedFactor(24.5, 15), 2); assert.equal(speedFactor(100, 15), 16);
});
test('revealCount', () => {
  assert.equal(revealCount('hello world', 7.9), 7);
  assert.equal(revealCount('hello world', 99), 11);
  const long = 'abcd '.repeat(40);                    // 200 chars
  assert.equal(revealCount(long, 10), 30);            // 3x rate, word boundary
  assert.equal(revealCount(long, 11), 30);            // 33 snaps back to 30
  assert.equal(revealCount(long, 1000), 200);
});
