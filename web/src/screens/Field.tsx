import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { api, fmt, type FieldPlan, type Schedule } from '../api'
import { useAfter } from '../auto'

const pct = (a: number, b: number) => `${a >= b ? '+' : '−'}${Math.abs((100 * (a - b)) / b).toFixed(0)}%`

export function FieldScreen({ onNext, auto }: { onNext: () => void; auto: boolean }) {
  const [gens, setGens] = useState(1)
  const [maint, setMaint] = useState('')
  const [outage, setOutage] = useState('')
  const [applied, setApplied] = useState({ maint: '', outage: '' })
  const [horizon, setHorizon] = useState(180)
  const [data, setData] = useState<FieldPlan | null>(null)
  const [view, setView] = useState<'welltwin' | 'practice'>('welltwin')
  const [err, setErr] = useState('')
  const [flipped, setFlipped] = useState(false)

  useEffect(() => {
    let live = true
    setErr('')
    api.fieldSchedule(gens, horizon, applied.maint, applied.outage).then((d) => live && setData(d)).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
    return () => { live = false }
  }, [gens, horizon, applied])

  // auto demo: show WellTwin, flip to today's practice, back, move on
  useAfter(auto && !!data && view === 'welltwin' && !flipped, 4500, () => { setView('practice'); setFlipped(true) })
  useAfter(auto && view === 'practice', 3500, () => setView('welltwin'))
  useAfter(auto && flipped && view === 'welltwin', 4000, onNext)

  if (!data) return <div className="panel mono muted">{err || 'Scheduling steam generators across the field…'}</div>
  const p = data.practice.kpi
  const w = data.welltwin.kpi
  const seqGain = data.sequencing_only.kpi.net_value_cr - p.net_value_cr
  const planGain = w.net_value_cr - data.sequencing_only.kpi.net_value_cr
  const rows = data.welltwin.field_oil.map((v, d) => ({ d, twin: v, practice: data.practice.field_oil[d] }))
  const sched = data[view]

  return (
    <div className="screen" style={{ display: 'grid', gap: 18, gridTemplateRows: 'auto auto minmax(250px, 1fr)' }}>
      <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '14px 20px' }}>
        <div>
          <div className="label">Field twin · {Object.keys(sched.per_well).length} wells · shared steam generators</div>
          <h2 style={{ fontSize: 22, marginTop: 4 }}>Which well gets steam next?</h2>
        </div>
        <Picker label="Steam generators" value={gens} options={[1, 2, 3]} onChange={setGens} />
        <Picker label="Horizon (days)" value={horizon} options={[120, 180, 365]} onChange={setHorizon} />
        <div>
          <div className="label" style={{ fontSize: 10, marginBottom: 4 }}>Constraints</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="text" style={{ minWidth: 150 }} placeholder="maintenance e.g. 1:40-60" value={maint} onChange={(e) => setMaint(e.target.value)} aria-label="Generator maintenance windows" />
            <input className="text" style={{ minWidth: 150 }} placeholder="well outage e.g. BGW-03:0-30" value={outage} onChange={(e) => setOutage(e.target.value)} aria-label="Well outage windows" />
            <button className="btn ghost" onClick={() => setApplied({ maint, outage })}>APPLY</button>
          </div>
          {err && <div className="mono red" style={{ fontSize: 11, marginTop: 4 }}>{err}</div>}
        </div>
        <div className="mono muted" style={{ fontSize: 11, maxWidth: 360, marginLeft: 'auto' }}>
          Each well's twin gives its best cycle and its cold decline. A free generator goes to the well with the most incremental oil per generator-day.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 18 }}>
        <section className="panel">
          <div className="label" style={{ marginBottom: 10 }}>Next {horizon} days · field totals</div>
          <table className="compact">
            <thead><tr><th /><th>TODAY'S PRACTICE</th><th>WELLTWIN</th><th>CHANGE</th></tr></thead>
            <tbody>
              <tr><td>Oil</td><td>{fmt(p.oil_bbl)} bbl</td><td>{fmt(w.oil_bbl)} bbl</td><td className={w.oil_bbl >= p.oil_bbl ? 'ok' : 'amber'}>{pct(w.oil_bbl, p.oil_bbl)}</td></tr>
              <tr><td>Steam</td><td>{fmt(p.steam_t)} t</td><td>{fmt(w.steam_t)} t</td><td className={w.steam_t <= p.steam_t ? 'ok' : 'amber'}>{pct(w.steam_t, p.steam_t)}</td></tr>
              <tr><td>Field SOR</td><td>{p.sor}</td><td>{w.sor}</td><td className={w.sor <= p.sor ? 'ok' : 'amber'}>{pct(w.sor, p.sor)}</td></tr>
              <tr><td>CO₂ (steam + power)</td><td>{fmt(p.co2_t)} t</td><td>{fmt(w.co2_t)} t</td><td className={w.co2_t <= p.co2_t ? 'ok' : 'amber'}>{pct(w.co2_t, p.co2_t)}</td></tr>
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
        <section className="panel" style={{ minHeight: 250, display: 'flex', flexDirection: 'column' }}>
          <div className="label">Field oil rate (bopd) · <span className="cyan">WellTwin</span> vs <span className="amber">today's practice</span></div>
          <div style={{ flex: 1, minHeight: 200 }}><ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="d" type="number" domain={[0, horizon]} tickCount={8} />
              <YAxis />
              <Line dataKey="practice" stroke="var(--amber)" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line dataKey="twin" stroke="var(--cyan)" strokeWidth={2.5} dot={false} animationDuration={1200} />
            </LineChart>
          </ResponsiveContainer></div>
        </section>
        <section className="panel">
          <div className="label" style={{ marginBottom: 10 }}>Priority queue · WellTwin</div>
          <table className="compact">
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
    <div style={{ display: 'grid', gap: 6, position: 'relative', paddingTop: s.maintenance.length ? 14 : 0 }}>
      {s.maintenance.map((m, i) => (
        <div key={`m${i}`} title={`Generator G${m.generator} maintenance days ${m.start}–${m.end}`} className="mono"
          style={{ position: 'absolute', top: 0, bottom: 34, left: `calc(72px + (100% - 72px) * ${Math.min(m.start, s.horizon) / s.horizon})`,
            width: `calc((100% - 72px) * ${(Math.min(m.end, s.horizon) - Math.min(m.start, s.horizon)) / s.horizon})`, borderLeft: '1px dashed var(--amber)', borderRight: '1px dashed var(--amber)',
            background: 'rgba(244,162,97,.07)', fontSize: 9, color: 'var(--amber)', textAlign: 'center', pointerEvents: 'none' }}>G{m.generator} MAINT</div>
      ))}
      {wells.map((w) => (
        <div key={w} style={{ display: 'grid', gridTemplateColumns: '64px 1fr', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ fontSize: 11 }}>{w}</span>
          <div style={{ position: 'relative', height: 22, background: 'var(--bg)', borderRadius: 3 }}>
            {s.outages.filter((o) => o.well_id === w).map((o, i) => (
              <div key={`o${i}`} title={`${w} unavailable days ${o.start}–${o.end}`} style={{ position: 'absolute', top: 0, bottom: 0, left: x(o.start), width: `calc(${x(o.end)} - ${x(o.start)})`,
                background: 'repeating-linear-gradient(45deg, rgba(239,83,80,.25) 0 4px, transparent 4px 8px)', borderRadius: 2 }} />
            ))}
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
