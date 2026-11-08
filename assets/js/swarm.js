/*
 * swarm.js: a terminal-style agent swarm that rebuilds the home page on load.
 * Written from scratch for kasenteoh.github.io. Pure logic lives in swarm-core.js.
 *
 *   1. Snapshot the real page: framed boxes (backgrounds, borders, icons)
 *      and lines of text, in reading order.
 *   2. Hide it all without moving anything: text goes transparent, boxes are clipped.
 *   3. A boot log prints, then agents (block cursors with tags) spawn.
 *   4. "frame" agents scan boxes in top-down like a CRT; "write" agents type
 *      the text, which glows in the agent's colour, then settles.
 *   5. The camera scrolls with the build and agents only build what is on screen.
 *      Visitor input pauses the camera; it resumes RESUME_MS after the last input.
 *   6. When done (or on Esc) agents exit and the authored DOM is put back.
 *
 * Runs only if the inline head snippet set html.sw-pre (it owns the run gate).
 * Dev flag: ?speed=0.5 slower, ?speed=2 faster.
 */
import * as core from "./swarm-core.js";

const html = document.documentElement;
const SPEED = Math.max(0.2, parseFloat(new URLSearchParams(location.search).get("speed")) || 1);
const COLORS = ["#7ee787", "#ff7b72", "#79c0ff", "#d2a8ff", "#e3b341", "#56d4dd"];
const N = innerWidth < core.PHONE_MAX_W ? 7 : 12;
const FRAMERS = Math.max(2, Math.round(N / 4));
const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "Home", "End"]);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const pad = (n) => String(n).padStart(2, "0");

// ------------------------------------------------------------------- state
const tasks = [];
const sections = [];
const agents = [];
const badges = new Set();
const timers = new Set();
const stats = { boxes: 0, strings: 0 };
const view = { y: 0, h: 0, max: 0 }; // read once per frame
const listeners = new AbortController();

let style, layer, bar, barEls, prevRestoration;
let speed = SPEED;
let t0 = 0;
let doneCount = 0;
let rushed = false; // finishAll(): everything revealed at once, fast exit
let skipped = false; // skip(): as rushed, and the bar says "skipped"
let finished = false;
let cleaned = false;
let tour = true; // camera follows the build
let lastInput = -Infinity;
let camY = null; // where the camera last left the page, to spot visitor scrolls

const on = (type, fn, opts) => addEventListener(type, fn, { ...opts, signal: listeners.signal });
const later = (fn, ms) => {
  const id = setTimeout(() => {
    timers.delete(id);
    fn();
  }, ms);
  timers.add(id);
};
const sleep = (ms) => (rushed ? Promise.resolve() : new Promise((r) => later(r, ms / SPEED)));

