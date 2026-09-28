"""Live operations: the twin shadows a well through its cycle.

The "field" is simulated from the well's hidden true parameters, with surprises
the plan did not know about: this cycle the reservoir cools a little faster, and a
water-in-oil emulsion (condensed steam + heavy oil) raises rod drag in the tubing.
Every day the field streams SCADA + dyno data. The twin re-estimates
its state, forecasts the rest of the cycle under the issued SPM work order, and
raises alerts with a concrete setpoint change the operator approves or rejects.
"""
import numpy as np
from scipy.optimize import least_squares

from . import params as P
from . import twin
from .dyno import card
from .history import DAYS, load
from .optimize import DEMO, plan
from .physics import simulate

SURPRISE = dict(tau0=0.85, drag_c=1.8)  # vs history: 15% faster cooling, emulsion drag ×1.8
MIN_FIT_DAYS = 15
LOOKAHEAD_D = 21        # float alerts look three weeks ahead
S = {}                  # ponytail: one global demo session; key by user/well when multi-user


def _issued(schedule):
    spm = np.full(DAYS, np.nan)
    for step in schedule:
        spm[step["from_day"]:] = step["spm"]
    return spm


def start(mission=None):
    m = dict(DEMO, **(mission or {}))
    res = plan(m)
    rec = res["recommended"]
    wid, cycle = m["well_id"], res["state"]["next_cycle"]
    true = next(w for w in load()[0] if w["well_id"] == wid)
    truth = dict(q_cold=true["true_q_cold"], skin=true["true_skin"], tau0=true["true_tau0"] * SURPRISE["tau0"],
                 drag_c=true["true_drag_c"] * SURPRISE["drag_c"], deg=true["true_deg"], cycle=cycle)
    rng = np.random.default_rng(10)
    S.clear()
    S.update(
        mission=m, well_id=wid, cycle=cycle, x={k: [v] for k, v in rec["x"].items()}, truth=truth,
        planned=twin.well_model(wid, cycle), issued=_issued(rec["spm_schedule"]), day=0,
        plan_series={k: rec["series"][k] for k in ("oil", "cum", "float_margin", "spm")},
        prod_start=rec["prod_start"], plan_resteam=rec["resteam_day"],
        noise_oil=rng.lognormal(0, 0.05, DAYS), noise_load=rng.normal(1, 0.03, DAYS),
        alerts=[], log=[dict(day=0, kind="info", text=f"Work order issued: {rec['x']['steam_t']:.0f} t steam, "
                                                       f"SPM schedule {rec['spm_schedule'][0]['spm']} → {rec['spm_schedule'][-1]['spm']}")],
        fitted=None, float_seen=0, actions={},
    )
    return snapshot()


def _field():
    """What the real well does under the SPM actually applied."""
    return simulate(S["x"], S["truth"], DAYS, controller=False, spm_override=S["issued"])


def _observed(r):
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
    x = S["x"]
    prior = np.log([base["q_cold"], base["tau0"], base["drag_c"]])

    def resid(th):
        r = simulate(x, dict(base, q_cold=th[0], tau0=th[1], drag_c=th[2]), DAYS, controller=False, spm_override=S["issued"])
        fm = r["float_margin"][0, days]
        sim_load = np.maximum(P.ROD_WEIGHT_BUOYANT_N * (1 - 1 / fm), 0) / 1e3
        return np.concatenate([np.log1p(r["oil"][0, days]) - np.log1p(oil), (sim_load - load_kn) / 1.0,
                               (np.log(th) - prior) / 0.5])

    fit = least_squares(resid, x0=[base["q_cold"], base["tau0"], base["drag_c"]], bounds=([1, 5, 0.5], [20, 90, 20]))
    return dict(base, q_cold=float(fit.x[0]), tau0=float(fit.x[1]), drag_c=float(fit.x[2]))


