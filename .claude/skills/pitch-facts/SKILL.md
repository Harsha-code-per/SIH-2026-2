---
name: pitch-facts
description: Write or check PPT slides, video scripts, README claims or jury answers for SIH26120 using only verified facts and reproducible numbers. Use for any pitch, presentation, demo-script or judge-Q&A work.
---

# Pitch facts and claims policy

## Sources of truth
- Field facts with citations: `docs/RESEARCH.md` §1.
- Competitive position and USP: `docs/RESEARCH.md` §3–4.
- Slide plan: `docs/PPT_OUTLINE.md`. Video: `docs/VIDEO_SCRIPT.md`.
- Live numbers: run them, never copy old ones.
  ```
  .venv/bin/python -m engine.optimize    # demo mission: strategies, baseline, SPM schedule
  curl -s localhost:8765/api/field       # hold-out error, anomaly recall
  ```

## Rules
1. Every number in a slide or voiceover must appear in the current engine output or in a cited source. Re-run after any engine change.
2. Prototype results are "model estimates on synthetic history calibrated to published Baghewala data". Say it once per artifact, plainly.
3. Never claim field validation, accuracy on real data, or savings OIL has not measured.
4. Units:
   - CSS soak in **days**
   - steam in **tonnes CWE**
   - pressure in **bar**
   - SOR in m³ steam / m³ oil
5. Lead with the coupling insight: *safe pump speed falls as the reservoir cools*. It is the one idea judges must remember.
6. Close with: "Don't experiment on the well. Experiment on its digital twin first."

## Likely jury questions (keep answers short)
| Question | Answer |
|---|---|
| Where is your data from? | No public data exists; physics-calibrated synthetic history. The CSV contract is ready for OIL exports (skill `real-data`). |
| How accurate is it? | Hold-out error on past cycles (quote `/api/field`), and we show P10–P90 instead of point values. |
| What if it's wrong? | Recommends only inside the validated envelope and only if P10 meets the target; shadow mode first. |
| Why not a full reservoir simulator? | Lumped model is ms-fast for 4,096 counterfactuals. CMG STARS runs can train the surrogate later. |
| Does the LLM decide? | No. It parses intent and explains; a guard blocks any number the engine didn't produce. |
