# Architecture

## Request flow: `POST /api/mission`
1. `twin.field()` (cached, warmed at API start):
   - For every well, calibrate `(q_cold, tau0, drag_c, deg)` by least squares on log daily oil + dyno minimum load across all its past cycles.
   - Repeat leave-one-cycle-out for the conformal error quantile (80% coverage → P10–P90).
   - Build the envelope: this well's CSS ranges + the field's SRP ranges, padded 5%.
   - Run IsolationForest on daily SRP signatures.
2. `optimize.plan(mission)`:
   1. `candidates()`: 4,096 Sobol points. ¾ inside the envelope, ¼ over full engineering bounds, and the last row is the "1.5× steam" probe (E).
   2. `physics.simulate(x, well, 240, controller=True)`: every candidate for every day, vectorized.
   3. P50 = cum oil at deadline. P10/P90 = P50 × (1 ∓ q), doubled outside the envelope.
   4. Gates in order: frac → envelope → steam → energy → rod risk → P10 ≥ target. Counts form the funnel.
   5. Rank feasible plans by (steam cost + power cost + failure risk × workover) / P50.
   6. Pick A–E; baseline = median historical settings with constant SPM; evidence = 3 nearest past cycles; SPM schedule = daily SPM compressed to 0.25-SPM VFD steps.
3. `llm.explain()` runs separately via `/api/explain`, so the UI never waits on the LLM.

## Physics summary (`engine/physics.py`)
| Step | Model |
|---|---|
| Viscosity | Walther (ASTM D341) through (50 °C, 11,500 cP) and (200 °C, 12 cP) |
| Steam | Tsat(p) ≈ 100·(p/1.013)^0.25; Watson latent heat; wellbore quality loss grows with injection time |
| Heated zone | Heat × injection loss × soak efficiency ÷ (M_R·ΔT) → volume → radius over 20 m pay |
| Soak | (1 − 0.35·e^(−s/2))·e^(−s/60): interior optimum ≈ 4–5 d |
| Cooling | T(t) = T_res + (T_s − T_res)·e^(−t/τ), τ = τ0·(r_h/6)^0.8 |
| Inflow | Boberg–Lantz hot/cold radial flow; heating also clears asphaltene skin inside r_h |
| Pump | API displacement 0.1166·S(in)·N·D²; volumetric efficiency falls with viscosity |
| Rod float | Terminal rod fall speed = buoyant weight ÷ (drag_c·μ·L); safe SPM keeps peak downstroke speed ≤ fall speed / 1.25 |
| Loads | Mills acceleration factor; modified Goodman ratio on the top rod |
| Energy | Hydraulic + viscous friction power ÷ 0.55 + 1.2 kW idle |
| Controller | SPM(t) = clip(min(ceiling, fill-match, safe), 1, ceiling) |

## Operate modules
| Module | How it works |
|---|---|
| `dyno.card()` | Explicit FD on m·u_tt = EA·u_xx − c·u_t + m·g_b with 45 nodes. Damping c = drag_c·μ_tubing + structural. Top node follows the carrier and detaches when tension < 0 (rod float), then reattaches when the carrier returns. Pump node carries fluid load on the upstroke, and on the downstroke until the plunger crosses the unfilled fraction (fluid pound). Stroke direction comes from the carrier phase delayed by L/a. ~0.2 s per card. |
| `live` | Truth = well's hidden parameters × surprise (τ ×0.85, drag ×1.8). Observations = daily oil (5% noise) + dyno min load (3% noise) under the issued SPM. Every 2 days after 15 production days: least squares on (q_cold, τ0, drag_c) with log-normal priors (σ 0.5) on the historical values. Forecast under the issued schedule. Alerts: cooling deviation > 15%, drag deviation > 25%, float within 21 days → proposed SPM = min(issued, thermal-aware controller on the re-fitted twin). Rejected float alerts snooze 10 days. |
| `field` | Each well: best in-envelope cycle by net value (oil − steam − power − risk × workover), or median practice. When a generator frees up, it goes to the ready well with max (cycle oil − cold decline oil over the remaining horizon) / (injection + rig move days). The practice baseline rotates wells in fixed order. |
| `learn` | Validates columns, numeric ranges, duplicates, orphans and gaps; appends to `history.EXTRA`; clears the `twin.field`, `field.cycle_plan` and API caches; recalibrates; reports parameter/envelope/error deltas and plan-vs-actual using the SPM actually applied. |

## Honest limits
- Lumped single-zone thermal model. Upgrade path: train on CMG STARS runs and swap exhaustive search for Bayesian optimization.
- Failure hazard weights are hand-set (`ponytail:` note in code); refit on OIL's failure log.
- Live Ops runs one in-memory session and the learning overlay is in-memory. Both need a database for multi-user or persistent use.
- Dyno diagnosis is rule-based on the solved card; a CNN trained on real OIL cards should replace it.
- All `ASSUMED` values in `params.py` await field data.
