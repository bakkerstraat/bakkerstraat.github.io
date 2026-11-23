"""Weekly BTC adoption pulse + next-ATH model.

Writes data/adoption_pulse.json for adoption-pulse.html.
Run weekly (GitHub Action) or locally:  python scripts/adoption_pulse.py

Data sources (each optional except the Coin Metrics CSV):
  - Coin Metrics community CSV on GitHub: daily PriceUSD, AdrBalCnt, SplyCur (history)
  - Coin Metrics community API: same metrics after the CSV ends
  - Kraken public OHLC: daily price after the Coin Metrics data ends
  - Farside: daily US spot ETF flows (US$m) -> BTC, appended to data/etf_holdings.csv
  - data/manual_anchors.csv: hand-entered price/address points for gaps
"""
from __future__ import annotations

import io
import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "adoption_pulse.json")

ASSUMED_LOW = float(os.environ.get("ASSUMED_LOW", "55000"))  # your stated bottom; observed lows below it take over
CM_CSV = "https://raw.githubusercontent.com/coinmetrics/data/master/csv/btc.csv"
CM_API = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
KRAKEN = "https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440"
FARSIDE = "https://farside.co.uk/bitcoin-etf-flow-all-data/"
UA = {"User-Agent": "Mozilla/5.0 (adoption-pulse; +https://bakkerstraat.github.io)"}

# Search windows for each past cycle: (low window, peak window). Extremes are found inside them.
CYCLES = [
    ("2011-10-01", "2012-01-31", "2013-11-01", "2013-12-31"),
    ("2014-12-01", "2015-09-30", "2017-12-01", "2017-12-31"),
    ("2018-11-15", "2019-02-28", "2021-10-01", "2021-11-30"),
    ("2022-11-01", "2022-12-31", "2025-09-01", "2025-10-31"),
]
CURRENT_CYCLE_START = "2025-01-01"  # current ATH is searched from here

notes: list[str] = []


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


# ---------------------------------------------------------------- data loading
def load_cm_csv(path_or_url: str = CM_CSV) -> pd.DataFrame:
    local = os.environ.get("CM_CSV_PATH")
    if local and os.path.exists(local):
        raw = pd.read_csv(local, usecols=["time", "PriceUSD", "AdrBalCnt", "SplyCur"])
    else:
        r = requests.get(path_or_url, timeout=120, headers=UA)
        r.raise_for_status()
        raw = pd.read_csv(io.StringIO(r.text), usecols=["time", "PriceUSD", "AdrBalCnt", "SplyCur"])
    raw["time"] = pd.to_datetime(raw["time"])
    return raw.set_index("time").rename(columns={"PriceUSD": "price", "AdrBalCnt": "addresses", "SplyCur": "supply"})


def extend_cm_api(df: pd.DataFrame) -> pd.DataFrame:
    start = df.dropna(subset=["price"]).index.max() + pd.Timedelta(days=1)
    try:
        r = requests.get(CM_API, timeout=60, headers=UA, params={
            "assets": "btc", "metrics": "PriceUSD,AdrBalCnt,SplyCur", "frequency": "1d",
            "start_time": start.strftime("%Y-%m-%d"), "page_size": 10000})
        r.raise_for_status()
        rows = r.json().get("data", [])
        if not rows:
            return df
        new = pd.DataFrame(rows)
        new["time"] = pd.to_datetime(new["time"]).dt.tz_localize(None).dt.normalize()
        new = new.set_index("time").rename(columns={"PriceUSD": "price", "AdrBalCnt": "addresses", "SplyCur": "supply"})
        new = new[[c for c in ["price", "addresses", "supply"] if c in new]].apply(pd.to_numeric, errors="coerce")
        log(f"coin metrics api: +{len(new)} days")
        return df.combine_first(new)
    except Exception as e:  # noqa: BLE001
        notes.append(f"Coin Metrics API unavailable ({type(e).__name__}); recent data from fallbacks.")
        return df


