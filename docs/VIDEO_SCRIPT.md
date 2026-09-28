# Prototype video: script (≈150 s)

**Fastest path: auto demo.** Open the app, press **`D`**, and record. Every screen plays itself:
- the mission types itself and is parsed by Nemotron
- the twin replays under typical practice to show rod float
- Live Ops alerts are read, then approved
- the Field Gantt flips to practice and back
- the Learn step ingests the live cycle

The full run takes about 2½ minutes; record the voiceover to match the table below. `Esc` stops.

**Setup:**
- Chrome in front (it must be the visible window, or animations pause), 1920×1080, fullscreen (F11), zoom 100%.
- Run `make demo` (or `make up`) and open the app.
- Run the mission once before recording so the explanation is cached.
- In Live Ops, press RESTART before recording that segment.
- Record with OBS and drive with the mouse or `→`. Voiceover is recorded separately.

| # | Time | Screen / action | Voiceover |
|---|---|---|---|
| 1 | 0–7 s | **Intro** | "Baghewala crude is ten thousand times thicker than water. Oil India heats it with steam and lifts it with rod pumps. What if every strategy could be tested before it touches the real well?" |
| 2 | 7–18 s | **Mission.** Point at float margin LOW and 8 failures in 9 cycles. Type the sentence, press Enter. | "Well BGW-08 has broken rods in eight of nine steam cycles. The engineer just states the mission: 1,600 barrels in 90 days, 1,000 tonnes of steam." |
| 3 | 18–28 s | **Simulate.** Trace runs; funnel ends at 893. | "The twin calibrates itself on this well's history, 5% error on cycles it never saw, and simulates 4,096 combined steam-and-pump strategies in a third of a second." |
| 4 | 28–45 s | **Digital twin.** It plays; dyno card shows NORMAL. Click TYPICAL PRACTICE, scrub to ~150: ROD FLOAT, and the card shows separation. | "Steam heats the rock and the oil thins. As it cools the oil thickens again, and at a constant pump speed the rods can't fall through it. The dynamometer card, solved from the wave equation, shows the rods floating. Our plan slows the pump as the reservoir cools." |
| 5 | 45–60 s | **Counterfactuals.** Race; D struck; E panel. | "Five strategies race to the target. D breaks the steam budget. E promises more oil with 1,740 tonnes, but this well has never taken more than 1,140. The twin would be guessing, so it refuses." |
| 6 | 60–72 s | **Plan.** P50 band, checks, comparison. | "The plan meets the target even at P10, with 20% less steam, zero rod-float days and 32% lower cost per barrel than this well's usual practice. Nemotron explains it, and every number is checked against the engine." |
| 7 | 72–100 s | **Live Ops.** Play at 3×. Alerts: cooling (acknowledge) → drag (acknowledge) → **float forecast 19 days ahead**. Pause on it, click APPROVE, and the SPM step-down changes. | "Then the plan goes live. The twin shadows the well on daily SCADA and dyno data. It notices the reservoir cooling faster than planned, then that rod drag is rising, likely an emulsion. Nineteen days before it happens it forecasts rod float, and proposes a lower pump speed. The operator approves. Zero float days." |
| 8 | 100–118 s | **Field.** Toggle Gantt between WellTwin and practice. | "Across the field, steam generators are the bottleneck. The field twin decides which well to steam next: 17% less steam, no rod float, and about one crore more net value over six months than steaming wells in turn." |
| 9 | 118–135 s | **Learn.** INGEST LIVE CYCLE, then before/after and plan-vs-actual. | "Every executed cycle becomes history. The data is checked, the twin recalibrates, and its error on that cycle falls from 9% to 6%. Real OIL exports drop in the same way." |
| 10 | 135–150 s | **Outro** | "Don't experiment on the well. Experiment on its digital twin first. Team Kaihatsu, R.M.K. College of Engineering and Technology." |

**Say once, clearly (step 3 or the end card):** the prototype runs on synthetic history calibrated to published Baghewala data, and connecting OIL's records needs no code change.
