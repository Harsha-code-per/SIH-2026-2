"""Engine self-check.  Run: .venv/bin/python -m engine.test_engine"""
import numpy as np

from . import llm, optimize, params as P, physics as ph


def test():
    mu = ph.viscosity_cp(np.array([50, 60, 100, 200, 300]))
    assert 10_000 <= mu[0] <= 13_000 and np.all(np.diff(mu) < 0), mu

    soak = ph.soak_efficiency(np.linspace(1, 12, 45))
    assert 0 < soak.argmax() < len(soak) - 1, "soak efficiency must have an interior optimum"

    cold, hot = ph.safe_spm(np.array([15_000.0, 50.0]), 2.2, 4.5)
    assert cold < 3 < hot, (cold, hot)

    res = optimize.plan(optimize.DEMO)
    m, rec = res["mission"], res["recommended"]
    assert res["feasible"]
    assert rec["p10"] >= m["target_bbl"] and rec["x"]["steam_t"] <= m["steam_budget_t"]
    assert rec["energy_kwh"] <= m["energy_budget_kwh"] and rec["x"]["inj_p_bar"] <= P.FRAC_LIMIT_BAR
    assert rec["in_envelope"] and rec["float_days"] == 0
    fm = np.array(rec["series"]["float_margin"])[int(np.ceil(rec["prod_start"])):rec["resteam_day"]]
    assert fm.min() >= 1.0, fm.min()
    assert rec["failure_risk"] < res["baseline"]["failure_risk"] and rec["cost_per_bbl"] < res["baseline"]["cost_per_bbl"]

    e = next(s for s in res["strategies"] if s["label"] == "E")
    assert not e["in_envelope"] and "steam_t" in e["out_of_envelope"]
    assert rec["cost_per_bbl"] <= min(s["cost_per_bbl"] for s in res["strategies"] if s["label"] == "B")

    facts = llm._facts(res)
    assert llm.guard(llm._template(facts), facts)
    assert not llm.guard("Expect 2,345 bbl at 777 bar.", facts)
    assert llm._regex_parse("1,600 barrels in 90 days, 1000 t steam, 6.5 MWh") == dict(
        target_bbl=1600, deadline_d=90, steam_budget_t=1000, energy_budget_kwh=6500)
    print("engine OK")


if __name__ == "__main__":
    test()