def _alert(kind, text, **kw):
    if any(a["kind"] == kind and a["status"] == "open" for a in S["alerts"]):
        return None
    S["alerts"].append(dict(id=len(S["alerts"]) + 1, day=S["day"], kind=kind, text=text, status="open", **kw))
    return S["alerts"][-1]


def step(n=1):
    if not S:
        start()
    end = min(DAYS - 1, int(_field()["cutoff_day"][0]) + 3)
    for _ in range(int(n)):
        if S["day"] >= end:
            break
        S["day"] += 1
        _daily()
    return snapshot()


def _daily():
    r = _field()
    days, oil, load_kn = _observed(r)
    d = S["day"]
    if len(days) and load_kn[-1] < 1.0:  # dyno says the rods floated yesterday
        S["float_seen"] += 1
        if S["float_seen"] == 1:
            S["log"].append(dict(day=d, kind="critical", text=f"ROD FLOAT measured: dyno min load {load_kn[-1]:.1f} kN, impact loading"))
    if len(days) < MIN_FIT_DAYS or d % 2:
        return
    S["fitted"] = fit = _track(days, oil, load_kn)
    f = simulate(S["x"], fit, DAYS, controller=False, spm_override=S["issued"])
    tau_dev = fit["tau0"] / S["planned"]["tau0"] - 1
    if abs(tau_dev) > 0.15 and not any(a["kind"] == "cooling" for a in S["alerts"]):
        _alert("cooling", f"Reservoir cooling {abs(tau_dev) * 100:.0f}% {'faster' if tau_dev < 0 else 'slower'} than planned "
                          f"(τ {S['planned']['tau0']:.0f} → {fit['tau0']:.0f} d). Re-steam trigger moves day {S['plan_resteam']} → "
                          f"{int(f['cutoff_day'][0])}. Forecast by day {S['mission']['deadline_d']:.0f}: "
                          f"{f['cum'][0, int(S['mission']['deadline_d']) - 1]:,.0f} bbl"
                          f"{' (below the ' + format(S['mission']['target_bbl'], ',.0f') + ' bbl target)' if f['cum'][0, int(S['mission']['deadline_d']) - 1] < S['mission']['target_bbl'] else ''}.",
               severity="info", action=None)
    ahead = np.arange(d, min(d + LOOKAHEAD_D, DAYS))
    floats = ahead[f["float_margin"][0, ahead] < 1.0]
    snoozed = any(a["kind"] == "float" and a["status"] == "rejected" and d - a["decided"] < 10 for a in S["alerts"])
    if floats.size and S["issued"][d] > P.MIN_SPM and not snoozed:
        fix = simulate(S["x"], fit, DAYS, controller=True)["spm"][0]
        new = S["issued"].copy()
        new[d + 1:] = np.minimum(new[d + 1:], np.round(fix[d + 1:] * 4) / 4)
        chk = simulate(S["x"], fit, DAYS, controller=False, spm_override=new)
        now, to = S["issued"][d + 1], new[d + 1]
        when = "Rods are floating now" if floats[0] <= d + 1 else f"Rods forecast to float on day {floats[0]} (in {floats[0] - d} d)"
        made = _alert("float", f"{when} at the current work order. "
                        f"Reduce SPM {now:.2f} → {to:.2f} (VFD {now / P.SPM_PER_HZ:.0f} → {to / P.SPM_PER_HZ:.0f} Hz) and follow the "
                        f"updated step-down. Float days: {int(f['float_days'][0])} → {int(chk['float_days'][0])}; oil change "
                        f"{chk['cum'][0, -1] - f['cum'][0, -1]:+,.0f} bbl.",
               severity="critical" if floats[0] <= d + 1 else "warning", action=True, float_day=int(floats[0]))
        if made:
            S["actions"][made["id"]] = new
    drag_dev = fit["drag_c"] / S["planned"]["drag_c"] - 1
    if drag_dev > 0.25 and not any(a["kind"] == "drag" for a in S["alerts"]):
        _alert("drag", f"Dyno loads show rod drag {drag_dev * 100:.0f}% above this well's history: tubing fluid is more "
                       f"viscous than the reservoir temperature explains (likely water-in-oil emulsion or asphaltene "
                       f"build-up). Twin updated; consider a demulsifier / hot-oil job.", severity="info", action=None)


