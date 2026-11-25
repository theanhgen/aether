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
const _MON3 = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const _dm = t => new Date(t).getUTCDate() + " " + _MON3[new Date(t).getUTCMonth()];   // "9 SEP"

// Balance chart — graph-paper trace. Full grid, ruler axes (value left, time bottom),
// a hairline trace, a STATUS box and boxed callouts for real readings and effluxes
// printed on the plot. Re-draws at the container's pixel width so text stays 1:1.
// Pass Infinity for full history. Depends on BALANCE, FLUX, cz, cz2 from data.js.
function mountBalanceChart(root, windowDays) {
  root._win = windowDays;
  drawBalanceChart(root);
  if (!root._ro && typeof ResizeObserver !== "undefined") {
    root._w = root.clientWidth;
    root._ro = new ResizeObserver(() => {
      const w = root.clientWidth;
      if (Math.abs(w - root._w) > 2) { root._w = w; drawBalanceChart(root); }
    });
    root._ro.observe(root);
  }
}

function drawBalanceChart(root) {
  const windowDays = root._win;
  const DAY = 86400000;
  if (!Array.isArray(BALANCE) || BALANCE.length < 2) {   // guard: chart needs ≥2 readings
    root.innerHTML = `<div class="gp-head"><div><div class="chart-title">balance</div>`
      + `<div class="chart-desc">not enough data — need at least 2 readings</div></div></div>`;
    return;
  }
  root.innerHTML = `
    <div class="gp-head">
      <div><div class="chart-title"><span class="mk" aria-hidden="true"></span>balance</div><div class="chart-desc"></div></div>
      <div class="chart-cur"></div>
    </div>
    <div class="gp-body"><svg class="gp"></svg></div>
    <div class="gp-key"></div>
    <div class="gp-foot"><span class="gp-foot-main"></span><span>○ real reading · <i class="sq" aria-hidden="true"></i> efflux · + influx · gaps interpolated</span></div>`;
  const svg = root.querySelector("svg.gp");

  // ---- series (unchanged logic: real readings, projected to today) ----
  const all = BALANCE.map(p => ({ t: parseDay(p.d), v: p.v }));
  {
    const last = all[all.length - 1];
    const n = new Date();
    const todayT = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
    const weeklyAt = typeof weeklyInAt === "function"
      ? weeklyInAt
      : () => (typeof WEEKLY_IN !== "undefined" ? WEEKLY_IN : 0);
    let v = last.v;
    for (let t = last.t + DAY; t <= todayT; t += DAY) {
      v *= 1 + dayRate;
      if (new Date(t).getUTCDay() === 5) {
        v += weeklyAt(t);
        if (t < todayT) all.push({ t, v, est: true });
      }
    }
    if (todayT > last.t) all.push({ t: todayT, v, est: true });
  }
  const tMax = all[all.length - 1].t;
  const full = !isFinite(windowDays);
  const tMin = full ? all[0].t : tMax - windowDays * DAY;
  const reals = all.filter(p => p.t >= tMin);
  const wp = reals.slice();
  if (!full && (!reals.length || reals[0].t > tMin)) {
    let before = null, after = null;
    for (const p of all) { if (p.t <= tMin) before = p; if (p.t >= tMin && !after) after = p; }
    if (before && after && after.t > before.t)
      wp.unshift({ t: tMin, v: before.v + (after.v - before.v) * (tMin - before.t) / (after.t - before.t) });
    else if (after) wp.unshift({ t: tMin, v: after.v });
  }
  const dayMap = {};
  (typeof FLUX !== "undefined" ? FLUX : []).forEach(f => {
    const t = parseDay(f.date);
    if (t < tMin || t > tMax) return;
    const a = dayMap[t] || (dayMap[t] = { t, in: 0, out: 0 });
    if (f.amount >= 0) a.in += f.amount; else a.out += f.amount;
  });
  const dayEvents = Object.values(dayMap).sort((a, b) => a.t - b.t).map(e => ({ ...e, net: e.in + e.out }));
  const segOf = (A, B) => {
    const evs = dayEvents.filter(e => e.t > A.t && e.t <= B.t);
    return { evs, R: (B.v - A.v) - evs.reduce((s, e) => s + e.net, 0), span: (B.t - A.t) || 1 };
  };
  const valueAt = t => {
    if (t <= wp[0].t) return wp[0].v;
    if (t >= wp[wp.length - 1].t) return wp[wp.length - 1].v;
    for (let i = 0; i < wp.length - 1; i++) {
      const A = wp[i], B = wp[i + 1];
      if (t >= A.t && t <= B.t) {
        const { evs, R, span } = segOf(A, B);
        const cum = evs.filter(e => e.t <= t).reduce((s, e) => s + e.net, 0);
        return A.v + R * (t - A.t) / span + cum;
      }
    }
    return wp[wp.length - 1].v;
  };
  const daily = [];
  for (let t = tMin; t < tMax; t += DAY) daily.push({ t, v: valueAt(t) });
  daily.push({ t: tMax, v: valueAt(tMax) });

  // ---- geometry (pixel units) ----
  const W = Math.max(300, Math.round(root.clientWidth || 640));
  const narrow = W < 560;
  const LW = narrow ? 38 : 50, BH = 40, PT = 1, PR = 6;
  const PH = narrow ? 340 : (full ? 520 : 440);
  const H = PT + PH + BH;
  const x0 = LW, x1 = W - PR, y0 = PT, y1 = PT + PH, iw = x1 - x0;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W); svg.setAttribute("height", H);

  const vMin = Math.min(...daily.map(p => p.v)), vMax = Math.max(...daily.map(p => p.v));
  const vpad = (vMax - vMin) * 0.16 || 1, lo = vMin - vpad * 1.3, hi = vMax + vpad;
  const X = t => x0 + (t - tMin) / (tMax - tMin) * iw;
  const Y = v => y0 + (1 - (v - lo) / (hi - lo)) * PH;
  const pxPerV = PH / (hi - lo);

  // value grid + ruler
  const steps = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000];
  const major = steps.find(s => s * pxPerV >= (narrow ? 30 : 38)) || 50000;
  const minor = major / 5 * pxPerV >= 6 ? major / 5 : major / 2;
  const kfmt = g => (g % 1000 === 0 ? (g / 1000) : (g / 1000).toFixed(1).replace(".", ",")) + "k";
  let grid = "", ruler = "";
  for (let g = Math.ceil(lo / minor) * minor; g <= hi; g += minor) {
    const y = Y(g).toFixed(1), isMaj = Math.abs(g / major - Math.round(g / major)) < 1e-6;
    grid += `<line class="${isMaj ? "gmaj" : "gmin"}" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>`;
    ruler += `<line class="tick" x1="${x0 - (isMaj ? 9 : 4)}" y1="${y}" x2="${x0}" y2="${y}"/>`;
    if (isMaj) ruler += `<text class="tlab" x="${x0 - 12}" y="${(+y + 3).toFixed(1)}" text-anchor="end">${kfmt(g)}</text>`;
  }
  // time grid + ruler (days → weeks → months)
  const spanDays = (tMax - tMin) / DAY, dayPx = iw / spanDays;
  const wk = 7 * dayPx >= 16 ? 1 : 2;                   // weeks per major vertical line
  const firstMon = tMin + ((8 - new Date(tMin).getUTCDay()) % 7) * DAY;
  let lastM = new Date(tMin).getUTCMonth(), wkIdx = 0;
  for (let t = tMin; t <= tMax; t += DAY) {
    const x = X(t).toFixed(1), d = new Date(t);
    const isMon = t >= firstMon && Math.round((t - firstMon) / DAY) % 7 === 0;
    const isMaj = isMon && (wkIdx++ % wk === 0);
    const isMonth = d.getUTCMonth() !== lastM; if (isMonth) lastM = d.getUTCMonth();
    if (isMaj) grid += `<line class="gmaj" x1="${x}" y1="${y0}" x2="${x}" y2="${y1}"/>`;
    else if (dayPx >= 7) grid += `<line class="gmin" x1="${x}" y1="${y0}" x2="${x}" y2="${y1}"/>`;
    const len = isMonth ? 18 : isMaj ? 9 : isMon ? 6 : 3.5;
    if (dayPx >= 2.4 || isMon || isMonth) ruler += `<line class="tick" x1="${x}" y1="${y1}" x2="${x}" y2="${(y1 + len).toFixed(1)}"/>`;
    if (isMaj && 7 * wk * dayPx >= 20 && X(t) < x1 - 16) ruler += `<text class="tlab" x="${(+x + 2).toFixed(1)}" y="${y1 + 18}">${String(d.getUTCDate()).padStart(2, "0")}</text>`;
    if (isMonth && X(t) < x1 - 26) ruler += `<text class="tlab mo" x="${(+x + 3).toFixed(1)}" y="${y1 + 33}">${_MON3[d.getUTCMonth()]}</text>`;
  }
  const frame = `<line class="axis" x1="${x0}" y1="${y0}" x2="${x0}" y2="${y1}"/><line class="axis" x1="${x0}" y1="${y1}" x2="${x1}" y2="${y1}"/>`
    + `<line class="gmaj" x1="${x1}" y1="${y0}" x2="${x1}" y2="${y1}"/><line class="gmaj" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y0}"/>`;

  // trace — straight hairline segments, one point per day
  const P = daily.map(p => [X(p.t), Y(p.v)]);
  const trace = `<polyline class="trace" points="${P.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}"/>`;

  // ---- what gets marked: per day, real reading and/or flux ----
  const marks = {};
  const mk = t => marks[t] || (marks[t] = { t });
  reals.filter(p => !p.est).forEach(p => { mk(p.t).read = p.v; });
  dayEvents.forEach(e => { const m = mk(e.t); if (e.out < 0) m.out = e.out; if (e.in > 0) m.in = e.in; });
  const markList = Object.values(marks).filter(m => m.t >= tMin && m.t <= tMax);
  let markSvg = "";
  markList.forEach(m => {
    const x = X(m.t), y = Y(valueAt(m.t));
    if (m.in && !m.read && !m.out) markSvg += `<path class="mk-in" d="M${(x - 3.5).toFixed(1)},${y.toFixed(1)}h7M${x.toFixed(1)},${(y - 3.5).toFixed(1)}v7"/>`;
    if (m.out) markSvg += `<rect class="mk-out" x="${(x - 2.8).toFixed(1)}" y="${(y - 2.8).toFixed(1)}" width="5.6" height="5.6"/>`;
    if (m.read) markSvg += `<circle class="mk-read" cx="${x.toFixed(1)}" cy="${Y(m.read).toFixed(1)}" r="3.2"/>`;
  });

  // ---- boxes: overlap-aware placement ----
  const CW = 6.06, LH = 13.5, TCW = 8 * 0.606 + 0.5, TAGW = 4 * TCW + 8;   // Paper Mono advance 0.606em; tags at 8px
  const placed = [];
  const hits = (b, m = 3) => placed.some(q => b.x < q.x + q.w + m && q.x < b.x + b.w + m && b.y < q.y + q.h + m && q.y < b.y + b.h + m);
  const inPlot = b => b.x >= x0 + 3 && b.x + b.w <= x1 - 3 && b.y >= y0 + 3 && b.y + b.h <= y1 - 3;
  const traceIn = b => P.reduce((n, p) => n + (p[0] > b.x - 2 && p[0] < b.x + b.w + 2 && p[1] > b.y - 2 && p[1] < b.y + b.h + 2 ? 1 : 0), 0);

  // status group — title box + STATUS box, in the corner the trace crosses least
  const since = Math.floor((Date.now() - anchorDate.getTime()) / DAY);
  const status = since <= 7 ? "NOMINAL" : since <= 30 ? "DRIFTING" : "STALE";
  const fmt = _dm;
  const endsToday = all[all.length - 1].est;
  const tl = [["BALANCE TRACE", "ttl"], ["from: " + fmt(tMin), ""], ["to  : " + (endsToday ? "NOW" : fmt(tMax)), ""]];
  const sl = [["STATUS", "tag"], [status, "big"], ["sync " + shortDate.toUpperCase() + " · " + since + "d ago", ""]];
  const gW = Math.max(150, 21 * CW + 14), tH = 3 * LH + 10, sH = 12 + 26 + 14 + 10, gH = tH + 8 + sH;
  const corners = [[x0 + 14, y0 + 14], [x1 - 14 - gW, y0 + 14], [x0 + 14, y1 - 14 - gH], [x1 - 14 - gW, y1 - 14 - gH]];
  const [gx, gy] = corners.map(c => [c, traceIn({ x: c[0], y: c[1], w: gW, h: gH })]).sort((a, b) => a[1] - b[1])[0][0];
  let boxes = "";
  const boxText = (bx, by, lines) => {
    let yy = by + 4, s = "";
    lines.forEach(([txt, cls]) => {
      yy += cls === "big" ? 24 : LH;
      if (cls === "tag") { const tw = txt.length * TCW + 8; s += `<rect class="tg" x="${bx + 7}" y="${(yy - 8.5).toFixed(1)}" width="${tw.toFixed(1)}" height="11"/><text x="${bx + 11}" y="${(yy - 0.5).toFixed(1)}" class="tgt">${txt}</text>`; }
      else s += `<text x="${bx + 7}" y="${yy.toFixed(1)}" class="${cls}">${txt}</text>`;
    });
    return s;
  };
  boxes += `<rect class="box" x="${gx}" y="${gy}" width="${gW}" height="${tH}" rx="3"/>` + boxText(gx, gy, tl);
  boxes += `<rect class="box" x="${gx}" y="${gy + tH + 8}" width="${gW}" height="${sH}" rx="3"/>` + boxText(gx, gy + tH + 8, sl);
  placed.push({ x: gx, y: gy, w: gW, h: gH });

  // callouts — EVERY real reading and EVERY efflux gets a boxed label printed on the plot.
  // Each box searches the whole plot on a grid for the nearest free spot: it may not overlap another
  // box or the status group, may not cover any marked point, and pays for covering the trace or
  // running its leader through another box. Crowded stretches (July) fan out into the empty paper.
  // Anything that still finds no room gets a small numbered tag and a line in the key under the plot.
  const markPts = markList.map(m => [X(m.t), m.read ? Y(m.read) : Y(valueAt(m.t))]);
  const ptIn = (b, pad = 5) => markPts.some(([px, py]) => px > b.x - pad && px < b.x + b.w + pad && py > b.y - pad && py < b.y + b.h + pad);
  const segHitsBox = (ax, ay, bx, by, q) => {
    const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
    for (let i = 1; i < n; i++) { const sx = ax + (bx - ax) * i / n, sy = ay + (by - ay) * i / n;
      if (sx > q.x - 1 && sx < q.x + q.w + 1 && sy > q.y - 1 && sy < q.y + q.h + 1) return true; }
    return false;
  };
  const lastRead = markList.filter(m => m.read).sort((a, b) => b.t - a.t)[0];
  const pri = m => (m === lastRead ? 1e12 : 0) + (m.out ? 1e6 + Math.abs(m.out) : 0) + (m.read ? 1000 : 0);
  const cands = markList.filter(m => m.read || m.out).sort((a, b) => pri(b) - pri(a));
  const leads = [], tags = [], segs = [];
  const cross = (p1, p2, p3, p4) => {                     // proper segment intersection
    const d = (a, b, q) => (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
    return d(p3, p4, p1) * d(p3, p4, p2) < 0 && d(p1, p2, p3) * d(p1, p2, p4) < 0;
  };
  let callouts = "", key = [];
  const step = narrow ? 6 : 8;
  for (const m of cands) {
    const lines = [[fmt(m.t), "d"]];
    if (m.out) lines.push(["−" + cz2(Math.abs(m.out)), "OUT"]);
    if (m.read) lines.push([cz2(m.read), "READ"]);
    const w = Math.max(...lines.map(l => l[0].length * CW + (l[1] === "d" ? 0 : TAGW + 5))) + 14, h = lines.length * LH + 8;
    const ax = X(m.t), ay = m.read ? Y(m.read) : Y(valueAt(m.t));
    let best = null;
    for (let bx = x0 + 4; bx + w <= x1 - 4; bx += step) {
      for (let by = y0 + 4; by + h <= y1 - 4; by += step) {
        const b = { x: bx, y: by, w, h };
        const cx = Math.max(bx, Math.min(ax, bx + w)), cy = Math.max(by, Math.min(ay, by + h));
        const len = Math.hypot(cx - ax, cy - ay);
        if (len < 8 || len > 340) continue;
        if (best && len > best.s) continue;                  // cheap prune: score ≥ leader length
        if (hits(b, 5) || ptIn(b)) continue;
        let s = len + traceIn(b) * 45;
        if (best && s > best.s) continue;
        if (placed.some(q => segHitsBox(ax, ay, cx, cy, q))) s += 600;
        s += 160 * segs.filter(g => cross([ax, ay], [cx, cy], g[0], g[1])).length;
        s += 90 * markPts.filter(([px, py]) => (px !== ax || py !== ay) && Math.abs((cx - ax) * (py - ay) - (cy - ay) * (px - ax)) / (len || 1) < 4
          && (px - ax) * (cx - ax) + (py - ay) * (cy - ay) > 0 && Math.hypot(px - ax, py - ay) < len).length;
        if (!best || s < best.s) best = { b, s, cx, cy };
      }
    }
    if (!best || best.s >= 1200) { tags.push({ m, ax, ay, lines }); continue; }
    const b = best.b; placed.push(b); segs.push([[ax, ay], [best.cx, best.cy]]);
    leads.push(`<line class="lead" x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${best.cx.toFixed(1)}" y2="${best.cy.toFixed(1)}"/>`);
    callouts += `<rect class="box" x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="2"/>`
      + lines.map((l, i) => {
        const ty = b.y + 4 + LH * (i + 1) - 2;
        if (i === 0) return `<text x="${(b.x + 7).toFixed(1)}" y="${ty.toFixed(1)}" style="font-size:9px;opacity:.7">${l[0]}</text>`;
        return `<rect class="tg" x="${(b.x + 7).toFixed(1)}" y="${(ty - 8.5).toFixed(1)}" width="${TAGW.toFixed(1)}" height="11"/>`
          + `<text class="tgt" x="${(b.x + 7 + TAGW / 2).toFixed(1)}" y="${(ty - 0.5).toFixed(1)}" text-anchor="middle">${l[1]}</text>`
          + `<text x="${(b.x + 7 + TAGW + 5).toFixed(1)}" y="${ty.toFixed(1)}">${l[0]}</text>`;
      }).join("");
  }
  // fallback (narrow screens): numbered boxed tag on the point, full values in the key below
  tags.sort((a, b) => a.m.t - b.m.t).forEach((g, i) => {
    const n = String(i + 1), w = n.length * CW + 8, h = 13;
    const cand = [[6, -h - 6], [-w - 6, -h - 6], [6, 6], [-w - 6, 6], [-w / 2, -h - 14], [-w / 2, 14]]
      .map(([dx, dy]) => ({ x: g.ax + dx, y: g.ay + dy, w, h }));
    const b = cand.find(q => inPlot(q) && !hits(q, 1)) || cand[0];
    placed.push(b);
    callouts += `<rect class="box" x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${w}" height="${h}" rx="2"/>`
      + `<text x="${(b.x + 4).toFixed(1)}" y="${(b.y + 10).toFixed(1)}" style="font-size:9px">${n}</text>`;
    key.push(`<span><b>[${n}]</b> ${g.lines.map(l => (l[1] && l[1] !== "d" ? l[1] + " " : "") + l[0]).join(" · ")}</span>`);
  });
  callouts = leads.join("") + callouts;
  const keyEl = root.querySelector(".gp-key");
  if (keyEl) keyEl.innerHTML = key.join("");

  const ex = X(wp[wp.length - 1].t), ey = Y(wp[wp.length - 1].v);
  svg.innerHTML = `<rect class="paper" x="${x0}" y="${y0}" width="${iw}" height="${PH}"/>${grid}${frame}${ruler}${trace}${markSvg}
    <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="3.5" fill="var(--chart-2)"/>
    ${callouts}${boxes}
    <g class="hov" style="display:none"><line y1="${y0}" y2="${y1}"/><rect class="box" height="${LH * 2 + 8}" rx="2"/><text class="h1"></text><text class="h2"></text></g>`;

  // header + footer
  root.querySelector(".chart-desc").textContent = (full ? "full · " : "last " + windowDays + "d · ")
    + _fmtDay(tMin, { day: "numeric", month: "short" }) + " – " + (endsToday ? "now" : _fmtDay(tMax, { day: "numeric", month: "short" }));
  if (root._curTick) clearInterval(root._curTick);
  const setCur = () => { const el = root.querySelector(".chart-cur"); if (el) el.innerHTML = '<span class="fig">' + cz2(liveNow()) + '</span> <span>AU</span>'; };
  setCur();
  root._curTick = setInterval(setCur, 1000);
  const delta = wp[wp.length - 1].v - wp[0].v;
  const inSum = dayEvents.reduce((s, e) => s + e.in, 0), outSum = dayEvents.reduce((s, e) => s + e.out, 0);
  root.querySelector(".gp-foot-main").innerHTML = `<b>${delta >= 0 ? "+" : "−"}${cz(Math.abs(delta))} AU</b> since ${_fmtDay(tMin, { day: "numeric", month: "short" })} · <span class="tag">in</span> +${cz(inSum)} <span class="tag">out</span> ${outSum ? "−" + cz(Math.abs(outSum)) : "0"}`;

  // hover — optional extra: a boxed readout for any day (all key values are already printed)
  const hov = svg.querySelector(".hov"), hl = hov.querySelector("line"), hr = hov.querySelector("rect"),
        h1 = hov.querySelector(".h1"), h2 = hov.querySelector(".h2");
  const move = e => {
    const r = svg.getBoundingClientRect();
    const vx = (e.clientX - r.left) / r.width * W;
    if (vx < x0 || vx > x1) { hov.style.display = "none"; return; }
    let t = tMin + (vx - x0) / iw * (tMax - tMin);
    t = Math.max(tMin, Math.min(tMax, tMin + Math.round((t - tMin) / DAY) * DAY));
    const px = X(t), bal = valueAt(t);
    const a = _fmtDay(t, { day: "numeric", month: "short", year: "numeric" }).toUpperCase(), b = cz2(bal) + " AU";
    const w = Math.max(a.length, b.length) * CW + 14, bx = px + w + 16 > x1 ? px - w - 8 : px + 8;
    hl.setAttribute("x1", px); hl.setAttribute("x2", px);
    hr.setAttribute("x", bx); hr.setAttribute("y", y0 + 8); hr.setAttribute("width", w);
    h1.setAttribute("x", bx + 7); h1.setAttribute("y", y0 + 8 + LH + 1); h1.textContent = a;
    h2.setAttribute("x", bx + 7); h2.setAttribute("y", y0 + 8 + 2 * LH + 1); h2.textContent = b;
    hov.style.display = "";
  };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerleave", () => { hov.style.display = "none"; });
}
