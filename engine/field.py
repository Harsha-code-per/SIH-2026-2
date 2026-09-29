"""Field steam scheduler: which well gets the steam generator next.

Steam generators are the scarce resource (OIL steamed 19 of 33 wells last year).
Each well's twin gives its best cycle plan and what it will do if left cold. The
scheduler hands a free generator to the well with the most incremental oil per
generator-day, and compares against today's practice: steaming wells in turn with
their usual settings and constant SPM.
"""
from functools import lru_cache

import numpy as np

from . import params as P
from . import twin
from .history import DAYS
from .optimize import candidates
from .physics import simulate

COLD_DECLINE_D = 250.0


@lru_cache(maxsize=None)
def cycle_plan(wid, policy):
    """One cycle for this well. 'twin': best net value inside its envelope with the
    thermal-aware SPM controller. 'practice': median historical settings, constant SPM."""
    st = twin.state(wid)
    well = twin.well_model(wid, st["next_cycle"])
    if policy == "twin":
        env = twin.field()["twins"][wid]["envelope"]
        x = candidates(env, n=1024)
        x = {k: v[twin.in_envelope(env, x)[0]] for k, v in x.items()}
        r = simulate(x, well, DAYS)
    else:
        cyc = twin.field()["twins"][wid]["cycles"]
        x = {k: np.array([np.median([c[k] for c in cyc])]) for k in P.DECISIONS}
        r = simulate(x, well, DAYS, controller=False)
    live = np.arange(DAYS)[None, :] < r["cutoff_day"][:, None]
    oil = np.where(live, r["oil"], 0.0)
    kwh = np.where(live, r["kwh"], 0.0).sum(1)
    value = (oil.sum(1) * P.OIL_PRICE_PER_BBL - x["steam_t"] * P.STEAM_COST_PER_T
             - kwh * P.POWER_COST_PER_KWH - r["failure_risk"] * P.WORKOVER_COST)
    i = int(np.argmax(value))
    return dict(x={k: float(v[i]) for k, v in x.items()}, oil=oil[i], inj_days=float(r["inj_days"][i]),
                cutoff=int(r["cutoff_day"][i]), steam_t=float(x["steam_t"][i]), kwh=float(kwh[i]),
                float_days=int(r["float_days"][i]), failure_risk=float(r["failure_risk"][i]),
                rate_now=st["oil_rate_bopd"])


def _cold(rate, days):
    return rate * np.exp(-np.arange(days) / COLD_DECLINE_D)


