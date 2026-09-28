"""HTTP surface for the control-room UI.  Run: .venv/bin/uvicorn engine.api:app --port 8765"""
import json
from functools import lru_cache
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import audit, dyno, field as fieldsched, learn, live, llm, optimize, params as P, twin
from .history import DAYS
from .physics import simulate

app = FastAPI(title="Baghewala Well Twin")
twin.field()  # calibrate all wells before accepting requests (~5 s)


def _py(o):
    return JSONResponse(json.loads(json.dumps(o, default=lambda v: v.item() if isinstance(v, np.generic) else v.tolist())))


class Mission(BaseModel):
    well_id: str = optimize.DEMO["well_id"]
    target_bbl: float = Field(optimize.DEMO["target_bbl"], ge=100, le=10000)
    deadline_d: float = Field(optimize.DEMO["deadline_d"], ge=20, le=180)
    steam_budget_t: float = Field(optimize.DEMO["steam_budget_t"], ge=200, le=2500)
    energy_budget_kwh: float = Field(optimize.DEMO["energy_budget_kwh"], ge=1000, le=50000)


class Text(BaseModel):
    text: str = Field(max_length=500)
    well_id: str = optimize.DEMO["well_id"]


class WhatIf(BaseModel):
    mission: Mission = Mission()
    x: dict[str, float]
    controller: bool = True


def _check(wid):
    if wid not in twin.field()["twins"]:
        raise HTTPException(404, f"unknown well {wid}")


@lru_cache(maxsize=64)
def _plan(key):
    return optimize.plan(dict(key))


learn._invalidate.append(_plan.cache_clear)


@app.get("/api/field")
def field():
    f = twin.field()
    fails = [a for t in f["twins"].values() for a in t["anomalies"] if a["rod_failure"]]
    return _py(dict(
        conformal_q=f["conformal_q"], loco_mape=f["loco_mape"], n_holdout=f["n_holdout"],
        failures=len(fails), failures_warned=sum(a["lead_days"] is not None for a in fails),
        wells=[dict(well_id=w, cycles=len(t["cycles"]), rod_failures=int(sum(c["rod_failure"] for c in t["cycles"])),
                    last_cum_bbl=t["cycles"][-1]["cum_oil_bbl"]) for w, t in f["twins"].items()],
        synthetic=True,
    ))


@app.get("/api/wells/{wid}")
def well(wid: str):
    _check(wid)
    return _py(dict(twin.state(wid), cycles=twin.field()["twins"][wid]["cycles"]))


@app.post("/api/parse")
def parse(t: Text):
    return _py(llm.parse(t.text, t.well_id))


@app.post("/api/mission")
def mission(m: Mission):
    _check(m.well_id)
    return _py(_plan(tuple(sorted(m.model_dump().items()))))


@app.post("/api/explain")
def explain(m: Mission):
    _check(m.well_id)
    res = _plan(tuple(sorted(m.model_dump().items())))
    if not res["feasible"]:
        raise HTTPException(409, res["message"])
    return _py(llm.explain(res))


