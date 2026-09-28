import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, XAxis, YAxis } from 'recharts'
import { api, fmt, type Alert, type Card, type Live, type Mission } from '../api'
import { useAfter } from '../auto'
import { DynoCard } from '../DynoCard'
import { WellScene, type Run } from '../WellScene'

const TICK_MS = 260
const ROD_W_KN = 25 // buoyant rod weight: min polished-rod load → measured float margin
const HZ_PER_SPM = 50 / 6

export function LiveScreen({ mission, onNext, auto }: { mission: Mission; onNext: () => void; auto: boolean }) {
  const [s, setS] = useState<Live | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(auto ? 3 : 1)
  const [card, setCard] = useState<Card | null>(null)
  const [err, setErr] = useState('')

  const restart = () => { setCard(null); api.liveStart(mission).then((x) => { setS(x); setPlaying(true) }).catch((e) => setErr(String(e))) }
  useEffect(restart, []) // eslint-disable-line react-hooks/exhaustive-deps

  const waiting = !!s?.alerts.some((a) => a.status === 'open')
  useEffect(() => {
    if (!playing || !s || s.complete || waiting) return
    const id = setTimeout(() => api.liveStep(speed).then(setS).catch((e) => setErr(String(e))), TICK_MS)
    return () => clearTimeout(id)
  }, [playing, s, speed, waiting])

  const bucket = s && s.day >= s.prod_start ? Math.floor(s.day / 5) : -1
  useEffect(() => { if (bucket >= 0) api.liveDyno().then(setCard).catch(() => {}) }, [bucket])

  const decide = (a: Alert, approve: boolean) => api.liveDecide(a.id, approve).then((x) => { setS(x); setPlaying(true) })
  // auto demo: give each alert time to be read, approve it, and move on when the cycle ends
  const first = s?.alerts.find((a) => a.status === 'open')
  useAfter(auto && !!first, first?.action ? 4500 : 3000, () => first && decide(first, true))
  useAfter(auto && !!s?.complete, 3000, onNext)

  const end = s ? Math.min(Math.max(s.kpi.resteam_day, 110) + 8, s.plan.oil.length - 1) : 0
  const rows = useMemo(() => {
    if (!s) return []
    const obs = new Map(s.observed.day.map((d, i) => [d, i]))
    const f0 = s.forecast.day[0]
    return Array.from({ length: end + 1 }, (_, d) => {
      const i = obs.get(d)
      const j = d - f0
      const load = i === undefined ? undefined : s.observed.min_load_kn[i]
      return {
        d,
        plan: d >= s.prod_start ? s.plan.oil[d] : null,
        obs: i === undefined ? null : s.observed.oil[i],
        fc: j >= 0 && d >= s.prod_start ? s.forecast.oil[j] : null,
        band: j >= 0 && d >= s.prod_start ? [s.forecast.lo[j], s.forecast.hi[j]] : null,
        fm: j >= 0 && d >= s.prod_start ? Math.min(s.forecast.float_margin[j], 6) : null,
        fmObs: load === undefined ? null : Math.min(load <= 0.3 ? 0.95 : 1 / (1 - load / ROD_W_KN), 6),
        spm: d >= s.prod_start ? s.issued_spm[d] : null,
      }
    })
  }, [s, end])

  if (!s) return <div className="panel mono muted">{err || 'Starting live session…'}</div>
  const run: Run = {
    series: Object.fromEntries(['t_res', 'spm', 'oil', 'float_margin'].map((k) => [k, Array(s.plan.oil.length).fill(s.truth_now[k as keyof Live['truth_now']])])) as unknown as Run['series'],
    inj_days: s.inj_days, prod_start: s.prod_start, r_heated: s.r_heated, t_steam: s.t_steam, resteam_day: s.kpi.resteam_day,
  }
  const target = s.mission.target_bbl
  const onTrack = s.kpi.forecast_at_deadline >= target
  const tw = s.twin
  const open = s.alerts.filter((a) => a.status === 'open')
  const closed = s.alerts.filter((a) => a.status !== 'open').slice().reverse()

  return (
    <div className="screen" style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 0.75fr) minmax(460px, 1.45fr) minmax(320px, 1fr)', gap: 20 }}>
      <section className="panel" style={{ padding: 0, overflow: 'hidden', minHeight: 560 }}>
        <WellScene run={run} day={s.day} />
      </section>

      <section style={{ display: 'grid', gap: 14, gridTemplateRows: 'auto auto auto minmax(210px, 1fr) minmax(210px, 1fr)' }}>
        <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px' }}>
          <div>
            <div className="label">Live · {s.well_id} · CSS cycle #{s.cycle} · SCADA + dyno feed</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span className="big" style={{ fontSize: 38 }}>DAY {String(s.day).padStart(3, '0')}</span>
              <span className={`pill ${s.stage === 'PRODUCTION' ? 'ok' : s.stage === 'RE-STEAM DUE' ? 'red' : 'cyan'}`}>{s.stage}</span>
              {waiting && <span className="pill amber">AWAITING OPERATOR</span>}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn ghost" onClick={() => setPlaying(!playing)} disabled={s.complete}>{playing ? '❚❚' : '▶'}</button>
            {[1, 3].map((v) => <button key={v} className="btn ghost" style={{ color: speed === v ? 'var(--cyan)' : 'var(--muted)' }} onClick={() => setSpeed(v)}>{v}×</button>)}
            <button className="btn ghost" onClick={restart}>RESTART</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {[
            ['Oil produced', `${fmt(s.kpi.cum_oil)} bbl`, ''],
            [`Forecast · day ${s.mission.deadline_d}`, `${fmt(s.kpi.forecast_at_deadline)} bbl`, onTrack ? 'ok' : 'amber'],
            ['Rod-float days', String(s.kpi.float_days), s.kpi.float_days ? 'red' : 'ok'],
            ['Re-steam due', `day ${s.kpi.resteam_day}`, ''],
            ['SRP now', s.truth_now.spm ? `${s.truth_now.spm.toFixed(2)} SPM · ${(s.truth_now.spm * HZ_PER_SPM).toFixed(0)} Hz` : 'idle', 'cyan'],
          ].map(([k, v, c]) => (
            <div key={k} className="panel" style={{ padding: '10px 12px' }}>
              <div className="label" style={{ fontSize: 9 }}>{k}</div>
              <div className={`mono ${c}`} style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>

        <div className="panel mono" style={{ fontSize: 12, padding: '10px 16px', display: 'flex', gap: 22, flexWrap: 'wrap' }}>
          <span className="label" style={{ fontSize: 10 }}>Twin self-calibration</span>
          <Est k="cooling τ" a={tw.planned_tau0} b={tw.tau0} u="d" />
          <Est k="rod drag" a={tw.planned_drag_c} b={tw.drag_c} u="" />
          <Est k="cold rate" a={tw.planned_q_cold} b={tw.q_cold} u="bopd" />
        </div>

        <div className="panel" style={{ minHeight: 210 }}>
          <div className="label">Oil rate (bopd) · <span className="amber">measured</span> · <span className="muted">plan</span> · <span className="cyan">twin forecast ± band</span></div>
          <ResponsiveContainer width="100%" height="90%">
            <ComposedChart data={rows} margin={{ top: 10, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="d" type="number" domain={[0, end]} tickCount={8} />
              <YAxis domain={[0, 30]} />
              <Area dataKey="band" stroke="none" fill="var(--cyan)" fillOpacity={0.12} isAnimationActive={false} />
              <Line dataKey="plan" stroke="var(--muted)" strokeDasharray="4 4" dot={false} isAnimationActive={false} />
              <Line dataKey="fc" stroke="var(--cyan)" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Scatter dataKey="obs" fill="var(--amber)" shape={<Dot />} isAnimationActive={false} />
              <ReferenceLine x={s.day} stroke="#f5f7fa" strokeDasharray="3 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="panel" style={{ minHeight: 210 }}>
          <div className="label">Rod float margin · <span className="amber">measured from dyno</span> · <span className="cyan">forecast</span> · issued SPM (right) · <span className="red">float below 1.0</span></div>
          <ResponsiveContainer width="100%" height="90%">
            <ComposedChart data={rows} margin={{ top: 10, right: 0, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="d" type="number" domain={[0, end]} tickCount={8} />
              <YAxis yAxisId="fm" domain={[0, 6]} allowDataOverflow ticks={[0, 1, 1.25, 3, 6]} />
              <YAxis yAxisId="spm" orientation="right" domain={[0, 6]} tick={{ fill: 'var(--muted)' }} />
              <ReferenceLine yAxisId="fm" y={1} stroke="var(--red)" />
              <ReferenceLine yAxisId="fm" y={1.25} stroke="var(--amber)" strokeDasharray="4 4" />
              <Line yAxisId="spm" dataKey="spm" type="stepAfter" stroke="#7f93a3" strokeDasharray="2 3" dot={false} isAnimationActive={false} />
              <Line yAxisId="fm" dataKey="fm" stroke="var(--cyan)" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Scatter yAxisId="fm" dataKey="fmObs" fill="var(--amber)" shape={<Dot />} isAnimationActive={false} />
              <ReferenceLine yAxisId="fm" x={s.day} stroke="#f5f7fa" strokeDasharray="3 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
        <div className="panel" style={{ padding: 16 }}>
          <div className="label" style={{ marginBottom: 10 }}>Alerts · twin recommendations</div>
          <AnimatePresence>
            {open.map((a) => (
              <motion.div key={a.id} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                style={{ border: `1px solid var(--${a.severity === 'info' ? 'cyan' : a.severity === 'critical' ? 'red' : 'amber'})`, borderRadius: 5, padding: 12, marginBottom: 10, background: 'var(--panel-2)' }}>
                <div className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: a.severity === 'info' ? 'var(--cyan)' : a.severity === 'critical' ? 'var(--red)' : 'var(--amber)' }}>
                  DAY {a.day} · {a.kind === 'float' ? 'ROD-FLOAT FORECAST' : a.kind === 'drag' ? 'ROD DRAG ANOMALY' : 'RESERVOIR COOLING'}
                </div>
                <p style={{ margin: '6px 0 10px', fontSize: 13, lineHeight: 1.5 }}>{a.text}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  {a.action ? (
                    <>
                      <button className="btn" style={{ padding: '8px 14px', fontSize: 12 }} onClick={() => decide(a, true)}>APPROVE</button>
                      <button className="btn ghost" onClick={() => decide(a, false)}>REJECT</button>
                    </>
                  ) : <button className="btn ghost" onClick={() => decide(a, true)}>ACKNOWLEDGE</button>}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {!open.length && <div className="mono muted" style={{ fontSize: 12 }}>No open alerts. The twin is tracking the well.</div>}
          {closed.map((a) => (
            <div key={a.id} className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
              <span className={a.status === 'approved' ? 'ok' : 'red'}>{a.status === 'approved' ? '✓' : '✗'}</span> day {a.day} · {a.text.split('.')[0]}
            </div>
          ))}
        </div>

        <div className="panel" style={{ padding: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>Measured dyno card · day {bucket >= 0 ? s.day : '–'}</div>
          {bucket >= 0 ? <DynoCard card={card} stroke={s.x.stroke_m} /> : <div className="mono muted" style={{ fontSize: 12 }}>pump idle</div>}
        </div>

        <div className="panel" style={{ padding: 14 }}>
          <div className="label" style={{ marginBottom: 8 }}>Event log · audit trail</div>
          {s.log.slice().reverse().map((l, i) => (
            <div key={i} className="mono" style={{ fontSize: 11, marginBottom: 4, color: l.kind === 'critical' ? 'var(--red)' : 'var(--muted)' }}>
              {String(l.day).padStart(3, '0')} · {l.text}
            </div>
          ))}
        </div>
        {s.complete && <button className="btn" onClick={onNext}>FIELD STEAM PLAN →</button>}
      </section>
    </div>
  )
}

function Est({ k, a, b, u }: { k: string; a: number; b: number; u: string }) {
  const dev = b / a - 1
  return (
    <span>
      <span className="muted">{k} </span>{a.toFixed(1)}{Math.abs(dev) > 0.02 && <> → <b className={Math.abs(dev) > 0.15 ? 'amber' : 'cyan'}>{b.toFixed(1)}</b></>} <span className="muted">{u}</span>
    </span>
  )
}

function Dot(props: { cx?: number; cy?: number }) {
  return props.cx == null || props.cy == null ? null : <circle cx={props.cx} cy={props.cy} r={2} fill="var(--amber)" />
}
