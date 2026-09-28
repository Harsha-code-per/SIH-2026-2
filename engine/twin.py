"""Well-specific digital twin = physics model + parameters history-matched to
this well + an honest error model + the envelope where it is trustworthy.
"""
from functools import cache

import numpy as np
from scipy.optimize import least_squares
from sklearn.ensemble import IsolationForest

from . import params as P
from .history import DAYS, load
from .physics import simulate

FIT = ("q_cold", "tau0", "drag_c", "deg")
LO, HI = np.array([1.0, 8.0, 1.0, 0.85]), np.array([15.0, 80.0, 10.0, 1.0])
COVERAGE = 0.80  # P10–P90


def _xs(cyc):
    return {k: np.array([c[k] for c in cyc]) for k in P.DECISIONS}


def _well(theta, cycle):
    return dict(zip(FIT, theta), skin=P.SKIN_COLD, cycle=np.asarray(cycle, float))


def calibrate(cyc, day):
    """History match: daily oil (log space) + dyno minimum load, all cycles at once."""
    nums = [int(c["cycle"]) for c in cyc]
    row = {n: i for i, n in enumerate(nums)}
    obs = [d for d in day if int(d["cycle"]) in row][::2]
    ci = np.array([row[int(d["cycle"])] for d in obs])
    di = np.array([int(d["day"]) for d in obs])
    oil = np.log1p([d["oil_bpd"] for d in obs])
    load_kn = np.array([d["min_load_kn"] for d in obs])
    x = _xs(cyc)

    def resid(theta):
        r = simulate(x, _well(theta, nums), DAYS, controller=False)
        fm = r["float_margin"][ci, di]
        sim_load = np.maximum(P.ROD_WEIGHT_BUOYANT_N * (1 - 1 / fm), 0) / 1e3
        return np.concatenate([np.log1p(r["oil"][ci, di]) - oil, (sim_load - load_kn) / 4.0])

    fit = least_squares(resid, x0=[5.0, 30.0, 4.0, 0.96], bounds=(LO, HI))
    return fit.x


def _cum(theta, cyc):
    r = simulate(_xs(cyc), _well(theta, [c["cycle"] for c in cyc]), DAYS, controller=False)
    return np.array([r["oil"][i, :int(c["cycle_days"])].sum() for i, c in enumerate(cyc)])


@cache
def field():
    """Calibrate every well, leave-one-cycle-out conformal error, envelopes, anomalies."""
    wells, cycles, daily = load()
    by = lambda rows, wid: [r for r in rows if r["well_id"] == wid]
    twins, errors = {}, []
    for w in wells:
        wid = w["well_id"]
        cyc, day = by(cycles, wid), by(daily, wid)
        for k in range(len(cyc)):  # honest error: predict each past cycle without seeing it
            rest = cyc[:k] + cyc[k + 1:]
            theta = calibrate(rest, day)
            errors.append(_cum(theta, [cyc[k]])[0] / cyc[k]["cum_oil_bbl"] - 1)
        theta = calibrate(cyc, day)
        twins[wid] = dict(theta=dict(zip(FIT, theta.round(4))), cycles=cyc,
                          fit_cum=_cum(theta, cyc).round(0).tolist(), anomalies=_anomalies(cyc, day))
    errors = np.abs(errors)
    n = len(errors)
    q = float(np.quantile(errors, min(1.0, np.ceil((n + 1) * COVERAGE) / n)))
    srp = {k: (min(c[k] for c in cycles), max(c[k] for c in cycles)) for k in ("stroke_m", "spm_max")}
    for t in twins.values():
        env = {k: (min(c[k] for c in t["cycles"]), max(c[k] for c in t["cycles"])) for k in ("steam_t", "inj_p_bar", "soak_d")}
        env.update(srp)
        t["envelope"] = {k: (lo - 0.05 * (hi - lo), hi + 0.05 * (hi - lo)) for k, (lo, hi) in env.items()}
    return dict(twins=twins, conformal_q=q, loco_mape=float(errors.mean()), n_holdout=n, wells=wells)


def _anomalies(cyc, day):
    """IsolationForest on daily SRP signatures; report lead time before logged failures."""
    feats = np.array([[d["min_load_kn"], d["kwh"] / (d["oil_bpd"] + 1), d["spm"]] for d in day])
    flag = IsolationForest(contamination=0.06, random_state=0).fit_predict(feats) == -1
    out = []
    for c in cyc:
        days = [int(d["day"]) for d, f in zip(day, flag) if f and d["cycle"] == c["cycle"]]
        first = min(days) if days else None
        before = [d for d in days if c["rod_failure"] and 0 < c["failure_day"] - d <= 30]  # warning window
        lead = int(c["failure_day"] - min(before)) if before else None
        out.append(dict(cycle=int(c["cycle"]), anomaly_days=len(days), first_anomaly_day=first,
                        rod_failure=bool(c["rod_failure"]), lead_days=lead))
    return out


def in_envelope(env, x):
    """Boolean mask + per-variable violations for candidate dict-of-arrays x."""
    bad = {k: (x[k] < lo) | (x[k] > hi) for k, (lo, hi) in env.items()}
    return ~np.any(list(bad.values()), axis=0), bad


def well_model(wid, cycle):
    t = field()["twins"][wid]
    return dict(t["theta"], skin=P.SKIN_COLD, cycle=cycle)


def state(wid):
    """Current well state at the end of its last cycle, as the twin sees it."""
    f = field()
    t = f["twins"][wid]
    last = t["cycles"][-1]
    r = simulate({k: [last[k]] for k in P.DECISIONS}, well_model(wid, last["cycle"]), DAYS, controller=False)
    end = int(last["cycle_days"]) - 1
    return dict(
        well_id=wid, next_cycle=int(last["cycle"]) + 1, cycles_done=len(t["cycles"]),
        reservoir_temp_c=round(float(r["t_res"][0, end]), 1), tubing_visc_cp=round(float(r["mu_tub"][0, end])),
        oil_rate_bopd=round(float(r["oil"][0, end]), 1), spm=float(last["spm_max"]),
        float_margin=round(float(r["float_margin"][0, end]), 2),
        rod_failures=int(sum(c["rod_failure"] for c in t["cycles"])), last_cycle=last,
        calibrated=t["theta"], envelope=t["envelope"], anomalies=t["anomalies"],
        history_steam_t=(min(c["steam_t"] for c in t["cycles"]), max(c["steam_t"] for c in t["cycles"])),
    )
