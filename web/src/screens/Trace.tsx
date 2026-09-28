import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { fmt, type Plan } from '../api'

const STEP_MS = 650
const SECTIONS: [number, string][] = [[0, 'ANALYZING WELL STATE'], [4, 'BUILDING CANDIDATE STRATEGIES'], [6, 'SIMULATING OUTCOMES · APPLYING CONSTRAINTS']]

export function TraceScreen({ plan, onNext }: { plan: Plan; onNext: () => void }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (shown >= plan.trace.length) return
    const id = setTimeout(() => setShown((s) => s + 1), shown === 0 ? 300 : STEP_MS)
    return () => clearTimeout(id)
  }, [shown, plan.trace.length])

  let left = plan.n
  const bars = [{ name: 'Candidates', left, rejected: 0 }, ...plan.funnel.map((g) => ({ name: g.reason, left: (left -= g.rejected), rejected: g.rejected }))]
  const gateAt = (i: number) => 6 + i // trace lines 6.. are the funnel gates

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 24 }}>
      <section className="panel mono" style={{ minHeight: 560, fontSize: 14 }}>
        {plan.trace.slice(0, shown).map((line, i) => {
          const section = SECTIONS.find(([at]) => at === i)
          const mark = line.startsWith('✗') ? 'red' : line.startsWith('✓') ? 'ok' : 'cyan'
          return (
            <div key={i}>
              {section && <div className="label" style={{ margin: i ? '22px 0 10px' : '0 0 10px', color: 'var(--text)' }}>{section[1]}</div>}
              <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} style={{ padding: '4px 0', display: 'flex', gap: 10 }}>
                <span className={mark}>{line.startsWith('✗') || line.startsWith('✓') ? line[0] : '›'}</span>
                <span style={{ color: mark === 'cyan' ? 'var(--text)' : undefined }}>{line.replace(/^[✗✓]\s*/, '')}</span>
              </motion.div>
            </div>
          )
        })}
        {shown < plan.trace.length && <span className="cyan">▍</span>}
      </section>

      <section className="panel">
        <div className="label">Strategy funnel</div>
        <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
          {bars.map((b, i) => {
            const visible = i === 0 ? shown > 4 : shown > gateAt(i - 1)
            return (
              <div key={b.name} style={{ opacity: visible ? 1 : 0.15, transition: 'opacity .4s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }} className="mono">
                  <span className="muted">{i === 0 ? 'Generated' : `− ${b.name}`}</span>
                  <span>{fmt(b.left)}</span>
                </div>
                <div style={{ height: 8, background: 'var(--bg)', borderRadius: 2, marginTop: 5 }}>
                  <motion.div animate={{ width: visible ? `${(100 * b.left) / plan.n}%` : '100%' }} transition={{ duration: 0.6 }}
                    style={{ height: '100%', borderRadius: 2, background: i === bars.length - 1 ? 'var(--cyan)' : '#2b3b47' }} />
                </div>
              </div>
            )
          })}
        </div>
        {shown >= plan.trace.length && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginTop: 34 }}>
            <div className="big cyan">{fmt(bars[bars.length - 1].left)}</div>
            <div className="muted">feasible strategies out of {fmt(plan.n)} simulated</div>
            <button className="btn" style={{ marginTop: 24 }} onClick={onNext}>OPEN DIGITAL TWIN →</button>
          </motion.div>
        )}
      </section>
    </div>
  )
}