def extend_kraken(df: pd.DataFrame) -> pd.DataFrame:
    try:
        r = requests.get(KRAKEN, timeout=30, headers=UA)
        r.raise_for_status()
        res = r.json()["result"]
        key = [k for k in res if k != "last"][0]
        k = pd.DataFrame(res[key], columns=["t", "o", "h", "l", "c", "vw", "v", "n"])
        k["time"] = pd.to_datetime(k["t"], unit="s").dt.normalize()
        k = k.set_index("time")[["c"]].astype(float).rename(columns={"c": "price"})
        last = df.dropna(subset=["price"]).index.max()
        k = k[k.index > last]
        log(f"kraken: +{len(k)} days")
        return df.combine_first(k)
    except Exception as e:  # noqa: BLE001
        notes.append(f"Kraken unavailable ({type(e).__name__}).")
        return df


def apply_manual(df: pd.DataFrame) -> pd.DataFrame:
    p = os.path.join(DATA, "manual_anchors.csv")
    if not os.path.exists(p):
        return df
    m = pd.read_csv(p, parse_dates=["date"]).set_index("date")
    m = m.rename(columns={"price_usd": "price"})[["price", "addresses"]]
    last_p = df.dropna(subset=["price"]).index.max()
    last_a = df.dropna(subset=["addresses"]).index.max()
    m.loc[m.index <= last_p, "price"] = np.nan  # never override real data
    m.loc[m.index <= last_a, "addresses"] = np.nan
    m = m.dropna(how="all")
    if len(m):
        notes.append(f"{len(m)} hand-entered anchor points used after the automatic data ends (interpolated between).")
    return df.combine_first(m)


def update_etf_from_farside(price: pd.Series) -> pd.DataFrame:
    path = os.path.join(DATA, "etf_holdings.csv")
    etf = pd.read_csv(path, parse_dates=["date"])
    try:
        r = requests.get(FARSIDE, timeout=60, headers=UA)
        r.raise_for_status()
        tables = pd.read_html(io.StringIO(r.text))
        t = max(tables, key=len)
        t.columns = [str(c[-1] if isinstance(c, tuple) else c) for c in t.columns]
        t = t.rename(columns={t.columns[0]: "date"})
        t["date"] = pd.to_datetime(t["date"], errors="coerce", dayfirst=True)
        t = t.dropna(subset=["date"])
        tot = [c for c in t.columns if c.lower().startswith("total")][0]
        flow = pd.to_numeric(t[tot].astype(str).str.replace(r"[(),]", lambda m: "-" if m.group() == "(" else "", regex=True),
                             errors="coerce").fillna(0) * 1e6
        t = t.assign(flow_usd=flow).set_index("date").sort_index()
        last = etf["date"].max()
        t = t[t.index > last]
        if len(t):
            px = price.reindex(t.index, method="ffill")
            btc = (t["flow_usd"] / px).cumsum() + etf["btc_total"].iloc[-1]
            add = pd.DataFrame({"date": btc.index, "btc_total": btc.round().values, "source": "Farside flows / daily price"})
            etf = pd.concat([etf, add], ignore_index=True)
            etf.to_csv(path, index=False)
            log(f"farside: +{len(add)} days")
    except Exception as e:  # noqa: BLE001
        notes.append(f"Farside ETF flows unavailable ({type(e).__name__}); ETF series uses data/etf_holdings.csv as is.")
    return etf


# ---------------------------------------------------------------- analysis
def decyear(ts: pd.Timestamp) -> float:
    start = pd.Timestamp(ts.year, 1, 1)
    return ts.year + (ts - start).days / (366 if ts.is_leap_year else 365)


