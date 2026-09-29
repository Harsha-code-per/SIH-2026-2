"""Live operations: the twin shadows a well through its cycle.

Two data sources:
- "simulated": the field is simulated from the well's hidden true parameters, with
  surprises the plan did not know about: the reservoir cools a little faster, and a
  water-in-oil emulsion (condensed steam + heavy oil) raises rod drag in the tubing.
- "external": readings are pushed in (SCADA gateway, dyno export, replayed CSV)
  through `observe()`. The twin itself stands in for anything not measured.

Either way, the twin re-estimates its state from daily oil + dyno minimum load,
forecasts the rest of the cycle under the issued SPM work order, and raises alerts
with concrete remedies (slow the pump, or switch on the downhole heater) that the
operator approves or rejects.
"""
import numpy as np
from scipy.optimize import least_squares

from . import params as P
from . import twin
from .dyno import card
from .history import DAYS, load
from .optimize import DEMO, co2, plan
from .physics import simulate

SURPRISE = dict(tau0=0.85, drag_c=1.8)  # vs history: 15% faster cooling, emulsion drag ×1.8
MIN_FIT_DAYS = 15
LOOKAHEAD_D = 21        # float alerts look three weeks ahead
HEATER_STEPS_KW = (5, 10, 15, 20, 30, 40, 60)
S = {}                  # ponytail: one global demo session; key by user/well when multi-user


def _issued(schedule):
    spm = np.full(DAYS, np.nan)
    for step in schedule:
        spm[step["from_day"]:] = step["spm"]
    return spm


def start(mission=None, source="simulated", x=None, cycle=None):
    """source='simulated' runs the demo field. source='external' waits for observe() data.
    x/cycle replay a known cycle's settings (e.g. a historical cycle streamed from CSV)."""
    m = dict(DEMO, **(mission or {}))
    wid = m["well_id"]
    if x is None:
        res = plan(m)
        rec = res["recommended"]
        cycle = res["state"]["next_cycle"]
        xs, issued, schedule = rec["x"], _issued(rec["spm_schedule"]), rec["spm_schedule"]
        plan_series = {k: rec["series"][k] for k in ("oil", "cum", "float_margin", "spm")}
        prod_start, resteam = rec["prod_start"], rec["resteam_day"]
    else:  # replay: the operator ran fixed settings at constant SPM
        cycle = int(cycle or twin.state(wid)["next_cycle"])
        xs = {k: float(x[k]) for k in P.DECISIONS}
        issued = np.full(DAYS, xs["spm_max"])
        schedule = [dict(from_day=0, spm=xs["spm_max"])]
        r = simulate(xs, twin.well_model(wid, cycle), DAYS, controller=False)
        plan_series = {k: r[k][0].round(2).tolist() for k in ("oil", "cum", "float_margin", "spm")}
        prod_start, resteam = float(r["prod_start"][0]), int(r["cutoff_day"][0])
    truth = None
    if source == "simulated":
        true = next(w for w in load()[0] if w["well_id"] == wid)
        truth = dict(q_cold=true["true_q_cold"], skin=true["true_skin"], tau0=true["true_tau0"] * SURPRISE["tau0"],
                     drag_c=true["true_drag_c"] * SURPRISE["drag_c"], deg=true["true_deg"], cycle=cycle)
    rng = np.random.default_rng(10)
    S.clear()
    S.update(
        mission=m, well_id=wid, cycle=cycle, source=source, x={k: [v] for k, v in xs.items()}, truth=truth,
        planned=twin.well_model(wid, cycle), issued=issued, heater=dict(kw=0.0, from_d=DAYS), day=0, ext={},
        plan_series=plan_series, prod_start=prod_start, plan_resteam=resteam,
        noise_oil=rng.lognormal(0, 0.05, DAYS), noise_load=rng.normal(1, 0.03, DAYS),
        alerts=[], log=[dict(day=0, kind="info", text=f"Work order issued: {xs['steam_t']:.0f} t steam, "
                                                       f"SPM schedule {schedule[0]['spm']} → {schedule[-1]['spm']}"
                                                       + ("" if source == "simulated" else " · waiting for field data"))],
        fitted=None, float_seen=0, actions={}, tau_streak=0,
    )
    return snapshot()


