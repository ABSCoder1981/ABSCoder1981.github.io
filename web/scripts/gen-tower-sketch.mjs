// Generates the hero background: an architectural line sketch of 3 towers under construction,
// in true 2-point perspective (low horizon, two vanishing points), as an inline-ready SVG.
//   node scripts/gen-tower-sketch.mjs   → src/assets/tower-sketch.svg
//
// Animation model: every line is its OWN stroke (pathLength="1") with its own delay (--d) and
// duration (--t), so CSS can "draw" it with stroke-dashoffset. Nothing is revealed through clip
// boxes: the buildings appear exactly like a pencil drawing being made, line by line.
//   1. ground lines draw first
//   2. the vertical edges climb upwards, slowly (class "r" = rising, linear)
//   3. each floor line runs outward from the front corner just as the climbing edge reaches it
//   4. window mullions follow the edge up, the roof lines close the top
//   5. the crane builds up its mast, then its jib; tower 3 keeps adding slabs and scaffolding
import { writeFileSync } from 'node:fs';

const W = 1600;
const HT = 1000;
const HORIZON = 900; // low horizon: we look up at the towers, like the reference sketch
const G = 1000; // ground line (bottom edge of the viewBox)
const VL = { x: -520, y: HORIZON }; // left vanishing point (off-canvas)
const VR = { x: 2320, y: HORIZON }; // right vanishing point (off-canvas)

const r = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const pt = (p) => `${r(p[0])} ${r(p[1])}`;

/** Point where the line from (cx, y) towards a vanishing point crosses x = xt. */
function toward(cx, y, xt, vp) {
  const t = (xt - cx) / (vp.x - cx);
  return [xt, y + t * (vp.y - y)];
}

/** Foreshortening: equal real spacing along a receding face gets tighter with distance. */
const fore = (f, c = 0.6) => (f * (1 + c)) / (1 + c * f);

/** A box seen from its front corner: front edge at cx, left face to VL, right face to VR. */
function prism({ cx, top, bot, wl, wr }) {
  const xl = cx - wl * fore(1);
  const xr = cx + wr * fore(1);
  return {
    cx, top, bot, wl, wr, xl, xr,
    Ft: [cx, top], Fb: [cx, bot],
    Lt: toward(cx, top, xl, VL), Lb: toward(cx, bot, xl, VL),
    Rt: toward(cx, top, xr, VR), Rb: toward(cx, bot, xr, VR),
  };
}

/** x of a point at fraction f along a face (perspective-compressed). */
const faceX = (p, side, f) => (side === 'L' ? p.cx - p.wl * fore(f) : p.cx + p.wr * fore(f));

const floorY = (p, i, n) => p.bot + ((p.top - p.bot) * i) / n;

/** Outline of a prism as separate strokes, each drawn from the bottom up. */
function edges(p, { left = true, right = true, base = true } = {}) {
  const out = { base: [], up: [], roof: [] };
  if (base) {
    if (left) out.base.push(`M${pt(p.Fb)}L${pt(p.Lb)}`);
    if (right) out.base.push(`M${pt(p.Fb)}L${pt(p.Rb)}`);
  }
  out.up.push(`M${pt(p.Fb)}L${pt(p.Ft)}`);
  if (left) out.up.push(`M${pt(p.Lb)}L${pt(p.Lt)}`);
  if (right) out.up.push(`M${pt(p.Rb)}L${pt(p.Rt)}`);
  if (left) out.roof.push(`M${pt(p.Ft)}L${pt(p.Lt)}`);
  if (right) out.roof.push(`M${pt(p.Ft)}L${pt(p.Rt)}`);
  return out;
}

/** Floor lines as separate strokes (bottom floor first); each runs outward from the front corner. */
function floorSegs(p, n, { from = 1, to = n - 1, slab = 0, left = true, right = true, f0 = 0, f1 = 1 } = {}) {
  const out = [];
  for (let i = from; i <= to; i++) {
    for (const dy of slab ? [0, slab] : [0]) {
      const y = floorY(p, i, n) + dy;
      if (left) {
        const a = toward(p.cx, y, faceX(p, 'L', f0), VL);
        const b = toward(p.cx, y, faceX(p, 'L', f1), VL);
        out.push({ i, d: `M${pt(a)}L${pt(b)}` });
      }
      if (right) {
        const a = toward(p.cx, y, faceX(p, 'R', f0), VR);
        const b = toward(p.cx, y, faceX(p, 'R', f1), VR);
        out.push({ i, d: `M${pt(a)}L${pt(b)}` });
      }
    }
  }
  return out;
}

