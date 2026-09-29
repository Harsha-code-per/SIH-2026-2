"""Field-data connectors: get real SCADA / dyno readings into Live Ops.

Everything funnels into one HTTP call, POST /api/live/observe, with rows of
{day, oil_bpd, min_load_kn, spm?, kwh?}. A connector only has to map its source
onto that schema.

- `replay`: streams a recorded cycle from the CSV/Excel history as if it were live.
  Use it to test the whole pipeline end to end, or to show judges a real
  (historical) cycle being tracked.
- `from_scada`: maps one raw SCADA record (tag → value) to an observation using
  `TAG_MAP`. Wire it to OIL's historian (OPC-UA, Modbus TCP, or a CSV drop folder)
  by reading tags on a schedule and posting the mapped rows.
  # ponytail: transport (OPC-UA/Modbus client) not bundled; add asyncua / pymodbus when OIL confirms its SCADA stack

    python -m engine.connectors replay BGW-08 9 --url http://localhost:8765 --every 0.3
"""
import argparse
import json
import time
import urllib.request

from . import params as P
from .history import load

# SCADA tag names → observation fields (placeholders until OIL shares its tag list)
TAG_MAP = {
    "oil_bpd": "BGW.{well}.FLOW.OIL_BOPD",
    "min_load_kn": "BGW.{well}.DYNO.MIN_LOAD_KN",
    "spm": "BGW.{well}.VFD.SPM",
    "kwh": "BGW.{well}.MOTOR.KWH_DAY",
}


def from_scada(record, well, day):
    """One raw SCADA record → one observation row (missing optional tags are dropped)."""
    row = {"day": int(day)}
    for field, tag in TAG_MAP.items():
        v = record.get(tag.format(well=well))
        if v is not None:
            row[field] = float(v)
    missing = {"oil_bpd", "min_load_kn"} - set(row)
    if missing:
        raise ValueError(f"record for {well} day {day} lacks {', '.join(sorted(missing))}")
    return row


def _post(url, path, body):
    req = urllib.request.Request(url.rstrip("/") + path, json.dumps(body).encode(), {"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def replay(well, cycle, url="http://localhost:8765", every=0.3, chunk=1):
    """Stream a historical cycle into an external Live Ops session, printing new alerts."""
    _, cycles, daily = load()
    c = next((c for c in cycles if c["well_id"] == well and int(c["cycle"]) == int(cycle)), None)
    if c is None:
        raise SystemExit(f"no cycle {cycle} for {well} in history")
    rows = sorted((d for d in daily if d["well_id"] == well and int(d["cycle"]) == int(cycle)), key=lambda d: d["day"])
    snap = _post(url, "/api/live/start", dict(mission=dict(well_id=well), source="external", cycle=int(cycle),
                                              x={k: c[k] for k in P.DECISIONS}))
    print(f"replaying {well} cycle {cycle}: {len(rows)} days → {url}")
    seen = set()
    for i in range(0, len(rows), chunk):
        batch = [dict(day=int(r["day"]), oil_bpd=r["oil_bpd"], min_load_kn=r["min_load_kn"], spm=r["spm"], kwh=r["kwh"])
                 for r in rows[i:i + chunk]]
        snap = _post(url, "/api/live/observe", dict(rows=batch))
        for a in snap["alerts"]:
            if a["id"] not in seen:
                seen.add(a["id"])
                print(f"  day {snap['day']:>3} ALERT {a['kind']}: {a['text']}")
        time.sleep(every)
    print(f"done: day {snap['day']}, float days measured {snap['kpi']['float_days']}, twin τ {snap['twin']['tau0']:.1f} d, "
          f"drag {snap['twin']['drag_c']:.2f}")
    return snap


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    rp = sub.add_parser("replay", help="stream a recorded cycle into Live Ops")
    rp.add_argument("well")
    rp.add_argument("cycle", type=int)
    rp.add_argument("--url", default="http://localhost:8765")
    rp.add_argument("--every", type=float, default=0.3, help="seconds between posts")
    rp.add_argument("--chunk", type=int, default=1, help="days per post")
    a = ap.parse_args()
    replay(a.well, a.cycle, a.url, a.every, a.chunk)
