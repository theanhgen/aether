// AETHER — shared view helpers. Pure: they read the data.js globals and return markup.
// No data lives here; data.js stays the single source of truth.

const _UI_MON = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
const _MON_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// "5 – 8 Sep 2026" / "17 Oct – 8 Nov 2026" / "12 Jul 2026" → UTC ms of the first day
function tripStart(dates) {
  const parts = String(dates).split(/\s*[–—-]\s*/);
  const end = parts[parts.length - 1].trim().split(/\s+/);
  const endMon = _UI_MON[(end[1] || "").slice(0, 3).toLowerCase()], endYear = +end[2];
  const s = parts[0].trim().split(/\s+/);
  const mon = s[1] ? _UI_MON[s[1].slice(0, 3).toLowerCase()] : endMon;
  const year = s[2] ? +s[2] : endYear;
  return Date.UTC(year, mon, +s[0]);
}
// discharge log in chronological order, numbered 01, 02, … (same numbers on manifest and burn)
function tripsChrono() {
  return LOG.map(t => ({ ...t, start: tripStart(t.dates) }))
    .sort((a, b) => a.start - b.start)
    .map((t, i) => ({ ...t, no: String(i + 1).padStart(2, "0"), slug: t.name.toLowerCase() }));
}
const totalDischarged = () => LOG.reduce((s, t) => s + (t.total ?? 0), 0);
const perUnitDay = t => t.days ? (t.per ?? 0) / t.days : null;
const _esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---- vitals grid: ≡ label above a big tabular value, unit small after it ----
function vitalsItems() {
  return [
    { k: "last sync", v: cz2(ANCHOR.balance), u: "AU" },
    { k: "influx",    v: "+" + cz(WEEKLY_IN), u: "AU / wk" },
    { k: "drift",     v: "+" + cz2(driftPerDay), u: "AU / day" },
    { k: "rate",      v: (RATE * 100).toFixed(2).replace(".", ","), u: "% p.a." }
  ];
}
function vitalsGrid(items, cols) {
  return `<div class="vgrid c${cols}">` + items.map(it =>
    `<div class="vcell"><div class="vlab"><span class="mk" aria-hidden="true"></span>${it.k}</div>`
    + `<div class="vval tnum"><span class="fig">${it.v}</span><span class="u">${it.u}</span></div></div>`).join("") + `</div>`;
}

// ---- concentric rings gauge: two hairline circles, radius ∝ amount (linear) ----
// label + amount sit just outside each circle, upper right. Nothing in the centre.
// Drawn at the container's pixel width W so the labels stay at a readable size.
function ringsSVG(a, b, W) {
  // a, b: { label, amount }
  W = Math.max(280, Math.min(560, W || 560));
  const fs = W < 420 ? 11 : 13, cw = fs * 0.63, lh = fs * 1.3;
  const [big, small] = a.amount >= b.amount ? [a, b] : [b, a];
  const ratio = small.amount / (big.amount || 1);
  const wOf = it => Math.max(it.label.length, (cz2(it.amount) + " AU").length) * cw;
  // label box anchored just outside a circle of radius r at angle th (upper right)
  const box = (r, th, it) => {
    const x = Math.cos(th) * r + 10, yb = Math.sin(th) * r - 8;          // relative to centre
    return { x, yb, x1: x + wOf(it), top: yb - lh - fs * 0.85, bot: yb + 3 };
  };
  // largest R for which the outer label fits the width and the inner label stays inside the outer ring
  let best = null;
  for (const tho of [-50, -58, -66, -74, -82]) for (const thi of [-50, -60, -70, -80]) {
    for (let R = 208; R >= 60; R -= 2) {
      const bo = box(R, tho * Math.PI / 180, big), bi = box(Math.max(6, R * ratio), thi * Math.PI / 180, small);
      const cx = R + 2;
      if (cx + bo.x1 > W - 10 || 2 * R + 6 > W) continue;
      const inside = [[bi.x1, bi.top], [bi.x1, bi.bot], [bi.x, bi.top]].every(([px, py]) => Math.hypot(px, py) <= R - 6);
      if (!inside) continue;
      if (!best || R > best.R) best = { R, tho, thi, bo, bi };
      break;
    }
  }
  if (!best) { const R = (W - 4) / 2.6; best = { R, tho: -60, thi: -60, bo: box(R, -60 * Math.PI / 180, big), bi: box(R * ratio, -60 * Math.PI / 180, small) }; }
  const { R, bo, bi } = best;
  const r2 = Math.max(6, R * ratio);
  const cx = R + 2, cy = Math.max(R + 2, -bo.top + 4), H = cy + R + 4;
  const lab = (b, it, cls) =>
    `<text class="rl" style="font-size:${fs}px" x="${(cx + b.x).toFixed(1)}" y="${(cy + b.yb - lh).toFixed(1)}">${_esc(it.label)}</text>`
    + `<text class="ra" style="font-size:${fs}px" x="${(cx + b.x).toFixed(1)}" y="${(cy + b.yb).toFixed(1)}" data-ring="${cls}">${cz2(it.amount)} AU</text>`;
  return `<svg viewBox="0 0 ${W} ${H.toFixed(0)}" width="${W}" height="${H.toFixed(0)}" role="img" aria-label="${_esc(big.label)} ${cz2(big.amount)} AU, ${_esc(small.label)} ${cz2(small.amount)} AU">
    <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R.toFixed(1)}"/>
    <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r2.toFixed(1)}"/>
    ${lab(bo, big, big === a ? "a" : "b")}${lab(bi, small, small === a ? "a" : "b")}
  </svg>`;
}