def _x(heater=None):
    kw, from_d = heater or (S["heater"]["kw"], S["heater"]["from_d"])
    return dict(S["x"], heater_kw=[kw], heater_from_d=[from_d])


def _field():
    """What the well does under the SPM actually applied: the hidden truth when simulated,
    the twin's best estimate when data comes from outside."""
    well = S["truth"] if S["source"] == "simulated" else (S["fitted"] or S["planned"])
    return simulate(_x(), well, DAYS, controller=False, spm_override=S["issued"])


def _observed(r):
    if S["source"] == "external":
        days = np.array(sorted(d for d in S["ext"] if d < S["day"]), int)
        rows = [S["ext"][d] for d in days]
        return days, np.array([row["oil_bpd"] for row in rows]), np.array([row["min_load_kn"] for row in rows])
    d0, d1 = int(np.ceil(S["prod_start"])), S["day"]
    days = np.arange(d0, max(d0, d1))
    oil = r["oil"][0, days] * S["noise_oil"][days]
    fm = r["float_margin"][0, days]
    load_kn = np.maximum(P.ROD_WEIGHT_BUOYANT_N * (1 - 1 / fm), 0) / 1e3 * S["noise_load"][days]
    return days, oil, load_kn


def _track(days, oil, load_kn):
    """Re-estimate cold rate, cooling constant and rod drag from what the well is doing.
    Weak priors on the historical values keep early, uninformative data from swinging the fit."""
    base = S["planned"]
    prior = np.log([base["q_cold"], base["tau0"], base["drag_c"]])

    def resid(th):
        r = simulate(_x(), dict(base, q_cold=th[0], tau0=th[1], drag_c=th[2]), DAYS, controller=False, spm_override=S["issued"])
        fm = r["float_margin"][0, days]
        sim_load = np.maximum(P.ROD_WEIGHT_BUOYANT_N * (1 - 1 / fm), 0) / 1e3
        return np.concatenate([np.log1p(r["oil"][0, days]) - np.log1p(oil), (sim_load - load_kn) / 1.0,
                               (np.log(th) - prior) / 0.5])

    prev = S["fitted"] or base  # warm start: consecutive days should not jump between local minima
    fit = least_squares(resid, x0=[prev["q_cold"], prev["tau0"], prev["drag_c"]], bounds=([1, 5, 0.5], [20, 90, 20]))
    return dict(base, q_cold=float(fit.x[0]), tau0=float(fit.x[1]), drag_c=float(fit.x[2]))


def _alert(kind, text, **kw):
    if any(a["kind"] == kind and a["status"] == "open" for a in S["alerts"]):
        return None
    S["alerts"].append(dict(id=len(S["alerts"]) + 1, day=S["day"], kind=kind, text=text, status="open", **kw))
    return S["alerts"][-1]


def step(n=1):
    if not S:
        start()
    if S["source"] == "external":
        return snapshot()  # time advances only when data arrives
    end = min(DAYS - 1, int(_field()["cutoff_day"][0]) + 3)
    for _ in range(int(n)):
        if S["day"] >= end:
            break
        S["day"] += 1
        _daily()
    return snapshot()


def observe(rows):
    """Push field readings (one row per production day) into an external session.
    Row: day, oil_bpd, min_load_kn, optional spm (applied) and kwh."""
    if S.get("source") != "external":
        raise ValueError("start the live session with source='external' first")
    for row in rows:
        d = int(row["day"])
        if not (0 <= d < DAYS):
            raise ValueError(f"day {d} outside 0–{DAYS - 1}")
        oil, load_kn = float(row["oil_bpd"]), float(row["min_load_kn"])
        if not (0 <= oil <= 2000 and -50 <= load_kn <= 500):
            raise ValueError(f"day {d}: implausible reading oil={oil} min_load={load_kn}")
        if row.get("spm") is not None:
            S["issued"][d:] = np.where(np.isnan(S["issued"][d:]), float(row["spm"]), S["issued"][d:])
            S["issued"][d] = float(row["spm"])
        S["ext"][d] = dict(oil_bpd=oil, min_load_kn=load_kn, kwh=row.get("kwh"))
    S["day"] = max(S["day"], max(S["ext"], default=-1) + 1)
    _daily(force=True)
    return snapshot()


