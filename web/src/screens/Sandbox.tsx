import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { api, fmt, type Plan, type WhatIf, type X } from '../api'
import { useAfter } from '../auto'

type Knob = { k: keyof X | 'heater_kw'; label: string; unit: string; step: number }
const KNOBS: Knob[] = [
  { k: 'steam_t', label: 'Steam volume', unit: 't', step: 10 },
  { k: 'inj_p_bar', label: 'Injection pressure', unit: 'bar', step: 1 },
  { k: 'soak_d', label: 'Soak', unit: 'd', step: 0.5 },
  { k: 'stroke_m', label: 'Stroke length', unit: 'm', step: 0.1 },
  { k: 'spm_max', label: 'SPM ceiling', unit: 'SPM', step: 0.1 },
  { k: 'heater_kw', label: 'Downhole heater', unit: 'kW', step: 5 },
]
const CHECKS: [keyof WhatIf['meets'], string][] = [
  ['target', 'P10 ≥ target'], ['steam', 'steam budget'], ['energy', 'energy budget'],
  ['frac', 'below frac'], ['envelope', 'validated envelope'], ['rod', 'no rod float'],
]

export function SandboxScreen({ plan, onNext, auto }: { plan: Plan; onNext: () => void; auto: boolean }) {
  const [x, setX] = useState<Record<string, number>>({ ...plan.recommended.x, heater_kw: 0 })
  const [controller, setController] = useState(true)
  const [r, setR] = useState<WhatIf | null>(null)

  useEffect(() => {
    let live = true
    const id = setTimeout(() => api.simulate(plan.mission, x, controller).then((d) => live && setR(d)).catch(() => {}), 120)
    return () => { live = false; clearTimeout(id) }
  }, [x, controller, plan.mission])

  // auto demo: push steam past the envelope, then show the heater alternative to SPM control, then move on
  useAfter(auto && !!r && x.steam_t === plan.recommended.x.steam_t, 2500, () => setX({ ...x, steam_t: 1600 }))
  useAfter(auto && x.steam_t === 1600, 3500, () => { setX({ ...plan.baseline.x, heater_kw: 20 }); setController(false) })
  useAfter(auto && !controller, 4500, onNext)

  const load = (src: X, ctrl: boolean, heater = 0) => { setX({ ...src, heater_kw: heater }); setController(ctrl) }
  const m = plan.mission
  const rows = useMemo(() => {
    if (!r) return []
    const end = Math.min(Math.max(r.resteam_day, plan.recommended.resteam_day) + 10, r.cum.length - 1)
    return Array.from({ length: end + 1 }, (_, d) => ({
      d, cum: r.cum[d], rec: plan.recommended.series.cum[d],
      fm: d >= r.prod_start ? Math.min(r.float_margin[d], 6) : null, spm: d >= r.prod_start ? r.spm[d] : null,
    }))
  }, [r, plan])

  return (
    <div className="screen" style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 0.9fr) minmax(520px, 1.6fr)', gap: 20 }}>
      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div className="label">What-if sandbox · {m.well_id} cycle #{plan.state.next_cycle}</div>
          <h2 style={{ fontSize: 20, marginTop: 4 }}>Try it on the twin, not the well.</h2>
        </div>
        {KNOBS.map((kn) => {
          const [lo, hi] = kn.k === 'heater_kw' ? [0, r?.heater_max_kw ?? 60] : (r?.bounds[kn.k as keyof X] ?? [0, 1])
          const env = kn.k === 'heater_kw' ? null : r?.envelope[kn.k as keyof X]
          const out = !!r?.out_of_envelope.includes(kn.k)
          const pct = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`
          const band = env ? `linear-gradient(to right, var(--line) ${pct(env[0])}, rgba(76,201,240,.45) ${pct(env[0])}, rgba(76,201,240,.45) ${pct(env[1])}, var(--line) ${pct(env[1])})` : 'var(--line)'
          return (
            <label key={kn.k} style={{ display: 'grid', gap: 4 }}>
              <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span className="muted">{kn.label}</span>
                <span className={out ? 'red' : 'cyan'} style={{ fontWeight: 700 }}>
                  {kn.step < 1 ? x[kn.k].toFixed(1) : fmt(x[kn.k])} {kn.unit}{out && ' · OUTSIDE ENVELOPE'}
                </span>
              </div>
              <input type="range" min={lo} max={hi} step={kn.step} value={x[kn.k]} aria-label={kn.label}
                onChange={(e) => setX({ ...x, [kn.k]: Number(e.target.value) })}
                style={{ width: '100%', appearance: 'none', height: 6, borderRadius: 3, background: band, accentColor: out ? 'var(--red)' : 'var(--cyan)' }} />
            </label>
          )
        })}
        <div className="mono muted" style={{ fontSize: 10 }}>▬ highlighted band = range this well has actually run (validated envelope)</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn ghost" style={{ color: controller ? 'var(--cyan)' : 'var(--muted)', flex: 1 }} onClick={() => setController(true)}>THERMAL-AWARE SPM</button>
          <button className="btn ghost" style={{ color: !controller ? 'var(--amber)' : 'var(--muted)', flex: 1 }} onClick={() => setController(false)}>CONSTANT SPM</button>
        </div>
        {r && (
          <div style={{ marginTop: 6 }}>
            <div className="label" style={{ fontSize: 10, marginBottom: 6 }}>Compared with plan C</div>
            <table className="compact">
              <tbody>
                {([
                  ['Oil by deadline', r.p50, plan.recommended.p50, 'bbl', 1],
                  ['Steam', x.steam_t, plan.recommended.x.steam_t, 't', -1],
                  ['SOR', r.sor, plan.recommended.sor, '', -1],
                  ['Energy', r.energy_kwh, plan.recommended.energy_kwh, 'kWh', -1],
                  ['CO₂', r.co2_t, plan.recommended.co2_t, 't', -1],
                  ['Rod-float days', r.float_days, plan.recommended.float_days, 'd', -1],
                ] as [string, number, number, string, number][]).map(([k, a, b, u, good]) => {
                  const d = a - b
                  const dig = (v: number) => (Number.isInteger(v) || Math.abs(v) >= 10 ? 0 : 2)
                  return (
                    <tr key={k}>
                      <td>{k}</td>
                      <td>{fmt(a, dig(a))} {u}</td>
                      <td className={Math.abs(d) < 1e-9 ? 'muted' : d * good > 0 ? 'ok' : 'red'}>{Math.abs(d) < 1e-9 ? '=' : `${d > 0 ? '+' : '−'}${fmt(Math.abs(d), dig(d))}`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={() => load(plan.recommended.x, true)}>LOAD PLAN C</button>
          <button className="btn ghost" style={{ flex: 1 }} onClick={() => load(plan.baseline.x, false)}>LOAD TYPICAL PRACTICE</button>
        </div>
        <button className="btn" onClick={onNext}>OPERATE THIS PLAN LIVE →</button>
      </section>

      <section style={{ display: 'grid', gap: 14, gridTemplateRows: 'auto auto minmax(200px, 1fr) minmax(170px, 0.8fr)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr repeat(5, 1fr)', gap: 10 }}>
          <Tile k={`Oil by day ${m.deadline_d}`} v={r ? `${fmt(r.p50)} bbl` : '…'} sub={r ? `P10–P90 ${fmt(r.p10)}–${fmt(r.p90)}${r.in_envelope ? '' : ' · wide: extrapolating'}` : ''} c={r && !r.in_envelope ? 'red' : 'cyan'} />
          <Tile k="SOR" v={r ? r.sor.toFixed(2) : '…'} sub="m³/m³" />
          <Tile k="Energy" v={r ? fmt(r.energy_kwh) : '…'} sub={r?.heater_days ? `kWh · heater ${r.heater_days} d` : 'kWh'} c={r && !r.meets.energy ? 'red' : ''} />
          <Tile k="CO₂" v={r ? fmt(r.co2_t, 1) : '…'} sub="t" />
          <Tile k="Cost" v={r ? `₹${fmt(r.cost_per_bbl)}` : '…'} sub="per bbl" />
          <Tile k="Rod float" v={r ? `${r.float_days} d` : '…'} sub={r ? `failure risk ${(r.failure_risk * 100).toFixed(0)}%` : ''} c={r && r.float_days ? 'red' : 'ok'} />
        </div>
        <div className="panel mono" style={{ display: 'flex', gap: 18, padding: '10px 16px', fontSize: 12, flexWrap: 'wrap' }}>
          <span className="label" style={{ fontSize: 10 }}>Mission checks</span>
          {CHECKS.map(([k, label]) => (
            <span key={k} className={r?.meets[k] ? 'ok' : 'red'}>{r?.meets[k] ? '✓' : '✗'} {label}</span>
          ))}
        </div>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="label">Cumulative oil (bbl) · <span className="cyan">this what-if</span> · <span className="muted">plan C</span></div>
          <div style={{ flex: 1, minHeight: 150 }}><ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 10, right: 10, bottom: 0, left: -6 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="d" type="number" domain={[0, 'dataMax']} tickCount={8} />
              <YAxis />
              <ReferenceLine y={m.target_bbl} stroke="#f5f7fa" strokeDasharray="4 4" />
              <ReferenceLine x={m.deadline_d} stroke="#f5f7fa" strokeDasharray="4 4" />
              <Line dataKey="rec" stroke="var(--muted)" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              <Line dataKey="cum" stroke={r && !r.in_envelope ? 'var(--red)' : 'var(--cyan)'} strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer></div>
        </div>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="label">Rod float margin <span className="cyan">(left)</span> · SPM applied <span className="amber">(right)</span> · <span className="red">float below 1.0</span></div>
          <div style={{ flex: 1, minHeight: 120 }}><ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 10, right: 0, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="d" type="number" domain={[0, 'dataMax']} tickCount={8} />
              <YAxis yAxisId="fm" domain={[0, 6]} allowDataOverflow ticks={[0, 1, 3, 6]} />
              <YAxis yAxisId="spm" orientation="right" domain={[0, 8]} />
              <ReferenceLine yAxisId="fm" y={1} stroke="var(--red)" />
              <Line yAxisId="fm" dataKey="fm" stroke="var(--cyan)" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="spm" dataKey="spm" stroke="var(--amber)" strokeDasharray="3 3" dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer></div>
        </div>
      </section>
    </div>
  )
}

function Tile({ k, v, sub, c = '' }: { k: string; v: string; sub: string; c?: string }) {
  return (
    <div className="panel" style={{ padding: '10px 12px' }}>
      <div className="label" style={{ fontSize: 9 }}>{k}</div>
      <div className={`mono ${c}`} style={{ fontSize: 19, fontWeight: 700, marginTop: 4 }}>{v}</div>
      <div className="mono muted" style={{ fontSize: 10 }}>{sub}</div>
    </div>
  )
}