// ---- receipt table: header row, one line per entry, right-aligned tabular amounts ----
// head: [c1, c2, c3]; rows: [[c1, c2, amountText]]; totals: [[label, value, cls]]
function receiptHTML(head, rows, totals) {
  const t = `<table class="receipt"><thead><tr><th class="d">${head[0]}</th><th class="m">${head[1]}</th><th class="num">${head[2]}</th></tr></thead><tbody>`
    + rows.map(r => `<tr><td class="d tnum">${r[0]}</td><td class="m">${r[1]}</td><td class="num">${r[2]}</td></tr>`).join("")
    + `</tbody></table>`;
  const tot = totals && totals.length
    ? `<div class="rc-totals">` + totals.map(x => `<div class="${x[2] || ""}"><span>${x[0]}</span><span>${x[1]}</span></div>`).join("") + `</div>`
    : "";
  return t + tot;
}
const signed = n => (n >= 0 ? "+" : "−") + cz2(Math.abs(n));
function fluxReceipt(list, withTotals) {
  const rows = list.map(f => [f.date, f.amount >= 0 ? '<span class="tag w">in</span>influx' : '<span class="tag w">out</span>efflux', signed(f.amount)]);
  let totals = null;
  if (withTotals) {
    const inn = list.filter(f => f.amount > 0).reduce((s, f) => s + f.amount, 0);
    const out = list.filter(f => f.amount < 0).reduce((s, f) => s + f.amount, 0);
    const tg = s => '<span class="tag w">' + s + '</span>';
    totals = [[tg("in"), signed(inn) + " AU"], [tg("out"), signed(out) + " AU"], [tg("net"), signed(inn + out) + " AU", "net"]];
  }
  return receiptHTML(["date", "movement", "amount AU"], rows, totals);
}