def _daily(force=False):
    r = _field()
    days, oil, load_kn = _observed(r)
    d = S["day"]
    floated = int((load_kn < 1.0).sum())
    if floated > S["float_seen"] and S["float_seen"] == 0:
        S["log"].append(dict(day=d, kind="critical", text=f"ROD FLOAT measured: dyno min load {load_kn[load_kn < 1.0][-1]:.1f} kN, impact loading"))
    S["float_seen"] = floated
    if len(days) < MIN_FIT_DAYS or (d % 2 and not force):
        return
    S["fitted"] = fit = _track(days, oil, load_kn)
    f = simulate(_x(), fit, DAYS, controller=False, spm_override=S["issued"])
    D = int(S["mission"]["deadline_d"]) - 1
    tau_dev = fit["tau0"] / S["planned"]["tau0"] - 1
    S["tau_streak"] = S["tau_streak"] + 1 if abs(tau_dev) > 0.15 else 0  # must persist: early fits are noisy
    if S["tau_streak"] >= 3 and len(days) >= 30 and not any(a["kind"] == "cooling" for a in S["alerts"]):
        short = f["cum"][0, D] < S["mission"]["target_bbl"]
        new_resteam = int(f["cutoff_day"][0])
        moved = f" Re-steam trigger moves day {S['plan_resteam']} → {new_resteam}." if new_resteam != S["plan_resteam"] else ""
        _alert("cooling", f"Reservoir cooling {abs(tau_dev) * 100:.0f}% {'faster' if tau_dev < 0 else 'slower'} than planned "
                          f"(τ {S['planned']['tau0']:.0f} → {fit['tau0']:.0f} d, early estimate, refines daily).{moved}"
                          f" Forecast by day {D + 1}: {f['cum'][0, D]:,.0f} bbl"
                          f"{' (below the ' + format(S['mission']['target_bbl'], ',.0f') + ' bbl target)' if short else ''}.",
               severity="info", action=None)
    ahead = np.arange(d, min(d + LOOKAHEAD_D, DAYS))
    floats = ahead[f["float_margin"][0, ahead] < 1.0]
    snoozed = any(a["kind"] == "float" and a["status"] == "rejected" and d - a["decided"] < 10 for a in S["alerts"])
    if floats.size and not snoozed:
        _float_alert(d, fit, f, int(floats[0]))
    drag_dev = fit["drag_c"] / S["planned"]["drag_c"] - 1
    if drag_dev > 0.25 and not any(a["kind"] == "drag" for a in S["alerts"]):
        _alert("drag", f"Dyno loads show rod drag {drag_dev * 100:.0f}% above this well's history: tubing fluid is more "
                       f"viscous than the reservoir temperature explains (likely water-in-oil emulsion or asphaltene "
                       f"build-up). Twin updated; consider a demulsifier / hot-oil job.", severity="info", action=None)


