/* Colón Desk — renders site/data/series.json (written by fetch.py) with ECharts. */
(function () {
  "use strict";

  const DATA_URL = "data/series.json";
  const RANGE_KEY = "colon-desk-range";
  const charts = {};
  let S = null;            // series map from the JSON
  let range = "1Y";
  let triCcy = "CRC";

  // ---------- helpers ----------
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const fmt = (v, d = 2) => v == null || Number.isNaN(v) ? "—" :
    v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const toTs = (d) => Date.parse(d + "T00:00:00Z");
  const last = (a) => a[a.length - 1];

  // minMonths keeps low-frequency charts (quarterly FDI) readable on short ranges.
  function rangeStart(endTs, minMonths = 0) {
    const d = new Date(endTs);
    const m = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "3Y": 36, "5Y": 60 }[range];
    if (!m) return null;
    d.setUTCMonth(d.getUTCMonth() - Math.max(m, minMonths));
    return d.getTime();
  }
  // value at or before a timestamp in a [[date, v], ...] series
  function valueAt(series, ts) {
    let lo = 0, hi = series.length - 1, best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (toTs(series[mid][0]) <= ts) { best = series[mid]; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
  }
  const pts = (key) => (S[key] ? S[key].d.map(([d, v]) => [toTs(d), v]) : []);

  function theme() {
    return {
      ink: css("--ink"), ink2: css("--ink-2"), ink3: css("--ink-3"), line: css("--line"),
      grid: css("--grid"), panel: css("--panel"), band: css("--band"),
      s: [css("--s1"), css("--s2"), css("--s3"), css("--s4"), css("--s5")],
      up: css("--up"), down: css("--down"), mono: css("--font-data"), body: css("--font-body"),
    };
  }

  function base(t, extra = {}) {
    return Object.assign({
      animation: false,
      textStyle: { fontFamily: t.body, color: t.ink2 },
      grid: { left: 8, right: 16, top: 34, bottom: 28, containLabel: true },
      legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 12, itemHeight: 3,
        textStyle: { color: t.ink2, fontSize: 12 } },
      tooltip: {
        trigger: "axis", backgroundColor: t.panel, borderColor: t.line,
        textStyle: { color: t.ink, fontFamily: t.mono, fontSize: 12 },
        axisPointer: { type: "cross", lineStyle: { color: t.ink3 }, crossStyle: { color: t.ink3 },
          label: { backgroundColor: t.ink2, color: t.panel, fontFamily: t.mono } },
      },
    }, extra);
  }
  function timeAxis(t, extra = {}) {
    return Object.assign({
      type: "time", axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false },
      axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, hideOverlap: true },
      splitLine: { show: false },
    }, extra);
  }
  function valAxis(t, extra = {}) {
    return Object.assign({
      type: "value", scale: true, position: "right",
      axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11 },
      splitLine: { lineStyle: { color: t.grid } }, axisLine: { show: false },
    }, extra);
  }
  const line = (name, data, color, extra = {}) => Object.assign({
    name, type: "line", data, showSymbol: false, symbolSize: 8, smooth: false,
    lineStyle: { width: 2, color }, itemStyle: { color }, emphasis: { focus: "series" },
  }, extra);

  // ECharts' "inside" dataZoom swallows every wheel event over a chart (even with
  // zoomOnMouseWheel: "ctrl"), which hijacked page scrolling. So the window is held by a
  // slider dataZoom: hidden on most charts, visible under the MONEX chart. Ctrl+wheel (and
  // trackpad pinch, which arrives as Ctrl+wheel) zooms via attachCtrlZoom below; a plain
  // wheel is never intercepted, so the page scrolls normally.
  function zoom(endTs, xIdx = [0], minMonths = 0, slider = false) {
    const start = rangeStart(endTs, minMonths);
    return [{ type: "slider", show: slider, xAxisIndex: xIdx, filterMode: "filter", height: 18, bottom: 4,
      brushSelect: false, showDetail: false, borderColor: "transparent",
      startValue: start == null ? undefined : start, endValue: endTs, start: start == null ? 0 : undefined }];
  }

  function attachCtrlZoom(id) {
    const el = document.getElementById(id);
    if (el.dataset.ctrlZoom) return;
    el.dataset.ctrlZoom = "1";
    el.addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;              // plain scroll: leave it to the page
      const c = charts[id];
      const dz = c && c.getOption().dataZoom;
      if (!dz || !dz.length) return;
      e.preventDefault();
      const { start = 0, end = 100 } = dz[0];
      const rect = el.getBoundingClientRect();
      const focus = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const span = end - start, factor = Math.exp(Math.max(-40, Math.min(40, e.deltaY)) * 0.01);
      const nspan = Math.min(100, Math.max(0.5, span * factor));
      let ns = start + (span - nspan) * focus;
      ns = Math.min(Math.max(0, ns), 100 - nspan);
      c.dispatchAction({ type: "dataZoom", dataZoomIndex: 0, start: ns, end: ns + nspan });
    }, { passive: false });
  }

  function chart(id) {
    if (!charts[id]) { charts[id] = echarts.init(document.getElementById(id), null, { renderer: "canvas" }); attachCtrlZoom(id); }
    return charts[id];
  }

  // ---------- tiles ----------
  function spark(series, n = 60) {
    const s = series.slice(-n).map((p) => p[1]);
    if (s.length < 2) return "";
    const min = Math.min(...s), max = Math.max(...s), w = 160, h = 28, pad = 3;
    const x = (i) => (i / (s.length - 1)) * (w - 2 * pad) + pad;
    const y = (v) => max === min ? h / 2 : h - pad - ((v - min) / (max - min)) * (h - 2 * pad);
    const dl = s.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const da = `${dl}L${x(s.length - 1).toFixed(1)},${h}L${x(0).toFixed(1)},${h}Z`;
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <path class="a" d="${da}"/><path class="l" d="${dl}"/>
      <circle cx="${x(s.length - 1).toFixed(1)}" cy="${y(last(s)).toFixed(1)}" r="2.5"/></svg>`;
  }
  function delta(cur, prev, digits, unit, bps) {
    if (prev == null) return `<span class="flat">—</span>`;
    const d = cur - prev;
    const arrow = Math.abs(d) < 1e-9 ? "■" : d > 0 ? "▲" : "▼";
    const extra = bps ? ` (${d >= 0 ? "+" : ""}${fmt((d / prev) * 1e4, 0)} bps)` : "";
    return `<span>${arrow} ${d >= 0 ? "+" : ""}${fmt(d, digits)}${unit}${extra}</span>`;
  }
  function tile({ k, v, d, sparkSeries, asof, title }) {
    return `<div class="tile" title="${title || ""}"><div class="k">${k}</div><div class="v">${v}</div>
      <div class="d">${d}</div>${sparkSeries ? spark(sparkSeries) : ""}<div class="asof">${asof || ""}</div></div>`;
  }
  const niceDate = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  const niceMonth = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

  function renderTiles() {
    const m = S.monex.d, L = last(m), P = m[m.length - 2];
    const vw = m.map((r) => [r[0], r[5]]);
    const vol = m.map((r) => [r[0], r[6] / 1e6]);
    const avg20 = m.slice(-21, -1).reduce((a, r) => a + r[6], 0) / 20 / 1e6;
    const simple = (key, label, digits, unit, opts = {}) => {
      const s = S[key].d; if (!s.length) return "";
      const cur = last(s), prev = s[s.length - 2];
      const scale = opts.scale || 1;
      return tile({
        k: label, v: `${opts.prefix || ""}${fmt(cur[1] * scale, digits)}${opts.suffix || ""}`,
        d: delta(cur[1] * scale, prev ? prev[1] * scale : null, digits, unit),
        sparkSeries: s.map(([d, v]) => [d, v * scale]),
        asof: (S[key].freq === "Mensual" ? niceMonth : niceDate)(cur[0]),
        title: `BCCR indicator ${S[key].code}`,
      });
    };
    const rb = last(S.ref_buy.d), rs = last(S.ref_sell.d);

    // FDI: rolling 4-quarter total and the free-zone share of it.
    const fq = fdi("fdi_q_regime");
    const tot = fq.byCode[23145] || [], fz = fq.byCode[23150] || [];
    const sum4 = (s, end) => s.slice(Math.max(0, end - 3), end + 1).reduce((a, p) => a + p[1], 0);
    const n = tot.length - 1;
    const fdi4 = n >= 3 ? sum4(tot, n) : null, fdi4prev = n >= 7 ? sum4(tot, n - 4) : null;
    const fdiSeries = tot.map((p, i) => i >= 3 ? [p[0], sum4(tot, i) / 1e3] : null).filter(Boolean);
    const fzShare = n >= 3 && fz.length === tot.length ? (sum4(fz, n) / fdi4) * 100 : null;
    const fzSeries = tot.map((p, i) => i >= 3 && fz[i] ? [p[0], (sum4(fz, i) / sum4(tot, i)) * 100] : null).filter(Boolean);
    const quarter = (d) => { const x = new Date(d + "T00:00:00Z"); return `Q${Math.floor(x.getUTCMonth() / 3) + 1} ${x.getUTCFullYear()}`; };

    document.getElementById("tiles").innerHTML = [
      tile({ k: `Dollar price, <abbr title="Volume-weighted average price on MONEX, the wholesale FX market">MONEX VWAP</abbr>`,
        v: `₡${fmt(L[5])}`, d: delta(L[5], P[5], 2, "", true), sparkSeries: vw,
        asof: niceDate(L[0]), title: "Average colones paid per dollar in the latest MONEX session, weighted by volume (BCCR 3439)" }),
      tile({ k: "BCCR reference rate (sell)", v: `₡${fmt(rs[1])}`, d: `<span>buy ₡${fmt(rb[1])}</span>`,
        sparkSeries: S.ref_sell.d, asof: niceDate(rs[0]), title: `The central bank's official sell (318) and buy (317) exchange rates; spread ₡${fmt(rs[1] - rb[1])}` }),
      tile({ k: "MONEX volume", v: `$${fmt(L[6] / 1e6, 1)}M`, d: `<span>20-day avg $${fmt(avg20, 1)}M</span>`,
        sparkSeries: vol, asof: niceDate(L[0]), title: `US dollars traded on MONEX in the latest session, ${fmt(L[7], 0)} trades (BCCR 3446)` }),
      simple("tpm", `Policy rate (<abbr title="Tasa de política monetaria">TPM</abbr>)`, 2, " pp", { suffix: "%" }),
      simple("tbp", `Deposit benchmark (<abbr title="Tasa básica pasiva">TBP</abbr>)`, 2, " pp", { suffix: "%" }),
      simple("ipc_yoy", `Inflation (<abbr title="Consumer price index, year-on-year change">CPI y/y</abbr>)`, 2, " pp", { suffix: "%" }),
      simple("exp_inf_12m", `<abbr title="Median 12-month-ahead inflation forecast from the BCCR expectations survey">Expected inflation</abbr>`, 2, " pp", { suffix: "%" }),
      simple("imae_yoy", `Activity growth (<abbr title="Monthly index of economic activity, trend-cycle, year-on-year">IMAE y/y</abbr>)`, 2, " pp", { suffix: "%" }),
      fdi4 == null ? "" : tile({ k: `<abbr title="Foreign direct investment, sum of the last four quarters">FDI, last 4 quarters</abbr>`,
        v: `$${fmt(fdi4 / 1e3, 2)}B`, d: fdi4prev == null ? "" : delta(fdi4 / 1e3, fdi4prev / 1e3, 2, "B y/y"),
        sparkSeries: fdiSeries, asof: `to ${quarter(tot[n][0])}`, title: "Foreign direct investment inflows, rolling one-year total (BCCR table 368)" }),
      fzShare == null ? "" : tile({ k: "Free-zone share of FDI", v: `${fmt(fzShare, 0)}%`,
        d: `<span>of 4-quarter FDI</span>`, sparkSeries: fzSeries, asof: `to ${quarter(tot[n][0])}`,
        title: "Share of FDI going to companies in free trade zones (zonas francas)" }),
      simple("rin", `Net reserves (<abbr title="Reservas internacionales netas">RIN</abbr>)`, 2, "", { prefix: "$", suffix: "B", scale: 1e-3 }),
      simple("sofr", `US overnight rate (<abbr title="Secured Overnight Financing Rate">SOFR</abbr>)`, 2, " pp", { suffix: "%" }),
    ].join("");
  }

  // ---------- FDI ----------
  const REGIME_EN = { 23147: "Regular companies", 23148: "Tourism", 23149: "Financial system",
    23150: "Free trade zones", 23151: "Inward processing", 23152: "Real estate" };
  const COUNTRY_EN = { "E.E.U.U.": "United States", "Suiza": "Switzerland", "México": "Mexico", "Colombia": "Colombia",
    "Bélgica": "Belgium", "España": "Spain", "Alemania": "Germany", "Holanda": "Netherlands", "Francia": "France",
    "Inglaterra": "United Kingdom", "Italia": "Italy", "Canadá": "Canada", "Panamá": "Panama", "Guatemala": "Guatemala",
    "El Salvador": "El Salvador", "Honduras": "Honduras", "Nicaragua": "Nicaragua", "Argentina": "Argentina",
    "Brasil": "Brazil", "Chile": "Chile", "Venezuela": "Venezuela", "Islas Caimán": "Cayman Islands", "China": "China",
    "Corea": "South Korea", "Japón": "Japan", "Taiwán": "Taiwan", "República Dominicana": "Dominican Republic",
    "Inmobiliaria": "Real estate (individuals)" };
  const COUNTRY_AGGREGATES = new Set(["América Central", "América del Norte", "Otros relevantes de América",
    "Relevantes de Europa", "Relevantes de Asia", "Otros Países", "Otros países"]);   // regions and the residual
  const ACTIVITY_EN = { 23102: "Agriculture & fishing (A)", 23103: "Mining (B)", 23104: "Manufacturing (C)",
    23105: "Utilities (D,E)", 23106: "Construction (F)", 23107: "Wholesale & retail trade (G)",
    23108: "Transport & storage (H)", 23109: "Hotels & restaurants (I)", 23110: "Other services (R–U)",
    38585: "Info & communications (J)", 38586: "Finance & insurance (K)", 38587: "Real estate (L)",
    38588: "Business services (M,N)", 38589: "Public administration (O)",
    38590: "Education & health (P,Q)" };

  function fdi(key) {
    const t = S[key] || { indicators: [] };
    const byCode = {}; t.indicators.forEach((i) => { byCode[i.code] = i.d; });
    return { indicators: t.indicators, byCode };
  }

  function renderFdiRegime(t) {
    const f = fdi("fdi_q_regime");
    const total = (f.byCode[23145] || []).map(([d, v]) => [toTs(d), v]);
    const codes = [23150, 23147, 23152, 23148, 23151, 23149];   // largest first, fixed colour order
    const series = codes.map((c, j) => ({
      name: REGIME_EN[c], type: "bar", stack: "fdi", stackStrategy: "samesign", barMaxWidth: 18,
      data: (f.byCode[c] || []).map(([d, v]) => [toTs(d), +v.toFixed(1)]),
      itemStyle: { color: t.s[j % t.s.length], borderColor: t.panel, borderWidth: 1 },
      emphasis: { focus: "series" },
    }));
    series[5].itemStyle.color = t.ink3;    // 6th category: neutral, palette has 5 slots here
    series.push(line("Total", total, t.ink, { lineStyle: { width: 1.5, color: t.ink, type: "dashed" }, z: 5 }));
    chart("c-fdi-regime").setOption(Object.assign(base(t), {
      legend: Object.assign(base(t).legend, { type: "scroll" }),
      grid: { left: 8, right: 16, top: 40, bottom: 28, containLabel: true },
      tooltip: Object.assign(base(t).tooltip, { axisPointer: { type: "shadow" },
        valueFormatter: (v) => (v == null ? "—" : "$" + fmt(v, 0) + "M") }),
      xAxis: timeAxis(t), yAxis: valAxis(t, { scale: false, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, formatter: "${value}M" } }),
      dataZoom: zoom(last(total)[0], [0], 60),
      series,
    }), true);
  }

  function rankedBars(id, t, key, nameOf, include, subId, what) {
    const f = fdi(key);
    const lastYear = f.indicators.reduce((m, i) => (i.d.length && i.d[i.d.length - 1][0] > m ? i.d[i.d.length - 1][0] : m), "");
    const yr = +lastYear.slice(0, 4);
    const rows = f.indicators.filter(include).map((i) => {
      const at = (y) => { const p = i.d.find((q) => +q[0].slice(0, 4) === y); return p ? p[1] : 0; };
      const avg = [0, 1, 2, 3, 4].reduce((a, k) => a + at(yr - k), 0) / 5;
      return { name: nameOf(i), latest: at(yr), avg };
    }).sort((a, b) => b.latest - a.latest).slice(0, 10).reverse();
    document.getElementById(subId).textContent =
      `Annual inflows in US$ millions ${what}: ${yr} compared with the ${yr - 4}–${yr} average.`;
    chart(id).setOption(Object.assign(base(t), {
      grid: { left: 8, right: 24, top: 30, bottom: 8, containLabel: true },
      tooltip: Object.assign(base(t).tooltip, { axisPointer: { type: "shadow" },
        valueFormatter: (v) => (v == null ? "—" : "$" + fmt(v, 0) + "M") }),
      xAxis: { type: "value", axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, formatter: "${value}M" },
        splitLine: { lineStyle: { color: t.grid } } },
      yAxis: { type: "category", data: rows.map((r) => r.name), axisTick: { show: false },
        axisLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.ink2, fontSize: 11.5, width: 190, overflow: "truncate" } },
      series: [
        { name: String(yr), type: "bar", data: rows.map((r) => +r.latest.toFixed(1)), barMaxWidth: 12, barGap: "20%",
          itemStyle: { color: t.s[0], borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: "right", color: t.ink2, fontFamily: t.mono, fontSize: 10.5, formatter: (p) => fmt(p.value, 0) } },
        { name: `${yr - 4}–${yr} average`, type: "bar", data: rows.map((r) => +r.avg.toFixed(1)), barMaxWidth: 12,
          itemStyle: { color: t.s[1], opacity: 0.75, borderRadius: [0, 3, 3, 0] } },
      ],
    }), true);
  }

  function renderFdiCountry(t) {
    rankedBars("c-fdi-country", t, "fdi_a_country",
      (i) => COUNTRY_EN[i.name] || i.name,
      (i) => i.code !== 23093 && !COUNTRY_AGGREGATES.has(i.name),
      "fdi-country-sub", "from the 10 largest sources");
  }
  function renderFdiActivity(t) {
    rankedBars("c-fdi-activity", t, "fdi_a_activity",
      (i) => ACTIVITY_EN[i.code] || i.name,
      (i) => i.code !== 23093,
      "fdi-activity-sub", "by sector of the receiving company (letters are ISIC sector codes)");
  }
  function renderFdiAnnual(t) {
    const d = (fdi("fdi_a_regime").byCode[23093] || []).map(([x, v]) => [x.slice(0, 4), +(v / 1e3).toFixed(3)]);
    chart("c-fdi-annual").setOption(Object.assign(base(t), {
      legend: { show: false },
      tooltip: Object.assign(base(t).tooltip, { axisPointer: { type: "shadow" }, valueFormatter: (v) => "$" + fmt(v, 2) + "B" }),
      xAxis: { type: "category", data: d.map((p) => p[0]), axisTick: { show: false }, axisLine: { lineStyle: { color: t.line } },
        axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, hideOverlap: true } },
      yAxis: valAxis(t, { scale: false, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, formatter: "${value}B" } }),
      series: [{ name: "FDI inflows", type: "bar", data: d.map((p) => p[1]), barMaxWidth: 16,
        itemStyle: { color: t.s[0], borderRadius: [3, 3, 0, 0] } }],
    }), true);
  }
  function renderFdiGam(t) {
    const f = fdi("fdi_q_regime");
    const ins = (f.byCode[90758] || []).map(([d, v]) => [toTs(d), +v.toFixed(1)]);
    const out = (f.byCode[90759] || []).map(([d, v]) => [toTs(d), +v.toFixed(1)]);
    if (!ins.length) return;
    chart("c-fdi-gam").setOption(Object.assign(base(t), {
      tooltip: Object.assign(base(t).tooltip, { axisPointer: { type: "shadow" }, valueFormatter: (v) => "$" + fmt(v, 0) + "M" }),
      xAxis: timeAxis(t), yAxis: valAxis(t, { scale: false, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, formatter: "${value}M" } }),
      dataZoom: zoom(last(ins)[0], [0], 60),
      series: [
        { name: "Inside the GAM", type: "bar", stack: "fz", data: ins, barMaxWidth: 18, itemStyle: { color: t.s[0], borderColor: t.panel, borderWidth: 1 } },
        { name: "Outside the GAM", type: "bar", stack: "fz", data: out, barMaxWidth: 18, itemStyle: { color: t.s[2], borderColor: t.panel, borderWidth: 1 } },
      ],
    }), true);
  }

  // ---------- charts ----------
  // MONEX uses a category axis (one slot per trading session) so weekends and holidays
  // leave no gaps between candles; a time axis would space them by calendar day.
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const sessionLabel = (d) => `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]} \u2019${d.slice(2, 4)}`;
  function renderMonex(t) {
    const m = S.monex.d;
    const days = m.map((r) => r[0]);
    const startTs = rangeStart(toTs(last(days)));
    let startIdx = 0;
    if (startTs != null) { startIdx = days.findIndex((d) => toTs(d) >= startTs); if (startIdx < 0) startIdx = 0; }
    const ohlc = m.map((r) => [r[1], r[4], r[3], r[2]]);   // ECharts: open, close, low, high
    const vwap = m.map((r) => r[5]);
    const vol = m.map((r) => ({ value: r[6] / 1e6,
      itemStyle: { color: r[4] >= r[1] ? t.up : t.down, opacity: 0.55 } }));
    const catAxis = (extra) => Object.assign({
      type: "category", data: days, boundaryGap: true, axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false },
      axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, hideOverlap: true, formatter: sessionLabel },
      axisPointer: { label: { formatter: (p) => niceDate(p.value) } }, splitLine: { show: false },
    }, extra);
    chart("c-monex").setOption(Object.assign(base(t), {
      legend: Object.assign(base(t).legend, { data: ["Session candle", "VWAP", "Volume (US$ M)"] }),
      grid: [
        { left: 8, right: 16, top: 34, height: "56%", containLabel: true },
        { left: 8, right: 16, top: "72%", bottom: 54, containLabel: true },
      ],
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      xAxis: [catAxis({ gridIndex: 0, axisLabel: { show: false } }), catAxis({ gridIndex: 1 })],
      yAxis: [valAxis(t, { gridIndex: 0, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, formatter: "₡{value}" } }),
        valAxis(t, { gridIndex: 1, scale: false, splitNumber: 2, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, formatter: "${value}M" } })],
      dataZoom: zoom(0, [0, 1], 0, true).map((z) => z.type === "slider"
        ? Object.assign(z, { startValue: startIdx, endValue: days.length - 1, start: undefined, textStyle: { color: t.ink3 }, fillerColor: "rgba(127,140,155,0.15)",
            handleStyle: { color: t.panel, borderColor: t.ink3 }, moveHandleStyle: { color: t.line },
            dataBackground: { lineStyle: { color: t.ink3, width: 1 }, areaStyle: { color: t.grid } } })
        : z),
      tooltip: Object.assign(base(t).tooltip, {
        formatter(ps) {
          const i = ps[0].dataIndex, r = m[i];
          return `<b>${niceDate(r[0])}</b><br>open ₡${fmt(r[1])} · high ₡${fmt(r[2])}<br>low ₡${fmt(r[3])} · close ₡${fmt(r[4])}` +
            `<br>VWAP ₡${fmt(r[5])}<br>volume $${fmt(r[6] / 1e6, 1)}M · ${fmt(r[7], 0)} trades`;
        },
      }),
      series: [
        { name: "Session candle", type: "candlestick", data: ohlc, xAxisIndex: 0, yAxisIndex: 0, barMaxWidth: 10,
          itemStyle: { color: t.up, color0: t.down, borderColor: t.up, borderColor0: t.down } },
        line("VWAP", vwap, t.s[3], { xAxisIndex: 0, yAxisIndex: 0, lineStyle: { width: 1.5, color: t.s[3] } }),
        { name: "Volume (US$ M)", type: "bar", data: vol, xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 8, itemStyle: { color: t.s[0] } },
      ],
    }), true);
  }

  function renderPremium(t) {
    const buy = S.ref_buy.d, sell = S.ref_sell.d;
    const mid = new Map(buy.map(([d, v], i) => [d, sell[i] && sell[i][0] === d ? (v + sell[i][1]) / 2 : null]));
    const data = S.monex.d.filter((r) => mid.get(r[0]) != null).map((r) => [toTs(r[0]), +(r[5] - mid.get(r[0])).toFixed(3)]);
    chart("c-premium").setOption(Object.assign(base(t), {
      legend: { show: false },
      xAxis: timeAxis(t), yAxis: valAxis(t, { axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, formatter: "₡{value}" } }),
      dataZoom: zoom(last(data)[0]),
      series: [line("VWAP − ref mid", data, t.s[0], {
        areaStyle: { color: t.s[0], opacity: 0.08 },
        markLine: { silent: true, symbol: "none", data: [{ yAxis: 0 }], lineStyle: { color: t.ink3, type: "dashed", width: 1 }, label: { show: false } },
      })],
    }), true);
  }

  function renderVol(t) {
    const m = S.monex.d, out = [], w = 20, r = [];
    for (let i = 1; i < m.length; i++) {
      r.push(Math.log(m[i][5] / m[i - 1][5]));
      if (r.length >= w) {
        const win = r.slice(-w), mu = win.reduce((a, b) => a + b, 0) / w;
        const sd = Math.sqrt(win.reduce((a, b) => a + (b - mu) ** 2, 0) / (w - 1));
        out.push([toTs(m[i][0]), +(sd * Math.sqrt(252) * 100).toFixed(3)]);
      }
    }
    chart("c-vol").setOption(Object.assign(base(t), {
      legend: { show: false },
      xAxis: timeAxis(t), yAxis: valAxis(t, { min: 0, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, formatter: "{value}%" } }),
      dataZoom: zoom(last(out)[0]),
      series: [line("20d realized vol", out, t.s[1], { areaStyle: { color: t.s[1], opacity: 0.08 } })],
    }), true);
  }

  function renderRates(t) {
    const tpm = pts("tpm"), tbp = pts("tbp"), sofr = pts("sofr");
    chart("c-rates").setOption(Object.assign(base(t), {
      xAxis: timeAxis(t), yAxis: valAxis(t, { axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, formatter: "{value}%" } }),
      dataZoom: zoom(Math.max(last(tpm)[0], last(tbp)[0])),
      series: [
        line("TPM", tpm, t.s[0], { step: "end" }),
        line("TBP", tbp, t.s[1]),
        line("SOFR", sofr, t.s[2]),
      ],
    }), true);
  }

  function curveChart(id, t, tenors, seriesFor) {
    const endTs = Math.max(...tenors.map((k) => { const s = seriesFor(k); return s.length ? toTs(last(s)[0]) : 0; }));
    const snaps = [["Latest", 0], ["3 months ago", 3], ["12 months ago", 12]].map(([name, back], j) => {
      const d = new Date(endTs); d.setUTCMonth(d.getUTCMonth() - back);
      const at = d.getTime();
      const vals = tenors.map((k) => { const p = valueAt(seriesFor(k), at); return p ? p[1] : null; });
      return line(name, vals, t.s[j], { showSymbol: true, symbol: "circle",
        lineStyle: { width: 2, color: t.s[j], type: j === 0 ? "solid" : j === 1 ? "dashed" : "dotted" } });
    });
    chart(id).setOption(Object.assign(base(t), {
      tooltip: Object.assign(base(t).tooltip, { axisPointer: { type: "line", lineStyle: { color: t.ink3 } },
        valueFormatter: (v) => (v == null ? "—" : fmt(v, 2) + "%") }),
      xAxis: { type: "category", data: tenors, axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false },
        axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, interval: 0, hideOverlap: true } },
      yAxis: valAxis(t, { axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, formatter: "{value}%" } }),
      series: snaps,
    }), true);
  }
  function renderTri(t) {
    const c = S.tri.curves[triCcy];
    const tenors = Object.keys(c);
    curveChart("c-tri", t, tenors, (k) => c[k]);
  }
  function renderUst(t) {
    const map = { "6M": "ust_6m", "2Y": "ust_2y", "5Y": "ust_5y", "10Y": "ust_10y", "30Y": "ust_30y" };
    curveChart("c-ust", t, Object.keys(map), (k) => S[map[k]].d);
  }

  function renderInf(t) {
    const cpi = pts("ipc_yoy"), exp = pts("exp_inf_12m");
    chart("c-inf").setOption(Object.assign(base(t), {
      // keep the 2–4% target band in view even when inflation sits far below it
      xAxis: timeAxis(t), yAxis: valAxis(t, { max: (v) => Math.ceil(Math.max(v.max, 4.5)), axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, formatter: "{value}%" } }),
      dataZoom: zoom(last(cpi)[0]),
      series: [
        line("CPI y/y", cpi, t.s[0], {
          markArea: { silent: true, itemStyle: { color: t.band }, data: [[{ yAxis: 2 }, { yAxis: 4 }]] },
          markLine: { silent: true, symbol: "none", data: [{ yAxis: 3 }], lineStyle: { color: t.s[2], type: "dashed", width: 1 },
            label: { formatter: "target 3%", color: t.ink3, fontFamily: t.mono, fontSize: 11, position: "insideStartTop" } },
        }),
        line("Expectations 12m (median)", exp, t.s[1]),
      ],
    }), true);
  }

  function renderImae(t) {
    const d = pts("imae_yoy");
    chart("c-imae").setOption(Object.assign(base(t), {
      legend: { show: false },
      xAxis: timeAxis(t), yAxis: valAxis(t, { scale: false, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, formatter: "{value}%" } }),
      dataZoom: zoom(last(d)[0]),
      series: [{ name: "IMAE y/y", type: "bar", barMaxWidth: 10,
        data: d.map(([x, v]) => ({ value: [x, v], itemStyle: { color: v >= 0 ? t.s[0] : t.down, borderRadius: v >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] } })) }],
    }), true);
  }

  function small(id, t, key, color, fmtAxis, scale = 1) {
    const d = pts(key).map(([x, v]) => [x, v * scale]);
    chart(id).setOption(Object.assign(base(t), {
      legend: { show: false }, grid: { left: 8, right: 12, top: 12, bottom: 24, containLabel: true },
      xAxis: timeAxis(t), yAxis: valAxis(t, { splitNumber: 3, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, formatter: fmtAxis } }),
      tooltip: Object.assign(base(t).tooltip, { axisPointer: { type: "line", lineStyle: { color: t.ink3 } } }),
      dataZoom: zoom(last(d)[0]),
      series: [line(S[key].label, d, color, { areaStyle: { color, opacity: 0.08 } })],
    }), true);
  }

  function renderAll() {
    if (!S) return;
    const t = theme();
    renderTiles();
    renderMonex(t); renderPremium(t); renderVol(t); renderRates(t);
    renderTri(t); renderUst(t); renderInf(t); renderImae(t);
    if (S.fdi_q_regime) { renderFdiRegime(t); renderFdiCountry(t); renderFdiActivity(t); renderFdiAnnual(t); renderFdiGam(t); }
    small("c-rin", t, "rin", t.s[0], "${value}B", 1e-3);
    small("c-eur", t, "eurusd", t.s[4], "{value}");
    small("c-gold", t, "gold", t.s[3], "${value}");
  }

  // ---------- controls ----------
  function setRange(r) {
    range = r;
    try { localStorage.setItem(RANGE_KEY, r); } catch (e) { /* storage unavailable */ }
    document.querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === r)));
    renderAll();
  }
  document.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => setRange(b.dataset.range)));
  document.querySelectorAll("[data-ccy]").forEach((b) => b.addEventListener("click", () => {
    triCcy = b.dataset.ccy;
    document.querySelectorAll("[data-ccy]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderTri(theme());
  }));
  try { const r = localStorage.getItem(RANGE_KEY); if (r) range = r; } catch (e) { /* ignore */ }
  document.querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === range)));

  // Re-theme on OS or explicit toggle changes.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
  new MutationObserver(renderAll).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => Object.values(charts).forEach((c) => c.resize()), 120); });

  // ---------- load ----------
  fetch(DATA_URL, { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((j) => {
      S = j.series;
      const u = new Date(j.updated);
      document.getElementById("updated").textContent =
        `data refreshed ${u.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Costa_Rica" })} CR time`;
      document.getElementById("freshness").textContent =
        `Latest MONEX session: ${niceDate(last(S.monex.d)[0])}. ${S.monex.d.length.toLocaleString()} sessions since ${niceDate(S.monex.d[0][0])}.`;
      renderAll();
    })
    .catch((e) => {
      document.getElementById("tiles").outerHTML =
        `<div class="err">Couldn't load ${DATA_URL} (${e.message}). Run <code>python fetch.py</code> to generate it.</div>`;
    });
})();
