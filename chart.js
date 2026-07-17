// Parse "2026-07-11" and "11 Jul 2026" identically to a UTC-midnight timestamp,
// so BALANCE readings and FLUX event dates compare timezone-independently.
const _MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function parseDay(s) {
  s = String(s).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/))) return Date.UTC(+m[3], _MONTHS[m[2].toLowerCase()], +m[1]);
  return new Date(s).getTime();
}
const _fmtDay = (t, opts) => new Date(t).toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });

// Balance chart — reusable. Renders a shadcn/recharts-style line chart of BALANCE
// into `root` (a .chart-card element), windowed to `windowDays` days.
// Pass Infinity for full history. Depends on BALANCE, cz, cz2 from data.js.
function mountBalanceChart(root, windowDays) {
  const DAY = 86400000;
  if (!Array.isArray(BALANCE) || BALANCE.length < 2) {   // guard: chart needs ≥2 readings
    root.innerHTML = `<div class="chart-head"><div><div class="chart-title">balance</div>`
      + `<div class="chart-desc">not enough data</div></div></div>`
      + `<div class="chart-body" style="padding:22px 16px;color:var(--muted-foreground);font-size:12px">— need at least 2 readings —</div>`;
    return;
  }
  root.innerHTML = `
    <div class="chart-head">
      <div><div class="chart-title">balance</div><div class="chart-desc"></div></div>
      <div class="chart-cur"></div>
    </div>
    <div class="chart-body">
      <svg class="bchart" viewBox="0 0 640 170"></svg>
      <div class="btip"></div>
    </div>
    <div class="chart-foot">
      <div class="chart-foot-main"></div>
      <div class="chart-foot-sub">real readings · gaps interpolated</div>
    </div>`;
  const svg  = root.querySelector(".bchart");
  const tip  = root.querySelector(".btip");
  const body = root.querySelector(".chart-body");
  const W = 640, H = 170, PL = 8, PR = 8, PT = 14, PB = 22;
  const iw = W - PL - PR, ih = H - PT - PB;

  const all = BALANCE.map(p => ({ t: parseDay(p.d), v: p.v }));
  const tMax = all[all.length - 1].t;
  const full = !isFinite(windowDays);
  const tMin = full ? all[0].t : tMax - windowDays * DAY;
  const reals = all.filter(p => p.t >= tMin);          // real readings inside window (hover snaps here)
  const wp = reals.slice();
  if (!full && (!reals.length || reals[0].t > tMin)) { // interpolate a left-edge point so the line fills the axis
    let before = null, after = null;
    for (const p of all) { if (p.t <= tMin) before = p; if (p.t >= tMin && !after) after = p; }
    if (before && after && after.t > before.t)
      wp.unshift({ t: tMin, v: before.v + (after.v - before.v) * (tMin - before.t) / (after.t - before.t) });
    else if (after) wp.unshift({ t: tMin, v: after.v });
  }
  const vMin = Math.min(...wp.map(p => p.v)), vMax = Math.max(...wp.map(p => p.v));
  const vpad = (vMax - vMin) * 0.12 || 1, lo = vMin - vpad, hi = vMax + vpad;
  const X = t => PL + (t - tMin) / (tMax - tMin) * iw;
  const Y = v => PT + (1 - (v - lo) / (hi - lo)) * ih;

  // densify to daily then smooth (Catmull-Rom → bézier; dense points ⇒ tiny overshoot)
  const daily = []; let j = 0;
  for (let t = tMin; t <= tMax; t += DAY) {
    while (j < wp.length - 2 && wp[j + 1].t < t) j++;
    const a = wp[j], b = wp[j + 1], f = (t - a.t) / (b.t - a.t);
    daily.push({ px: X(t), py: Y(a.v + (b.v - a.v) * f) });
  }
  let d = `M${daily[0].px.toFixed(1)},${daily[0].py.toFixed(1)}`;
  for (let i = 0; i < daily.length - 1; i++) {
    const p0 = daily[i - 1] || daily[i], p1 = daily[i], p2 = daily[i + 1], p3 = daily[i + 2] || p2;
    const c1x = p1.px + (p2.px - p0.px) / 6, c1y = p1.py + (p2.py - p0.py) / 6;
    const c2x = p2.px - (p3.px - p1.px) / 6, c2y = p2.py - (p3.py - p1.py) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.px.toFixed(1)},${p2.py.toFixed(1)}`;
  }

  // horizontal gridlines — step adapts so 3–5 lines always show
  const niceSteps = [1000, 2000, 5000, 10000, 20000, 50000, 100000];
  const step = niceSteps.find(s => (hi - lo) / s <= 5) || niceSteps[niceSteps.length - 1];
  let grid = "";
  for (let g = Math.ceil(lo / step) * step; g < hi; g += step) {
    const gy = Y(g).toFixed(1);
    grid += `<line class="grid" x1="${PL}" y1="${gy}" x2="${W - PR}" y2="${gy}"/>`
          + `<text class="glabel" x="${PL}" y="${(Y(g) - 3).toFixed(1)}">${(g / 1000).toFixed(0)}k</text>`;
  }
  // month x-ticks (skip the very edges)
  let xticks = "", lastM = -1;
  const span = (tMax - tMin) / DAY;
  for (let t = tMin; t <= tMax; t += DAY) {
    const mo = new Date(t).getUTCMonth();
    if (mo !== lastM) {
      lastM = mo;
      const frac = (t - tMin) / DAY / span;
      if (frac > 0.03 && frac < 0.97)
        xticks += `<text class="xlabel" x="${X(t).toFixed(1)}" y="${H - 6}" text-anchor="middle">${_fmtDay(t, { month: "short" })}</text>`;
    }
  }

  // flux event markers, sitting on the line (green influx / orange efflux)
  const lineYAt = t => {
    let a = wp[0], b = wp[wp.length - 1];
    for (let i = 0; i < wp.length - 1; i++) if (t >= wp[i].t && t <= wp[i + 1].t) { a = wp[i]; b = wp[i + 1]; break; }
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    return a.v + (b.v - a.v) * f;
  };
  // aggregate flux by day so a day with several movements shows the cumulative
  // (influx and efflux summed separately), not just the last entry
  const dayAgg = {};
  (typeof FLUX !== "undefined" ? FLUX : []).forEach(f => {
    const t = parseDay(f.date);
    if (t < tMin || t > tMax) return;
    const a = dayAgg[t] || (dayAgg[t] = { t, in: 0, out: 0 });
    if (f.amount >= 0) a.in += f.amount; else a.out += f.amount;
  });
  const events = Object.values(dayAgg).map(a => {
    const net = a.in + a.out;
    return { t: a.t, x: X(a.t), y: Y(lineYAt(a.t)), in: a.in, out: a.out, net, inflow: net >= 0 };
  });
  const evDots = events.map(e =>
    `<circle cx="${e.x.toFixed(1)}" cy="${e.y.toFixed(1)}" r="3" fill="var(${e.inflow ? "--chart-2" : "--primary"})" stroke="var(--card)" stroke-width="1.5"/>`).join("");

  const ex = X(wp[wp.length - 1].t), ey = Y(wp[wp.length - 1].v);
  svg.innerHTML = `${grid}${xticks}
    <line class="cross" y1="${PT}" y2="${H - PB}"/>
    <path d="${d}" fill="none" stroke="var(--chart-2)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    ${evDots}
    <circle class="hdot" r="4" fill="var(--chart-2)"/>
    <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="3.5" fill="var(--chart-2)"/>`;

  // header + footer
  const fmt = t => _fmtDay(t, { day: "numeric", month: "short" });
  root.querySelector(".chart-desc").textContent = (full ? "full · " : "last " + windowDays + "d · ") + fmt(tMin) + " – " + fmt(tMax);
  // current value — live estimate with full detail (matches the main page), ticking
  if (root._curTick) clearInterval(root._curTick);
  const setCur = () => { const el = root.querySelector(".chart-cur"); if (el) el.innerHTML = cz2(liveNow()) + ' <span>AU</span>'; };
  setCur();
  root._curTick = setInterval(setCur, 1000);
  const delta = wp[wp.length - 1].v - wp[0].v, up = delta >= 0;
  const icon = up
    ? `<svg viewBox="0 0 24 24" class="trend-icon"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`
    : `<svg viewBox="0 0 24 24" class="trend-icon"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>`;
  // in/out sums over the window (from flux events), shown in brackets
  const inSum  = events.reduce((s, e) => s + e.in, 0);
  const outSum = events.reduce((s, e) => s + e.out, 0);
  const io = `<span class="foot-io">[in +${cz(inSum)} · out ${outSum ? "−" + cz(Math.abs(outSum)) : "0"}]</span>`;
  root.querySelector(".chart-foot-main").innerHTML = `${up ? "+" : "−"}${cz(Math.abs(delta))} AU since ${fmt(tMin)} ${icon} ${io}`;

  // hover — crosshair snaps to nearest real reading
  // hover — snaps to each DAY; shows that day's balance + daily drift, plus any event
  const cross = svg.querySelector(".cross"), hdot = svg.querySelector(".hdot");
  const eventByDay = {};
  events.forEach(ev => { eventByDay[Math.round((ev.t - tMin) / DAY)] = ev; });
  const move = e => {
    const r = svg.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const vbx = (cx - r.left) / r.width * W;
    let t = tMin + Math.max(0, Math.min(1, (vbx - PL) / iw)) * (tMax - tMin);
    t = Math.max(tMin, Math.min(tMax, tMin + Math.round((t - tMin) / DAY) * DAY));  // snap to day
    const bal = lineYAt(t), px = X(t), py = Y(bal);
    cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.style.opacity = 1;
    hdot.setAttribute("cx", px); hdot.setAttribute("cy", py); hdot.style.opacity = 1;
    const ds = _fmtDay(t, { day: "numeric", month: "short", year: "numeric" });
    const ev = eventByDay[Math.round((t - tMin) / DAY)];
    let evHtml = "";
    if (ev) {
      if (ev.in > 0)  evHtml += `<span style="color:var(--chart-2)">influx +${czMoney(ev.in)} AU</span>`;
      if (ev.out < 0) evHtml += `<span style="color:var(--primary)">efflux −${czMoney(Math.abs(ev.out))} AU</span>`;
    }
    tip.innerHTML = `<b>${cz2(bal)} AU</b><span>drift +${cz2(bal * dayRate)} · ${ds}</span>` + evHtml;
    tip.style.opacity = 1;
    const br = body.getBoundingClientRect(), tw = tip.offsetWidth;
    const screenX = r.left + px / W * r.width;
    tip.style.left = Math.max(0, Math.min(br.width - tw, screenX - br.left - tw / 2)) + "px";
  };
  const hide = () => { cross.style.opacity = 0; hdot.style.opacity = 0; tip.style.opacity = 0; };
  body.addEventListener("pointermove", move);
  body.addEventListener("pointerleave", hide);
}