def _float_alert(d, fit, f, float_day):
    """Two remedies, each checked on the re-fitted twin: slow the pump, or heat the tubing."""
    options = []
    if S["issued"][d] > P.MIN_SPM:
        fix = simulate(_x(), fit, DAYS, controller=True)["spm"][0]
        new = S["issued"].copy()
        new[d + 1:] = np.minimum(new[d + 1:], np.round(fix[d + 1:] * 4) / 4)
        chk = simulate(_x(), fit, DAYS, controller=False, spm_override=new)
        now, to = S["issued"][d + 1], new[d + 1]
        options.append(dict(key="spm", label=f"SLOW PUMP {now:.2f} → {to:.2f} SPM",
                            detail=f"VFD {now / P.SPM_PER_HZ:.0f} → {to / P.SPM_PER_HZ:.0f} Hz, then the updated step-down",
                            float_days=int(chk["float_days"][0]), oil=round(float(chk["cum"][0, -1] - f["cum"][0, -1])),
                            kwh=round(float(chk["cum_kwh"][0, -1] - f["cum_kwh"][0, -1])), apply=dict(spm=new)))
    for kw in HEATER_STEPS_KW:  # smallest heater that stops the float at the current SPM
        chk = simulate(_x((kw, d + 1)), fit, DAYS, controller=False, spm_override=S["issued"])
        if chk["float_days"][0] == 0:
            extra = float(chk["cum_kwh"][0, -1] - f["cum_kwh"][0, -1])
            options.append(dict(key="heater", label=f"HEATER ON {kw} kW",
                                detail=f"thermostatic below {P.HEATER_ON_BELOW_C:.0f} °C, keeps the current SPM",
                                float_days=0, oil=round(float(chk["cum"][0, -1] - f["cum"][0, -1])), kwh=round(extra),
                                co2_t=round(extra * P.CO2_T_PER_KWH, 1), apply=dict(heater=(float(kw), d + 1))))
            break
    if not options:
        return
    when = "Rods are floating now" if float_day <= d + 1 else f"Rods forecast to float on day {float_day} (in {float_day - d} d)"
    best = min(options, key=lambda o: (o["float_days"], o["kwh"] - 50 * o["oil"]))
    made = _alert("float", f"{when} at the current work order ({int(f['float_days'][0])} float days forecast). "
                           f"Recommended: {best['label']}.",
                  severity="critical" if float_day <= d + 1 else "warning", action=True, float_day=float_day,
                  options=[{k: v for k, v in o.items() if k != "apply"} for o in options], recommended=best["key"])
    if made:
        S["actions"][made["id"]] = {o["key"]: o["apply"] for o in options}


def decide(alert_id, approve, option=None):
    a = next(a for a in S["alerts"] if a["id"] == alert_id)
    if a["status"] != "open":
        return snapshot()
    a["status"] = "approved" if approve else "rejected"
    a["decided"] = S["day"]
    chosen = None
    if approve and a.get("action"):
        acts = S["actions"][alert_id]
        chosen = option if option in acts else a.get("recommended")
        act = acts[chosen]
        if "spm" in act:
            S["issued"] = act["spm"]
        if "heater" in act:
            S["heater"] = dict(kw=act["heater"][0], from_d=act["heater"][1])
        a["chosen"] = chosen
    label = next((o["label"] for o in a.get("options", []) if o["key"] == chosen), None)
    S["log"].append(dict(day=S["day"], kind="decision",
                         text=f"Operator {a['status']}: {label if label else a['text'].split('.')[0]}"))
    return snapshot()


