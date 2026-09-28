"""Learning loop: every executed cycle becomes history.

Ingest a finished cycle (from Live Ops or an uploaded CSV). The data is checked
against the CSV contract, the twin is recalibrated, and the result shows what it
learned: parameter shifts, envelope growth, and prediction error before vs after.
"""
import csv
import io

import numpy as np

from . import field, params as P, twin
from .history import DAYS, EXTRA
from .physics import simulate

CYCLE_COLS = ["well_id", "cycle", *P.DECISIONS, "cycle_days", "cum_oil_bbl", "cum_kwh", "float_days", "rod_failure", "failure_day"]
DAILY_COLS = ["well_id", "cycle", "day", "oil_bpd", "spm", "kwh", "min_load_kn"]
RANGES = {"steam_t": (50, 5000), "inj_p_bar": (10, 200), "soak_d": (0, 30), "stroke_m": (0.5, 6), "spm_max": (0.5, 15),
          "cycle_days": (1, 1000), "cum_oil_bbl": (0, 1e6), "day": (0, 1000), "oil_bpd": (0, 2000), "spm": (0, 15),
          "kwh": (0, 1e5), "min_load_kn": (-50, 500)}
_invalidate = []  # callbacks registered by the API to drop its own caches


def parse_csv(text):
    return [{k.strip(): v.strip() for k, v in r.items()} for r in csv.DictReader(io.StringIO(text.strip()))]


def validate(cycles, daily):
    """Data-quality report against the CSV contract. Returns (clean_cycles, clean_daily, issues)."""
    issues = []
    for name, rows, cols in (("cycles", cycles, CYCLE_COLS), ("daily", daily, DAILY_COLS)):
        missing = [c for c in cols if rows and c not in rows[0]]
        if not rows:
            issues.append(dict(level="error", file=name, msg="no rows"))
        if missing:
            issues.append(dict(level="error", file=name, msg=f"missing columns: {', '.join(missing)}"))
    if any(i["level"] == "error" for i in issues):
        return [], [], issues

    known = set(twin.field()["twins"])
    have = {(c["well_id"], int(c["cycle"])) for c in twin.field()["twins"].get(cycles[0]["well_id"], {}).get("cycles", [])}

    def num(row, cols, file, i):
        out = dict(row)
        for c in cols:
            if c in ("well_id", "failure_day"):
                continue
            try:
                out[c] = float(row[c])
            except (TypeError, ValueError):
                issues.append(dict(level="error", file=file, msg=f"row {i + 1}: {c}={row[c]!r} is not a number"))
                return None
            lo, hi = RANGES.get(c, (-np.inf, np.inf))
            if not lo <= out[c] <= hi:
                issues.append(dict(level="error", file=file, msg=f"row {i + 1}: {c}={out[c]:g} outside plausible range {lo:g}–{hi:g}"))
                return None
        return out

    cyc = [o for i, r in enumerate(cycles) if (o := num(r, CYCLE_COLS, "cycles", i))]
    day = [o for i, r in enumerate(daily) if (o := num(r, DAILY_COLS, "daily", i))]
    for c in cyc:
        if c["well_id"] not in known:
            issues.append(dict(level="error", file="cycles", msg=f"{c['well_id']}: unknown well (needs ≥3 cycles of history to calibrate)"))
        if (c["well_id"], int(c["cycle"])) in have:
            issues.append(dict(level="error", file="cycles", msg=f"{c['well_id']} cycle {int(c['cycle'])} already in history"))
    keys = {(c["well_id"], int(c["cycle"])) for c in cyc}
    orphan = sum((d["well_id"], int(d["cycle"])) not in keys for d in day)
    if orphan:
        issues.append(dict(level="warning", file="daily", msg=f"{orphan} daily rows have no matching cycle row and are ignored"))
    day = [d for d in day if (d["well_id"], int(d["cycle"])) in keys]
    for k in keys:
        ds = sorted(d["day"] for d in day if (d["well_id"], int(d["cycle"])) == k)
        if len(ds) < 20:
            issues.append(dict(level="warning", file="daily", msg=f"{k[0]} cycle {k[1]}: only {len(ds)} production days"))
        gaps = int(np.sum(np.diff(ds) > 1)) if len(ds) > 1 else 0
        if gaps:
            issues.append(dict(level="warning", file="daily", msg=f"{k[0]} cycle {k[1]}: {gaps} gaps in daily data"))
    if not issues:
        issues.append(dict(level="ok", file="all", msg=f"{len(cyc)} cycle(s), {len(day)} daily rows passed all checks"))
    return cyc, day, issues


