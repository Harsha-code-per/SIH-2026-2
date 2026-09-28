import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { fmt, type Plan, type Strategy } from '../api'
import { useAfter } from '../auto'

const COLOR: Record<string, string> = { A: '#7f93a3', B: '#b39ddb', C: 'var(--cyan)', D: 'var(--amber)', E: 'var(--red)' }
const PHASE_MS = [1400, 3200, 1800] // simulating → curves → table → envelope check

export function RaceScreen({ plan, onNext, auto }: { plan: Plan; onNext: () => void; auto: boolean }) {
  const [phase, setPhase] = useState(0)
  useAfter(auto && phase >= 3, 6500, onNext)
  useEffect(() => {
    if (phase >= PHASE_MS.length) return
    const id = setTimeout(() => setPhase((p) => p + 1), PHASE_MS[phase])
    return () => clearTimeout(id)
  }, [phase])

  const m = plan.mission
  const S = plan.strategies
  const horizon = Math.min(m.deadline_d + 20, plan.days - 1)
  const data = Array.from({ length: horizon + 1 }, (_, d) => Object.fromEntries([['day', d], ...S.map((s) => [s.label, s.cum[d]])]))
  const e = S.find((s) => s.label === 'E')
  const env = plan.state.envelope.steam_t
  const rec = plan.recommended

  return (
    <div className="screen" style={{ display: 'grid', gap: 20, gridTemplateRows: 'auto minmax(330px, 1fr) auto' }} onClick={() => phase < PHASE_MS.length && setPhase(phase + 1)}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${S.length}, 1fr)`, gap: 14 }}>
        {S.map((s) => <Card key={s.label} s={s} phase={phase} />)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: phase >= 3 && e ? '1.3fr 1fr' : '1fr', gap: 20 }}>
        <section className="panel" style={{ minHeight: 330, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="label">Cumulative oil (bbl) vs mission · target {fmt(m.target_bbl)} bbl by day {m.deadline_d}</div>
            <div className="mono" style={{ marginLeft: 'auto', display: 'flex', gap: 10, fontSize: 11 }}>
              {S.map((s) => <span key={s.label} style={{ color: COLOR[s.label], fontWeight: s.label === 'C' ? 700 : 400 }}>━ {s.label}</span>)}
            </div>
          </div>
          {phase >= 1 && (
            <div style={{ flex: 1, minHeight: 280 }}><ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 14, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" type="number" domain={[0, horizon]} tickCount={8} />
                <YAxis tickCount={6} />
                <ReferenceLine y={m.target_bbl} stroke="#f5f7fa" strokeDasharray="4 4" label={{ value: 'TARGET', fill: '#f5f7fa', fontSize: 10, position: 'insideTopLeft' }} />
                <ReferenceLine x={m.deadline_d} stroke="#f5f7fa" strokeDasharray="4 4" label={{ value: 'DEADLINE', fill: '#f5f7fa', fontSize: 10, position: 'insideTopRight' }} />
                {S.map((s) => (
                  <Line key={s.label} dataKey={s.label} stroke={COLOR[s.label]} dot={false} strokeWidth={s.label === 'C' ? 3 : 1.6}
                    strokeDasharray={s.label === 'E' ? '6 4' : undefined} animationDuration={2600} animationEasing="linear" />
                ))}
              </LineChart>
            </ResponsiveContainer></div>
          )}
        </section>

        {phase >= 3 && e && (
          <motion.section className="panel" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} style={{ borderColor: 'var(--red)' }}>
            <div className="label red">Strategy E · self-awareness check</div>
            <h3 className="mono" style={{ fontSize: 20, marginTop: 10 }}>Steam: {fmt(e.x.steam_t)} t</h3>
            <div className="red mono" style={{ fontWeight: 700, marginTop: 10 }}>⚠ OUTSIDE VALIDATED OPERATING ENVELOPE</div>
            <EnvelopeBar lo={env[0]} hi={env[1]} marks={[{ v: rec.x.steam_t, c: 'var(--cyan)', l: 'C' }, { v: e.x.steam_t, c: 'var(--red)', l: 'E' }]} />
            <div className="kv" style={{ marginTop: 16 }}>
              <span>This well has taken</span><span>{fmt(plan.state.history_steam_t[0])}–{fmt(plan.state.history_steam_t[1])} t</span>
              <span>Twin P50 says</span><span>{fmt(e.p50)} bbl</span>
              <span>Honest range (P10–P90)</span><span className="red">{fmt(e.p10)} – {fmt(e.p90)} bbl</span>
              <span>Prediction confidence</span><span className="red">LOW · extrapolating</span>
            </div>
            <div className="mono" style={{ marginTop: 14, fontWeight: 700 }}>→ EXCLUDED FROM RECOMMENDATION</div>
          </motion.section>
        )}
      </div>

      {phase >= 2 && (
        <motion.section className="panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <table>
            <thead>
              <tr><th>STRATEGY</th><th>PRODUCTION P50 · P10–P90 (bbl)</th><th>SOR</th><th>ENERGY (kWh)</th><th>₹ / BBL</th><th>ROD RISK</th><th style={{ textAlign: 'left' }}>VERDICT</th></tr>
            </thead>
            <tbody>
              {S.map((s) => (
                <tr key={s.label} className={s.label === 'C' ? 'win' : s.label === 'D' || s.label === 'E' ? 'struck' : ''}>
                  <td style={{ color: COLOR[s.label], fontWeight: 700 }}>{s.label}</td>
                  <td>{fmt(s.p50)} <span className="muted">· {fmt(s.p10)}–{fmt(s.p90)}</span></td>
                  <td>{s.sor.toFixed(2)}</td>
                  <td className={s.energy_kwh > m.energy_budget_kwh ? 'red' : ''}>{fmt(s.energy_kwh)}</td>
                  <td>{fmt(s.cost_per_bbl)}</td>
                  <td>{s.failure_risk < 0.05 ? 'LOW' : s.failure_risk < 0.15 ? 'MED' : 'HIGH'}</td>
                  <td style={{ textAlign: 'left' }} className={s.label === 'C' ? 'cyan' : s.label === 'A' || s.label === 'B' ? 'muted' : 'red'}>{s.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.section>
      )}
      {phase >= 3 && <button className="btn next" onClick={onNext}>RECOMMENDED PLAN →</button>}
    </div>
  )
}

function Card({ s, phase }: { s: Strategy; phase: number }) {
  const done = phase >= 2
  return (
    <div className="panel mono" style={{ padding: 14, borderColor: done && s.label === 'C' ? 'var(--cyan)' : undefined, fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <b style={{ color: COLOR[s.label], letterSpacing: '0.12em' }}>STRATEGY {s.label}</b>
        {!s.in_envelope && <span className="pill red">ENVELOPE</span>}
      </div>
      <div className="kv" style={{ fontSize: 12, marginTop: 10, gap: '3px 10px' }}>
        <span>Steam</span><span>{fmt(s.x.steam_t)} t</span>
        <span>Pressure</span><span>{s.x.inj_p_bar} bar</span>
        <span>Soak</span><span>{s.x.soak_d} d</span>
        <span>Stroke</span><span>{s.x.stroke_m.toFixed(1)} m</span>
        <span>SPM ceiling</span><span>{s.x.spm_max.toFixed(1)}</span>
      </div>
      <div style={{ marginTop: 10, fontWeight: 700, letterSpacing: '0.1em' }} className={done ? (s.label === 'C' ? 'cyan' : 'muted') : 'amber'}>
        {done ? `${fmt(s.p50)} bbl` : phase === 1 ? 'SIMULATING…' : 'QUEUED'}
      </div>
    </div>
  )
}

function EnvelopeBar({ lo, hi, marks }: { lo: number; hi: number; marks: { v: number; c: string; l: string }[] }) {
  const min = 300, max = 1800
  const pct = (v: number) => `${((v - min) / (max - min)) * 100}%`
  return (
    <div style={{ position: 'relative', height: 46, marginTop: 18 }}>
      <div style={{ position: 'absolute', top: 16, left: 0, right: 0, height: 6, background: 'var(--bg)', borderRadius: 3 }} />
      <div style={{ position: 'absolute', top: 16, left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})`, height: 6, background: 'var(--cyan)', opacity: 0.5, borderRadius: 3 }} />
      <span className="mono muted" style={{ position: 'absolute', top: 28, left: pct(lo), fontSize: 10 }}>validated</span>
      {marks.map((m) => (
        <div key={m.l} style={{ position: 'absolute', left: pct(m.v), top: 0, transform: 'translateX(-50%)', textAlign: 'center' }}>
          <div className="mono" style={{ fontSize: 10, color: m.c, fontWeight: 700 }}>{m.l}</div>
          <div style={{ width: 2, height: 22, background: m.c, margin: '0 auto' }} />
        </div>
      ))}
    </div>
  )
}
