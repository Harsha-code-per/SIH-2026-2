"""Mission → counterfactual search on the twin → one explainable operating plan."""
import time

import numpy as np
from scipy.stats import qmc

from . import params as P
from . import twin
from .history import DAYS
from .physics import simulate

N_CANDIDATES = 4096
ROUND = {"steam_t": 10, "inj_p_bar": 1, "soak_d": 0.5, "stroke_m": 0.1, "spm_max": 0.1}
SERIES = ("t_res", "mu_tub", "oil", "cum", "spm", "safe_spm", "float_margin", "cum_kwh", "fillage")


def co2(steam_t, kwh):
    """Tonnes CO2: steam generation + grid power for the pump."""
    return steam_t * P.CO2_T_PER_T_STEAM + kwh * P.CO2_T_PER_KWH


def candidates(env, n=N_CANDIDATES, seed=7):
    """3/4 of the search inside the validated envelope, 1/4 exploring the full
    engineering bounds (so the operator sees what was considered and why it was refused)."""
    # ponytail: exhaustive quasi-random search is fine on a ms-fast twin; swap in BayesOpt for a full simulator
    sob = qmc.Sobol(len(P.DECISIONS), seed=seed).random(n)
    lo, hi = np.array([P.BOUNDS[k] for k in P.DECISIONS]).T
    elo, ehi = np.array([env[k] for k in P.DECISIONS]).T
    focus = np.arange(n) % 4 != 0
    u = np.where(focus[:, None], elo + sob * (ehi - elo), lo + sob * (hi - lo))
    return {k: np.round(u[:, i] / ROUND[k]) * ROUND[k] for i, k in enumerate(P.DECISIONS)}


def _pick(x, i):
    return {k: float(x[k][i]) for k in P.DECISIONS}


def spm_schedule(spm, start, end):
    """Compress the daily SPM trajectory into operator-friendly VFD steps (0.25 SPM)."""
    steps, cur = [], None
    for d in range(int(np.ceil(start)), int(end)):
        s = round(float(spm[d]) * 4) / 4
        if s != cur:
            steps.append(dict(from_day=d, spm=s, vfd_hz=round(s / P.SPM_PER_HZ, 1)))
            cur = s
    return [s for i, s in enumerate(steps) if i == len(steps) - 1 or steps[i + 1]["from_day"] - s["from_day"] >= 3]


