import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { api, type Explanation, type Field, type Mission, type Plan, type WellState } from './api'
import { AuditScreen } from './screens/Audit'
import { FieldScreen } from './screens/Field'
import { LearnScreen } from './screens/Learn'
import { LiveScreen } from './screens/Live'
import { MissionScreen } from './screens/Mission'
import { PlanScreen } from './screens/Plan'
import { RaceScreen } from './screens/Race'
import { SandboxScreen } from './screens/Sandbox'
import { Intro, Outro } from './screens/Title'
import { TraceScreen } from './screens/Trace'
import { TwinScreen } from './screens/Twin'

const STAGES = ['intro', 'mission', 'trace', 'twin', 'race', 'plan', 'sandbox', 'live', 'field', 'learn', 'audit', 'outro'] as const
type Stage = (typeof STAGES)[number]
const NAV: [string, [Stage, string][]][] = [
  ['PLAN A CYCLE', [['mission', 'MISSION'], ['trace', 'ANALYZE'], ['twin', 'DIGITAL TWIN'], ['race', 'COUNTERFACTUALS'], ['plan', 'PLAN'], ['sandbox', 'WHAT-IF']]],
  ['OPERATE', [['live', 'LIVE OPS'], ['field', 'FIELD'], ['learn', 'LEARN'], ['audit', 'AUDIT']]],
]
const NEEDS_PLAN: Stage[] = ['trace', 'twin', 'race', 'plan', 'sandbox']
// Lower-third captions so the recorded demo reads without a voiceover. No numbers here: every number on screen comes from the engine.
const CAPTIONS: Partial<Record<Stage, string>> = {
  mission: 'The engineer states a mission in plain language. It becomes a target, a deadline and steam + energy budgets.',
  trace: 'The twin calibrates itself on this well\'s history, then simulates thousands of coupled steam + pump strategies.',
  twin: 'As the reservoir cools, the oil thickens. The plan slows the pump before the rods float; constant-speed practice does not.',
  race: 'Counterfactuals race to the target. Over-budget plans are struck out, and anything outside what this well has done is refused.',
  plan: 'One explainable plan: it meets the target even in the pessimistic case, with less steam and no rod float.',
  sandbox: 'What-if: push beyond history and uncertainty widens. Compare a downhole heater with smart pump control.',
  live: 'Live operations: the twin tracks the well daily, re-learns cooling and rod drag, and warns of rod float weeks ahead.',
  field: 'Across the field: which well gets the steam generator next, for more oil per tonne of steam.',
  learn: 'Every executed cycle becomes history, and the twin gets more accurate.',
  audit: 'Every plan is signed off by two people, and every decision is on the record.',
}
const DEFAULT: Mission = { well_id: 'BGW-08', target_bbl: 1600, deadline_d: 90, steam_budget_t: 1000, energy_budget_kwh: 7000 }

