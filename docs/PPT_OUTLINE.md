# SIH 2026 idea PPT: 6 slides (paste into the official SIH template)

## 1 · Title
- **WellTwin: Mission-driven digital twin for coupled CSS + SRP optimization**
- PS SIH26120 · Oil India Limited · Software · Smart Automation · Team name / college
- Tagline: *Don't experiment on the well. Experiment on its digital twin first.*

## 2 · Problem & pain
- Baghewala: 10,000–13,000 cP @ 50 °C, 46–48 °C reservoir, 17–19° API, ~1,150 m. CSS gives a 5–6× uplift and was used on 19 wells in FY25-26.
- **Coupling diagram:** Steam → heat → viscosity ↓ → flow ↑ → *cooling → viscosity ↑ → rods can't fall → rod float → impact loading → rod failure / pump unseating*.
- Today CSS and SRP are tuned separately, from historical practice, reactively (PS).
- Cost: high SOR, energy per barrel, workovers, lost production.
- Visual: screenshot of Twin screen in TYPICAL PRACTICE with ROD FLOAT.

## 3 · Solution & architecture
- Operator mission (target, deadline, steam, energy) goes in; one executable CSS + SRP plan comes out.
- Pipeline: data layer (existing CSV/Excel) → well-specific physics twin (Walther, Marx–Langenheim, Boberg–Lantz, rod-fall, Mills/Goodman) → history matching + conformal uncertainty + validated envelope → 4,096-strategy counterfactual search → constraint funnel → plan + evidence → Nemotron explanation behind a number guard.
- Visual: architecture diagram + Plan-screen screenshot.

## 4 · Innovation / USP
| We do | Others (XSPOC, CSS proxies, typical twins) |
|---|---|
| Couple thermal cycle ↔ lift: **SPM/VFD schedule follows the cooling curve** | Optimize SRP *or* CSS |
| **Mission → one plan** (P10 ≥ target) | Dashboards / Pareto charts for the engineer to interpret |
| **Knows its limits**: validated envelope, conformal P10–P90, evidence cycles | Point predictions, extrapolate silently |
| **LLM can't invent numbers** (guarded) | LLM chat over data |
| Laptop-class, offline-capable, no new sensors | Cloud SCADA platforms |

## 5 · Feasibility & viability
- Built and working: FastAPI + NumPy/SciPy/scikit-learn engine, React control room, NVIDIA NIM (Nemotron). 4,096 × 240-day simulations in ~0.3 s.
- Data path: synthetic now, then OIL CSV exports (same schema) → per-well recalibration, no code change.
- Rollout: **shadow mode** (compare recommendations with actual cycles) → advisory → closed loop via VFD setpoints.
- Risks and mitigations:
  - Data gaps → envelope limits confident advice.
  - Model drift → recalibration each cycle.
  - Operator trust → evidence + explanations.
  - Lumped model → CMG STARS runs as surrogate training data.

## 6 · Impact & benefits
- On the prototype's synthetic history, the demo well vs its typical practice gives **−20% steam, −17% SOR, 0 vs 35 rod-float days, −32% cost/bbl**. Label these as model estimates.
- Field level: fewer rod failures and workovers, lower SOR and energy/bbl, steam freed for more wells (only 19 of 33 were steamed last year).
- Roadmap:
  - Gibbs wave-equation dyno cards
  - Fleet steam allocation across wells
  - Refit failure hazard on OIL's failure log
  - Edge deployment at the well pad
- References: SIH PS 26120; oil-india.com; SPE APOG 2023-535203; SPE J 28(03); Boberg & Lantz (1966); Marx & Langenheim (1959); API RP 11L; ChampionX XSPOC.