/** Vertical lines (window mullions / columns) on a face, each drawn bottom → top. */
function columnSegs(p, m, side, { yTop = p.top, yBot = p.bot, pair = 0, skip = () => false } = {}) {
  const vp = side === 'L' ? VL : VR;
  const out = [];
  for (let k = 1; k < m; k++) {
    if (skip(k)) continue;
    const base = faceX(p, side, k / m);
    for (const off of pair ? [-pair / 2, pair / 2] : [0]) {
      const x = base + off;
      const yt = toward(p.cx, yTop, x, vp)[1];
      const yb = toward(p.cx, yBot, x, vp)[1];
      out.push({ k, d: `M${r(x)} ${r(yb)}L${r(x)} ${r(yt)}` });
    }
  }
  return out;
}

/** A dashed guide from a point towards a vanishing point, extended to the canvas edge. */
function guide(x, y, vp, extend = 0) {
  const xt = vp.x < x ? -extend : W + extend;
  const end = toward(x, y, xt, vp);
  return `M${r(x)} ${r(y)}L${pt(end)}`;
}

// ---------- Stroke registry ----------
const segs = []; // { tw, d, w, o, delay, dur, rise }
const emit = (tw, d, w, o, delay, dur, rise = false) => segs.push({ tw, d, w, o, delay: r2(delay), dur: r2(dur), rise });

/**
 * Draws one prism the way a draughtsman would: base lines, then the edges climbing (taking `rise`
 * seconds), floor lines appearing as the edges pass them, mullions following, roof lines last.
 * Returns the time the climbing edge starts and when the whole prism is done.
 */
function drawPrism(tw, p, cfg) {
  const {
    t0, rise, n = 1, floorP = p, floorOpts = {}, cols = [], edgeOpts = {},
    edgeW = 1.1, edgeO = 0.7, floorW = 0.7, floorO = 0.5, colW = 0.6, colO = 0.45,
  } = cfg;
  const e = edges(p, edgeOpts);
  const up0 = t0 + 0.45;
  e.base.forEach((d, k) => emit(tw, d, edgeW, edgeO, t0 + k * 0.15, 0.7));
  e.up.forEach((d, k) => emit(tw, d, edgeW, edgeO, up0 + k * 0.12, rise, true));
  e.roof.forEach((d, k) => emit(tw, d, edgeW, edgeO, up0 + rise + 0.1 + k * 0.15, 0.9));

  const lo = floorOpts.from ?? 1;
  const hi = floorOpts.to ?? n - 1;
  floorSegs(floorP, n, floorOpts).forEach(({ i, d }) =>
    emit(tw, d, floorW, floorO, up0 + 0.2 + rise * ((i - lo + 0.5) / (hi - lo + 1)), 0.9),
  );
  cols.forEach(({ side, m, opts }, ci) =>
    columnSegs(p, m, side, opts).forEach(({ k, d }) =>
      emit(tw, d, colW, colO, up0 + 0.9 + ci * 0.15 + k * 0.2, rise, true),
    ),
  );
  return { up0, end: up0 + rise + 1.2 };
}

// ---------- Construction guides (dashed) ----------
let guides = `M-100 ${HORIZON}L${W + 100} ${HORIZON}`;

// ---------- Tower 1: left, back — tall and slim ----------
const t1 = prism({ cx: 360, top: 175, bot: G, wl: 150, wr: 95 });
const t1done = drawPrism('t1', t1, {
  t0: 1.0, rise: 9, n: 26,
  cols: [{ side: 'L', m: 5 }, { side: 'R', m: 4 }],
  edgeW: 1.1, edgeO: 0.65, floorO: 0.5,
});
// slim crown, drawn once the shaft is up
const t1c = prism({ cx: 360, top: 140, bot: 175, wl: 110, wr: 70 });
drawPrism('t1', t1c, { t0: t1done.end - 0.4, rise: 0.7, edgeOpts: { base: false }, edgeW: 0.9, edgeO: 0.55 });
guides += guide(t1.cx, t1.top, VL, 100) + guide(t1.cx, t1.top, VR, 100);

// ---------- Tower 2: centre, front — tallest, most detailed ----------
const PODIUM_TOP = G - 175;
const pod = prism({ cx: 800, top: PODIUM_TOP, bot: G, wl: 330, wr: 330 });
// podium + entrance first: the base the tower stands on
drawPrism('t2', pod, {
  t0: 0.3, rise: 1.4, n: 3, floorOpts: { slab: 4 },
  cols: [{ side: 'L', m: 6 }, { side: 'R', m: 7 }],
  edgeW: 1.4, edgeO: 0.95, floorO: 0.6,
});
const canopy = prism({ cx: 800, top: G - 72, bot: G - 58, wl: 360, wr: 370 });
drawPrism('t2', canopy, { t0: 1.9, rise: 0.5, edgeW: 1.2, edgeO: 0.9 });
const entry = prism({ cx: 800, top: PODIUM_TOP - 40, bot: G - 72, wl: 120, wr: 150 });
drawPrism('t2', entry, {
  t0: 2.1, rise: 0.8, cols: [{ side: 'R', m: 4 }, { side: 'L', m: 3 }],
  edgeW: 1.1, edgeO: 0.85, colO: 0.5,
});

