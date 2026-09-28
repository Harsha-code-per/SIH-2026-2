# Prototype video: script (≈110 s)

**Setup:**
- Browser at 1920×1080, fullscreen (F11), zoom 100%.
- Start the API, wait for it to report ready, then open http://localhost:5199 (or :8765 after `npm run build`).
- Run the mission once before recording so the explanation is cached and appears instantly.
- Record with OBS; drive with the mouse or `→`.
- Voiceover is recorded separately and laid over the capture.

| # | Time | Screen / action | Voiceover |
|---|---|---|---|
| 1 | 0–8 s | **Intro**: title fades in over the dim well | "Baghewala crude is ten thousand times thicker than water. Oil India heats it with steam, then lifts it with rod pumps. What if we could test every production strategy *before* touching the real well?" |
| 2 | 8–22 s | **Mission.** Hover the well state (float margin **LOW**, **8 rod failures in 9 cycles**). Type the mission sentence, press Enter ("Parsed by NVIDIA Nemotron"). | "Well BGW-08 has broken rods in eight of its nine steam cycles. The engineer doesn't tune knobs. They set a mission: 1,600 barrels in 90 days, 1,000 tonnes of steam, 7 megawatt-hours of power." |
| 3 | 22–34 s | Click **SIMULATE MISSION**. The trace runs; the funnel shrinks to **893**. | "The twin loads this well's history and calibrates itself: 5% error on 63 past cycles it never saw. Then it simulates 4,096 combined steam-and-pump strategies in a third of a second, and throws out every one that breaks a limit." |
| 4 | 34–54 s | **Digital twin.** Let it play: steam goes down, the heated zone glows then cools, oil rises, SPM steps down. Then click **TYPICAL PRACTICE** and drag to day ~150: **ROD FLOAT · IMPACT LOADING**. | "Steam heats the rock and the oil thins. As it cools the oil thickens again, and the rods can no longer fall through it. Run the pump at a constant speed, as operators do today, and the rods float: impact loading, then failure. Our plan lowers pump speed as the reservoir cools, so the rods never float." |
| 5 | 54–72 s | **Counterfactuals.** Cards simulate, curves race to the target, table appears. D gets struck out. | "Five strategies race to the target. A is cheap but misses at the pessimistic P10. D produces the most, but blows the steam budget." |
| 6 | 72–84 s | E panel slides in: **OUTSIDE VALIDATED OPERATING ENVELOPE → EXCLUDED** | "E promises even more oil with 1,740 tonnes of steam. But this well has never taken more than 1,140. The twin would be guessing, so it says so, and refuses." |
| 7 | 84–102 s | **Plan.** Pause on P50 ± band, the green checks and the comparison table. | "The recommendation: 740 tonnes, 97 bar, 3½-day soak, and a pump schedule that steps from 4.5 down to 1.75 strokes a minute. It meets the target even at P10, uses 20% less steam, has zero rod-float days, and costs 32% less per barrel than this well's usual practice. The explanation is written by Nemotron, and every number in it is checked against the engine." |
| 8 | 102–110 s | **Outro** | "Don't experiment on the well. Experiment on its digital twin first." |

**Say once, clearly (at step 3 or in the end card):** the prototype runs on synthetic history calibrated to published Baghewala data, and connecting OIL's real records needs no code change.
