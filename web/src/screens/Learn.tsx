import { useState } from 'react'
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, XAxis, YAxis } from 'recharts'
import { api, type Learned } from '../api'
import { useAfter } from '../auto'

const download = (name: string, text: string) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

export function LearnScreen({ onNext, auto }: { onNext: () => void; auto: boolean }) {
  const [res, setRes] = useState<Learned | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [files, setFiles] = useState<{ cycles?: File; daily?: File; workbook?: File }>({})

  const run = async (label: string, fn: () => Promise<Learned>) => {
    setBusy(label)
    setErr('')
    try {
      setRes(await fn())
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }
  const upload = () => files.workbook ? run('upload', () => api.learnUploadXlsx(files.workbook!)) : files.cycles && files.daily &&
    run('upload', async () => api.learnUpload(await files.cycles!.text(), await files.daily!.text()))
  const templates = async () => {
    const t = await api.learnTemplate()
    download('cycles.csv', t.cycles)
    download('daily.csv', t.daily)
  }

  useAfter(auto && !res && !busy, 2000, () => run('live', api.learnLive))
  useAfter(auto && !!res?.ok, 8000, onNext)

  const b = res?.before
  const a = res?.after
  const pva = res?.plan_vs_actual
  const rows = pva ? pva.day.map((d, i) => ({ d, actual: pva.actual[i], before: pva.before[i], after: pva.after[i] })) : []

  return (
    <div className="screen" style={{ display: 'grid', gap: 18, gridTemplateRows: 'auto auto minmax(330px, 1fr)' }}>
      <div className="panel" style={{ padding: '14px 20px' }}>
        <div className="label">Learning loop · shadow mode</div>
        <h2 style={{ fontSize: 22, marginTop: 4 }}>Every executed cycle makes the twin better.</h2>
        <div className="muted" style={{ marginTop: 4 }}>
          Ingest what the well actually did. It is checked against the data contract, the twin recalibrates, the validated envelope grows, and prediction error is re-measured.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18 }}>
        <section className="panel" style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <div className="label">Source 1 · Live operations</div>
          <div className="muted" style={{ fontSize: 13 }}>The cycle you just ran in Live Ops: daily SCADA and dyno data, plus the SPM actually applied.</div>
          <button className="btn" onClick={() => run('live', api.learnLive)} disabled={!!busy}>{busy === 'live' ? 'RECALIBRATING…' : 'INGEST LIVE CYCLE'}</button>
        </section>
        <section className="panel" style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <div className="label">Source 2 · Your field data (Excel or CSV)</div>
          {(['workbook', 'cycles', 'daily'] as const).map((k) => (
            <label key={k} className="btn ghost" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <span>{k === 'workbook' ? 'WORKBOOK.XLSX' : `${k.toUpperCase()}.CSV`}</span>
              <span className={files[k] ? 'cyan' : 'muted'} style={{ letterSpacing: 0, textTransform: 'none', fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {files[k]?.name ?? 'choose file…'}
              </span>
              <input type="file" hidden accept={k === 'workbook' ? '.xlsx' : '.csv,text/csv'} onChange={(e) => setFiles({ ...files, [k]: e.target.files?.[0] })} />
            </label>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={upload} disabled={!(files.workbook || (files.cycles && files.daily)) || !!busy}>{busy === 'upload' ? 'CHECKING…' : 'VALIDATE & INGEST'}</button>
            <button className="btn ghost" onClick={templates}>CSV ↓</button>
            <a className="btn ghost" href="/api/learn/template.xlsx" style={{ textDecoration: 'none' }}>XLSX ↓</a>
          </div>
        </section>
        <section className="panel" style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
          <div className="label">Data-quality report</div>
          {err && <div className="mono red" style={{ fontSize: 12 }}>{err}</div>}
          {res?.issues.map((i, k) => (
            <div key={k} className="mono" style={{ fontSize: 12 }}>
              <span className={i.level === 'ok' ? 'ok' : i.level === 'warning' ? 'amber' : 'red'}>{i.level === 'ok' ? '✓' : i.level === 'warning' ? '!' : '✗'}</span> {i.file}: {i.msg}
            </div>
          ))}
          {!res && !err && <div className="mono muted" style={{ fontSize: 12 }}>Nothing ingested yet.</div>}
          {res?.ok && <button className="btn ghost" style={{ justifySelf: 'start' }} onClick={() => run('reset', async () => { await api.learnReset(); return { ok: false, issues: [{ level: 'ok', file: 'all', msg: 'history reset to baseline' }] } })}>RESET HISTORY</button>}
        </section>
      </div>

      {!(res?.ok && b && a) && (
        <section className="panel" style={{ display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            <div className="label">Waiting for an executed cycle</div>
            <div className="mono muted" style={{ fontSize: 13, marginTop: 10, maxWidth: 560, lineHeight: 1.7 }}>
              Finish a cycle in Live Ops and ingest it, or upload OIL's cycle + daily exports.<br />
              You'll see what the twin learned, how its validated envelope changed, and its error before vs after.
            </div>
          </div>
        </section>
      )}
      {res?.ok && b && a && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 18 }}>
          <section className="panel">
            <div className="label" style={{ marginBottom: 10 }}>What the twin learned · {res.well_id} cycle #{res.cycle}</div>
            <table>
              <thead><tr><th /><th>BEFORE</th><th>AFTER</th></tr></thead>
              <tbody>
                <tr><td>Cycles in history</td><td>{b.cycles}</td><td className="cyan">{a.cycles}</td></tr>
                <tr><td>Cold rate (bopd)</td><td>{b.theta.q_cold.toFixed(2)}</td><td>{a.theta.q_cold.toFixed(2)}</td></tr>
                <tr><td>Cooling τ (d)</td><td>{b.theta.tau0.toFixed(1)}</td><td>{a.theta.tau0.toFixed(1)}</td></tr>
                <tr><td>Rod-drag factor</td><td>{b.theta.drag_c.toFixed(2)}</td><td>{a.theta.drag_c.toFixed(2)}</td></tr>
                <tr><td>Steam envelope (t)</td><td>{b.envelope.steam_t.map((v) => v.toFixed(0)).join('–')}</td><td>{a.envelope.steam_t.map((v) => v.toFixed(0)).join('–')}</td></tr>
                <tr><td>Field hold-out error</td><td>{(b.loco_mape * 100).toFixed(1)}%</td><td>{(a.loco_mape * 100).toFixed(1)}%</td></tr>
              </tbody>
            </table>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
              <div style={{ background: 'var(--panel-2)', padding: 12, borderRadius: 4 }}>
                <div className="label" style={{ fontSize: 10 }}>Cycle error · old twin</div>
                <div className="mono amber" style={{ fontSize: 26, fontWeight: 700 }}>{((res.cum_error_before ?? 0) * 100).toFixed(1)}%</div>
              </div>
              <div style={{ background: 'var(--panel-2)', padding: 12, borderRadius: 4 }}>
                <div className="label" style={{ fontSize: 10 }}>Cycle error · recalibrated</div>
                <div className="mono cyan" style={{ fontSize: 26, fontWeight: 700 }}>{((res.cum_error_after ?? 0) * 100).toFixed(1)}%</div>
              </div>
            </div>
          </section>
          <section className="panel" style={{ minHeight: 330, display: 'flex', flexDirection: 'column' }}>
            <div className="label">Plan vs actual · oil rate (bopd) · <span className="amber">actual</span> · <span className="muted">twin before</span> · <span className="cyan">twin after</span></div>
            <div style={{ flex: 1, minHeight: 280 }}><ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 12, right: 10, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="d" type="number" domain={['dataMin', 'dataMax']} tickCount={8} />
                <YAxis />
                <Scatter dataKey="actual" fill="var(--amber)" isAnimationActive={false} shape={(p: { cx?: number; cy?: number }) => <circle cx={p.cx} cy={p.cy} r={2} fill="var(--amber)" />} />
                <Line dataKey="before" stroke="var(--muted)" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                <Line dataKey="after" stroke="var(--cyan)" strokeWidth={2.5} dot={false} animationDuration={1200} />
              </ComposedChart>
            </ResponsiveContainer></div>
          </section>
        </div>
      )}
      <button className="btn next" onClick={onNext}>AUDIT TRAIL →</button>
    </div>
  )
}