// main shaft
const T2_RISE = 10;
const t2 = prism({ cx: 800, top: 70, bot: PODIUM_TOP, wl: 250, wr: 255 });
const t2done = drawPrism('t2', t2, {
  t0: 2.4, rise: T2_RISE, n: 30, floorOpts: { slab: 3.5 },
  cols: [{ side: 'L', m: 7, opts: { pair: 5 } }, { side: 'R', m: 8, opts: { pair: 5 } }],
  edgeW: 1.4, edgeO: 0.95, floorO: 0.62, colO: 0.55,
});
/** Time the climbing edge of the main shaft reaches height y. */
const t2At = (y) => t2done.up0 + T2_RISE * ((PODIUM_TOP - y) / (PODIUM_TOP - t2.top));

// balcony rails on the right face, every other floor, in the middle bays
for (let i = 2; i < 29; i += 2) {
  const y = floorY(t2, i, 30) - 9;
  const a = toward(t2.cx, y, faceX(t2, 'R', 0.18), VR);
  const b = toward(t2.cx, y, faceX(t2, 'R', 0.62), VR);
  emit('t2', `M${pt(a)}L${pt(b)}`, 0.7, 0.5, t2At(y) + 0.5, 0.7);
}

// cantilevered / offset boxes: each appears when the shaft reaches its height
const c3 = prism({ cx: 845, top: 505, bot: 575, wl: 210, wr: 270 });
drawPrism('t2', c3, {
  t0: t2At((c3.top + c3.bot) / 2) - 0.2, rise: 0.8,
  cols: [{ side: 'R', m: 5 }, { side: 'L', m: 3 }], edgeW: 1.2, edgeO: 0.9, colO: 0.55,
});
const c2 = prism({ cx: 740, top: 300, bot: 395, wl: 330, wr: 190 });
drawPrism('t2', c2, {
  t0: t2At((c2.top + c2.bot) / 2) - 0.2, rise: 0.8, n: 2,
  cols: [{ side: 'L', m: 4 }, { side: 'R', m: 3 }], edgeW: 1.3, edgeO: 0.95, colO: 0.6, floorO: 0.6,
});
const c1 = prism({ cx: 870, top: 95, bot: 215, wl: 170, wr: 255 });
drawPrism('t2', c1, {
  t0: t2At((c1.top + c1.bot) / 2) - 0.2, rise: 0.9, n: 3,
  cols: [{ side: 'R', m: 4 }, { side: 'L', m: 3 }], edgeW: 1.3, edgeO: 0.95, colO: 0.6, floorO: 0.6,
});
// rooftop mast, last
const mastT = t2done.up0 + T2_RISE + 0.5;
emit('t2', `M800 70L800 20`, 0.9, 0.7, mastT, 0.6, true);
emit('t2', `M785 70L800 20`, 0.9, 0.7, mastT + 0.2, 0.5);
emit('t2', `M815 70L800 20`, 0.9, 0.7, mastT + 0.3, 0.5);

guides +=
  guide(t2.cx, t2.top, VL, 200) +
  guide(t2.cx, t2.top, VR, 200) +
  guide(c1.cx, c1.top, VR, 200) +
  guide(c2.cx, c2.top, VL, 200) +
  guide(pod.cx, PODIUM_TOP, VL, 200) +
  guide(pod.cx, PODIUM_TOP, VR, 200);

// dimension line next to tower 2 (draft feel), drawn like a measuring tape being pulled
emit('plane', `M505 ${PODIUM_TOP}L505 70`, 0.7, 0.45, 4.5, 3.5, true);
emit('plane', `M497 ${PODIUM_TOP}L513 ${PODIUM_TOP}`, 0.7, 0.45, 4.5, 0.4);
emit('plane', `M497 70L513 70`, 0.7, 0.45, 8.0, 0.4);

