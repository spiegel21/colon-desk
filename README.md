# Colón Desk (BCCR dashboard)

**▶ Live dashboard: https://spiegel21.github.io/colon-desk/** — refreshed weekdays at 14:05 Costa Rica time.

Static dashboard of USD/CRC (MONEX), Costa Rican rates, inflation, activity, foreign direct investment and reserves,
built from the Banco Central de Costa Rica **SDDE** API
([estándar](https://gee.bccr.fi.cr/indicadoreseconomicos/Documentos/DocumentosMetodologiasNotasTecnicas/Estandar_API_SDDE.pdf)).

```
fetch.py                       # stdlib-only: pulls every series -> site/data/series.json
site/index.html, app.js, style.css   # the dashboard (ECharts from cdnjs), no build step
.github/workflows/refresh.yml  # weekday cron: fetch + deploy to GitHub Pages
```

## Run locally

```bash
echo 'BCCR_TOKEN=<token from Mi Perfil → Generar token>' > .env   # gitignored
python3 fetch.py
python3 -m http.server -d site 8000   # open http://localhost:8000
```

## API notes (learned the hard way)

- Base: `https://apim.bccr.fi.cr/SDDE/api/Bccr.GE.SDDE.Publico.Indicadores.API`; header
  `Authorization: Bearer <token>`. Path casing (`GE`/`Ge`, `SDDE`/`sddE`) does not matter.
- **CORS is locked to `sdd.bccr.fi.cr`** — a browser page on any other origin cannot call the
  API. That is why data is fetched server-side (Action) and served as static JSON.
- The WAF returns an nginx **403 for the `python-requests` User-Agent**; `fetch.py` sends its own.
- Full history in one call is fine (~1 s for 27 years of daily data); `cuadro/{n}/series`
  returns every indicator of a table at once (MONEX table 219 ≈ 7 MB).
- Daily series include weekends (carried forward) — `fetch.py` drops Sat/Sun; MONEX keeps only
  sessions with `Total calces > 0`.
- Catalogs: `indicadoresEconomicos/descargar` and `cuadro/descargar` return .xlsx lists
  (≈12.7k indicators, ≈890 tables).
- On a Mac with TLS inspection, Python may not trust the keychain root: export it and set
  `SSL_CERT_FILE` (not needed in GitHub Actions).

## Hosting

GitHub Pages, deployed by `.github/workflows/refresh.yml` on weekdays at 14:05
Costa Rica time (20:05 UTC), on every push to `main`, and on demand (`gh workflow run refresh.yml`).
Only public BCCR data is published; the token lives in the repo secret `BCCR_TOKEN` and never
reaches the page. A keepalive empty commit every ~45 days stops GitHub from pausing the
schedule (it disables crons in repos idle for 60 days).