def schedule(generators=1, horizon=180, plans="twin", order="value", maintenance=(), outages=()):
    """maintenance: (generator 1..G, start_d, end_d) windows when a generator is down.
    outages: (well_id, start_d, end_d) windows when a well cannot be steamed (workover, access)."""
    wells = list(twin.field()["twins"])
    pl = {w: cycle_plan(w, plans) for w in wells}
    free = [0.0] * generators
    ready = {w: 0.0 for w in wells}
    skip = set()
    jobs, turn = [], 0

    def gain(w, t):
        """Incremental oil over the rest of the horizon if steaming starts at t, per generator-day."""
        s = t + P.RIG_MOVE_D
        n = int(max(horizon - s, 0))
        cyc = pl[w]["oil"][:n].sum()
        cold = _cold(pl[w]["rate_now"] * np.exp(-s / COLD_DECLINE_D), n).sum()
        return (cyc - cold) / (pl[w]["inj_days"] + P.RIG_MOVE_D)

    while True:
        g = int(np.argmin(free))
        t = free[g]
        if t >= horizon:
            break
        down = next((e for gg, s0, e in maintenance if gg == g + 1 and s0 <= t < e), None)
        if down is not None:  # generator in maintenance
            free[g] = down
            continue
        for ww, s0, e in outages:  # well unavailable for any part of the injection it would get
            if ww in ready and s0 < t + P.RIG_MOVE_D + pl[ww]["inj_days"] and e > t + P.RIG_MOVE_D:
                ready[ww] = max(ready[ww], e - P.RIG_MOVE_D)
        cands = [w for w in wells if ready[w] <= t and w not in skip]
        if not cands:
            later = [ready[w] for w in wells if w not in skip and ready[w] > t]
            if not later:
                break
            free[g] = min(later)
            continue
        if order == "value":
            w = max(cands, key=lambda w: gain(w, t))
            if gain(w, t) <= 0:
                skip.add(w)
                continue
        else:  # today's practice: the generator moves along the wells in turn
            ordered = wells[turn:] + wells[:turn]
            w = next(w for w in ordered if w in cands)
        start = t + P.RIG_MOVE_D
        clash = next((e for gg, s0, e in maintenance if gg == g + 1 and s0 < start + pl[w]["inj_days"] and e > t), None)
        if clash is not None:  # the job would run into planned maintenance: wait it out (the well keeps its turn)
            free[g] = clash
            continue
        if order != "value":
            turn = (wells.index(w) + 1) % len(wells)
        free[g] = start + pl[w]["inj_days"]
        ready[w] = start + pl[w]["cutoff"]
        jobs.append(dict(well_id=w, generator=g + 1, start=round(start, 1), inj_days=round(pl[w]["inj_days"], 1),
                         steam_t=pl[w]["steam_t"], cycle_end=round(start + pl[w]["cutoff"], 1),
                         gain_per_gen_day=round(float(gain(w, t)), 1), x=pl[w]["x"]))

    # field production: cold decline until steamed, the cycle, then cold decline from the cycle's last rate
    per_well = {}
    for w in wells:
        q = _cold(pl[w]["rate_now"], horizon)
        for j in sorted((j for j in jobs if j["well_id"] == w), key=lambda j: j["start"]):
            s = int(j["start"])
            if s >= horizon:
                continue
            seg = pl[w]["oil"][:pl[w]["cutoff"]]
            n = min(len(seg), horizon - s)
            q[s:s + n] = seg[:n]
            tail = horizon - (s + n)
            if tail > 0:
                q[s + n:] = _cold(max(seg[-1], 1.0), tail)
        per_well[w] = q
    total = sum(per_well.values())
    done = [j for j in jobs if j["start"] < horizon]
    steam = sum(j["steam_t"] for j in done)
    oil = float(total.sum())
    return dict(
        jobs=done, field_oil=total.round(1).tolist(), per_well={w: q.round(1).tolist() for w, q in per_well.items()},
        kpi=dict(oil_bbl=round(oil), steam_t=round(steam), sor=round(steam / (oil * 0.159), 2) if oil else None,
                 wells_steamed=len({j["well_id"] for j in done}), cycles=len(done),
                 float_days=sum(pl[j["well_id"]]["float_days"] for j in done),
                 expected_failures=round(sum(pl[j["well_id"]]["failure_risk"] for j in done), 1),
                 co2_t=round(steam * P.CO2_T_PER_T_STEAM + sum(pl[j["well_id"]]["kwh"] for j in done) * P.CO2_T_PER_KWH),
                 net_value_cr=round((oil * P.OIL_PRICE_PER_BBL - steam * P.STEAM_COST_PER_T
                                     - sum(pl[j["well_id"]]["failure_risk"] for j in done) * P.WORKOVER_COST) / 1e7, 2)),
        generators=generators, horizon=horizon, plans=plans, order=order,
        maintenance=[dict(generator=g, start=s0, end=e) for g, s0, e in maintenance],
        outages=[dict(well_id=w, start=s0, end=e) for w, s0, e in outages],
    )


def compare(generators=1, horizon=180, maintenance=(), outages=()):
    base = schedule(generators, horizon, "practice", "rotation", maintenance, outages)
    seq = schedule(generators, horizon, "practice", "value", maintenance, outages)
    ours = schedule(generators, horizon, "twin", "value", maintenance, outages)
    return dict(practice=base, sequencing_only=seq, welltwin=ours)


if __name__ == "__main__":
    for g in (1, 2):
        c = compare(g)
        for k, v in c.items():
            print(g, k, v["kpi"], [(j["well_id"], j["start"]) for j in v["jobs"]][:10])