// ---------- Tower 3: right — under construction ----------
const T3_FLOORS = 16;
const BUILT = 10; // floors with façade
const T3_RISE = 6;
const t3full = prism({ cx: 1345, top: 300, bot: G, wl: 135, wr: 150 });
const builtTop = floorY(t3full, BUILT, T3_FLOORS);
const t3 = prism({ cx: 1345, top: builtTop, bot: G, wl: 135, wr: 150 });
const t3done = drawPrism('t3', t3, {
  t0: 2.2, rise: T3_RISE, n: T3_FLOORS, floorP: t3full, floorOpts: { to: BUILT - 1 },
  cols: [{ side: 'L', m: 5 }, { side: 'R', m: 5 }],
  edgeW: 1.2, edgeO: 0.85, floorO: 0.55,
});
// the floors only go up to BUILT-1 of T3_FLOORS, so scale their timing to the built height
// (handled by drawPrism through floorOpts.from/to).

// exposed slabs above: thick floor plates, added one after another
const tb = t3done.up0 + T3_RISE + 0.6;
for (let i = BUILT; i <= T3_FLOORS - 1; i++) {
  const reach = i < T3_FLOORS - 2 ? 1 : 0.55; // top floors only partly drawn
  floorSegs(t3full, T3_FLOORS, { from: i, to: i, slab: 5, f1: reach }).forEach(({ d }, k) =>
    emit('t3', d, 0.9, 0.8, tb + (i - BUILT) * 0.75 + k * 0.1, 1.0),
  );
}
// column lines between the exposed slabs (no façade yet), climbing
emit('t3', `M1345 ${r(builtTop)}L${pt(t3full.Ft)}`, 0.9, 0.75, tb + 0.3, 3.6, true);
[
  ...columnSegs(t3full, 5, 'L', { yTop: floorY(t3full, T3_FLOORS - 2, T3_FLOORS), yBot: builtTop, skip: (k) => k === 4 }),
  ...columnSegs(t3full, 5, 'R', { yTop: floorY(t3full, T3_FLOORS - 1, T3_FLOORS), yBot: builtTop, skip: (k) => k === 3 }),
].forEach(({ d }, idx) => emit('t3', d, 0.9, 0.75, tb + 0.6 + idx * 0.25, 3.4, true));

// scaffolding on the right face of the upper floors: uprights, ledgers, braces
const scTop = floorY(t3full, T3_FLOORS - 1, T3_FLOORS) - 10;
const scBot = floorY(t3full, BUILT - 3, T3_FLOORS);
const sc0 = tb + 1.6;
for (let k = 1; k <= 9; k++) {
  const x = faceX(t3full, 'R', k / 10) + 8;
  const yt = toward(t3full.cx, scTop, x, VR)[1];
  const yb = toward(t3full.cx, scBot, x, VR)[1];
  emit('t3', `M${r(x)} ${r(yb)}L${r(x)} ${r(yt)}`, 0.5, 0.5, sc0 + k * 0.14, 2.6, true);
}
let led = 0;
for (let y = scBot; y > scTop; y -= 22, led++) {
  const a = toward(t3full.cx, y, faceX(t3full, 'R', 0.1) + 8, VR);
  const b = toward(t3full.cx, y, faceX(t3full, 'R', 0.9) + 8, VR);
  emit('t3', `M${pt(a)}L${pt(b)}`, 0.5, 0.5, sc0 + 0.6 + led * 0.2, 0.7);
}
for (let k = 1; k < 9; k += 2) {
  const xa = faceX(t3full, 'R', k / 10) + 8;
  const xb = faceX(t3full, 'R', (k + 1) / 10) + 8;
  const a = toward(t3full.cx, scBot, xa, VR);
  const b = toward(t3full.cx, scBot - 90, xb, VR);
  emit('t3', `M${pt(a)}L${pt(b)}`, 0.5, 0.5, sc0 + 3 + k * 0.15, 0.6);
}
// planned envelope above (dashed, in guides)
const t3plan = prism({ cx: 1345, top: 240, bot: floorY(t3full, T3_FLOORS - 1, T3_FLOORS), wl: 135, wr: 150 });
const e3 = edges(t3plan, { base: false });
guides += [...e3.up, ...e3.roof].join('') + guide(t3full.cx, t3full.top, VR, 200) + guide(t3.cx, t3.top, VL, 100);

