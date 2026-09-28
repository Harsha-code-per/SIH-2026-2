"""Persistent audit trail + work orders (SQLite, stdlib only).

Every operator decision, data ingest and work-order action is appended here and
survives restarts. Work orders go draft → submitted (engineer) → approved/rejected
(supervisor).
# ponytail: names are self-declared; plug in OIL's SSO/LDAP roles for deployment
"""
import json
import os
import sqlite3
import time
from pathlib import Path

DB = Path(os.environ.get("WELLTWIN_DB", Path(__file__).resolve().parent.parent / "data" / "audit.db"))


def _db():
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    con.executescript("""
        CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, ts REAL, actor TEXT, role TEXT, kind TEXT,
                                           well_id TEXT, text TEXT, payload TEXT);
        CREATE TABLE IF NOT EXISTS work_orders (id INTEGER PRIMARY KEY, created REAL, well_id TEXT, cycle INTEGER,
                                                plan TEXT, status TEXT, prepared_by TEXT, prepared_at REAL,
                                                reviewed_by TEXT, reviewed_at REAL, note TEXT);
    """)
    return con


def log(kind, text, well_id="", actor="system", role="", payload=None):
    with _db() as con:
        con.execute("INSERT INTO events (ts, actor, role, kind, well_id, text, payload) VALUES (?,?,?,?,?,?,?)",
                    (time.time(), actor, role, kind, well_id, text, json.dumps(payload or {})))


def events(limit=200):
    with _db() as con:
        rows = con.execute("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r, payload=json.loads(r["payload"])) for r in rows]


def _wo(r):
    return dict(r, plan=json.loads(r["plan"]), number=f"WT-{r['id']:04d}")


def create_work_order(plan, prepared_by):
    rec, m = plan["recommended"], plan["mission"]
    body = dict(mission=m, x=rec["x"], spm_schedule=rec["spm_schedule"], p10=rec["p10"], p50=rec["p50"], p90=rec["p90"],
                sor=rec["sor"], energy_kwh=rec["energy_kwh"], co2_t=rec["co2_t"], cost_per_bbl=rec["cost_per_bbl"],
                t_steam=rec["t_steam"], inj_days=rec["inj_days"], prod_start=rec["prod_start"], resteam_day=rec["resteam_day"],
                day_target=rec["day_target"], evidence=plan["evidence"], baseline_float_days=plan["baseline"]["float_days"])
    now = time.time()
    with _db() as con:
        cur = con.execute("INSERT INTO work_orders (created, well_id, cycle, plan, status, prepared_by, prepared_at) VALUES (?,?,?,?,?,?,?)",
                          (now, m["well_id"], plan["state"]["next_cycle"], json.dumps(body), "submitted", prepared_by, now))
        wid = cur.lastrowid
    log("work_order", f"WT-{wid:04d} submitted for approval: {rec['x']['steam_t']:.0f} t steam, SPM "
                      f"{rec['spm_schedule'][0]['spm']} → {rec['spm_schedule'][-1]['spm']}", m["well_id"], prepared_by, "production engineer")
    return get_work_order(wid)


def review_work_order(wid, reviewer, approve, note=""):
    wo = get_work_order(wid)
    if wo is None:
        raise KeyError(wid)
    if wo["status"] != "submitted":
        raise ValueError(f"{wo['number']} is already {wo['status']}")
    if reviewer.strip().lower() == (wo["prepared_by"] or "").strip().lower():
        raise ValueError("four-eyes rule: the approver must be a different person from the preparer")
    status = "approved" if approve else "rejected"
    with _db() as con:
        con.execute("UPDATE work_orders SET status=?, reviewed_by=?, reviewed_at=?, note=? WHERE id=?",
                    (status, reviewer, time.time(), note, wid))
    log("work_order", f"{wo['number']} {status}{': ' + note if note else ''}", wo["well_id"], reviewer, "field supervisor")
    return get_work_order(wid)


def get_work_order(wid):
    with _db() as con:
        r = con.execute("SELECT * FROM work_orders WHERE id=?", (wid,)).fetchone()
    return _wo(r) if r else None


def work_orders(limit=50):
    with _db() as con:
        return [_wo(r) for r in con.execute("SELECT * FROM work_orders ORDER BY id DESC LIMIT ?", (limit,)).fetchall()]
