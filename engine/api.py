"""HTTP surface for the control-room UI.  Run: .venv/bin/uvicorn engine.api:app --port 8765"""
import json
from functools import lru_cache
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import llm, optimize, params as P, twin
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
    well_id: str = optimize.DEMO["well_id"]
    x: dict[str, float]
    controller: bool = True


def _check(wid):
    if wid not in twin.field()["twins"]:
        raise HTTPException(404, f"unknown well {wid}")


@lru_cache(maxsize=64)
def _plan(key):
    return optimize.plan(dict(key))


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
    _check(w.well_id)
    if set(w.x) != set(P.DECISIONS):
        raise HTTPException(422, f"x must have keys {P.DECISIONS}")
    x = {k: np.clip(v, *P.BOUNDS[k]) for k, v in w.x.items()}
    r = simulate(x, twin.well_model(w.well_id, twin.state(w.well_id)["next_cycle"]), DAYS, controller=w.controller)
    inside, bad = twin.in_envelope(twin.field()["twins"][w.well_id]["envelope"], {k: np.atleast_1d(v) for k, v in x.items()})
    return _py(dict({k: np.round(r[k][0], 2) for k in optimize.SERIES}, in_envelope=bool(inside[0]),
                    out_of_envelope=[k for k, b in bad.items() if b[0]], float_days=r["float_days"][0],
                    failure_risk=r["failure_risk"][0], prod_start=r["prod_start"][0], r_heated=r["r_heated"][0]))


_dist = Path(__file__).resolve().parent.parent / "web" / "dist"
if _dist.exists():  # single-process demo: serve the built UI too
    app.mount("/", StaticFiles(directory=_dist, html=True), name="web")
