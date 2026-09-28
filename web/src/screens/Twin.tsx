import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { api, fmt, type Card, type Plan } from '../api'
import { DynoCard } from '../DynoCard'
import { phaseOf, WellScene, type Run } from '../WellScene'

const DAYS_PER_SEC = 11
const CHAIN = ['STEAM', 'HEAT', 'VISCOSITY ↓', 'FLOW ↑', 'SPM ADAPTS']

export function TwinScreen({ plan, onNext }: { plan: Plan; onNext: () => void }) {
  const [mode, setMode] = useState<'plan' | 'practice'>('plan')
  const run: Run = mode === 'plan' ? plan.recommended : plan.baseline
  const end = Math.min(Math.max(plan.recommended.resteam_day, plan.baseline.resteam_day) + 10, plan.days - 1)
  const [day, setDay] = useState(0)
  const [playing, setPlaying] = useState(true)

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.max(now - last, 0) / 1000 // rAF timestamps can precede performance.now()
      last = now
      setDay((d) => {
        const n = d + dt * DAYS_PER_SEC
        if (n >= end) { setPlaying(false); return end }
        return n
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, end])

  const d = Math.max(0, Math.floor(day))
  const [card, setCard] = useState<Card | null>(null)
  const bucket = Math.floor(d / 6)
  useEffect(() => {
    if (d < run.prod_start) return
    let live = true
    api.dyno(plan.mission, mode, Math.min(bucket * 6 + 3, plan.days - 1)).then((c) => live && setCard(c)).catch(() => {})
    return () => { live = false }
  }, [bucket, mode, plan.mission, plan.days, run.prod_start]) // eslint-disable-line react-hooks/exhaustive-deps
  const s = run.series
  const stage = phaseOf(run, day)
  const lit = stage === 'INJECTION' ? 1 : stage === 'SOAK' ? 2 : 5
  const fm = s.float_margin[d]
  const producing = stage === 'PRODUCTION' || stage === 'RE-STEAM DUE'
  const data = useMemo(() => s.t_res.slice(0, end + 1).map((t, i) => ({
    day: i, t, mu: s.mu_tub[i], spm: s.spm[i] || null, safe: Math.min(s.safe_spm[i], 8),
  })), [s, end])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 1fr) minmax(420px, 1.15fr)', gap: 24 }}>
      <section className="panel" style={{ padding: 0, overflow: 'hidden', height: 'calc(100vh - 140px)', minHeight: 560 }}>
        <WellScene run={run} day={day} />
      </section>

      <section style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
        <div className="panel" style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
          <div className="big">DAY {String(d).padStart(3, '0')}</div>
          <div className={`pill ${stage === 'INJECTION' ? 'cyan' : stage === 'SOAK' ? 'amber' : stage === 'RE-STEAM DUE' ? 'red' : 'ok'}`}>{stage}</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn ghost" onClick={() => { if (day >= end) setDay(0); setPlaying(!playing) }}>{playing ? '❚❚' : '▶'}</button>
            <button className={`btn ghost`} style={{ color: mode === 'plan' ? 'var(--cyan)' : 'var(--muted)' }} onClick={() => setMode('plan')}>TWIN PLAN</button>
            <button className={`btn ghost`} style={{ color: mode === 'practice' ? 'var(--amber)' : 'var(--muted)' }} onClick={() => setMode('practice')}>TYPICAL PRACTICE</button>
          </div>
        </div>
        <input type="range" min={0} max={end} step={1} value={d} onChange={(e) => { setPlaying(false); setDay(Number(e.target.value)) }} style={{ width: '100%', accentColor: 'var(--cyan)' }} />

        <div className="panel" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          {CHAIN.map((c, i) => (
            <div key={c} className="mono" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: i < lit ? (i === 0 ? '#f5f7fa' : i < 2 ? 'var(--amber)' : 'var(--cyan)') : 'var(--dim)', transition: 'color .3s' }}>
              {c}{i < CHAIN.length - 1 && <span style={{ color: 'var(--dim)', marginLeft: 8 }}>→</span>}
            </div>
          ))}
        </div>

        <div className="panel kv" style={{ gridTemplateColumns: '1fr auto 1fr auto' }}>
          <span>Steam temperature</span><span>{run.t_steam} °C</span>
          <span>Heated radius</span><span>{run.r_heated} m</span>
          <span>Reservoir (heated zone)</span><span className="amber">{s.t_res[d].toFixed(0)} °C</span>
          <span>Oil viscosity (tubing)</span><span>{fmt(s.mu_tub[d])} cP</span>
          <span>Oil rate</span><span>{producing ? s.oil[d].toFixed(1) : '–'} bopd</span>
          <span>Cumulative oil</span><span>{fmt(s.cum[d])} bbl</span>
          <span>Pump speed</span><span className="cyan">{producing ? `${s.spm[d].toFixed(2)} SPM` : 'idle'}</span>
          <span>Safe SPM limit</span><span>{producing ? (s.safe_spm[d] > 20 ? '> 20' : s.safe_spm[d].toFixed(2)) : '–'}</span>
          <span>Rod float margin</span>
          <span className={!producing ? '' : fm < 1 ? 'red' : fm < 1.25 ? 'amber' : 'ok'}>{producing ? (fm > 20 ? '> 20' : fm.toFixed(2)) : '–'}</span>
          <span>Cumulative energy</span><span>{fmt(s.cum_kwh[d])} kWh</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="panel" style={{ height: 230 }}>
          <div className="label">Reservoir temperature <span className="amber">(°C)</span> · tubing oil viscosity <span className="cyan">(cP, log)</span></div>
          <ResponsiveContainer width="100%" height="88%">
            <LineChart data={data} margin={{ top: 10, right: 0, bottom: 0, left: -10 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" type="number" domain={[0, end]} tickCount={7} />
              <YAxis yAxisId="t" domain={[40, 340]} tickCount={5} />
              <YAxis yAxisId="mu" orientation="right" scale="log" domain={[1, 30000]} ticks={[1, 10, 100, 1000, 10000]} />
              <Line yAxisId="t" dataKey="t" stroke="var(--amber)" dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line yAxisId="mu" dataKey="mu" stroke="var(--cyan)" dot={false} strokeWidth={2} isAnimationActive={false} />
              <ReferenceLine yAxisId="t" x={d} stroke="#f5f7fa" strokeDasharray="3 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="panel" style={{ height: 230, padding: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>Dynamometer cards · wave-equation solution</div>
          {producing ? <DynoCard card={card} stroke={(mode === 'plan' ? plan.recommended : plan.baseline).x.stroke_m} /> : <div className="mono muted" style={{ fontSize: 12 }}>pump idle during {stage.toLowerCase()}</div>}
        </div>
        </div>

        <div className="panel" style={{ height: 165 }}>
          <div className="label">Pump speed <span className="cyan">(SPM)</span> vs rod-float limit <span className="red">(safe SPM)</span></div>
          <ResponsiveContainer width="100%" height="88%">
            <LineChart data={data} margin={{ top: 10, right: 30, bottom: 0, left: -10 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" type="number" domain={[0, end]} tickCount={7} />
              <YAxis domain={[0, 8]} ticks={[0, 2, 4, 6, 8]} />
              <Line dataKey="safe" stroke="var(--red)" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              <Line dataKey="spm" stroke={mode === 'plan' ? 'var(--cyan)' : 'var(--amber)'} dot={false} strokeWidth={2.5} isAnimationActive={false} />
              <ReferenceLine x={d} stroke="#f5f7fa" strokeDasharray="3 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <button className="btn" style={{ justifySelf: 'end' }} onClick={onNext}>RUN COUNTERFACTUALS →</button>
      </section>
    </div>
  )
}