@app.post("/api/simulate")
def what_if(w: WhatIf):
    """Sandbox: one operating point through the twin, with the same honesty rules as the optimizer."""
    m = w.mission
    _check(m.well_id)
    if not set(P.DECISIONS) <= set(w.x) <= set(P.DECISIONS) | {"heater_kw"}:
        raise HTTPException(422, f"x must have keys {P.DECISIONS} (+ optional heater_kw)")
    x = {k: float(np.clip(v, *P.BOUNDS[k])) for k, v in w.x.items() if k in P.BOUNDS}
    x["heater_kw"] = float(np.clip(w.x.get("heater_kw", 0.0), 0, P.HEATER_MAX_KW))
    st = twin.state(m.well_id)
    r = simulate(x, twin.well_model(m.well_id, st["next_cycle"]), DAYS, controller=w.controller)
    inside, bad = twin.in_envelope(st["envelope"], {k: np.atleast_1d(v) for k, v in x.items() if k in P.DECISIONS})
    q = twin.field()["conformal_q"] * (1 if inside[0] else 2)
    D = int(m.deadline_d) - 1
    p50 = float(r["cum"][0, D])
    kwh = float(r["cum_kwh"][0, D])
    cost = x["steam_t"] * P.STEAM_COST_PER_T + kwh * P.POWER_COST_PER_KWH + float(r["failure_risk"][0]) * P.WORKOVER_COST
    return _py(dict(
        {k: np.round(r[k][0], 2) for k in optimize.SERIES}, x=x, in_envelope=bool(inside[0]),
        out_of_envelope=[k for k, b in bad.items() if b[0]], envelope=st["envelope"], bounds=P.BOUNDS,
        heater_max_kw=P.HEATER_MAX_KW, p50=round(p50), p10=round(p50 * (1 - q)), p90=round(p50 * (1 + q)),
        energy_kwh=round(kwh), sor=round(x["steam_t"] / max(p50 * 0.159, 1e-6), 2), cost_per_bbl=round(cost / max(p50, 1)),
        co2_t=round(optimize.co2(x["steam_t"], kwh), 1), float_days=int(r["float_days"][0]),
        heater_days=int(r["heater_days"][0]), failure_risk=round(float(r["failure_risk"][0]), 3),
        prod_start=float(r["prod_start"][0]), resteam_day=int(r["cutoff_day"][0]), r_heated=float(r["r_heated"][0]),
        meets=dict(target=p50 * (1 - q) >= m.target_bbl, steam=x["steam_t"] <= m.steam_budget_t,
                   energy=kwh <= m.energy_budget_kwh, frac=x["inj_p_bar"] <= P.FRAC_LIMIT_BAR, envelope=bool(inside[0]),
                   rod=int(r["float_days"][0]) == 0),
    ))


class DynoReq(BaseModel):
    mission: Mission = Mission()
    mode: str = Field("plan", pattern="^(plan|practice)$")
    day: int = Field(60, ge=0, lt=DAYS)


@app.post("/api/dyno")
def dyno_card(q: DynoReq):
    """Surface + downhole card at one day of the recommended plan or typical practice."""
    _check(q.mission.well_id)
    res = _plan(tuple(sorted(q.mission.model_dump().items())))
    run = res["recommended"] if q.mode == "plan" else res["baseline"]
    s = run["series"]
    spm = s["spm"][q.day] or run["x"]["spm_max"]
    fill = min(max(s["fillage"][q.day], 0.2), 1.0)
    return _py(dyno.card(spm, run["x"]["stroke_m"], s["mu_tub"][q.day], res["state"]["calibrated"]["drag_c"], fill))


# --- live operations ---
class Decision(BaseModel):
    alert_id: int
    approve: bool
    actor: str = Field("", max_length=80)


@app.post("/api/live/start")
def live_start(m: Mission = Mission()):
    _check(m.well_id)
    return _py(live.start(m.model_dump()))


@app.post("/api/live/step")
def live_step(days: int = 1):
    return _py(live.step(max(1, min(days, 30))))


@app.post("/api/live/decide")
def live_decide(d: Decision):
    if not live.S:
        raise HTTPException(409, "no live session")
    a = next((a for a in live.S["alerts"] if a["id"] == d.alert_id), None)
    if a is None:
        raise HTTPException(404, "unknown alert")
    snap = live.decide(d.alert_id, d.approve)
    audit.log("live_decision", f"day {live.S['day']}: {'approved' if d.approve else 'rejected'}: {a['text'].split('.')[0]}",
              live.S["well_id"], d.actor or "operator", "operator", dict(alert=a["kind"]))
    return _py(snap)


@app.get("/api/live/dyno")
def live_dyno():
    if not live.S:
        raise HTTPException(409, "no live session")
    return _py(live.dyno_now())


