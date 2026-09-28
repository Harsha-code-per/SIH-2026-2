---
name: real-data
description: Onboard real Oil India (or any field) data into WellTwin in place of the synthetic history. Use when someone provides CSV/Excel exports of CSS cycles, SRP/VFD data, dyno loads or failure logs.
---

# Onboarding real field data

The contract is the three CSVs in `data/`. `engine/history.load()` reads them; if they exist, nothing is generated.

| File | One row per | Required columns |
|---|---|---|
| `wells.csv` | well | `well_id, cycles, pump_depth_m` (`true_*` columns are synthetic-only; drop them) |
| `cycles.csv` | CSS cycle | `well_id, cycle, steam_t, inj_p_bar, soak_d, stroke_m, spm_max, cycle_days, cum_oil_bbl, cum_kwh, float_days, rod_failure, failure_day` |
| `daily.csv` | well-day of production | `well_id, cycle, day, oil_bpd, spm, kwh, min_load_kn` |

`day` counts from the start of steam injection for that cycle. `min_load_kn` is the minimum polished-rod load from the dyno card. Near zero means rods are floating.

## Steps
1. Map OIL column names and units to the table above in a one-off script (keep it in `scripts/`, not in the engine). Units:
   - steam in tonnes cold-water-equivalent
   - pressure in bar at the wellhead
   - stroke in metres
2. Back up the synthetic data, then write the three files into `data/`.
3. Update anchors in `engine/params.py` from well files (pump depth, bore, rod string, pay thickness) and drop their `ASSUMED` tags.
4. `make restart` and check `/api/field`:
   - `loco_mape` is the honest hold-out error on the real cycles. Report it as-is.
   - If it is poor, look at the per-well fit (`twin.field()['twins'][id]['fit_cum']` vs actual) before adding complexity.
5. Walk the UI. The envelope, evidence cycles and anomalies now come from real history.

Never mix synthetic and real rows. Never commit OIL data to a public repository without written permission; keep it in `data/` locally and add it to `.gitignore`.
