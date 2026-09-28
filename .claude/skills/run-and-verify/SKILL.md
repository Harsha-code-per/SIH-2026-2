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
   | What-If | Sliders show the validated band; steam past history → red, wide band. Heater lowers float days and raises energy. The compared-with-plan-C table updates |
   | Work order (Plan → ISSUE WORK ORDER) | Submit with one name. Approving with the same name is refused (four-eyes); a different name approves and the stamp shows APPROVED. Do not click Print in automation (the dialog blocks the browser) |
   | Live Ops | Streams at 1×/3×; pauses on alerts: cooling (~day 34), drag (~day 66), float forecast (~day 70, 19 d ahead). APPROVE, and rod-float days stay 0. The dyno card updates every 5 days |
   | Field | 1/2/3 generators and horizon recompute; WellTwin beats practice on net value with 0 float days; the Gantt toggles |
   | Audit | Work orders and events persist across `make restart` (data/audit.db) |
   | Learn | After Live Ops completes, INGEST LIVE CYCLE shows cycles 9 → 10 and cycle error falls; RESET HISTORY restores the baseline |

   The Chrome window must be visible. Hidden tabs pause animation frames and throttle timers, so screens look frozen.
5. Offline check: `NVIDIA_API_KEY= make restart`. The mission still works and the explanation says "Deterministic engine summary".
6. Browser checks with claude-in-chrome: take screenshots at 1920×1080 and confirm no screen scrolls.

`make down` when finished.