def cycle_table(d: pd.DataFrame) -> list[dict]:
    out = []
    for lo_a, lo_b, pk_a, pk_b in CYCLES:
        lo = d.loc[lo_a:lo_b, "price"].idxmin()
        pk = d.loc[pk_a:pk_b, "price"].idxmax()
        a_lo, a_pk = d.loc[lo, "addresses"], d.loc[pk, "addresses"]
        mult = d.loc[pk, "price"] / d.loc[lo, "price"]
        aratio = a_pk / a_lo
        out.append({
            "label": f"{lo.year}-{str(pk.year)[2:]}",
            "low_date": lo.strftime("%Y-%m-%d"), "low": round(float(d.loc[lo, "price"]), 2),
            "peak_date": pk.strftime("%Y-%m-%d"), "peak": round(float(d.loc[pk, "price"]), 2),
            "multiple": round(float(mult), 2),
            "addr_low": int(a_lo), "addr_peak": int(a_pk), "addr_ratio": round(float(aratio), 3),
            "k": round(math.log(mult) / math.log(aratio), 2),
            "months": round((pk - lo).days / 30.44, 1),
        })
    return out


def cycle_decay_multiples(m: np.ndarray) -> dict:
    L = np.log(m)
    r = L[1:] / L[:-1]
    s, i = np.polyfit(np.arange(1, len(L)), np.log(L[1:]), 1)
    return {
        "log-decay, mean ratio": float(np.exp(L[-1] * r.mean())),
        "log-decay, last 2 ratios": float(np.exp(L[-1] * r[-2:].mean())),
        "log-decay, last ratio": float(np.exp(L[-1] * r[-1])),
        "log-log trend (ex-2011)": float(np.exp(np.exp(i + s * len(L)))),
        "raw multiple shrink": float(m[-1] / (m[-2] / m[-1])),
    }


def zscore(s: pd.Series, win: int, minp: int) -> pd.Series:
    mu = s.rolling(win, min_periods=minp).mean()
    sd = s.rolling(win, min_periods=minp).std()
    return (s - mu) / sd


