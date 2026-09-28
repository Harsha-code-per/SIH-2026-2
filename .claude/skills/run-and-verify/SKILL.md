---
name: run-and-verify
description: Start the WellTwin prototype and verify the full demo flow end to end (API, UI, LLM fallback). Use when asked to run, demo, screenshot, or confirm a change works in the app.
---

# Run and verify WellTwin

1. `make up`: waits until every well twin is calibrated, then prints the URLs. If it times out, read `.run/api.log`.
2. `make test` must print `engine OK` and type-check cleanly.
3. API smoke test:
   ```
   curl -s localhost:8765/api/field | head -c 200
   curl -s -XPOST localhost:8765/api/mission -H 'content-type: application/json' -d '{}' | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['feasible'],[s['label'] for s in d['strategies']])"
   ```
   Expect `True ['A','B','C','D','E']`.
4. UI walk-through at http://localhost:5199. Use `→` to advance.

   | Screen | What to check |
   |---|---|
   | Intro | Title fades in over the pumpjack |
   | Mission | BGW-08 state loads (float margin, failures); typing a sentence + Enter fills the four fields |
   | Analyze | Trace lines animate; funnel ends at the feasible count |
   | Digital twin | Plays day 0 → re-steam; TYPICAL PRACTICE late in the cycle shows **ROD FLOAT** |
   | Counterfactuals | Curves race; D and E struck out; E envelope panel appears |
   | Plan | Checks all ✓; explanation shows "Written by NVIDIA Nemotron" (or the template when offline) |
5. Offline check: `NVIDIA_API_KEY= make restart`. The mission still works and the explanation says "Deterministic engine summary".
6. Browser checks with claude-in-chrome: take screenshots at 1920×1080 and confirm no screen scrolls.

`make down` when finished.