# --- field steam scheduler ---
@lru_cache(maxsize=16)
def _field_compare(generators, horizon):
    return fieldsched.compare(generators, horizon)


learn._invalidate.append(_field_compare.cache_clear)


@app.get("/api/field/schedule")
def field_schedule(generators: int = 1, horizon: int = 180):
    if not (1 <= generators <= 4 and 60 <= horizon <= 365):
        raise HTTPException(422, "generators 1–4, horizon 60–365 days")
    return _py(_field_compare(generators, horizon))


# --- learning loop ---
class Upload(BaseModel):
    cycles_csv: str = Field(max_length=2_000_000)
    daily_csv: str = Field(max_length=20_000_000)


@app.post("/api/learn/ingest-live")
def learn_live():
    if not live.S or not live.snapshot()["complete"]:
        raise HTTPException(409, "run the live cycle to the re-steam trigger first")
    cyc, daily = live.as_history()
    return _py(_logged_ingest(learn.ingest([cyc], daily, "live operations")))


@app.post("/api/learn/upload")
def learn_upload(u: Upload):
    return _py(_logged_ingest(learn.ingest(learn.parse_csv(u.cycles_csv), learn.parse_csv(u.daily_csv), "csv upload")))


@app.post("/api/learn/upload-xlsx")
async def learn_upload_xlsx(request: Request):
    data = await request.body()
    if not data or len(data) > 20_000_000:
        raise HTTPException(413 if data else 422, "send one .xlsx workbook (max 20 MB) as the request body")
    try:
        cycles, daily = learn.parse_xlsx(data)
    except Exception as e:
        raise HTTPException(422, f"could not read workbook: {e}")
    return _py(_logged_ingest(learn.ingest(cycles, daily, "excel upload")))


@app.get("/api/learn/template.xlsx")
def learn_template_xlsx():
    return Response(learn.template_xlsx(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": "attachment; filename=welltwin_template.xlsx"})


@app.post("/api/learn/reset")
def learn_reset():
    return _py(learn.reset())


def _logged_ingest(res):
    if res["ok"]:
        audit.log("ingest", f"cycle #{res['cycle']} ingested from {res['source']}; cycle error "
                            f"{res['cum_error_before'] * 100:.1f}% → {res['cum_error_after'] * 100:.1f}% after recalibration",
                  res["well_id"], "data engineer", "data")
    return res


# --- work orders + audit trail ---
class WorkOrderReq(BaseModel):
    mission: Mission = Mission()
    prepared_by: str = Field(min_length=2, max_length=80)


class Review(BaseModel):
    reviewer: str = Field(min_length=2, max_length=80)
    approve: bool
    note: str = Field("", max_length=300)


@app.post("/api/workorders")
def wo_create(w: WorkOrderReq):
    _check(w.mission.well_id)
    res = _plan(tuple(sorted(w.mission.model_dump().items())))
    if not res["feasible"]:
        raise HTTPException(409, res["message"])
    return _py(audit.create_work_order(res, w.prepared_by.strip()))


@app.post("/api/workorders/{wid}/review")
def wo_review(wid: int, r: Review):
    try:
        return _py(audit.review_work_order(wid, r.reviewer.strip(), r.approve, r.note.strip()))
    except KeyError:
        raise HTTPException(404, "unknown work order")
    except ValueError as e:
        raise HTTPException(409, str(e))


@app.get("/api/workorders")
def wo_list():
    return _py(audit.work_orders())


@app.get("/api/audit")
def audit_events(limit: int = 200):
    return _py(audit.events(max(1, min(limit, 1000))))


@app.get("/api/learn/template")
def learn_template():
    return learn.template()


_dist = Path(__file__).resolve().parent.parent / "web" / "dist"
if _dist.exists():  # single-process demo: serve the built UI too
    app.mount("/", StaticFiles(directory=_dist, html=True), name="web")
