# WellTwin: project guide for contributors and coding agents

SIH 2026 · PS **SIH26120** (Oil India Limited): digital twin for coupled **CSS** (cyclic steam stimulation) + **SRP** (sucker-rod pump) optimization in the Baghewala heavy-oil field. The goal is to get shortlisted and win the Grand Finale, then keep growing it into a real field tool.

## Commands
```
make up       # API :8765 + UI :5199 in background (waits for twin calibration)
make down     # stop both
make restart  # after any engine/ change (uvicorn does not hot-reload)
make test     # engine self-check + UI type-check; must pass before every commit
make demo     # built UI + API on :8765 in one process (for recording)
make data     # regenerate synthetic history (then re-check the demo story)
```

## Layout
- `engine/params.py`: field anchors (cited) and `ASSUMED` knobs. Change numbers here, never inline.
- `engine/physics.py`: vectorized well-to-surface model. `simulate(x, well, days, controller)` is the core. Every array is `(N candidates, days)`.
- `engine/history.py`: synthetic field generator + CSV loader (`data/*.csv` schema = the real-data contract).
- `engine/twin.py`: calibration, conformal error, validated envelope, anomalies. `field()` is cached; the API warms it at import.
- `engine/optimize.py`: `plan(mission)` → funnel, strategies A–E, baseline, evidence, trace. `DEMO` is the video mission.
- `engine/llm.py`: NVIDIA NIM parse/explain + number guard + fallbacks.
- `engine/api.py`: FastAPI routes under `/api`; serves `web/dist` if built.
- `web/src/`: `App.tsx` stage machine; `screens/*` one file per stage; `WellScene.tsx` animated cross-section; `index.css` design tokens.
- `docs/`: research brief, video script, PPT outline, architecture.

## Invariants (do not break)
1. **The LLM never produces an operating number.** Numbers come from the engine; `llm.guard` must reject anything else.
2. **Honesty.** History is synthetic, and the UI tag and docs say so. Every claim in the PPT, video or README must be reproducible from `make test` / `python -m engine.optimize`. No invented accuracy figures.
3. **Only recommend what is validated.** A recommended plan is inside the envelope, meets the target at **P10**, and has zero float days.
4. **Demo story.** On `DEMO` (BGW-08):
   - A misses the target at P10.
   - C is recommended.
   - D breaks the budget.
   - E is out of envelope on steam only.
   - The typical-practice baseline shows rod-float days.

   `engine/test_engine.py` asserts most of this. Re-check it after any physics/data change.
5. **Laptop-class and offline-capable.** No new heavy dependencies without a reason; the demo must work without internet (LLM falls back).

## Conventions
- Python: numpy-vectorized, no classes unless state demands it. Units live in names (`_t`, `_bar`, `_d`, `_m`, `_kwh`, `_cp`).
- Frontend: colors only via CSS variables in `index.css`; mono font for all numbers; every screen must fit 1920×1080 without scrolling (recording).
- Commits: conventional (`feat:`, `fix:`, `docs:` …), made with your own git identity. No AI co-author trailers.
- Secrets: `.env` only (gitignored). Never commit keys.

## Skills
Task playbooks live in `.claude/skills/`:
- `run-and-verify`
- `engine-change`
- `real-data`
- `ui-screen`
- `pitch-facts`
