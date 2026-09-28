import { useEffect, useState } from 'react'
import { api, fmt, type Field, type Mission, type WellState } from '../api'
import { useAfter } from '../auto'
import { WellScene } from '../WellScene'

const FIELDS: [keyof Mission, string, string][] = [
  ['target_bbl', 'Production target', 'bbl'],
  ['deadline_d', 'Deadline from cycle start', 'days'],
  ['steam_budget_t', 'Steam available', 't CWE'],
  ['energy_budget_kwh', 'SRP energy budget', 'kWh'],
]

const DEMO_TEXT = 'We need 1,600 barrels from this well in 90 days. Steam is limited to 1,000 tonnes and we have 7 MWh of power.'

export function MissionScreen({ well, field, mission, setMission, onRun, busy, auto }: {
  well: WellState | null; field: Field | null; mission: Mission; setMission: (m: Mission) => void; onRun: () => void; busy: boolean; auto: boolean
}) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState('')

  // auto demo: type the mission, parse it, run it
  useEffect(() => {
    if (!auto) return
    let i = 0
    const id = setInterval(() => {
      i += 2
      setText(DEMO_TEXT.slice(0, i))
      if (i >= DEMO_TEXT.length) clearInterval(id)
    }, 28)
    return () => clearInterval(id)
  }, [auto])
  const typed = auto && text === DEMO_TEXT
  useAfter(typed && !parsed, 500, () => parse())
  useAfter(typed && parsed.startsWith('Parsed'), 1600, onRun)
  const parse = async () => {
    if (!text.trim()) return
    setParsed('parsing…')
    try {
      const r = await api.parse(text, mission.well_id)
      setMission(r.mission)
      setParsed(`${r.source === 'llm' ? 'Parsed by NVIDIA Nemotron' : 'Parsed by rules'}${r.defaulted.length ? ` · kept defaults for ${r.defaulted.join(', ')}` : ''}`)
    } catch (e) {
      setParsed(String(e))
    }
  }
  const fm = well?.float_margin ?? 2
  const maxCum = Math.max(...(well?.cycles.map((c) => c.cum_oil_bbl) ?? [1]))

  return (
    <div className="screen" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(300px, 1.1fr) minmax(320px, 1fr)', gap: 24, alignItems: 'stretch' }}>
      <section className="panel">
        <div className="label">Well</div>
        <select className="mono well-select" value={mission.well_id} aria-label="Well"
          onChange={(e) => api.well(e.target.value).then((w) => setMission(w.suggested)).catch(() => {})}>
          {(field?.wells ?? [{ well_id: mission.well_id, rod_failures: 0 }]).map((w) => (
            <option key={w.well_id} value={w.well_id}>{w.well_id}</option>
          ))}
        </select>
        <div className="muted" style={{ marginTop: 2 }}>Baghewala · Jodhpur Sandstone · next: CSS cycle #{well?.next_cycle ?? '–'}</div>
        <hr className="rule" />
        <div className="label" style={{ marginBottom: 10 }}>Current well state</div>
        {well && (
          <div className="kv">
            <span>Reservoir temperature</span><span>{well.reservoir_temp_c.toFixed(1)} °C</span>
            <span>Oil viscosity in tubing</span><span>{fmt(well.tubing_visc_cp)} cP</span>
            <span>Oil rate</span><span>{well.oil_rate_bopd.toFixed(1)} bopd</span>
            <span>SRP speed</span><span>{well.spm.toFixed(1)} SPM</span>
            <span>Rod float margin</span>
            <span className={fm < 1 ? 'red' : fm < 1.25 ? 'amber' : 'ok'}>{fm.toFixed(2)} {fm < 1 ? '· FLOATING' : fm < 1.25 ? '· LOW' : ''}</span>
            <span>Rod failures</span><span className="red">{well.rod_failures} in {well.cycles_done} cycles</span>
          </div>
        )}
        <hr className="rule" />
        <div className="label" style={{ marginBottom: 10 }}>CSS history · cum. oil per cycle</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90 }}>
          {well?.cycles.map((c) => (
            <div key={c.cycle} style={{ flex: 1, display: 'grid', gap: 4, justifyItems: 'center' }} title={`Cycle ${c.cycle}: ${fmt(c.cum_oil_bbl)} bbl, ${c.steam_t} t steam`}>
              <div style={{ width: '100%', height: (70 * c.cum_oil_bbl) / maxCum, background: c.rod_failure ? 'var(--red-dim)' : 'var(--cyan-dim)', borderTop: `2px solid ${c.rod_failure ? 'var(--red)' : 'var(--cyan)'}` }} />
              <span className="mono muted" style={{ fontSize: 10 }}>{c.cycle}</span>
            </div>
          ))}
        </div>
        <div className="mono muted" style={{ fontSize: 11, marginTop: 8 }}><span className="red">■</span> cycle with rod failure</div>
        {field && (
          <div className="mono muted" style={{ fontSize: 11, marginTop: 14, lineHeight: 1.6 }}>
            Twin hold-out error {(field.loco_mape * 100).toFixed(1)}% on {field.n_holdout} past cycles<br />
            Anomaly model flagged {field.failures_warned} of {field.failures} rod failures ahead of time
          </div>
        )}
      </section>

      <section className="panel" style={{ padding: 0, overflow: 'hidden', minHeight: 560 }}>
        <WellScene run={null} day={0} spmIdle={well?.spm ?? 3} floatIdle={fm < 1} />
      </section>

      <section className="panel" style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        <div>
          <div className="label">Mission</div>
          <h2 style={{ fontSize: 22, marginTop: 6 }}>What must this well deliver?</h2>
        </div>
        <div className="field">
          <textarea rows={2} placeholder="e.g. We need 1,600 barrels in 90 days, steam is limited to 1,000 tonnes and 7 MWh of power"
            value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); parse() } }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span className="mono muted" style={{ fontSize: 11 }}>{parsed}</span>
            <button className="btn ghost" onClick={parse}>PARSE ↵</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {FIELDS.map(([k, label, unit]) => (
            <label key={k} className="field">
              <span className="label" style={{ fontSize: 10 }}>{label}</span>
              <div style={{ position: 'relative' }}>
                <input type="number" value={mission[k] as number} onChange={(e) => setMission({ ...mission, [k]: Number(e.target.value) })} />
                <span className="mono muted" style={{ position: 'absolute', right: 10, top: 13, fontSize: 11 }}>{unit}</span>
              </div>
            </label>
          ))}
        </div>
        <div className="mono muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
          The twin searches steam volume, injection pressure, soak time, stroke length and the SPM/VFD schedule together, then keeps only plans that meet the target at P10 inside this well's validated history.
        </div>
        <button className="btn" onClick={onRun} disabled={busy}>{busy ? 'SIMULATING…' : 'SIMULATE MISSION'}</button>
      </section>
    </div>
  )
}