def main() -> None:
    d = load_cm_csv()
    d = extend_cm_api(d)
    d = extend_kraken(d)
    d = apply_manual(d)
    d = d.sort_index()
    d = d.reindex(pd.date_range(d.index.min(), d.index.max(), freq="D"))
    real_end = {"price": str(d.dropna(subset=["price"]).index.max().date())}
    d[["price", "addresses"]] = d[["price", "addresses"]].interpolate(method="time", limit_area="inside")
    d = d[d["price"] > 0]
    a_last = d["addresses"].last_valid_index()
    if a_last < d.index.max():
        notes.append(f"Address data ends {a_last.date()}; address growth and breadth z are carried forward from then.")
        d["addresses"] = d["addresses"].ffill()
    # supply: fill forward with the issuance schedule if missing
    if d["supply"].isna().any():
        last = d["supply"].last_valid_index()
        for t in d.index[d.index > last]:
            prev = d.index[d.index.get_loc(t) - 1]
            d.loc[t, "supply"] = d.loc[prev, "supply"] + (450 if t < pd.Timestamp("2028-04-15") else 225) * (t - prev).days

    etf = update_etf_from_farside(d["price"]).set_index("date")["btc_total"].astype(float)
    etf = etf[~etf.index.duplicated(keep="last")].sort_index()

    # ---- weekly frame
    w = d.resample("W-SUN").last()
    w["etf"] = etf.reindex(etf.index.union(w.index)).interpolate(method="time", limit_area="inside").reindex(w.index).ffill(limit=3)
    w = w.dropna(subset=["price"])
    w["breadth"] = np.log(w["addresses"]).diff(13) * 4  # annualised 13-week log growth
    w["breadth_z"] = zscore(w["breadth"], 156, 52)
    stale = w.index > a_last  # don't let the flat carried-forward count read as zero growth
    w.loc[stale, ["breadth", "breadth_z"]] = np.nan
    w[["breadth", "breadth_z"]] = w[["breadth", "breadth_z"]].ffill()
    mined4 = w["supply"].diff(4)
    w["absorption"] = w["etf"].diff(4) / mined4
    # Fixed scale, not a z-score (ETF history is too short): 0 = ETFs absorb exactly the new supply,
    # +1 = twice the new supply, -1 = net ETF selling equal to issuance. Clipped to +/-3.
    w["absorption_z"] = (w["absorption"] - 1).clip(-3, 3)
    w["pulse"] = w[["breadth_z", "absorption_z"]].mean(axis=1, skipna=True)

    # ---- cycles and relationships
    cyc = cycle_table(d)
    mults = np.array([c["multiple"] for c in cyc])
    lnM = np.log(mults)
    lnA = np.log([c["addr_ratio"] for c in cyc])
    k_last2 = float(np.mean([c["k"] for c in cyc[-2:]]))
    ks = [c["k"] for c in cyc]
    k_trend = np.polyfit(np.arange(len(ks)), ks, 1)
    k_next = float(max(k_last2, np.polyval(k_trend, len(ks)))) if np.all(np.diff(ks) > 0) else k_last2
    med_months = float(np.median([c["months"] for c in cyc]))

    # forward-return relationship, non-overlapping 26-week blocks (avoid autocorrelation inflation)
    fwd = np.log(w["price"].shift(-26) / w["price"])
    blk = pd.DataFrame({"z": w["breadth_z"], "f": fwd}).dropna().iloc[::26]
    from scipy.stats import spearmanr
    rho, pval = spearmanr(blk["z"], blk["f"]) if len(blk) > 8 else (float("nan"), float("nan"))

    # ---- current cycle
    cur = d.loc[CURRENT_CYCLE_START:]
    ath_date = cur["price"].idxmax()
    ath = float(cur.loc[ath_date, "price"])
    post = d.loc[ath_date:]
    obs_low_date = post["price"].idxmin()
    obs_low = float(post.loc[obs_low_date, "price"])
    decay = cycle_decay_multiples(mults)

    def model_at(t: pd.Timestamp) -> dict:
        """Model using only data up to week t."""
        hist = d.loc[ath_date:t, "price"]
        lo_date = hist.idxmin()
        lo_obs = float(hist.min())
        base = min(lo_obs, ASSUMED_LOW)
        T = med_months / 12
        g = float(w.loc[:t, "breadth"].tail(26).mean())  # smoothed annual log growth of addresses
        adopt_mult = math.exp(k_next * g * T)
        mlist = list(decay.values()) + [adopt_mult]
        lo_m, hi_m = min(mlist), max(mlist)
        z = float(w.loc[:t, "pulse"].dropna().iloc[-1]) if w.loc[:t, "pulse"].notna().any() else 0.0
        q = 1 / (1 + math.exp(-z))
        exp_m = math.exp(math.log(lo_m) + q * (math.log(hi_m) - math.log(lo_m)))
        return {"base": base, "low_obs": lo_obs, "low_date": lo_date, "g": g, "adopt_mult": adopt_mult,
                "lo_m": lo_m, "hi_m": hi_m, "z": z, "q": q, "exp_m": exp_m, "cycle_med_m": float(np.median(list(decay.values())))}

    now = w.index[-1]
    m = model_at(now)
    low_anchor = m["low_date"] if m["low_obs"] <= ASSUMED_LOW else max(m["low_date"], pd.Timestamp(obs_low_date))
    peak_date = low_anchor + pd.Timedelta(days=med_months * 30.44)
    f = np.linspace(0, 1, 40)
    t_path = [decyear(low_anchor + (peak_date - low_anchor) * x) for x in f]
    path = lambda mult: [round(m["base"] * mult ** x) for x in f]  # noqa: E731

    hist_rows = []
    for t in w.loc[ath_date + pd.Timedelta(days=7):].index:
        mm = model_at(t)
        hist_rows.append({"t": round(decyear(t), 4), "date": t.strftime("%Y-%m-%d"), "expected": round(mm["base"] * mm["exp_m"]),
                          "lo": round(mm["base"] * mm["lo_m"]), "hi": round(mm["base"] * mm["hi_m"]),
                          "adoption": round(mm["base"] * mm["adopt_mult"]), "pulse": round(mm["z"], 2)})

    weekly = []
    for t, r in w.iterrows():
        if t < pd.Timestamp("2010-09-01"):
            continue
        weekly.append({
            "t": round(decyear(t), 4), "date": t.strftime("%Y-%m-%d"), "price": round(float(r["price"]), 2),
            "addr": None if pd.isna(r["addresses"]) else int(r["addresses"]),
            "breadth": None if pd.isna(r["breadth"]) else round(float(r["breadth"]) * 100, 2),
            "breadth_z": None if pd.isna(r["breadth_z"]) else round(float(r["breadth_z"]), 2),
            "etf": None if pd.isna(r["etf"]) else int(r["etf"]),
            "absorption": None if pd.isna(r["absorption"]) else round(float(r["absorption"]), 2),
            "absorption_z": None if pd.isna(r["absorption_z"]) else round(float(r["absorption_z"]), 2),
            "pulse": None if pd.isna(r["pulse"]) else round(float(r["pulse"]), 2),
        })

    last = w.iloc[-1]
    out = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "data_through": now.strftime("%Y-%m-%d"),
        "real_data_through": real_end,
        "notes": notes,
        "assumed_low": ASSUMED_LOW,
        "current": {
            "ath": round(ath), "ath_date": ath_date.strftime("%Y-%m-%d"),
            "observed_low": round(obs_low), "observed_low_date": obs_low_date.strftime("%Y-%m-%d"),
            "base_low": round(m["base"]), "price": round(float(last["price"])),
            "addresses": int(last["addresses"]), "etf_btc": None if pd.isna(last["etf"]) else int(last["etf"]),
            "breadth_pct": round(float(last["breadth"]) * 100, 2), "breadth_z": round(float(last["breadth_z"]), 2),
            "absorption": None if pd.isna(last["absorption"]) else round(float(last["absorption"]), 2),
            "pulse": round(m["z"], 2), "pulse_quantile": round(m["q"], 3),
        },
        "model": {
            "k_by_cycle": ks, "k_used": round(k_next, 2), "median_months_low_to_peak": round(med_months, 1),
            "cycle_decay_multiples": {kk: round(v, 2) for kk, v in decay.items()},
            "adoption_multiple": round(m["adopt_mult"], 2), "addr_growth_used_pct": round(m["g"] * 100, 2),
            "band_multiple": [round(m["lo_m"], 2), round(m["hi_m"], 2)],
            "expected_multiple": round(m["exp_m"], 2),
            "expected_ath": round(m["base"] * m["exp_m"]), "band_ath": [round(m["base"] * m["lo_m"]), round(m["base"] * m["hi_m"])],
            "cycle_only_ath": round(m["base"] * m["cycle_med_m"]),
            "adoption_ath": round(m["base"] * m["adopt_mult"]),
            "peak_date": peak_date.strftime("%Y-%m-%d"), "peak_t": round(decyear(peak_date), 3),
            "fan": {"t": [round(x, 4) for x in t_path], "lo": path(m["lo_m"]), "hi": path(m["hi_m"]),
                    "mid": path(m["exp_m"])},
            "fwd_corr": {"spearman_rho": None if math.isnan(rho) else round(float(rho), 3),
                         "p": None if math.isnan(pval) else round(float(pval), 3), "n": int(len(blk)),
                         "desc": "breadth z vs next-26-week log return, non-overlapping blocks"},
        },
        "cycles": cyc,
        "weekly": weekly,
        "ath_history": hist_rows,
    }
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    log(json.dumps({k: out[k] for k in ["data_through", "current", "notes"]}, indent=1))
    log(json.dumps({k: v for k, v in out["model"].items() if k != "fan"}, indent=1))
    log(json.dumps(cyc, indent=1))


if __name__ == "__main__":
    main()