// ------------------------------------------------------------------ styles
const CSS = `
  .sw-rest{color:transparent!important;text-shadow:none!important;-webkit-text-fill-color:transparent}
  .sw-t>span:first-child{transition:color .7s ease,text-shadow .7s ease}
  #sw-layer{position:fixed;inset:0;pointer-events:none;z-index:9998;font-family:var(--font-mono,ui-monospace,monospace)}
  .sw-agent{position:absolute;left:0;top:0;will-change:transform;transition:opacity .35s ease}
  .sw-caret{display:block;width:8px;height:16px;background:currentColor;box-shadow:0 0 12px currentColor;opacity:.92}
  .sw-agent.idle .sw-caret{animation:sw-blink 1s steps(2,end) infinite}
  .sw-tag{position:absolute;left:11px;top:-15px;font:600 10px/14px var(--font-mono,monospace);padding:0 5px;border-radius:2px;color:#0a0a0a;white-space:nowrap;letter-spacing:.02em}
  .sw-scan{position:absolute;left:0;top:0;height:1px;background:currentColor;box-shadow:0 0 10px currentColor,0 0 2px currentColor;opacity:0;will-change:transform}
  @keyframes sw-blink{to{visibility:hidden}}
  #sw-boot{position:fixed;z-index:9999;background:#0e0e0e;border:1px solid #2a2a2a;border-radius:6px;
    box-shadow:0 24px 60px rgba(0,0,0,.6);font:13px/1.7 var(--font-mono,monospace);color:#9a9a9a;
    transition:opacity .45s ease,transform .45s ease;overflow:hidden}
  #sw-boot .hd{display:flex;gap:6px;align-items:center;padding:8px 12px;border-bottom:1px solid #1f1f1f;color:#5f5f5f;font-size:11px}
  #sw-boot .hd i{width:9px;height:9px;border-radius:50%;background:#2a2a2a;display:inline-block}
  #sw-boot .bd{padding:12px 16px 14px;white-space:pre;min-height:7.5em}
  @media (max-width:599px){#sw-boot{font-size:12px}#sw-boot .v{display:block;padding-left:3ch}}
  #sw-boot .g{color:#7ee787}#sw-boot .r{color:#ff7b72}#sw-boot .w{color:#e4e4e4}#sw-boot .d{color:#5f5f5f}
  #sw-bar{position:fixed;left:0;right:0;bottom:0;height:28px;z-index:10000;display:flex;align-items:center;gap:14px;
    padding:0 12px 0 0;background:#111;border-top:1px solid #2a2a2a;font:12px/28px var(--font-mono,monospace);color:#9a9a9a;
    transition:transform .4s ease;white-space:nowrap;overflow:hidden}
  #sw-bar .mode{background:#7ee787;color:#0a0a0a;font-weight:700;padding:0 10px;letter-spacing:.06em}
  #sw-bar .g{color:#7ee787}#sw-bar .k{color:#5f5f5f}
  #sw-bar .sp{flex:1}
  .sw-ok{color:#7ee787;font-size:.62em;font-weight:500;margin-left:.6em;opacity:0;transition:opacity .3s ease;vertical-align:middle}
  @media (max-width:599px){#sw-bar .hide-sm{display:none}}
`;

// ---------------------------------------------------------------- snapshot
const isClear = (c) => !c || c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c);
const byDoc = (a, b) => a.docY - b.docY || (a.kind === "box" ? -1 : 1) - (b.kind === "box" ? -1 : 1) || a.i - b.i;

// Keep docY (document top, or viewport top when fixed), h and off current.
function place(t) {
  const b = t.el.getBoundingClientRect();
  let top = b.top;
  if (t.kind === "text") {
    const first = t.segs[0].w.getClientRects()[0];
    if (first) top = first.top;
  }
  t.docY = top + (t.fixed ? 0 : scrollY);
  t.h = Math.max(0, b.bottom - top);
  // off-screen sideways (the off-canvas sidebar on phones) or no longer rendered
  t.off = b.right <= 0 || b.left >= innerWidth || (b.width === 0 && b.height === 0);
}