// ---- discharge log plate: one blue field, circles sized by total (area ∝ amount),
// joined in chronological order; x = order, y = AU per unit·day ----
function plateHTML(Wpx) {
  const trips = tripsChrono();
  if (!trips.length) return `<div class="plate"><div class="plate-head"><span>discharge log</span></div><p>— nothing discharged yet —</p></div>`;
  const W = Math.round(Math.max(300, Math.min(640, Wpx || 600))), sm = W < 440;
  const H = sm ? 320 : 400, padX = sm ? 44 : 70, padT = sm ? 56 : 70, padB = sm ? 72 : 60;
  const maxT = Math.max(...trips.map(t => t.total ?? 0)) || 1;
  const rMax = sm ? 42 : 64, rOf = v => Math.max(3, rMax * Math.sqrt((v ?? 0) / maxT));
  const pud = trips.map(t => perUnitDay(t) ?? 0);
  const pLo = Math.min(...pud), pHi = Math.max(...pud), span = (pHi - pLo) || 1;
  const pts = trips.map((t, i) => ({
    t, r: rOf(t.total),
    x: padX + (trips.length === 1 ? (W - 2 * padX) / 2 : i * (W - 2 * padX) / (trips.length - 1)),
    y: padT + (1 - ((pud[i] - pLo) / span)) * (H - padT - padB)
  }));
  const path = pts.map((p, i) => (i ? "L" : "M") + p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ");
  const nodes = pts.map(p => {
    const circ = `<circle class="c" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r.toFixed(1)}"/>`;
    const above = sm || p.x + p.r * 0.72 + 6 + 48 > W;       // tight: label sits right above the circle
    if (above) {
      const lx = Math.min(W - 24, Math.max(24, p.x)), ly = p.y - p.r - 6;
      return `<a href="burn.html#${p.t.slug}">${circ}`
        + `<rect class="tg" x="${(lx - 9).toFixed(1)}" y="${(ly - 24.5).toFixed(1)}" width="18" height="12"/>`
        + `<text x="${lx.toFixed(1)}" y="${(ly - 15).toFixed(1)}" text-anchor="middle" style="font-size:9.5px">${p.t.no}</text>`
        + `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle">${cz(p.t.total ?? 0)}</text></a>`;
    }
    const ex = p.x + p.r * 0.72, lx = ex + 6, ly = p.y - p.r * 0.72 - 6;
    return `<a href="burn.html#${p.t.slug}">${circ}`
      + `<line class="ln" x1="${ex.toFixed(1)}" y1="${(p.y - p.r * 0.72).toFixed(1)}" x2="${(lx - 2).toFixed(1)}" y2="${(ly + 2).toFixed(1)}"/>`
      + `<rect class="tg" x="${(lx - 0.5).toFixed(1)}" y="${(ly - 24.5).toFixed(1)}" width="18" height="12"/>`
      + `<text x="${(lx + 8.5).toFixed(1)}" y="${(ly - 15).toFixed(1)}" text-anchor="middle" style="font-size:9.5px">${p.t.no}</text>`
      + `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}">${cz(p.t.total ?? 0)}</text></a>`;
  }).join("");
  const cross = `<path class="ln" d="M4,${H - 10} h12 M10,${H - 16} v12"/>`
    + `<text x="24" y="${H - 6}" style="font-size:9.5px">↑ AU / unit·day · → chronological · area by total</text>`;
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="discharge log diagram"><path class="ln" d="${path}"/>${nodes}${cross}</svg>`;
  const mini = r => { const s = Math.max(2.5, r * 0.15); return `<svg width="${(2 * s + 2).toFixed(0)}" height="${(2 * s + 2).toFixed(0)}" viewBox="0 0 ${(2 * s + 2).toFixed(1)} ${(2 * s + 2).toFixed(1)}"><circle class="c" cx="${(s + 1).toFixed(1)}" cy="${(s + 1).toFixed(1)}" r="${s.toFixed(1)}"/></svg>`; };
  const rows = pts.map(p => `<tr><td class="no l"><span class="tag">${p.t.no}</span></td><td class="ci">${mini(p.r)}</td>`
    + `<td class="l"><a href="burn.html#${p.t.slug}">${_esc(p.t.name)}${p.t.pending ? ' <span class="tag">pending</span>' : ""}</a></td>`
    + `<td class="l opt">${_esc(p.t.dates.replace(/ 20\d\d$/, ""))}</td>`
    + `<td>${cz2(p.t.total ?? 0)}</td><td>${perUnitDay(p.t) == null ? "—" : cz2(perUnitDay(p.t))}</td></tr>`).join("");
  const sum = totalDischarged();
  const table = `<table class="pt"><thead><tr><th class="l">no</th><th></th><th class="l">burn</th><th class="l opt">dates</th><th>total AU</th><th>AU/unit·day</th></tr></thead>
    <tbody>${rows}<tr class="sum"><td class="l" colspan="2">∑</td><td class="l">${trips.length} burns</td><td class="opt"></td><td>${cz2(sum)}</td><td></td></tr></tbody></table>`;
  return `<div class="plate"><div class="plate-head"><span>discharge log</span><span>${trips.length} burns · ${cz2(sum)} AU</span></div>
    <div class="plate-body">${svg}<div>${table}<div class="plate-foot">select a burn → polar profile</div></div></div></div>`;
}

// ---- burn: one tall panel per trip, polar (radar) plot in hairlines ----
const BURN_CATS = ["thrust", "berth", "galley", "survey", "aux"];
function polarPanelsHTML(selected) {
  const trips = tripsChrono();
  const fields = ["f-red", "f-black", "f-white"];
  // category sums per trip (unknown categories folded in after the known five)
  const sums = trips.map(t => { const by = {}; (t.items || []).forEach(it => { const c = it.category || "aux"; by[c] = (by[c] || 0) + it.amount; }); return by; });
  const extra = [...new Set(sums.flatMap(by => Object.keys(by)).filter(c => !BURN_CATS.includes(c)))];
  const cats = [...BURN_CATS, ...extra];
  const maxV = Math.max(1, ...sums.flatMap(by => Object.values(by)));
  const S = 240, c = S / 2, R = 98;
  const rOf = v => R * Math.sqrt(v / maxV);                 // shared scale: radius ∝ √amount
  const ringVals = [1000, 5000, 10000, 20000, 40000].filter(v => v <= maxV * 1.02);
  const ang = i => (-90 + i * 360 / cats.length) * Math.PI / 180;
  return `<div class="panels">` + trips.map((t, k) => {
    const by = sums[k];
    const rings = ringVals.map(v => `<circle class="ring" cx="${c}" cy="${c}" r="${rOf(v).toFixed(1)}"/>`
      + `<text x="${(c + Math.cos(-0.94) * rOf(v) + 2).toFixed(1)}" y="${(c + Math.sin(-0.94) * rOf(v) - 2).toFixed(1)}" style="font-size:7.5px;opacity:.8">${v >= 1000 ? v / 1000 + "k" : v}</text>`).join("")
      + `<circle class="ring" cx="${c}" cy="${c}" r="${R}" style="opacity:.9"/>`;
    const spokes = cats.map((cat, i) => {
      const x = c + Math.cos(ang(i)) * (R + 6), y = c + Math.sin(ang(i)) * (R + 6);
      const lx = c + Math.cos(ang(i)) * (R + 16), ly = c + Math.sin(ang(i)) * (R + 16) + 3;
      const anchor = Math.abs(Math.cos(ang(i))) < 0.2 ? "middle" : Math.cos(ang(i)) > 0 ? "start" : "end";
      return `<line class="spoke" x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`
        + `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}">${cat.slice(0, 3).toUpperCase()}</text>`;
    }).join("");
    const P = cats.map((cat, i) => { const r = rOf(by[cat] || 0); return { cat, v: by[cat] || 0, x: c + Math.cos(ang(i)) * r, y: c + Math.sin(ang(i)) * r, i }; });
    const poly = `<polygon class="poly" points="${P.map(p => p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ")}"/>`;
    const vx = P.filter(p => p.v > 0).map(p => {
      if (Math.hypot(p.x - c, p.y - c) < 16) return `<circle class="vx" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2"/>`;
      const right = Math.cos(ang(p.i)) >= -0.2;
      return `<circle class="vx" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2"/>`
        + `<text x="${(p.x + (right ? 5 : -5)).toFixed(1)}" y="${(p.y + (p.i === 0 ? 10 : -4)).toFixed(1)}" text-anchor="${right ? "start" : "end"}" style="font-size:8px">${cz(p.v)}</text>`;
    }).join("");
    const pd = perUnitDay(t);
    const sel = selected && selected === t.slug;
    return `<a class="panel ${fields[k % fields.length]}${sel ? " sel" : ""}" id="${t.slug}" href="#${t.slug}">
      <div>
        <div><span class="tag">${t.no}</span>/ ${String(trips.length).padStart(2, "0")} · burn</div>
        <div style="font-weight:600">${_esc(t.name)}${t.pending ? ' <span class="tag">pending</span>' : ""}</div>
        <div>${_esc(t.dates)}</div>
      </div>
      <div class="mid">
        <div class="row2 tot"><span><span class="s">∑</span><span class="fig">${cz2(t.total ?? 0)}</span><span class="u">AU</span></span><span>${t.days ? t.days + " d" : ""}</span></div>
        <svg viewBox="0 0 ${S} ${S}" role="img" aria-label="${_esc(t.name)} by category">${rings}${spokes}${poly}${vx}</svg>
        <div class="row2"><span>${pd == null ? "" : cz2(pd) + " / unit·day"}</span><span>${(t.items || []).length} items</span></div>
      </div>
      <div class="row2"><span>polar · √AU radius</span><span class="selmark"><span class="tag">selected</span></span></div>
    </a>`;
  }).join("") + `</div>`;
}
