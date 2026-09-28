import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { api, fmt, type FieldPlan, type Schedule } from '../api'

const pct = (a: number, b: number) => `${a >= b ? '+' : '−'}${Math.abs((100 * (a - b)) / b).toFixed(0)}%`

export function FieldScreen({ onNext }: { onNext: () => void }) {
  const [gens, setGens] = useState(1)
  const [horizon, setHorizon] = useState(180)
  const [data, setData] = useState<FieldPlan | null>(null)
  const [view, setView] = useState<'welltwin' | 'practice'>('welltwin')
  const [err, setErr] = useState('')

  useEffect(() => {
    let live = true
    setErr('')
    api.fieldSchedule(gens, horizon).then((d) => live && setData(d)).catch((e) => setErr(String(e)))
    return () => { live = false }
  }, [gens, horizon])

  if (!data) return <div className="panel mono muted">{err || 'Scheduling steam generators across the field…'}</div>
  const p = data.practice.kpi
  const w = data.welltwin.kpi
  const seqGain = data.sequencing_only.kpi.net_value_cr - p.net_value_cr
  const planGain = w.net_value_cr - data.sequencing_only.kpi.net_value_cr
  const rows = data.welltwin.field_oil.map((v, d) => ({ d, twin: v, practice: data.practice.field_oil[d] }))
  const sched = data[view]

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '14px 20px' }}>
        <div>
          <div className="label">Field twin · {Object.keys(sched.per_well).length} wells · shared steam generators</div>
          <h2 style={{ fontSize: 22, marginTop: 4 }}>Which well gets steam next?</h2>
        </div>
        <Picker label="Steam generators" value={gens} options={[1, 2, 3]} onChange={setGens} />
        <Picker label="Horizon (days)" value={horizon} options={[120, 180, 365]} onChange={setHorizon} />
        <div className="mono muted" style={{ fontSize: 11, maxWidth: 360, marginLeft: 'auto' }}>
          Each well's twin gives its best cycle and its cold decline. A free generator goes to the well with the most incremental oil per generator-day.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 18 }}>
        <section className="panel">
          <div className="label" style={{ marginBottom: 10 }}>Next {horizon} days · field totals</div>
          <table>
            <thead><tr><th /><th>TODAY'S PRACTICE</th><th>WELLTWIN</th><th>CHANGE</th></tr></thead>
            <tbody>
              <tr><td>Oil</td><td>{fmt(p.oil_bbl)} bbl</td><td>{fmt(w.oil_bbl)} bbl</td><td className={w.oil_bbl >= p.oil_bbl ? 'ok' : 'amber'}>{pct(w.oil_bbl, p.oil_bbl)}</td></tr>
              <tr><td>Steam</td><td>{fmt(p.steam_t)} t</td><td>{fmt(w.steam_t)} t</td><td className={w.steam_t <= p.steam_t ? 'ok' : 'amber'}>{pct(w.steam_t, p.steam_t)}</td></tr>
              <tr><td>Field SOR</td><td>{p.sor}</td><td>{w.sor}</td><td className={w.sor <= p.sor ? 'ok' : 'amber'}>{pct(w.sor, p.sor)}</td></tr>
              <tr><td>CSS cycles run</td><td>{p.cycles}</td><td>{w.cycles}</td><td className="muted">{w.cycles - p.cycles >= 0 ? '+' : ''}{w.cycles - p.cycles}</td></tr>
              <tr><td>Rod-float days</td><td>{p.float_days}</td><td>{w.float_days}</td><td className="ok">−{p.float_days - w.float_days}</td></tr>
              <tr><td>Expected rod failures</td><td>{p.expected_failures}</td><td>{w.expected_failures}</td><td className="ok">−{(p.expected_failures - w.expected_failures).toFixed(1)}</td></tr>
              <tr className="win"><td>Net value*</td><td>₹{p.net_value_cr} cr</td><td>₹{w.net_value_cr} cr</td><td className="ok">+₹{(w.net_value_cr - p.net_value_cr).toFixed(2)} cr</td></tr>
            </tbody>
          </table>
          <div className="mono muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.6 }}>
            Gain from sequencing alone: ₹{seqGain.toFixed(2)} cr · from better cycle plans: ₹{planGain.toFixed(2)} cr<br />
            * oil ₹5,500/bbl − steam ₹2,500/t − expected workovers ₹12 lakh each (assumed). Practice = wells steamed in turn with their usual settings and constant SPM.
          </div>
        </section>

        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <div className="label">Steam generator schedule</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className="btn ghost" style={{ color: view === 'welltwin' ? 'var(--cyan)' : 'var(--muted)' }} onClick={() => setView('welltwin')}>WELLTWIN</button>
              <button className="btn ghost" style={{ color: view === 'practice' ? 'var(--amber)' : 'var(--muted)' }} onClick={() => setView('practice')}>TODAY'S PRACTICE</button>
            </div>
          </div>
          <Gantt s={sched} color={view === 'welltwin' ? 'var(--cyan)' : 'var(--amber)'} />
        </section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 18 }}>
        <section className="panel" style={{ height: 250 }}>
          <div className="label">Field oil rate (bopd) · <span className="cyan">WellTwin</span> vs <span className="amber">today's practice</span></div>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={rows} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="d" type="number" domain={[0, horizon]} tickCount={8} />
              <YAxis />
              <Line dataKey="practice" stroke="var(--amber)" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line dataKey="twin" stroke="var(--cyan)" strokeWidth={2.5} dot={false} animationDuration={1200} />
            </LineChart>
          </ResponsiveContainer>
        </section>
        <section className="panel">
          <div className="label" style={{ marginBottom: 10 }}>Priority queue · WellTwin</div>
          <table>
            <thead><tr><th>#</th><th>WELL</th><th>START</th><th>STEAM</th><th>GAIN / GEN-DAY</th></tr></thead>
            <tbody>
              {data.welltwin.jobs.slice(0, 7).map((j, i) => (
                <tr key={i}><td>{i + 1}</td><td className="cyan">{j.well_id}</td><td>day {Math.round(j.start)}</td><td>{fmt(j.steam_t)} t</td><td>+{fmt(j.gain_per_gen_day)} bbl</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <button className="btn next" onClick={onNext}>LEARNING LOOP →</button>
    </div>
  )
}

function Picker({ label, value, options, onChange }: { label: string; value: number; options: number[]; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="label" style={{ fontSize: 10, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', gap: 4 }}>
        {options.map((o) => (
          <button key={o} className="btn ghost" style={{ color: o === value ? 'var(--cyan)' : 'var(--muted)', padding: '6px 12px' }} onClick={() => onChange(o)}>{o}</button>
        ))}
      </div>
    </div>
  )
}

function Gantt({ s, color }: { s: Schedule; color: string }) {
  const wells = Object.keys(s.per_well)
  const x = (d: number) => `${(Math.min(d, s.horizon) / s.horizon) * 100}%`
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {wells.map((w) => (
        <div key={w} style={{ display: 'grid', gridTemplateColumns: '64px 1fr', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ fontSize: 11 }}>{w}</span>
          <div style={{ position: 'relative', height: 22, background: 'var(--bg)', borderRadius: 3 }}>
            {s.jobs.filter((j) => j.well_id === w).map((j, i) => (
              <div key={i}>
                <div title={`${w}: production cycle to day ${Math.round(j.cycle_end)}`} style={{ position: 'absolute', top: 7, height: 8, left: x(j.start + j.inj_days), width: `calc(${x(j.cycle_end)} - ${x(j.start + j.inj_days)})`, background: color, opacity: 0.22, borderRadius: 2 }} />
                <div title={`${w}: ${j.steam_t} t steam, generator ${j.generator}`} className="mono" style={{ position: 'absolute', top: 2, height: 18, left: x(j.start), width: `max(${x(j.inj_days)}, 18px)`, background: '#e8eef2', color: '#06121a', borderRadius: 2, fontSize: 9, fontWeight: 700, display: 'grid', placeItems: 'center' }}>G{j.generator}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 8 }}>
        <span />
        <div className="mono muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => <span key={f}>day {Math.round(f * s.horizon)}</span>)}
        </div>
      </div>
      <div className="mono muted" style={{ fontSize: 10 }}>▮ steam injection (generator) · ▬ production cycle until re-steam trigger</div>
    </div>
  )
}