// ---------- Tower crane beside tower 3: mast first, then the jib ----------
const MX = 1548;
const C0 = 3.4;
emit('crane', `M${MX} ${G}L${MX} 150`, 0.8, 0.6, C0, 5, true);
emit('crane', `M${MX + 16} ${G}L${MX + 16} 150`, 0.8, 0.6, C0 + 0.2, 5, true);
for (let y = G - 24, s = 0; y > 150; y -= 24, s ^= 1) {
  const d = s ? `M${MX} ${y + 24}L${MX + 16} ${y}` : `M${MX + 16} ${y + 24}L${MX} ${y}`;
  emit('crane', d, 0.8, 0.6, C0 + 0.3 + ((G - y) / (G - 150)) * 4.7, 0.35);
}
const J0 = C0 + 5.4;
emit('crane', `M${MX + 8} 150L1235 150`, 0.8, 0.6, J0, 1.6, true); // jib
emit('crane', `M${MX + 8} 150L1600 150`, 0.8, 0.6, J0, 0.6);
emit('crane', `M${MX} 166L1235 166`, 0.8, 0.6, J0 + 0.1, 1.6, true);
emit('crane', `M${MX + 16} 166L1600 160`, 0.8, 0.6, J0 + 0.1, 0.6);
for (let x = 1235; x < 1590; x += 26) {
  emit('crane', `M${x} 166L${x + 13} 150L${x + 26} 166`, 0.8, 0.6, J0 + 0.3 + ((1590 - x) / 355) * 1.4, 0.4);
}
emit('crane', `M${MX + 8} 150L${MX + 8} 110`, 0.8, 0.6, J0 + 1.8, 0.5, true);
emit('crane', `M${MX + 8} 110L1262 150`, 0.8, 0.6, J0 + 2.1, 0.8);
emit('crane', `M${MX + 8} 110L1590 150`, 0.8, 0.6, J0 + 2.2, 0.8);
const CRANE_DONE = J0 + 3.2;

// Trolley + hook + a steel beam hanging from it (animated along the jib in CSS)
const hook =
  `M1290 158L1316 158L1316 170L1290 170Z` + // trolley
  `M1300 170L1300 262M1306 170L1306 262` + // hoist ropes
  `M1292 262L1314 262L1308 276L1298 276Z` + // hook block
  `M1303 276L1260 300M1303 276L1346 300` + // slings
  `M1238 300L1368 300L1368 312L1238 312Z M1238 306L1368 306`; // I-beam
const beacon = { x: MX + 8, y: 106 };

// ---------- Floating draft planes (loose rectangles), each drifts on its own ----------
const planes = [
  [1395, 395, 60, 36],
  [1215, 640, 40, 26],
  [70, 330, 90, 55],
  [150, 250, 48, 30],
  [1470, 720, 44, 28],
  [560, 200, 52, 32],
];
const planePaths = planes.map(([x, y, w, h]) => `M${x} ${y}l${w} ${-h * 0.22}l0 ${h}l${-w} ${h * 0.22}Z`);

// ---------- Write ----------
const render = (tw) => {
  const buckets = new Map();
  for (const s of segs.filter((x) => x.tw === tw)) {
    const key = `${s.w}|${s.o}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(s);
  }
  const groups = [...buckets]
    .map(([key, arr]) => {
      const [w, o] = key.split('|');
      const paths = arr
        .map((s) => `<path class="s${s.rise ? ' r' : ''}" pathLength="1" d="${s.d}" style="--d:${s.delay}s;--t:${s.dur}s"/>`)
        .join('');
      return `<g stroke-width="${w}" stroke-opacity="${o}">${paths}</g>`;
    })
    .join('');
  return `<g class="sk sk--${tw}">${groups}</g>`;
};

const floats = planePaths
  .map(
    (d, i) =>
      `<path class="s fl" pathLength="1" d="${d}" stroke-width="0.8" stroke-opacity="0.6" style="--d:${(2.2 + i * 0.9).toFixed(1)}s;--fdur:${(8 + i * 1.6).toFixed(1)}s;--fdl:${(i * 0.9).toFixed(1)}s"/>`,
  )
  .join('');
const ambient =
  `<g class="sk sk--float">${floats}</g>` +
  `<g class="sk-hook" style="--hs:${r2(CRANE_DONE + 0.6)}s"><g class="sk-beam"><path class="hk" d="${hook}"/></g></g>` +
  `<circle class="sk-beacon" cx="${beacon.x}" cy="${beacon.y}" r="4" style="--bs:${r2(CRANE_DONE)}s"/>`;

const svg = `<svg class="tower-sketch" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${HT}" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false"><g class="sk sk--guides"><path class="guide" d="${guides}"/></g>${['t1', 't2', 't3', 'crane', 'plane'].map(render).join('')}${ambient}</svg>
`;

writeFileSync(new URL('../src/assets/tower-sketch.svg', import.meta.url), svg);
const last = Math.max(...segs.map((s) => s.delay + s.dur));
console.log(`tower-sketch.svg: ${segs.length} strokes, ${(svg.length / 1024).toFixed(1)} KB, fully drawn after ${last.toFixed(1)}s`);