function snapshot() {
  prevRestoration = history.scrollRestoration;
  history.scrollRestoration = "manual";
  scrollTo({ top: 0, behavior: "instant" });

  const fixedRoots = [];
  const boxOfEl = new Map();
  for (const el of document.body.querySelectorAll("*")) {
    if (el instanceof SVGElement && el.tagName.toLowerCase() !== "svg") continue;
    if (/^(SCRIPT|STYLE|NOSCRIPT|BR|TEMPLATE)$/.test(el.tagName)) continue;
    const cs = getComputedStyle(el);
    if (cs.position === "fixed") fixedRoots.push(el);
    if (cs.display === "none") continue; // body is visibility:hidden here, which still lays out
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const media = el.tagName === "IMG" || el.tagName.toLowerCase() === "svg";
    const bg = !isClear(cs.backgroundColor) || cs.backgroundImage !== "none";
    const bd = ["Top", "Right", "Bottom", "Left"].some(
      (s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none" && !isClear(cs[`border${s}Color`])
    );
    if (!media && !bg && !bd) continue;
    const t = { kind: "box", el, media, prevClip: el.style.clipPath, prevStyle: el.getAttribute("style"), deps: [], p: 0 };
    boxOfEl.set(el, t);
    tasks.push(t);
  }
  const isFixed = (el) => fixedRoots.some((f) => f.contains(el));
  const boxAbove = (el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) if (boxOfEl.has(p)) return boxOfEl.get(p);
    return null;
  };
  for (const t of tasks) {
    const up = boxAbove(t.el.parentElement);
    if (up) t.deps.push(up);
  }

  // text, grouped by the nearest block-level ancestor (one line or item each)
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.data.trim()) return NodeFilter.FILTER_REJECT;
      const p = n.parentElement;
      if (!p || p.closest("script,style,noscript,svg,title")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const groups = new Map();
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const range = document.createRange();
    range.selectNodeContents(n);
    if (!range.getClientRects().length) continue;
    let blk = n.parentElement;
    while (blk && blk !== document.body && getComputedStyle(blk).display.startsWith("inline")) blk = blk.parentElement;
    let g = groups.get(blk);
    if (!g) {
      g = { kind: "text", el: blk, segs: [], deps: [], acc: 0 };
      groups.set(blk, g);
    }
    const w = document.createElement("span");
    w.className = "sw-t";
    const d = document.createElement("span");
    const rest = document.createElement("span");
    rest.className = "sw-rest";
    rest.textContent = n.data;
    w.append(d, rest);
    n.parentNode.replaceChild(w, n);
    g.segs.push({ w, d, rest, text: n.data, orig: n, n: 0 });
    const up = boxAbove(w.parentElement);
    if (up && !g.deps.includes(up)) g.deps.push(up);
  }
  for (const g of groups.values()) {
    g.text = g.segs.map((s) => s.text).join("");
    g.len = g.text.length;
    tasks.push(g);
  }

  tasks.forEach((t, i) => {
    t.i = i;
    t.fixed = isFixed(t.el);
    t.done = false;
    t.claimed = false;
    place(t);
  });
  tasks.sort(byDoc);

  for (const t of tasks) if (t.kind === "box") t.el.style.clipPath = "inset(0 0 100% 0)";

  for (const s of document.querySelectorAll("main .section")) {
    const sec = { head: s.querySelector("h2"), left: 0 };
    for (const t of tasks) {
      if (s.contains(t.el)) {
        t.section = sec;
        sec.left++;
      }
    }
    sections.push(sec);
  }
  for (const t of tasks) if (t.off) finishTask(t, true);
  stats.boxes = tasks.filter((t) => t.kind === "box").length;
  stats.strings = tasks.length - stats.boxes;
}

// ----------------------------------------------------------- task helpers
function restoreBox(t) {
  t.el.style.clipPath = t.prevClip || "";
  if (t.prevStyle === null && t.el.getAttribute("style") === "") t.el.removeAttribute("style");
}

function finishTask(t, instant) {
  if (t.done) return;
  t.done = true;
  if (t.kind === "box") {
    restoreBox(t);
  } else {
    for (const s of t.segs) {
      if (s.n !== s.text.length) {
        s.d.textContent = s.text;
        s.rest.textContent = "";
        s.n = s.text.length;
      }
      s.d.style.color = "";
      s.d.style.textShadow = "";
    }
  }
  const sec = t.section;
  if (sec && --sec.left === 0 && !instant && sec.head) flashOk(sec.head);
  if (++doneCount === tasks.length) html.dataset.swarmBuildMs = String(Math.round(performance.now()));
}

function flashOk(head) {
  const b = document.createElement("span");
  b.className = "sw-ok";
  b.textContent = "✓ ok";
  head.appendChild(b);
  badges.add(b);
  requestAnimationFrame(() => (b.style.opacity = "1"));
  later(() => (b.style.opacity = "0"), 1500);
  later(() => {
    b.remove();
    badges.delete(b);
  }, 1900);
}

// At the very bottom nothing more can scroll into view, so the last strip counts too.
const released = (t) => core.isReleased(t, view.y, view.h) || (view.y >= view.max - 2 && t.docY >= view.y);

// Where an agent heads for its task: the top-left corner, kept in view, since a
// released box can start above the screen (or end below it).
function startPoint(t) {
  const r =
    t.kind === "box"
      ? t.el.getBoundingClientRect()
      : t.segs[0].rest.getClientRects()[0] || t.segs[0].w.getBoundingClientRect();
  const h = t.kind === "box" ? 16 : r.height || 16;
  return { x: r.left, y: clamp(r.top, 0, innerHeight - 44), h };
}

