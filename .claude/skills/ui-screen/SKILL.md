---
name: ui-screen
description: Add or change a WellTwin UI screen or component (web/src) while keeping the control-room design system and the recordable 1920x1080 layout. Use for any frontend work.
---

# UI work

- **Flow:** `App.tsx` holds `STAGES` and `NAV`. A new stage needs:
  - an entry in both
  - a `screens/<Name>.tsx` receiving `plan` (+ callbacks)
  - a "next" button
  - `→`/`←` keys work automatically.
- **Data:** only through `api.ts`. Add response fields to the types there first, then use them. No fetches inside screens except via `api`.
- **Design tokens** (`index.css`):
  - `--bg/--panel/--line` surfaces
  - `--cyan` = our plan / primary action
  - `--amber` = heat, typical practice, warnings
  - `--red` = rejection, float, failure
  - `--ok` = passed checks

  Numbers are always `.mono` with tabular figures. Labels use `.label`.
- **Building blocks:** `.panel`, `.kv` (2-column key/value), `table` (right-aligned numerics), `.pill`, `.btn` / `.btn.ghost`, `.big`.
- **Charts:** recharts `LineChart` inside `ResponsiveContainer` in a fixed-height `.panel`. Set `isAnimationActive={false}` for live-scrubbed charts and animate only reveal moments.
- **Motion:** `motion/react` for entrances. Keep durations ≤ 0.8 s. Screens with timed reveals (Trace, Race) must also advance on click.
- **Layout:** fixed-layout screens use `className="screen"` (exactly one viewport tall; grid rows share the space, charts sit in flex/grid cells with `height: 100%`). Long screens (Plan) use `fill`. Everything must fit 1920×1080 with no scroll. Measure with `document.querySelector('.stage')` scrollHeight − clientHeight.
- **Auto demo:** every screen takes `auto` and uses `useAfter(cond, ms, fn)` from `auto.ts` to play itself and call `onNext`. A new screen must do the same, or the one-take demo stalls.
- **Honesty:** keep the SYNTHETIC HISTORY tag in the top bar. Any number on screen must come from the API, never be hard-coded.
- **Verify:** `cd web && npx tsc -b`, then walk the flow (skill `run-and-verify`).
