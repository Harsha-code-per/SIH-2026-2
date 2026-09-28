import { motion } from 'motion/react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { fmt, type Explanation, type Plan } from '../api'
import { useState } from 'react'
import { useAfter } from '../auto'
import { WorkOrderFlow } from '../WorkOrder'

const pct = (a: number, b: number) => `${a >= b ? '+' : '−'}${Math.abs((100 * (a - b)) / b).toFixed(0)}%`

export function PlanScreen({ plan, why, onNext, auto }: { plan: Plan; why: Explanation | null; onNext: () => void; auto: boolean }) {
  const [wo, setWo] = useState<'closed' | 'open' | 'done'>('closed')
  useAfter(auto && wo === 'closed', 6000, () => setWo('open'))
  useAfter(auto && wo === 'done', 800, onNext)
  const r = plan.recommended
  const b = plan.baseline
  const m = plan.mission
  const end = r.resteam_day
  const data = r.series.spm.slice(0, Math.min(end + 5, plan.days)).map((spm, d) => ({
    d, plan: d >= r.prod_start ? spm : null, limit: Math.min(r.series.safe_spm[d], 8),
    practice: d >= b.prod_start && d < b.resteam_day ? b.series.spm[d] : null,
  }))
  const checks: [string, string][] = [
    ['Production target', `P10 ${fmt(r.p10)} ≥ ${fmt(m.target_bbl)} bbl`],
    ['Deadline', `target reached day ${r.day_target} ≤ ${m.deadline_d}`],
    ['Steam budget', `${fmt(r.x.steam_t)} ≤ ${fmt(m.steam_budget_t)} t`],
    ['Energy budget', `${fmt(r.energy_kwh)} ≤ ${fmt(m.energy_budget_kwh)} kWh`],
    ['Rod float', `margin ≥ 1.25 all cycle · 0 float days`],
    ['Operating envelope', 'VALIDATED · inside this well\'s history'],
  ]

  return (
    <div className="fill" style={{ display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: 24 }}>
      <section style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
        <div>
          <div className="label cyan">Recommended operating plan · {m.well_id} · CSS cycle #{plan.state.next_cycle}</div>
          <h1 style={{ fontSize: 26, marginTop: 4 }}>Strategy C</h1>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="panel">
            <div className="label" style={{ marginBottom: 12 }}>CSS · thermal stimulation</div>
            <div className="kv">
              <span>Steam volume</span><span>{fmt(r.x.steam_t)} t</span>
              <span>Injection pressure</span><span>{r.x.inj_p_bar} bar</span>
              <span>Steam temperature</span><span>{r.t_steam} °C</span>
              <span>Injection</span><span>{r.inj_days} d</span>
              <span>Soak</span><span>{r.x.soak_d} d</span>
              <span>Production start</span><span>day {Math.ceil(r.prod_start)}</span>
              <span>Re-steam trigger</span><span className="amber">day {r.resteam_day}</span>
            </div>
          </div>
          <div className="panel">
            <div className="label" style={{ marginBottom: 12 }}>SRP · thermal-aware schedule</div>
            <div className="kv"><span>Stroke length</span><span>{r.x.stroke_m.toFixed(1)} m</span></div>
            <table className="compact" style={{ marginTop: 8 }}>
              <thead><tr><th>FROM DAY</th><th>SPM</th><th>VFD</th></tr></thead>
              <tbody>
                {r.spm_schedule.filter((_, i, a) => i === 0 || i === a.length - 1 || i % 2 === 0).map((s) => (
                  <tr key={s.from_day}><td>{s.from_day}</td><td className="cyan">{s.spm.toFixed(2)}</td><td>{s.vfd_hz} Hz</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel" style={{ height: 175 }}>
          <div className="label">SPM schedule <span className="cyan">(twin plan)</span> vs typical practice <span className="amber">(constant)</span> vs rod-float limit <span className="red">(safe SPM)</span></div>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={data} margin={{ top: 12, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="d" type="number" domain={[0, end + 5]} tickCount={8} />
              <YAxis domain={[0, 8]} ticks={[0, 2, 4, 6, 8]} />
              <Line dataKey="limit" stroke="var(--red)" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              <Line dataKey="practice" stroke="var(--amber)" strokeDasharray="2 3" dot={false} isAnimationActive={false} />
              <Line dataKey="plan" stroke="var(--cyan)" strokeWidth={2.5} dot={false} animationDuration={1500} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="panel">
          <div className="label" style={{ marginBottom: 10 }}>Why this plan</div>
          {why ? (
            <>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>{why.text}</p>
              <div className="mono muted" style={{ fontSize: 11, marginTop: 10 }}>
                {why.source === 'llm' ? 'Written by NVIDIA Nemotron · every number verified against engine output' : 'Deterministic engine summary'}
              </div>
            </>
          ) : <span className="mono muted">Explaining…</span>}
          <hr className="rule" />
          <div className="label" style={{ marginBottom: 8 }}>Evidence · closest past cycles of this well</div>
          <div className="mono" style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            {plan.evidence.map((e) => (
              <div key={e.cycle} style={{ display: 'grid', gridTemplateColumns: '42px 1fr auto', gap: 10 }}>
                <span className="cyan">#{e.cycle}</span>
                <span className="muted">{fmt(e.steam_t)} t · {e.inj_p_bar} bar · {e.soak_d} d soak → <span style={{ color: 'var(--text)' }}>{fmt(e.cum_oil_bbl)} bbl</span></span>
                <span className={e.float_days ? 'red' : 'ok'}>{e.float_days ? `${e.float_days} float days${e.rod_failure ? ' · rod failure' : ''}` : 'no float'}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
        <div className="panel">
          <div className="label">Expected outcome by day {m.deadline_d}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 8 }}>
            <span className="big cyan">{fmt(r.p50)}</span><span className="mono">bbl P50</span>
          </div>
          <div className="mono muted">P10–P90: {fmt(r.p10)} – {fmt(r.p90)} bbl · ±{(plan.conformal_q * 100).toFixed(0)}% from hold-out error on past cycles</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 18 }}>
            {[['SOR', r.sor.toFixed(2), 'm³/m³'], ['Energy', fmt(r.energy_kwh), 'kWh'], ['Cost', `₹${fmt(r.cost_per_bbl)}`, 'per bbl']].map(([k, v, u]) => (
              <div key={k} style={{ background: 'var(--panel-2)', padding: 12, borderRadius: 4 }}>
                <div className="label" style={{ fontSize: 10 }}>{k}</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{v}</div>
                <div className="mono muted" style={{ fontSize: 11 }}>{u}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="label" style={{ marginBottom: 12 }}>Mission checks</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {checks.map(([k, v], i) => (
              <motion.div key={k} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.25 }}
                className="mono" style={{ display: 'grid', gridTemplateColumns: '22px 170px 1fr', fontSize: 13 }}>
                <span className="ok">✓</span><span>{k}</span><span className="muted">{v}</span>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="label" style={{ marginBottom: 12 }}>vs this well's typical practice (median of past cycles, constant SPM)</div>
          <table className="compact">
            <thead><tr><th /><th>TYPICAL PRACTICE</th><th>TWIN PLAN</th><th>CHANGE</th></tr></thead>
            <tbody>
              <tr><td>Oil by day {m.deadline_d}</td><td>{fmt(b.p50)} bbl</td><td>{fmt(r.p50)} bbl</td><td className={r.p50 >= b.p50 ? 'ok' : 'amber'}>{pct(r.p50, b.p50)}</td></tr>
              <tr><td>Steam</td><td>{fmt(b.x.steam_t)} t</td><td>{fmt(r.x.steam_t)} t</td><td className={r.x.steam_t <= b.x.steam_t ? 'ok' : 'amber'}>{pct(r.x.steam_t, b.x.steam_t)}</td></tr>
              <tr><td>Steam-oil ratio</td><td>{b.sor.toFixed(2)}</td><td>{r.sor.toFixed(2)}</td><td className={r.sor <= b.sor ? 'ok' : 'amber'}>{pct(r.sor, b.sor)}</td></tr>
              <tr><td>SRP energy</td><td>{fmt(b.energy_kwh)} kWh</td><td>{fmt(r.energy_kwh)} kWh</td><td className={r.energy_kwh <= b.energy_kwh ? 'ok' : 'amber'}>{pct(r.energy_kwh, b.energy_kwh)}</td></tr>
              <tr><td>CO₂ (steam + power)</td><td>{fmt(b.co2_t, 1)} t</td><td>{fmt(r.co2_t, 1)} t</td><td className={r.co2_t <= b.co2_t ? 'ok' : 'amber'}>{pct(r.co2_t, b.co2_t)}</td></tr>
              <tr><td>Rod-float days</td><td>{b.float_days}</td><td>{r.float_days}</td><td className="ok">{b.float_days ? `−${b.float_days} d` : '–'}</td></tr>
              <tr><td>Rod-failure risk</td><td>{(b.failure_risk * 100).toFixed(0)}%</td><td>{(r.failure_risk * 100).toFixed(0)}%</td><td className="ok">{r.failure_risk < b.failure_risk ? 'lower' : '–'}</td></tr>
              <tr><td>Cost per barrel*</td><td>₹{fmt(b.cost_per_bbl)}</td><td>₹{fmt(r.cost_per_bbl)}</td><td className="ok">{pct(r.cost_per_bbl, b.cost_per_bbl)}</td></tr>
            </tbody>
          </table>
          <div className="mono muted" style={{ fontSize: 10, marginTop: 8 }}>* steam ₹2,500/t + power ₹9/kWh + failure risk × ₹12 lakh workover (assumed rates). Model estimates on synthetic history.</div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifySelf: 'end' }}>
          <button className="btn ghost" onClick={() => setWo('open')}>ISSUE WORK ORDER</button>
          <button className="btn" onClick={onNext}>WHAT-IF SANDBOX →</button>
        </div>
        {wo === 'open' && <WorkOrderFlow mission={m} auto={auto} onClose={() => setWo('done')} />}
      </section>
    </div>
  )
}
