// AETHER — single source of truth. Update here after each sync; both pages read it.

// Confirmed balance + when it was read off the app. Page estimates "now" from drift.
const ANCHOR = {
  balance: 78822.21,   // prior 74 800,25 + drift + confirmed 4 000 influx (15 Jul)
  atISO: "2026-07-15T18:34:00+02:00"
};
const RATE = 0.0275;       // 2.75 % p.a. net
const WEEKLY_IN = 2000;    // top-up per week (2 × 1 000)
const WINDOW_DAYS = 90;    // balance chart: rolling window length

// FLUX — notable capital movements, newest first. Positive = influx (in),
// negative = efflux (out). Routine weekly top-ups between are omitted (they're
// summarised by the influx stat); daily interest is the drift stat.
const FLUX = [
  { date: "15 Jul 2026", amount:  4000 },   // extra influx (2 × 2 000)
  { date: "11 Jul 2026", amount:  2000 },
  { date: "03 Jul 2026", amount:  2000 },
  { date: "02 Jul 2026", amount: -2776.12 },
  { date: "26 Jun 2026", amount:  2000 },
  { date: "20 Jun 2026", amount:  2000 },
  { date: "19 Jun 2026", amount:  2000 },
  { date: "31 Mar 2026", amount: 27000 },   // injection
  { date: "14 Mar 2026", amount: 40000 }    // opening (2 × 20 000)
];

// BALANCE — real readings off the app, oldest → newest, for the chart.
// Gaps (e.g. Apr→Jun) draw as straight segments; no readings exist there.
const BALANCE = [
  { d: "2026-03-14", v: 40000.00 },   // opening, 2 × 20 000
  { d: "2026-03-17", v: 40009.18 },
  { d: "2026-04-02", v: 67060.28 },   // after the +27 000 injection (31 Mar)
  { d: "2026-06-20", v: 71455.71 },   // weekly influx + drift
  { d: "2026-07-02", v: 70751.02 },   // after the −2 776 efflux
  { d: "2026-07-03", v: 72756.33 },   // +2 000
  { d: "2026-07-11", v: 74800.25 },   // +2 000
  { d: "2026-07-15", v: 78822.21 }    // +4 000 influx — current anchor
];

// DISCHARGE LOG — trips paid from the reserve; the amount is what the reserve
// discharged for each. Trips settled elsewhere aren't listed.
// items = the pocket discharges that funded the burn. category is a coded bucket
// (thrust | berth | galley | survey | aux). total should equal their sum.
const LOG = [
  {
    name: "Antares", dates: "17 Oct – 8 Nov 2026", total: 39682.21, per: 19841.11,
    items: [
      { date: "16 Jul 2026", category: "thrust", amount: 39682.21 }
    ]
  },
  {
    name: "Rigel", dates: "25 – 27 Jul 2026", total: 9042, per: 4521,
    items: [
      { date: "12 Jun 2026", category: "berth", amount: 9042 }
    ]
  },
  {
    name: "Altair", dates: "10 – 12 Jul 2026", total: 2776.12, per: 1388.06,
    items: [
      { date: "02 Jul 2026", category: "thrust", amount: 2776.12 }
    ]
  }
];

// ---- derived (shared) ----
const cz  = n => n.toLocaleString("cs-CZ", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const cz2 = n => n.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// money: show cents only when the amount actually has a fractional part
const czMoney = n => Number.isInteger(n) ? cz(n) : cz2(n);

// one flux row — shared by manifest (latest 3) and flux.html (all)
const fluxRow = f => {
  const inflow = f.amount >= 0;
  return `
  <div class="row">
    <div>
      <div class="name">${inflow ? "influx" : "efflux"}</div>
      <div class="dates">${f.date}</div>
    </div>
    <div class="amt tnum ${inflow ? "in" : "out"}">${inflow ? "+" : "−"}${czMoney(Math.abs(f.amount))} AU</div>
  </div>`;
};
// interest simulation — daily rate from the 2.75 % p.a., compounded from the
// anchor. An approximation (the provider's exact day-count/accrual differs slightly).
const dayRate     = RATE / 365;
const anchorDate  = new Date(ANCHOR.atISO);
const driftPerDay = ANCHOR.balance * dayRate;     // ≈ interest/day at the current balance
// live estimate — recomputed on each call so the balance ticks up as interest accrues
const liveNow = () => ANCHOR.balance * Math.pow(1 + dayRate, Math.max(0, (Date.now() - anchorDate.getTime()) / 86400000));
const shortDate = anchorDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
