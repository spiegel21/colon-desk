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

  function rangeStart(endTs) {
    const d = new Date(endTs);
    const m = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "3Y": 36, "5Y": 60 }[range];
    if (!m) return null;
    d.setUTCMonth(d.getUTCMonth() - m);
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

  function zoom(endTs, xIdx = [0]) {
    const start = rangeStart(endTs);
    return [{ type: "inside", xAxisIndex: xIdx, filterMode: "filter",
      startValue: start == null ? undefined : start, endValue: endTs,
      start: start == null ? 0 : undefined }];
  }

  function chart(id) {
    if (!charts[id]) charts[id] = echarts.init(document.getElementById(id), null, { renderer: "canvas" });
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
    document.getElementById("tiles").innerHTML = [
      tile({ k: "MONEX VWAP", v: `₡${fmt(L[5])}`, d: delta(L[5], P[5], 2, "", true), sparkSeries: vw,
        asof: niceDate(L[0]), title: "BCCR indicator 3439 — promedio ponderado" }),
      tile({ k: "BCCR ref sell / buy", v: `₡${fmt(rs[1])}`, d: `<span>buy ₡${fmt(rb[1])} · spread ₡${fmt(rs[1] - rb[1])}</span>`,
        sparkSeries: S.ref_sell.d, asof: niceDate(rs[0]), title: "BCCR indicators 318 / 317" }),
      tile({ k: "MONEX volume", v: `$${fmt(L[6] / 1e6, 1)}M`, d: `<span>20d avg $${fmt(avg20, 1)}M · ${fmt(L[7], 0)} trades</span>`,
        sparkSeries: vol, asof: niceDate(L[0]), title: "BCCR indicator 3446 — monto negociado" }),
      simple("tpm", "TPM", 2, " pp", { suffix: "%" }),
      simple("tbp", "TBP", 2, " pp", { suffix: "%" }),
      simple("ipc_yoy", "CPI y/y", 2, " pp", { suffix: "%" }),
      simple("exp_inf_12m", "Exp. inflation 12m", 2, " pp", { suffix: "%" }),
      simple("imae_yoy", "IMAE y/y", 2, " pp", { suffix: "%" }),
      simple("rin", "Net reserves", 2, "", { prefix: "$", suffix: "B", scale: 1e-3 }),
      simple("sofr", "SOFR", 2, " pp", { suffix: "%" }),
    ].join("");
  }

  // ---------- charts ----------
  function renderMonex(t) {
    const m = S.monex.d;
    const ts = m.map((r) => toTs(r[0]));
    const endTs = last(ts);
    const ohlc = m.map((r, i) => [ts[i], r[1], r[4], r[3], r[2]]);   // ECharts: open, close, low, high
    const vwap = m.map((r, i) => [ts[i], r[5]]);
    const vol = m.map((r, i) => ({ value: [ts[i], r[6] / 1e6],
      itemStyle: { color: r[4] >= r[1] ? t.up : t.down, opacity: 0.55 } }));
    chart("c-monex").setOption(Object.assign(base(t), {
      legend: Object.assign(base(t).legend, { data: ["OHLC", "VWAP", "Volume (USD M)"] }),
      grid: [
        { left: 8, right: 16, top: 34, height: "62%", containLabel: true },
        { left: 8, right: 16, top: "78%", bottom: 24, containLabel: true },
      ],
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      xAxis: [timeAxis(t, { gridIndex: 0, axisLabel: { show: false } }), timeAxis(t, { gridIndex: 1 })],
      yAxis: [valAxis(t, { gridIndex: 0, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, formatter: "₡{value}" } }),
        valAxis(t, { gridIndex: 1, scale: false, splitNumber: 2, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, formatter: "${value}M" } })],
      dataZoom: zoom(endTs, [0, 1]),
      tooltip: Object.assign(base(t).tooltip, {
        formatter(ps) {
          const i = ps[0].dataIndex, r = m[i];
          return `<b>${niceDate(r[0])}</b><br>open ₡${fmt(r[1])} · high ₡${fmt(r[2])}<br>low ₡${fmt(r[3])} · close ₡${fmt(r[4])}` +
            `<br>VWAP ₡${fmt(r[5])}<br>volume $${fmt(r[6] / 1e6, 1)}M · ${fmt(r[7], 0)} trades`;
        },
      }),
      series: [
        { name: "OHLC", type: "candlestick", data: ohlc, xAxisIndex: 0, yAxisIndex: 0, barMaxWidth: 10,
          itemStyle: { color: t.up, color0: t.down, borderColor: t.up, borderColor0: t.down } },
        line("VWAP", vwap, t.s[3], { xAxisIndex: 0, yAxisIndex: 0, lineStyle: { width: 1.5, color: t.s[3] } }),
        { name: "Volume (USD M)", type: "bar", data: vol, xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 8, itemStyle: { color: t.s[0] } },
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