def plan(m):
    """m: well_id, target_bbl, deadline_d, steam_budget_t, energy_budget_kwh."""
    f = twin.field()
    tw = f["twins"][m["well_id"]]
    st = twin.state(m["well_id"])
    well = twin.well_model(m["well_id"], st["next_cycle"])
    q = f["conformal_q"]
    D = int(m["deadline_d"]) - 1

    env = tw["envelope"]
    x = candidates(env)
    # counterfactual probe "E": typical settings but 1.5× the most steam this well has ever taken
    for k in P.DECISIONS:
        x[k][-1] = np.round(sum(env[k]) / 2 / ROUND[k]) * ROUND[k]
    x["steam_t"][-1] = min(np.round(1.5 * env["steam_t"][1], -1), P.BOUNDS["steam_t"][1])
    t0 = time.perf_counter()
    r = simulate(x, well, DAYS)
    sim_ms = (time.perf_counter() - t0) * 1e3
    inside, bad = twin.in_envelope(tw["envelope"], x)
    p50 = r["cum"][:, D]
    band = np.where(inside, q, 2 * q)  # outside validated history the twin is extrapolating
    p10, p90 = p50 * (1 - band), p50 * (1 + band)
    energy = r["cum_kwh"][:, D]
    cost = x["steam_t"] * P.STEAM_COST_PER_T + energy * P.POWER_COST_PER_KWH + r["failure_risk"] * P.WORKOVER_COST

    gates = [  # (name, rejection reason, pass mask) applied in order → elimination funnel
        ("frac", "injection pressure above frac limit", x["inj_p_bar"] <= P.FRAC_LIMIT_BAR),
        ("envelope", "outside validated operating envelope", inside),
        ("steam", "steam over budget", x["steam_t"] <= m["steam_budget_t"]),
        ("energy", "SRP energy over budget", energy <= m["energy_budget_kwh"]),
        ("rod", "rod-float / failure risk too high", (r["float_days"] == 0) & (r["failure_risk"] <= P.MAX_FAILURE_RISK)),
        ("target", "P10 production misses target by deadline", p10 >= m["target_bbl"]),
    ]
    alive, funnel = np.ones(len(p50), bool), []
    best_p10 = 0.0
    for name, why, ok in gates:
        if name == "target":  # best pessimistic outcome any safe, in-budget, validated plan can reach
            best_p10 = float(p10[alive].max()) if alive.any() else 0.0
        funnel.append(dict(gate=name, reason=why, rejected=int((alive & ~ok).sum())))
        alive &= ok
    ok = {name: g for name, _, g in gates}
    feasible = alive
    if not feasible.any():
        return dict(mission=m, feasible=False, funnel=funnel, n=len(p50), best_p10=round(best_p10),
                    message="No strategy meets the mission inside the validated envelope. Relax target, deadline or budget.")
    score = np.where(feasible, cost / p50, np.inf)
    c = int(np.argmin(score))

    safe = ok["frac"] & ok["rod"]
    budget = ok["steam"] & ok["energy"]
    idx = np.arange(len(p50))
    def best(mask, key):
        return int(idx[mask][np.argmax(key[mask])]) if mask.any() else None
    picks = {
        "A": best(safe & inside & budget & ~ok["target"], -x["steam_t"]),
        "B": best(feasible & (np.abs(x["steam_t"] - x["steam_t"][c]) >= 100), -score),
        "C": c,
        "D": best(safe & inside & ~budget, p50),
        "E": len(p50) - 1,
    }
    verdicts = {"A": "Misses target at P10", "B": "Feasible, higher cost per barrel", "C": "RECOMMENDED",
                "D": "Breaks steam/energy budget", "E": "Outside validated envelope: excluded"}

    def summary(i, label):
        return dict(
            label=label, verdict=verdicts.get(label, ""), x=_pick(x, i),
            p10=round(float(p10[i])), p50=round(float(p50[i])), p90=round(float(p90[i])),
            sor=round(float(x["steam_t"][i] / (p50[i] * 0.159)), 2),  # m3 steam CWE / m3 oil
            energy_kwh=round(float(energy[i])), kwh_per_bbl=round(float(energy[i] / p50[i]), 1),
            cost_per_bbl=round(float(cost[i] / p50[i])), failure_risk=round(float(r["failure_risk"][i]), 3),
            co2_t=round(float(co2(x["steam_t"][i], energy[i])), 1),
            float_days=int(r["float_days"][i]), in_envelope=bool(inside[i]),
            out_of_envelope=[k for k, b in bad.items() if b[i]],
            day_target=int(np.argmax(r["cum"][i] >= m["target_bbl"])) + 1 if (r["cum"][i] >= m["target_bbl"]).any() else None,
            cum=r["cum"][i, :DAYS].round(0).tolist(),
        )

    strategies = [summary(i, k) for k, i in picks.items() if i is not None]
    rec = next(s for s in strategies if s["label"] == "C")
    rec["series"] = {k: np.round(r[k][c], 2).tolist() for k in SERIES}
    rec["prod_start"] = round(float(r["prod_start"][c]), 1)
    rec["inj_days"] = round(float(r["inj_days"][c]), 1)
    rec["t_steam"] = round(float(r["t_steam"][c]), 0)
    rec["r_heated"] = round(float(r["r_heated"][c]), 1)
    rec["resteam_day"] = int(r["cutoff_day"][c])
    rec["spm_schedule"] = spm_schedule(r["spm"][c], r["prod_start"][c], min(r["cutoff_day"][c], DAYS))

    # Baseline: this well's typical manual practice (median historical settings, constant SPM)
    last = {k: [float(np.median([cy[k] for cy in tw["cycles"]]))] for k in P.DECISIONS}
    b = simulate(last, well, DAYS, controller=False)
    base = dict(x={k: v[0] for k, v in last.items()}, p50=round(float(b["cum"][0, D])),
                energy_kwh=round(float(b["cum_kwh"][0, D])), float_days=int(b["float_days"][0]),
                failure_risk=round(float(b["failure_risk"][0]), 3),
                sor=round(float(last["steam_t"][0] / (b["cum"][0, D] * 0.159)), 2),
                series={k: np.round(b[k][0], 2).tolist() for k in SERIES},
                prod_start=round(float(b["prod_start"][0]), 1), inj_days=round(float(b["inj_days"][0]), 1),
                t_steam=round(float(b["t_steam"][0])), r_heated=round(float(b["r_heated"][0]), 1),
                resteam_day=int(b["cutoff_day"][0]))
    base["co2_t"] = round(float(co2(last["steam_t"][0], base["energy_kwh"])), 1)
    base["cost_per_bbl"] = round((last["steam_t"][0] * P.STEAM_COST_PER_T + base["energy_kwh"] * P.POWER_COST_PER_KWH
                                  + base["failure_risk"] * P.WORKOVER_COST) / base["p50"])

    rc = rec["x"]
    scale = {k: (P.BOUNDS[k][1] - P.BOUNDS[k][0]) for k in ("steam_t", "inj_p_bar", "soak_d")}
    evidence = sorted(tw["cycles"], key=lambda cy: sum(((cy[k] - rc[k]) / s) ** 2 for k, s in scale.items()))[:3]
    evidence = [dict(cycle=int(e["cycle"]), steam_t=e["steam_t"], inj_p_bar=e["inj_p_bar"], soak_d=e["soak_d"],
                     cum_oil_bbl=e["cum_oil_bbl"], rod_failure=bool(e["rod_failure"]), float_days=int(e["float_days"]))
                for e in evidence]

    th = tw["theta"]
    trace = [
        f"Loaded {len(tw['cycles'])} historical CSS cycles and {sum(int(cy['cycle_days']) for cy in tw['cycles'])} days of SRP data for {m['well_id']}",
        f"Twin calibrated: cold rate {th['q_cold']:.1f} bopd, cooling constant {th['tau0']:.0f} d, rod-drag factor {th['drag_c']:.2f}",
        f"Hold-out check on {f['n_holdout']} past cycles: {f['loco_mape'] * 100:.1f}% mean error, P10–P90 band ±{q * 100:.0f}%",
        f"Current state: reservoir {st['reservoir_temp_c']} °C, tubing oil {st['tubing_visc_cp']:,} cP, float margin {st['float_margin']}",
        f"Generated {len(p50):,} candidate CSS + SRP strategies",
        f"Simulated {len(p50):,} strategies × {DAYS} days in {sim_ms:.0f} ms",
        *[f"✗ {g['rejected']:,} rejected: {g['reason']}" if g["rejected"] else
          "✓ Rod-float risk: none. Thermal-aware SPM keeps rods falling freely" for g in funnel],
        f"✓ {int(feasible.sum()):,} feasible strategies remain",
        "Selected lowest cost per barrel with P10 ≥ target",
    ]
    return dict(mission=m, feasible=True, n=len(p50), funnel=funnel, trace=trace, state=st, best_p10=round(best_p10),
                strategies=strategies, recommended=rec, baseline=base, evidence=evidence,
                conformal_q=q, loco_mape=f["loco_mape"], days=DAYS)


