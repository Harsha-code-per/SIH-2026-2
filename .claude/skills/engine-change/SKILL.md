---
name: engine-change
description: Safely change the WellTwin physics, calibration, uncertainty or optimizer (engine/*.py), keeping the demo story and honesty invariants intact. Use for any edit under engine/.
---

# Changing the engine

## Before editing
- Read `CLAUDE.md` invariants. Trace the flow: `params → physics.simulate → history (synthetic data) → twin.calibrate/field → optimize.plan → api → UI`.
- `simulate()` is shared by history generation, calibration, the optimizer and what-if. A change there changes **everything**, including the synthetic data.

## Rules
- Constants go in `engine/params.py` with a source comment, or an `ASSUMED` tag.
- Keep functions vectorized over the candidate axis. `simulate` must stay under ~0.5 s for 4,096 × 240 days.
- A new output the UI needs: add it to `optimize.SERIES` (daily arrays) or the strategy `summary()` dict. Then add it to `web/src/api.ts` types.
- A new constraint: add a `(name, reason, pass_mask)` tuple to `gates` in `optimize.plan`. Order matters (it is the funnel).

## After editing
1. `make test`.
2. If physics or history changed: `make data`, then `.venv/bin/python -m engine.optimize` and check the demo story:
   - A misses at P10
   - C recommended
   - D over budget
   - E out of envelope (steam only)
   - baseline has float days > 0
   - C cost/bbl < baseline
3. If the story broke, scan wells for a new demo mission:
   ```python
   from engine import optimize as o, twin
   for wid in twin.field()['twins']:
       b = o.plan(dict(well_id=wid, target_bbl=100, deadline_d=90, steam_budget_t=2000, energy_budget_kwh=50000))['baseline']
       m = dict(well_id=wid, target_bbl=round(b['p50']*0.95, -1), deadline_d=90, steam_budget_t=1000, energy_budget_kwh=round(b['energy_kwh']*1.1, -2))
       r = o.plan(m); print(wid, b['float_days'], r['feasible'] and r['recommended']['cost_per_bbl'], b['cost_per_bbl'])
   ```
   Update `optimize.DEMO` and `DEFAULT` in `web/src/App.tsx` together.
4. `make restart` and walk the UI (skill `run-and-verify`).
5. Update any numbers quoted in `docs/` and `README.md`. They must match the new output.