// ---------------------------------------------------------------- agents
class Agent {
  constructor(i, x, y) {
    this.id = i + 1;
    this.color = COLORS[i % COLORS.length];
    this.role = i < FRAMERS ? "frame" : "write";
    this.x = this.tx = x;
    this.y = this.ty = y;
    this.h = 16;
    this.task = null;
    this.state = "idle";
    this.idleT = 0;
    this.el = document.createElement("div");
    this.el.className = "sw-agent idle";
    this.el.style.color = this.color;
    this.caret = document.createElement("span");
    this.caret.className = "sw-caret";
    this.tag = document.createElement("span");
    this.tag.className = "sw-tag";
    this.tag.style.background = this.color;
    this.el.append(this.caret, this.tag);
    this.scan = document.createElement("div");
    this.scan.className = "sw-scan";
    this.scan.style.color = this.color;
    layer.append(this.scan, this.el);
    this.setTag("spawn");
  }

  setTag(s) {
    const v = `a${pad(this.id)}:${s}`;
    if (this.tag.textContent !== v) this.tag.textContent = v;
  }

  step(dt) {
    // a task finished elsewhere (finishAll, resize) is dropped at once; one that has
    // left the screen goes back in the pool
    if (this.task?.done) this.release();
    else if (this.task && !released(this.task)) {
      this.task.claimed = false;
      this.release();
    }

    if (this.state === "idle") this.findWork(dt);
    if (this.state === "travel") this.travel(dt);
    if (this.state === "work") {
      if (this.task.done) this.release();
      else if (this.task.kind === "box") this.scanBox(dt);
      else this.type(dt);
    }

    const ease = 1 - Math.exp(-dt * (this.state === "work" ? 26 : 12) * speed);
    this.x += (this.tx - this.x) * ease;
    this.y += (this.ty - this.y) * ease;
    this.caret.style.height = `${clamp(this.h, 12, 34)}px`;
    this.el.style.transform = `translate3d(${this.x.toFixed(1)}px,${this.y.toFixed(1)}px,0)`;
  }

  findWork(dt) {
    const t = core.pickTask(tasks, this.role, released);
    if (t) {
      t.claimed = true;
      this.task = t;
      this.state = "travel";
      this.travelT = 0;
      this.el.classList.remove("idle");
      this.setTag(t.kind === "box" ? "frame" : "write");
      return;
    }
    this.idleT -= dt;
    if (this.idleT <= 0) {
      const c = document.querySelector("main")?.getBoundingClientRect();
      const x0 = c ? Math.max(c.left, 0) : 0;
      const x1 = c ? Math.min(c.right, innerWidth) : innerWidth;
      this.tx = x0 + 20 + Math.random() * Math.max(40, x1 - x0 - 120);
      this.ty = innerHeight * (0.55 + Math.random() * 0.3);
      this.idleT = 1 + Math.random() * 1.6;
    }
    this.setTag(finished ? "exit 0" : "wait");
    this.el.classList.add("idle");
  }

  travel(dt) {
    const t = this.task;
    const p = startPoint(t);
    this.tx = p.x;
    this.ty = p.y;
    this.h = p.h;
    this.travelT += dt;
    if (Math.hypot(this.tx - this.x, this.ty - this.y) >= 6 && this.travelT <= 1.1 / speed) return;
    if (t.done) return this.release(); // never glow text that is already final
    this.state = "work";
    if (t.kind === "box") {
      const r = t.el.getBoundingClientRect();
      t.dur = t.media ? 0.22 : clamp(r.height * 0.0013 + r.width * 0.00025, 0.18, 0.9);
      this.scan.style.opacity = t.media ? "0" : "0.85";
    } else {
      for (const s of t.segs) {
        s.d.style.color = this.color;
        s.d.style.textShadow = `0 0 8px ${this.color}66`;
      }
    }
  }

