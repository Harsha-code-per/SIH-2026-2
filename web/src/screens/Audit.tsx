import { useEffect, useState } from 'react'
import { api, type AuditEvent, type WorkOrder } from '../api'
import { useAfter } from '../auto'
import { WorkOrderDoc } from '../WorkOrder'

const when = (t: number | null) => (t ? new Date(t * 1000).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'medium' }) : '—')
const KIND: Record<string, string> = { work_order: 'cyan', live_decision: 'amber', ingest: 'ok' }

export function AuditScreen({ onNext, auto }: { onNext: () => void; auto: boolean }) {
  const [wos, setWos] = useState<WorkOrder[]>([])
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [open, setOpen] = useState<WorkOrder | null>(null)

  useEffect(() => {
    api.woList().then(setWos).catch(() => {})
    api.audit().then(setEvents).catch(() => {})
  }, [])
  useAfter(auto, 7000, onNext)

  return (
    <div className="screen" style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 20 }}>
      <section className="panel" style={{ overflow: 'auto' }}>
        <div className="label">Work orders · four-eyes sign-off</div>
        <h2 style={{ fontSize: 20, margin: '4px 0 14px' }}>Every plan that reached the field</h2>
        <table className="compact">
          <thead><tr><th>ORDER</th><th>WELL</th><th>STATUS</th><th>PREPARED</th><th>APPROVED</th><th /></tr></thead>
          <tbody>
            {wos.map((w) => (
              <tr key={w.id}>
                <td className="cyan">{w.number}</td>
                <td>{w.well_id} #{w.cycle}</td>
                <td><span className={`pill ${w.status === 'approved' ? 'ok' : w.status === 'rejected' ? 'red' : 'amber'}`}>{w.status}</span></td>
                <td>{w.prepared_by}</td>
                <td>{w.reviewed_by ?? '—'}</td>
                <td><button className="btn ghost" style={{ padding: '4px 8px', fontSize: 10 }} onClick={() => setOpen(w)}>VIEW</button></td>
              </tr>
            ))}
            {!wos.length && <tr><td colSpan={6} className="muted">No work orders yet. Issue one from the Plan screen.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="panel" style={{ overflow: 'auto' }}>
        <div className="label">Audit trail · persisted (SQLite)</div>
        <h2 style={{ fontSize: 20, margin: '4px 0 14px' }}>Who decided what, and when</h2>
        <div style={{ display: 'grid', gap: 8 }}>
          {events.map((e) => (
            <div key={e.id} className="mono" style={{ display: 'grid', gridTemplateColumns: '150px 110px 1fr', gap: 12, fontSize: 12, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
              <span className="muted">{when(e.ts)}</span>
              <span className={KIND[e.kind] ?? 'muted'}>{e.kind.replace('_', ' ')}</span>
              <span><b>{e.actor}</b>{e.role ? <span className="muted"> ({e.role})</span> : null} · {e.well_id} · {e.text}</span>
            </div>
          ))}
          {!events.length && <div className="mono muted" style={{ fontSize: 12 }}>No events yet.</div>}
        </div>
      </section>
      <button className="btn next" onClick={onNext}>FINISH →</button>

      {open && (
        <div className="modal" onClick={() => setOpen(null)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <div className="no-print" style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <button className="btn" style={{ padding: '8px 14px', fontSize: 12 }} onClick={() => window.print()}>PRINT / SAVE PDF</button>
              <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => setOpen(null)}>CLOSE</button>
            </div>
            <WorkOrderDoc wo={open} />
          </div>
        </div>
      )}
    </div>
  )
}