def snapshot():
    r = _field()
    days, oil, load_kn = _observed(r)
    d = min(S["day"], DAYS - 1)
    fit = S["fitted"] or S["planned"]
    f = simulate(_x(), fit, DAYS, controller=False, spm_override=S["issued"])
    ahead = slice(d, DAYS)
    band = 0.04 + 0.002 * np.arange(DAYS - d)
    stage = "INJECTION" if d < r["inj_days"][0] else "SOAK" if d < S["prod_start"] else \
        "RE-STEAM DUE" if d >= f["cutoff_day"][0] else "PRODUCTION"
    now_oil = float(oil[-1]) if S["source"] == "external" and len(oil) else float(r["oil"][0, d])
    return dict(
        well_id=S["well_id"], cycle=S["cycle"], day=d, stage=stage, mission=S["mission"], source=S["source"],
        x={k: v[0] for k, v in S["x"].items()}, prod_start=S["prod_start"],
        inj_days=float(r["inj_days"][0]), t_steam=float(r["t_steam"][0]), r_heated=float(r["r_heated"][0]),
        heater=S["heater"] if S["heater"]["kw"] else None,
        truth_now=dict(t_res=float(r["t_res"][0, d]), mu_tub=float(r["mu_tub"][0, d]), spm=float(r["spm"][0, d]),
                       float_margin=float(r["float_margin"][0, d]), oil=now_oil),
        observed=dict(day=days.tolist(), oil=np.round(oil, 2).tolist(), min_load_kn=np.round(load_kn, 2).tolist(),
                      spm=r["spm"][0, days].round(2).tolist()),
        plan=S["plan_series"],
        forecast=dict(day=list(range(d, DAYS)), oil=f["oil"][0, ahead].round(2).tolist(),
                      lo=(f["oil"][0, ahead] * (1 - band)).round(2).tolist(), hi=(f["oil"][0, ahead] * (1 + band)).round(2).tolist(),
                      float_margin=f["float_margin"][0, ahead].round(3).tolist()),
        issued_spm=np.nan_to_num(S["issued"]).round(2).tolist(),
        twin={k: fit[k] for k in ("q_cold", "tau0", "drag_c")} | {f"planned_{k}": S["planned"][k] for k in ("q_cold", "tau0", "drag_c")},
        kpi=dict(cum_oil=float(np.sum(oil)), forecast_at_deadline=float(f["cum"][0, int(S["mission"]["deadline_d"]) - 1]),
                 float_days=S["float_seen"], resteam_day=int(f["cutoff_day"][0]), cum_kwh=float(r["cum_kwh"][0, max(d - 1, 0)]),
                 co2_t=round(float(co2(S["x"]["steam_t"][0], r["cum_kwh"][0, max(d - 1, 0)])), 1)),
        alerts=S["alerts"], log=S["log"][-12:],
        complete=bool(d >= f["cutoff_day"][0]),
    )


def dyno_now():
    """Card at today's operating point: measured physics when simulated, twin-estimated when external."""
    r = _field()
    d = min(S["day"], DAYS - 1)
    drag = S["truth"]["drag_c"] if S["source"] == "simulated" else (S["fitted"] or S["planned"])["drag_c"]
    return card(max(float(r["spm"][0, d]), P.MIN_SPM), S["x"]["stroke_m"][0], float(r["mu_tub"][0, d]),
                drag, float(np.clip(r["fillage"][0, d], 0.2, 1.0)))


def as_history():
    """The executed cycle as rows for the learning loop (cycles.csv + daily.csv schema)."""
    r = _field()
    days, oil, load_kn = _observed(r)
    x = {k: v[0] for k, v in S["x"].items()}
    cyc = dict(well_id=S["well_id"], cycle=S["cycle"], **x, cycle_days=S["day"], cum_oil_bbl=round(float(oil.sum()), 1),
               cum_kwh=round(float(r["cum_kwh"][0, S["day"] - 1])), float_days=S["float_seen"],
               rod_failure=0, failure_day="")
    daily = [dict(well_id=S["well_id"], cycle=S["cycle"], day=int(dd), oil_bpd=round(float(o), 2),
                  spm=round(float(r["spm"][0, dd]), 2), kwh=round(float(r["kwh"][0, dd]), 1), min_load_kn=round(float(lk), 2))
             for dd, o, lk in zip(days, oil, load_kn)]
    return cyc, daily


if __name__ == "__main__":
    start()
    while True:
        s = step(1)
        for a in s["alerts"]:
            if a["status"] == "open":
                print(s["day"], a["kind"], a["text"])
                for o in a.get("options", []):
                    print("   option", o)
                decide(a["id"], True)
        if s["complete"] or s["day"] >= DAYS - 1:
            break
    print("day", s["day"], "float days", s["kpi"]["float_days"], "cum", round(s["kpi"]["cum_oil"]), "resteam", s["kpi"]["resteam_day"])
    print(*[f"{l['day']:>3} {l['kind']}: {l['text']}" for l in s["log"]], sep="\n")