  scanBox(dt) {
    const t = this.task;
    t.p = Math.min(1, t.p + (dt * speed) / t.dur);
    const e = easeOut(t.p);
    t.el.style.clipPath = `inset(0 0 ${((1 - e) * 100).toFixed(2)}% 0)`;
    const r = t.el.getBoundingClientRect();
    const y = r.top + r.height * e;
    this.scan.style.transform = `translate3d(${r.left}px,${y}px,0)`;
    this.scan.style.width = `${r.width}px`;
    this.tx = r.right - 4;
    // a box taller than the screen scans past its edges; the cursor stays in view
    this.ty = clamp(y - 8, 0, innerHeight - 44);
    this.h = 16;
    if (t.p >= 1) {
      finishTask(t);
      this.release();
    }
  }

  type(dt) {
    const t = this.task;
    t.acc += core.typingCps(t.len) * dt * speed * (0.6 + Math.random() * 0.8);
    const k = core.revealCount(t.text, t.acc);
    let off = 0;
    let caretSeg = t.segs[0];
    for (const s of t.segs) {
      const n = clamp(k - off, 0, s.text.length);
      if (n !== s.n) {
        s.d.textContent = s.text.slice(0, n);
        s.rest.textContent = s.text.slice(n);
        s.n = n;
      }
      if (n > 0) caretSeg = s;
      off += s.text.length;
    }
    const rs = caretSeg.d.getClientRects();
    const r = rs.length ? rs[rs.length - 1] : caretSeg.rest.getClientRects()[0];
    if (r) {
      this.tx = rs.length ? r.right + 1 : r.left;
      this.ty = r.top;
      this.h = r.height;
    }
    if (k >= t.len) {
      finishTask(t);
      this.release();
    }
  }

  release() {
    this.task = null;
    this.state = "idle";
    this.idleT = 0;
    this.scan.style.opacity = "0";
  }
}

// ------------------------------------------------------------- boot log
async function boot() {
  const main = document.querySelector("main")?.getBoundingClientRect();
  const box = document.createElement("div");
  box.id = "sw-boot";
  const w = Math.min(600, innerWidth - 32, main ? main.width - 32 : 600);
  const left = main && innerWidth >= core.PHONE_MAX_W ? main.left + (main.width - w) / 2 : 16;
  Object.assign(box.style, { left: `${left}px`, top: `${innerHeight * 0.26}px`, width: `${w}px` });
  box.innerHTML = `<div class="hd"><i></i><i></i><i></i><span style="margin-left:8px">swarm — zsh</span></div><div class="bd"></div>`;
  document.body.appendChild(box);
  const bd = box.querySelector(".bd");

  const line = () => bd.appendChild(document.createElement("div"));
  const type = async (el, markup, cps) => {
    const tmp = document.createElement("div");
    tmp.innerHTML = markup;
    const parts = [...tmp.childNodes].map((n) => ({ cls: n.nodeType === 1 ? n.className : "", text: n.textContent }));
    const full = tmp.textContent.length;
    for (let i = 1; i <= full && !rushed; i++) {
      let left = i;
      el.innerHTML =
        parts
          .map((p) => {
            const s = p.text.slice(0, Math.max(0, left));
            left -= p.text.length;
            return p.cls ? `<span class="${p.cls}">${s}</span>` : s;
          })
          .join("") + `<span class="g">▌</span>`;
      await sleep(1000 / cps);
    }
    el.innerHTML = markup;
  };
  const row = async (label, value) => {
    const el = line();
    el.innerHTML = `<span class="d">  ${label} </span>`;
    const dots = 19 - label.length - 1; // label, one space and dots fill 19 columns
    for (let i = 0; i < dots && !rushed; i++) {
      el.insertAdjacentHTML("beforeend", `<span class="d">.</span>`);
      await sleep(22);
    }
    // on phones the value drops to its own indented line (CSS), text unchanged
    el.insertAdjacentHTML("beforeend", `<span class="v"> ${value}</span>`);
    await sleep(160);
  };

  await sleep(250);
  await type(line(), `<span class="g">kasen@portfolio</span><span class="d">:</span><span class="w">~$ </span><span class="w">swarm up --agents ${N}</span>`, 38);
  await sleep(220);
  await row("snapshot", `<span class="w">${sections.length}</span> sections · <span class="w">${stats.boxes}</span> frames · <span class="w">${stats.strings}</span> strings`);
  await row("credentials", `<span class="w">${N}</span> agent tokens signed <span class="d">(vexis-sdk)</span>`);
  await row("dispatch", `<span class="g">frame×${FRAMERS}</span> <span class="r">write×${N - FRAMERS}</span> · top-down`);
  await sleep(200);
  return box;
}