def _snapshot(wid):
    f = twin.field()
    t = f["twins"][wid]
    return dict(theta=dict(t["theta"]), envelope={k: list(v) for k, v in t["envelope"].items()},
                cycles=len(t["cycles"]), conformal_q=f["conformal_q"], loco_mape=f["loco_mape"])


def _predict(theta, cyc, day):
    """Twin prediction of a cycle's daily oil given the SPM actually applied."""
    ov = np.full(DAYS, np.nan)
    for d in day:
        ov[int(d["day"])] = d["spm"]
    well = dict(theta, skin=P.SKIN_COLD, cycle=cyc["cycle"])
    return simulate({k: [cyc[k]] for k in P.DECISIONS}, well, DAYS, controller=False, spm_override=ov)["oil"][0]


def ingest(cycles, daily, source):
    cyc, day, issues = validate(cycles, daily)
    if any(i["level"] == "error" for i in issues):
        return dict(ok=False, issues=issues)
    wid = cyc[0]["well_id"]
    before = _snapshot(wid)
    EXTRA["cycles"].extend(cyc)
    EXTRA["daily"].extend(day)
    _reset_caches()
    after = _snapshot(wid)

    c = cyc[-1]
    d = [r for r in day if int(r["cycle"]) == int(c["cycle"])]
    days = np.array([int(r["day"]) for r in d])
    actual = np.array([r["oil_bpd"] for r in d])
    pb, pa = _predict(before["theta"], c, d)[days], _predict(after["theta"], c, d)[days]
    err = lambda p: float(np.abs(p.sum() / actual.sum() - 1))
    return dict(
        ok=True, source=source, well_id=wid, cycle=int(c["cycle"]), issues=issues, before=before, after=after,
        plan_vs_actual=dict(day=days.tolist(), actual=actual.round(2).tolist(), before=pb.round(2).tolist(), after=pa.round(2).tolist()),
        cum_error_before=err(pb), cum_error_after=err(pa),
    )


def _reset_caches():
    twin.field.cache_clear()
    field.cycle_plan.cache_clear()
    for fn in _invalidate:
        fn()
    twin.field()


def reset():
    EXTRA["cycles"].clear()
    EXTRA["daily"].clear()
    _reset_caches()
    return dict(ok=True)


def template():
    """CSV templates (headers + one example row) for teammates / OIL engineers."""
    return dict(cycles=",".join(CYCLE_COLS) + "\nBGW-08,10,740,97,3.5,2.0,4.5,116,1895.3,18775,0,0,\n",
                daily=",".join(DAILY_COLS) + "\nBGW-08,10,11,17.4,4.5,120.5,24.1\n")


if __name__ == "__main__":
    from . import live
    live.start()
    while not live.step(5)["complete"]:
        for a in live.S["alerts"]:
            if a["status"] == "open":
                live.decide(a["id"], True)
    cyc, daily = live.as_history()
    out = ingest([cyc], daily, "live")
    print(out["issues"])
    print("theta", out["before"]["theta"], "→", out["after"]["theta"])
    print("steam env", out["before"]["envelope"]["steam_t"], "→", out["after"]["envelope"]["steam_t"])
    print("cum error before", round(out["cum_error_before"], 3), "after", round(out["cum_error_after"], 3))
    print("loco", out["before"]["loco_mape"], "→", out["after"]["loco_mape"])
