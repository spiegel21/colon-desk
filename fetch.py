"""Fetch BCCR SDDE series and write compact JSON for the static dashboard.

Token: env var BCCR_TOKEN, or a `.env` file next to this script (BCCR_TOKEN=...).
Output: site/data/series.json  ->  {"updated": iso, "series": {key: {meta..., "d": [[date, value], ...]}}}

Stdlib only so the GitHub Action needs no `pip install`.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://apim.bccr.fi.cr/SDDE/api/Bccr.GE.SDDE.Publico.Indicadores.API"
ROOT = Path(__file__).resolve().parent
OUT = ROOT / "site" / "data" / "series.json"

# key -> (indicator code, label, unit, start date)
INDICATORS: dict[str, tuple[int, str, str, str]] = {
    # FX reference
    "ref_buy": (317, "Tipo de cambio de referencia — compra", "CRC", "2000/01/01"),
    "ref_sell": (318, "Tipo de cambio de referencia — venta", "CRC", "2000/01/01"),
    # Rates
    "tpm": (3541, "Tasa de política monetaria", "%", "2011/01/01"),
    "tbp": (423, "Tasa básica pasiva", "%", "2000/01/01"),
    "sofr": (90656, "SOFR overnight", "%", "2018/01/01"),
    "ust_6m": (3035, "Letra del Tesoro EE.UU. 6 meses", "%", "2005/01/01"),
    "ust_2y": (3040, "Nota del Tesoro EE.UU. 2 años", "%", "2005/01/01"),
    "ust_5y": (3041, "Nota del Tesoro EE.UU. 5 años", "%", "2005/01/01"),
    "ust_10y": (3039, "Nota del Tesoro EE.UU. 10 años", "%", "2005/01/01"),
    "ust_30y": (3042, "Bono del Tesoro EE.UU. 30 años", "%", "2005/01/01"),
    # Prices
    "ipc_yoy": (89638, "IPC — variación interanual", "%", "2000/01/01"),
    "ipc_mom": (89636, "IPC — variación mensual", "%", "2000/01/01"),
    "exp_inf_12m": (3809, "Expectativa de inflación a 12 meses (mediana)", "%", "2006/01/01"),
    # Activity & external
    "imae": (94931, "IMAE — serie original (2022=100)", "índice", "2000/01/01"),
    "imae_tc": (94995, "IMAE — tendencia ciclo (2022=100)", "índice", "2000/01/01"),
    "imae_yoy": (95262, "IMAE tendencia ciclo — variación interanual", "%", "2000/01/01"),
    "rin": (304, "Reservas internacionales netas", "USD mill.", "2000/01/01"),
    "eurusd": (333, "Euro (USD por EUR)", "USD", "2005/01/01"),
    "gold": (1979, "Oro (USD por onza troy)", "USD", "2005/01/01"),
}

# Whole tables (cuadros): key -> (cuadro code, start date)
CUADROS: dict[str, tuple[int, str]] = {
    "monex": (219, "2006/01/01"),
    "tri": (432, "2018/01/01"),
}

# Foreign direct investment (FDI) tables, stored generically as {indicators: [{code, name, d}]}.
# key -> (cuadro code, start date, unit)
FDI_TABLES: dict[str, tuple[int, str, str]] = {
    "fdi_q_regime": (368, "2000/01/01", "USD mill."),    # quarterly, by special regime
    "fdi_a_regime": (303, "1997/01/01", "USD mill."),    # annual, by special regime
    "fdi_a_activity": (304, "1997/01/01", "USD mill."),  # annual, by economic activity
    "fdi_a_country": (305, "1997/01/01", "USD mill."),   # annual, by country of origin
}

MONEX_FIELDS = {  # indicator code -> short key (rates in CRC, amounts in USD)
    "3434": "open", "3435": "close", "3436": "low", "3437": "high",
    "3438": "avg", "3439": "vwap", "3441": "trades", "3446": "volume",
}


def token() -> str:
    tok = os.environ.get("BCCR_TOKEN", "").strip()
    env = ROOT / ".env"
    if not tok and env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("BCCR_TOKEN="):
                tok = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not tok:
        sys.exit("BCCR_TOKEN not set (env var or .env)")
    return tok


def get(path: str, params: dict[str, str], tok: str, retries: int = 4) -> dict:
    url = f"{BASE}/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {tok}",
        "Accept": "application/json",
        # The API's WAF returns an nginx 403 for the `python-requests` UA; keep a custom one.
        "User-Agent": "bccr-dashboard/1.0",
    })
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                body = json.load(r)
            if not body.get("estado", False):
                raise RuntimeError(f"{path}: {body.get('mensaje')}")
            return body
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                sys.exit(f"{path}: HTTP {e.code} — token invalid/expired or subscription inactive")
            if attempt == retries - 1:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == retries - 1:
                raise
        time.sleep(2 ** attempt * 2)
    raise AssertionError("unreachable")


def window(start: str) -> dict[str, str]:
    return {"fechaInicio": start, "fechaFin": dt.date.today().strftime("%Y/%m/%d"), "idioma": "ES"}


def pairs(series: list[dict], drop_weekends: bool = False) -> list[list]:
    out = []
    for p in series:
        v = p.get("valorDatoPorPeriodo")
        if v is None:
            continue
        d = p["fecha"][:10]
        if drop_weekends and dt.date.fromisoformat(d).weekday() >= 5:
            continue
        out.append([d, round(float(v), 6)])
    return out


def main() -> None:
    tok = token()
    result: dict[str, dict] = {}

    for key, (code, label, unit, start) in INDICATORS.items():
        meta = get(f"indicadoresEconomicos/{code}/metadata", {"idioma": "ES"}, tok)["datos"][0]
        body = get(f"indicadoresEconomicos/{code}/series", window(start), tok)
        per = meta.get("periodicidad", "")
        d = pairs(body["datos"][0]["series"], drop_weekends=(per == "Diaria"))
        result[key] = {"code": code, "label": label, "unit": unit, "freq": per,
                       "lastPublished": meta.get("ultimaPublicacion"), "d": d}
        print(f"{key:12s} {code:>6} {per:9s} {len(d):6d} pts  last={d[-1] if d else None}")

    # MONEX: one row per *trading* session (days with trades > 0).
    code, start = CUADROS["monex"]
    tab = get(f"cuadro/{code}/series", window(start), tok)["datos"][0]
    cols: dict[str, dict[str, float]] = {}
    for ind in tab["indicadores"]:
        k = MONEX_FIELDS.get(str(ind["codigoIndicador"]))
        if k:
            cols[k] = {p["fecha"][:10]: p["valorDatoPorPeriodo"] for p in ind["series"]}
    dates = sorted(d for d, n in cols["trades"].items() if n)
    rows = [[d] + [cols[k].get(d) for k in ("open", "high", "low", "close", "vwap", "volume", "trades")]
            for d in dates]
    result["monex"] = {"code": code, "label": tab["titulo"], "unit": "CRC / USD",
                       "freq": "Diaria", "cols": ["date", "open", "high", "low", "close", "vwap", "volume", "trades"],
                       "d": rows}
    print(f"{'monex':12s} {code:>6} sessions={len(rows)} last={rows[-1]}")

    # TRI: interbank reference curve, CRC and USD tenors.
    code, start = CUADROS["tri"]
    tab = get(f"cuadro/{code}/series", window(start), tok)["datos"][0]
    curves: dict[str, dict[str, list]] = {"CRC": {}, "USD": {}}
    seen: set[str] = set()
    for ind in tab["indicadores"]:
        tenor = ind["nombreIndicador"].strip()
        ccy = "USD" if tenor in seen else "CRC"  # table lists CRC tenors first, then USD
        seen.add(tenor)
        curves[ccy][tenor] = pairs(ind["series"], drop_weekends=True)
    result["tri"] = {"code": code, "label": tab["titulo"], "unit": "%", "freq": "Diaria", "curves": curves}
    print(f"{'tri':12s} {code:>6} CRC={list(curves['CRC'])} USD={list(curves['USD'])}")

    for key, (code, start, unit) in FDI_TABLES.items():
        tab = get(f"cuadro/{code}/series", window(start), tok)["datos"][0]
        inds = [{"code": int(ind["codigoIndicador"]), "name": ind["nombreIndicador"].strip(),
                 "d": pairs(ind["series"])} for ind in tab["indicadores"]]
        result[key] = {"code": code, "label": tab["titulo"], "unit": unit,
                       "freq": tab.get("periodicidad", ""), "indicators": inds}
        last = max((i["d"][-1][0] for i in inds if i["d"]), default=None)
        print(f"{key:15s} {code:>6} indicators={len(inds)} last={last}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {"updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "series": result}
    OUT.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