// ------------------------------------------------------------ status bar
function makeBar() {
  bar = document.createElement("div");
  bar.id = "sw-bar";
  bar.innerHTML = `<span class="mode">SWARM</span>
    <span class="a"></span>
    <span class="g p"></span>
    <span class="hide-sm"><span class="k">tasks</span> <span class="t"></span></span>
    <span class="hide-sm"><span class="k">t+</span><span class="s"></span></span>
    <span class="sp"></span>
    <span class="msg k hide-sm"></span>`;
  document.body.appendChild(bar);
  barEls = {
    a: bar.querySelector(".a"),
    p: bar.querySelector(".p"),
    t: bar.querySelector(".t"),
    s: bar.querySelector(".s"),
    msg: bar.querySelector(".msg"),
  };
  barEls.msg.textContent = "esc to skip";
}

function updateBar(elapsed) {
  const pct = tasks.length ? doneCount / tasks.length : 1;
  const cells = innerWidth < core.PHONE_MAX_W ? 10 : 18;
  const n = Math.round(pct * cells);
  const busy = agents.filter((a) => a.state !== "idle").length;
  barEls.a.textContent = `${busy}/${N} busy`;
  barEls.p.textContent = `[${"█".repeat(n)}${"░".repeat(cells - n)}] ${String(Math.round(pct * 100)).padStart(3)}%`;
  barEls.t.textContent = `${doneCount}/${tasks.length}`;
  barEls.s.textContent = `${elapsed.toFixed(1)}s`;
}

// ------------------------------------------------------------------ camera
function nextHidden() {
  for (const t of tasks) if (!t.done && !t.claimed && !t.fixed && !released(t)) return t;
  return null;
}

// topmost point the camera must keep on screen: the next unclaimed task, or any
// busy agent's task or cursor above it (the cursor lags its task while travelling,
// so the task's own top counts too, or the camera could scroll it away and back)
function frontierY() {
  let y = Infinity;
  for (const t of tasks) {
    if (!t.done && !t.claimed && !t.fixed) {
      y = t.docY;
      break;
    }
  }
  for (const a of agents) if (a.state !== "idle" && !a.task.fixed) y = Math.min(y, a.task.docY, a.y + view.y);
  return y === Infinity ? null : y;
}

function camera(dt, now) {
  if (finished || rushed) return;
  if (!tour) {
    if (now - lastInput < core.RESUME_MS) return;
    tour = true;
  }
  const idle = agents.filter((a) => a.state === "idle").length;
  const nx = nextHidden();
  const want = core.cameraTarget({
    frontierY: frontierY(),
    nextHiddenY: nx ? nx.docY : null,
    idleAgents: idle,
    scrollY: view.y,
    viewportH: view.h,
    maxScroll: view.max,
  });
  const d = want - view.y;
  if (Math.abs(d) <= 0.5) return;
  const step = d * Math.min(1, dt * (4 + idle * 0.6) * speed);
  scrollTo({ top: view.y + (d > 0 ? Math.min(d, step + 0.5) : Math.max(d, step - 0.5)), behavior: "instant" });
  camY = scrollY;
}

function visitorInput() {
  tour = false;
  lastInput = performance.now();
}

function onScroll() {
  // our own scrolls leave scrollY where camY says; anything else is the visitor
  if (camY !== null && Math.abs(scrollY - camY) > 2) visitorInput();
}

function onKey(e) {
  if (e.key === "Escape") skip();
  else if (NAV_KEYS.has(e.key)) visitorInput();
}

function relayout() {
  for (const t of tasks) {
    if (t.done) continue;
    place(t);
    if (t.off) finishTask(t, true);
  }
  tasks.sort(byDoc);
}

// --------------------------------------------------------- finish / skip
// Reveal everything now and stop the camera (Task 5 calls this on link clicks).
function finishAll() {
  if (finished || rushed) return;
  rushed = true;
  tour = false;
  for (const t of tasks) finishTask(t, true);
}

