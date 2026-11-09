// Pure logic for the swarm intro: scheduling, camera, timing, typing math.
// No DOM access, no dependencies.

export const SEEN_KEY = "swarm-seen";
export const PHONE_MAX_W = 600;
export const LONG_TEXT = 120;
export const RELEASE_FRAC = 0.9;
export const RESUME_MS = 1500;

export function targetSeconds(viewportW) {
  return viewportW >= PHONE_MAX_W ? 15 : 20;
}

// Task = { kind: "box"|"text", done, claimed, deps: Task[], docY, fixed, h? }
export function isReleased(task, scrollY, viewportH) {
  return (
    task.fixed ||
    (task.docY < scrollY + viewportH * RELEASE_FRAC &&
      task.docY + (task.h ?? 0) >= scrollY)
  );
}

export function pickTask(tasks, role, released) {
  const wanted = role === "frame" ? "box" : "text";
  let fallback = null;
  for (const t of tasks) {
    if (t.done || t.claimed) continue;
    if (!t.deps.every((d) => d.done)) continue;
    if (!released(t)) continue;
    if (t.kind === wanted) return t;
    if (fallback === null) fallback = t;
  }
  return fallback;
}

export function cameraTarget({ frontierY, nextHiddenY, idleAgents, scrollY, viewportH, maxScroll }) {
  if (frontierY == null) return scrollY;
  let want = frontierY - 0.15 * viewportH;
  if (idleAgents > 0 && nextHiddenY != null) {
    want = Math.max(
      want,
      Math.min(nextHiddenY - 0.75 * viewportH, frontierY - 0.04 * viewportH)
    );
  }
  want = Math.min(maxScroll, Math.max(0, want));
  return frontierY < scrollY ? want : Math.max(scrollY, want);
}

export function speedFactor(buildSeconds, targetS) {
  const over = buildSeconds - 1.5 * targetS;
  if (over <= 0) return 1;
  return Math.min(16, 2 ** (over / 2));
}

export function typingCps(len) {
  return Math.min(420, 110 + 0.65 * len);
}

export function revealCount(text, budget) {
  const len = text.length;
  if (len <= LONG_TEXT) return Math.min(len, Math.floor(budget));
  const n = Math.min(len, Math.floor(budget * 3));
  if (n === len) return len;
  const i = text.lastIndexOf(" ", n - 1);
  return i < 0 ? 0 : i + 1;
}