def decide(alert_id, approve):
    a = next(a for a in S["alerts"] if a["id"] == alert_id)
    if a["status"] != "open":
        return snapshot()
    a["status"] = "approved" if approve else "rejected"
    a["decided"] = S["day"]
    if approve and a.get("action"):
        S["issued"] = S["actions"][alert_id]
    S["log"].append(dict(day=S["day"], kind="decision", text=f"Operator {a['status']}: {a['text'].split('.')[0]}"))
    return snapshot()


def snapshot():
    r = _field()
    days, oil, load_kn = _observed(r)
    d = S["day"]
    fit = S["fitted"] or S["planned"]
    f = simulate(S["x"], fit, DAYS, controller=False, spm_override=S["issued"])
    ahead = slice(d, DAYS)
    band = 0.04 + 0.002 * np.arange(DAYS - d)
    stage = "INJECTION" if d < r["inj_days"][0] else "SOAK" if d < S["prod_start"] else \
        "RE-STEAM DUE" if d >= r["cutoff_day"][0] else "PRODUCTION"
    return dict(
        well_id=S["well_id"], cycle=S["cycle"], day=d, stage=stage, mission=S["mission"],
        x={k: v[0] for k, v in S["x"].items()}, prod_start=S["prod_start"],
        inj_days=float(r["inj_days"][0]), t_steam=float(r["t_steam"][0]), r_heated=float(r["r_heated"][0]),
        truth_now=dict(t_res=float(r["t_res"][0, d]), mu_tub=float(r["mu_tub"][0, d]), spm=float(r["spm"][0, d]),
                       float_margin=float(r["float_margin"][0, d]), oil=float(r["oil"][0, d])),
        observed=dict(day=days.tolist(), oil=oil.round(2).tolist(), min_load_kn=load_kn.round(2).tolist(),
                      spm=r["spm"][0, days].round(2).tolist()),
        plan=S["plan_series"],
        forecast=dict(day=list(range(d, DAYS)), oil=f["oil"][0, ahead].round(2).tolist(),
                      lo=(f["oil"][0, ahead] * (1 - band)).round(2).tolist(), hi=(f["oil"][0, ahead] * (1 + band)).round(2).tolist(),
                      float_margin=f["float_margin"][0, ahead].round(3).tolist()),
        issued_spm=np.nan_to_num(S["issued"]).round(2).tolist(),
        twin={k: fit[k] for k in ("q_cold", "tau0", "drag_c")} | {f"planned_{k}": S["planned"][k] for k in ("q_cold", "tau0", "drag_c")},
        kpi=dict(cum_oil=float(oil.sum()), forecast_at_deadline=float(f["cum"][0, int(S["mission"]["deadline_d"]) - 1]),
                 float_days=S["float_seen"], resteam_day=int(f["cutoff_day"][0]), cum_kwh=float(r["cum_kwh"][0, max(d - 1, 0)])),
        alerts=S["alerts"], log=S["log"][-12:],
        complete=bool(d >= r["cutoff_day"][0]),
    )


def dyno_now():
    """Measured card at today's operating point on the real well."""
    r = _field()
    d = S["day"]
    return card(max(float(r["spm"][0, d]), P.MIN_SPM), S["x"]["stroke_m"][0], float(r["mu_tub"][0, d]),
                S["truth"]["drag_c"], float(np.clip(r["fillage"][0, d], 0.2, 1.0)))


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
                decide(a["id"], True)
        if s["complete"] or s["day"] >= DAYS - 1:
            break
    print("day", s["day"], "float days", s["kpi"]["float_days"], "cum", round(s["kpi"]["cum_oil"]), "resteam", s["kpi"]["resteam_day"])
    print(*[f"{l['day']:>3} {l['kind']}: {l['text']}" for l in s["log"]], sep="\n")
