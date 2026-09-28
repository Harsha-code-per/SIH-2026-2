# SIH26120: Research Brief

## 1. The field
| Fact | Value | Source |
|---|---|---|
| Location | Bikaner–Nagaur sub-basin, Rajasthan; discovered 1991; 200.26 km² | oil-india.com/rajasthan-fields |
| Wells | 52 drilled, 33 operational | BusinessToday, Apr 2026 |
| Reservoir | Jodhpur Sandstone, ~1,150 m | SPE APOG 2023-535203 |
| Crude | 17–19° API (PS) / 14–17° (OIL); **10,000–13,000 cP @ 50 °C**; high asphaltene | SIH PS 26120, OIL |
| Reservoir temperature | 46–48 °C, low pressure | SIH PS 26120 |
| Lift | Sucker-rod pumps (incl. hydraulic SRP), pump ~1,100 m; downhole electric heaters; thermal wellheads | OIL, SPE APOG 2023 |
| CSS | First in India at Baghewala; pilot gave 5–6× production; **19 wells steamed in FY25-26 (+72%)** | OIL / BusinessToday |
| Output | 43,773 t (FY26) vs 32,787 t (FY25) from Rajasthan | BusinessToday, Apr 2026 |
| Failures | Rod/tubing failure study on an Indian western oil field | SPE J 28(03) 2023 |

## 2. The real pain point (why CSS and SRP must be optimized together)
Steam heats the zone around the well, and the oil viscosity falls from ~12,000 cP to single digits. Over the following 3–5 months the zone cools and the viscosity climbs back.
- On every downstroke the rod string has to **fall through that oil column**.
- Terminal fall velocity ∝ buoyant rod weight / (viscous drag × viscosity).
- Once the polished rod moves down faster than the rods can fall, the rods **float**: carrier-bar separation, impact loading, compression, then rod parting and pump unseating.

**So the safe maximum SPM falls continuously as the well cools.** Running a constant SPM chosen when the well was hot is what breaks rods late in the cycle. Meanwhile, CSS design (steam, pressure, soak) sets *how fast* the well cools. The two systems are one coupled problem, yet today they are tuned separately and reactively (PS text).

## 3. Existing solutions and their gaps
| Solution | Covers | Gap |
|---|---|---|
| ChampionX XSPOC 3.x (SLB) | Rod-lift diagnostics from 1B+ pump cards, setpoint optimization, AI autonomous control | SRP only; blind to the reservoir's thermal state and the CSS schedule |
| CSS proxy models (polynomial/ANN, PSO, experimental design; SPE/JPEPT literature) | Steam volume, soak, cycle length | CSS only; ignore the lift constraints that cap what can be produced |
| Dyno-card ML (CNN/SVM, Bahrain 35k-card set) | Fault classification | Diagnoses after the fact; doesn't plan |
| Other SIH26120 teams (PetroTwin-AI, USHNA, THERMO-LIFT, …) | Physics + ML + Pareto + LLM copilot | Dashboards and Pareto fronts; accuracy claims on synthetic data; no validity envelope; no mission framing |

## 4. Our position (USP)
1. **Mission → one plan.** Target + deadline + budgets in; one executable CSS + SRP plan out.
2. **Thermal-aware SPM/VFD schedule.** Pump speed follows the predicted cooling curve with a 1.25 float margin, and the plan includes the re-steam trigger day.
3. **Knows what it doesn't know.**
   - The validated envelope comes from the well's own history.
   - Conformal P10–P90 intervals come from leave-one-cycle-out error.
   - A plan is recommended only if **P10 ≥ target**.
   - It cites the nearest past cycles as evidence.
4. **Numbers-safe LLM.** Nemotron parses and explains; a guard blocks any number the engine did not compute.
5. **Field-deployable.** Laptop-class compute, ingests existing CSV/Excel exports, needs no new sensors. Rollout goes shadow → advisory → closed loop.
6. **Learning loop.** Each executed cycle becomes history, which widens the envelope and triggers recalibration.

## 5. Prototype numbers (synthetic history, demo well BGW-08)
- Twin hold-out: **5.4% mean error** on 63 past cycles → P10–P90 band ±10%.
- Calibration recovers each well's hidden cooling constant and rod-drag factor within 1%, and its cold rate within ~10% (that one absorbs cycle-to-cycle noise).
- 4,096 strategies × 240 days simulated in ~0.3 s.
- Recommended vs this well's typical practice:
  - **−20% steam**, **−17% SOR**
  - **0 vs 35 rod-float days**, failure risk 46% → ~0%
  - **−32% cost/bbl** (including expected workover)
  - −3% oil by day 90 while still meeting the target at P10
- Anomaly model flags 8 of 28 historical rod failures 3–30 days ahead. We claim that as-is.

## 6. Honest limitations (say these before judges ask)
- Synthetic data; `ASSUMED` parameters in `engine/params.py` need OIL data.
- Lumped reservoir model (not a full thermal simulator). Upgrade path: CMG STARS runs as surrogate training data, with Bayesian optimization replacing exhaustive search.
- Failure hazard weights are hand-set and should be refit on OIL's rod-failure log.
- Surface dyno cards are not yet solved with the Gibbs wave equation (roadmap).
