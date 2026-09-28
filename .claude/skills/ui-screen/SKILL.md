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
- **Layout:** must fit 1920×1080 with no scroll (the video is recorded at that size). Check with claude-in-chrome `resize_window`.
- **Honesty:** keep the SYNTHETIC HISTORY tag in the top bar. Any number on screen must come from the API, never be hard-coded.
- **Verify:** `cd web && npx tsc -b`, then walk the flow (skill `run-and-verify`).