export default function App() {
  const [stage, setStage] = useState<Stage>('intro')
  const [mission, setMission] = useState<Mission>(DEFAULT)
  const [well, setWell] = useState<WellState | null>(null)
  const [field, setField] = useState<Field | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [why, setWhy] = useState<Explanation | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [auto, setAuto] = useState(false) // one-take demo for recording: every screen plays itself
  const [captions, setCaptions] = useState(true)

  const startDemo = useCallback(() => {
    api.learnReset().catch(() => {})
    setMission(DEFAULT)
    setPlan(null)
    setWhy(null)
    setAuto(true)
    setStage('intro')
  }, [])

  useEffect(() => {
    // each session starts from the baseline history (ingested cycles live in server memory only)
    api.learnReset().catch(() => {}).finally(() => api.field().then(setField).catch((e) => setErr(String(e))))
  }, [])
  useEffect(() => {
    api.well(mission.well_id).then(setWell).catch((e) => setErr(String(e)))
  }, [mission.well_id])

  const run = async () => {
    setBusy(true)
    setErr('')
    setWhy(null)
    try {
      const p = await api.mission(mission)
      if (!p.feasible) throw new Error(p.message)
      setPlan(p)
      setStage('trace')
      api.explain(mission).then(setWhy).catch(() => {})
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const go = useCallback((dir: 1 | -1) => {
    setStage((s) => {
      const i = STAGES.indexOf(s) + dir
      if (i < 0 || i >= STAGES.length) return s
      if (!plan && NEEDS_PLAN.includes(STAGES[i])) return i > STAGES.indexOf(s) ? 'live' : 'mission'
      return STAGES[i]
    })
  }, [plan])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1)
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1)
      if (e.key === 'd' || e.key === 'D') startDemo()
      if (e.key === 'Escape') setAuto(false)
      if (e.key === 'c' || e.key === 'C') setCaptions((c) => !c)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, startDemo])

  if (stage === 'intro') return <Intro auto={auto} onNext={() => setStage('mission')} onDemo={startDemo} />
  if (stage === 'outro') return <Outro onBack={() => { setAuto(false); setStage('audit') }} />

  const at = STAGES.indexOf(stage)
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">WELL<b>TWIN</b> · BAGHEWALA</div>
        <nav className="steps">
          {NAV.map(([group, items], g) => (
            <div key={group} style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: g ? 18 : 0 }}>
              <span className="mono" style={{ fontSize: 9, color: 'var(--dim)', letterSpacing: '0.14em', marginRight: 6 }}>{group}</span>
              {items.map(([s, label]) => (
                <button key={s} className={s === stage ? 'on' : STAGES.indexOf(s) < at ? 'done' : ''}
                  disabled={!plan && NEEDS_PLAN.includes(s)} onClick={() => setStage(s)}>{label}</button>
              ))}
            </div>
          ))}
        </nav>
        {!auto && <button className="btn ghost" style={{ marginLeft: 'auto', padding: '6px 10px', fontSize: 10 }} onClick={startDemo} title="Plays the whole story hands-free (D). Esc stops.">▶ AUTO DEMO</button>}
        <span className="tag" style={auto ? undefined : { marginLeft: 12 }} title="No public Baghewala dataset exists; history is generated by the physics model with unmodelled variability and noise.">
          SYNTHETIC DATA · CALIBRATED
        </span>
      </header>
      <main className="stage">
        {err && <div className="panel red mono" style={{ marginBottom: 16 }}>{err}</div>}
        {stage === 'mission' && <MissionScreen auto={auto} well={well} field={field} mission={mission} setMission={setMission} onRun={run} busy={busy} />}
        {stage === 'trace' && plan && <TraceScreen auto={auto} plan={plan} onNext={() => setStage('twin')} />}
        {stage === 'twin' && plan && <TwinScreen auto={auto} plan={plan} onNext={() => setStage('race')} />}
        {stage === 'race' && plan && <RaceScreen auto={auto} plan={plan} onNext={() => setStage('plan')} />}
        {stage === 'plan' && plan && <PlanScreen auto={auto} plan={plan} why={why} onNext={() => setStage('sandbox')} />}
        {stage === 'sandbox' && plan && <SandboxScreen auto={auto} plan={plan} onNext={() => setStage('live')} />}
        {stage === 'live' && <LiveScreen auto={auto} mission={mission} onNext={() => setStage('field')} />}
        {stage === 'field' && <FieldScreen auto={auto} onNext={() => setStage('learn')} />}
        {stage === 'learn' && <LearnScreen auto={auto} onNext={() => setStage('audit')} />}
        {stage === 'audit' && <AuditScreen auto={auto} onNext={() => setStage('outro')} />}
      </main>
      <AnimatePresence>
        {auto && captions && CAPTIONS[stage] && (
          <motion.div key={stage} initial={{ opacity: 0, y: 12, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, x: '-50%' }} transition={{ duration: 0.5 }}
            style={{ position: 'fixed', left: '50%', bottom: 26, maxWidth: 980, padding: '12px 22px', borderRadius: 6,
              background: 'rgba(8,12,16,0.88)', border: '1px solid var(--line)', fontSize: 17, lineHeight: 1.45, textAlign: 'center', zIndex: 20,
              boxShadow: '0 10px 40px rgba(0,0,0,.5)' }}>
            {CAPTIONS[stage]}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