function skip() {
  if (finished) return;
  skipped = true;
  finishAll();
}

// ------------------------------------------------------------- main loop
function loop() {
  let prev = performance.now();
  const frame = (now) => {
    if (cleaned) return;
    try {
      const dt = clamp((now - prev) / 1000, 0, 0.05);
      prev = now;
      view.y = scrollY;
      view.h = innerHeight;
      view.max = Math.max(0, html.scrollHeight - innerHeight);
      for (const a of agents) a.step(dt);
      camera(dt, now);
      const elapsed = (now - t0) / 1000;
      updateBar(elapsed);
      if (doneCount === tasks.length && agents.every((a) => a.state === "idle")) {
        finished = true;
        wrapUp();
        return;
      }
      requestAnimationFrame(frame);
    } catch (err) {
      fail(err);
    }
  };
  requestAnimationFrame(frame);
}

function wrapUp() {
  barEls.msg.classList.remove("k", "hide-sm");
  barEls.msg.classList.add("g");
  barEls.msg.textContent = skipped
    ? `✓ skipped · ${N} agents exited`
    : `✓ build complete · ${N} agents exited · 0 errors`;
  agents.forEach((a, i) => {
    a.setTag("exit 0");
    a.el.classList.add("idle");
    later(() => (a.el.style.opacity = "0"), (rushed ? 0 : 120) + i * (rushed ? 15 : 70));
  });
  if (!rushed) later(() => tour && scrollTo({ top: 0, behavior: "smooth" }), 700);
  later(() => {
    bar.style.transform = "translateY(100%)";
    later(cleanup, 450);
  }, rushed ? 900 : 2600);
}

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  listeners.abort();
  for (const id of timers) clearTimeout(id);
  timers.clear();
  for (const t of tasks) {
    if (t.kind === "box") restoreBox(t);
    else for (const s of t.segs) s.w.replaceWith(s.orig); // no-op if main.js replaced the text
  }
  for (const b of badges) b.remove();
  badges.clear();
  layer?.remove();
  bar?.remove();
  document.getElementById("sw-boot")?.remove();
  style?.remove();
  html.classList.remove("sw-pre");
  if (prevRestoration) history.scrollRestoration = prevRestoration;
}

// Never leave a hidden or half-built page behind: put the DOM back, then report.
function fail(err) {
  try {
    cleanup();
  } finally {
    html.classList.remove("sw-pre");
    setTimeout(() => {
      throw err;
    });
  }
}

// ------------------------------------------------------------------ start
async function start() {
  try {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  } catch (_) {}
  if (!html.classList.contains("sw-pre")) return; // the failsafe already showed the page
  try {
    style = document.createElement("style");
    style.id = "sw-style";
    style.textContent = CSS;
    document.head.appendChild(style);
    snapshot();
    camY = scrollY;
    html.classList.remove("sw-pre"); // page is now blank but laid out

    on("keydown", onKey);
    on("resize", relayout, { passive: true });
    on("wheel", visitorInput, { passive: true });
    on("touchstart", visitorInput, { passive: true });
    on("touchmove", visitorInput, { passive: true });
    on("scroll", onScroll, { passive: true });

    layer = document.createElement("div");
    layer.id = "sw-layer";
    document.body.appendChild(layer);
    makeBar();
    t0 = performance.now();
    updateBar(0);

    const bootBox = await boot();
    if (rushed) {
      bootBox.remove();
      for (let i = 0; i < N; i++) agents.push(new Agent(i, -50, -50));
    } else {
      const r = bootBox.querySelector(".bd").getBoundingClientRect();
      for (let i = 0; i < N; i++) {
        agents.push(new Agent(i, r.left + 16 + i * 9, r.bottom - 20));
        await sleep(45); // resolves at once after skip(), so all N still spawn
      }
      bootBox.style.opacity = "0";
      bootBox.style.transform = "translateY(-8px)";
      later(() => bootBox.remove(), 500);
    }
    loop();
  } catch (err) {
    fail(err);
  }
}

if (html.classList.contains("sw-pre")) {
  if (document.readyState === "complete") start();
  else on("load", start, { once: true });
}
