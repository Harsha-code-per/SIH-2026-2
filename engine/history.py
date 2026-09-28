"""Field history: synthetic Baghewala generator + CSV loader for real OIL exports.

SYNTHETIC DATA. No public Baghewala dataset exists (the PS dataset link is blank).
Each well gets hidden "true" parameters. Its past cycles are run under manual
practice (constant SPM) with effects the twin does NOT model: cycle-to-cycle
reservoir variability and daily measurement noise. The twin must then recover the
well from this history, the same way it would from real data.

Real data: export three CSVs with the same columns and point load() at the folder.
"""
import csv
from pathlib import Path

import numpy as np

from . import params as P
from .physics import simulate

DATA = Path(__file__).resolve().parent.parent / "data"
DAYS = 240


def _generate(seed=26120, n_wells=8):
    rng = np.random.default_rng(seed)
    wells, cycles, daily = [], [], []
    for w in range(n_wells):
        wid = f"BGW-{w + 1:02d}"
        truth = dict(q_cold=rng.uniform(3.5, 6.5), skin=P.SKIN_COLD, tau0=rng.uniform(22, 36),
                     drag_c=rng.uniform(3.5, 5.0), deg=rng.uniform(0.94, 0.98))
        n = int(rng.integers(6, 10))
        x = dict(steam_t=rng.uniform(550, 1150, n).round(-1), inj_p_bar=rng.uniform(85, 125, n).round(),
                 soak_d=rng.integers(3, 8, n).astype(float), stroke_m=rng.choice([1.9, 2.2, 2.5], n),
                 spm_max=rng.uniform(2.5, 4.5, n).round(1))
        # unmodeled cycle-to-cycle variability: the twin sees it only as error
        well = dict(truth, cycle=np.arange(1, n + 1), q_cold=truth["q_cold"] * rng.lognormal(0, 0.08, n))
        r = simulate(x, well, DAYS, controller=False)
        wells.append(dict(well_id=wid, cycles=n, pump_depth_m=P.PUMP_DEPTH, **{f"true_{k}": round(v, 4) for k, v in truth.items()}))
        for c in range(n):
            length = int(min(r["cutoff_day"][c], 150))
            failed = rng.random() < r["failure_risk"][c]
            fdays = np.flatnonzero(r["float_margin"][c, :length] < 1.0)
            fail_day = int(fdays[0]) if failed and fdays.size else (int(rng.integers(60, length)) if failed else "")
            oil = r["oil"][c, :length] * rng.lognormal(0, 0.06, length)
            cycles.append(dict(
                well_id=wid, cycle=c + 1, **{k: float(x[k][c]) for k in P.DECISIONS},
                cycle_days=length, cum_oil_bbl=round(oil.sum(), 1), cum_kwh=round(r["kwh"][c, :length].sum()),
                float_days=int(r["float_days"][c]), rod_failure=int(failed), failure_day=fail_day))
            w_b = P.ROD_WEIGHT_BUOYANT_N
            for d in range(int(np.ceil(r["prod_start"][c])), length):
                fm = r["float_margin"][c, d]
                daily.append(dict(well_id=wid, cycle=c + 1, day=d, oil_bpd=round(oil[d], 2),
                                  spm=round(r["spm"][c, d], 2), kwh=round(r["kwh"][c, d], 1),
                                  # dyno-card minimum polished-rod load: goes to ~0 when rods float
                                  min_load_kn=round(max(w_b - w_b / fm, 0) / 1e3 * rng.normal(1, 0.03), 2)))
    return wells, cycles, daily


def _write(name, rows):
    with open(DATA / name, "w", newline="") as f:
        wr = csv.DictWriter(f, fieldnames=list(rows[0]))
        wr.writeheader()
        wr.writerows(rows)


def _read(name):
    with open(DATA / name) as f:
        return [{k: (float(v) if v.replace(".", "", 1).replace("-", "", 1).isdigit() else v) for k, v in r.items()}
                for r in csv.DictReader(f)]


def load():
    """Returns (wells, cycles, daily) as lists of dicts; generates synthetic data on first run."""
    if not (DATA / "cycles.csv").exists():
        DATA.mkdir(exist_ok=True)
        for name, rows in zip(("wells.csv", "cycles.csv", "daily.csv"), _generate()):
            _write(name, rows)
    return _read("wells.csv"), _read("cycles.csv"), _read("daily.csv")


if __name__ == "__main__":
    wells, cycles, daily = load()
    for c in cycles:
        print(c["well_id"], int(c["cycle"]), c["steam_t"], c["spm_max"], c["cum_oil_bbl"], c["float_days"], c["rod_failure"])