def suggest(wid):
    """A stretch mission this well can meet: 95% of the best P10 any safe, in-budget, validated plan reaches."""
    if wid == DEMO["well_id"]:
        return dict(DEMO)
    st = twin.state(wid)
    cyc = twin.field()["twins"][wid]["cycles"]
    x = {k: [float(np.median([c[k] for c in cyc]))] for k in P.DECISIONS}
    r = simulate(x, twin.well_model(wid, st["next_cycle"]), DAYS, controller=False)
    m = dict(well_id=wid, target_bbl=100.0, deadline_d=90.0, steam_budget_t=1000.0,
             energy_budget_kwh=float(round(r["cum_kwh"][0, 89] * 1.2, -2)))
    return dict(m, target_bbl=float(round(plan(m)["best_p10"] * 0.95, -1)))


DEMO = dict(well_id="BGW-08", target_bbl=1600, deadline_d=90, steam_budget_t=1000, energy_budget_kwh=7000)

if __name__ == "__main__":
    out = plan(DEMO)
    print("\n".join(out["trace"]))
    for s in out["strategies"]:
        print(s["label"], s["verdict"], s["x"], s["p10"], s["p50"], s["p90"], "SOR", s["sor"], "kWh", s["energy_kwh"], "₹/bbl", s["cost_per_bbl"], "risk", s["failure_risk"], s["out_of_envelope"], "day", s["day_target"])
    b = out["baseline"]
    print("BASE", b["x"], b["p50"], "kWh", b["energy_kwh"], "float", b["float_days"], "risk", b["failure_risk"], "SOR", b["sor"], "₹/bbl", b["cost_per_bbl"])
    print("SPM", out["recommended"]["spm_schedule"], "resteam", out["recommended"]["resteam_day"])
    print("EVID", out["evidence"])
