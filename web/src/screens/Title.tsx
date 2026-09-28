import { motion } from 'motion/react'
import { useAfter } from '../auto'
import { WellScene } from '../WellScene'

const full: React.CSSProperties = { height: '100%', display: 'grid', placeItems: 'center', position: 'relative', overflow: 'hidden', cursor: 'pointer' }

export function Intro({ onNext, onDemo, auto }: { onNext: () => void; onDemo: () => void; auto: boolean }) {
  useAfter(auto, 6500, onNext)
  return (
    <div style={full} onClick={onNext}>
      {!auto && (
        <button className="btn ghost" style={{ position: 'absolute', right: 24, bottom: 20, fontSize: 11 }}
          onClick={(e) => { e.stopPropagation(); onDemo() }}>▶ AUTO DEMO (D)</button>
      )}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.35, display: 'grid', placeItems: 'center' }}>
        <div style={{ height: '100%', aspectRatio: '520 / 660' }}><WellScene run={null} day={0} spmIdle={2} /></div>
      </div>
      <div style={{ position: 'relative', textAlign: 'center', maxWidth: 980, padding: 24 }}>
        <motion.div className="label" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
          Reservoir → Steam → Wellbore → Sucker-rod pump → Surface
        </motion.div>
        <motion.h1 style={{ fontSize: 52, lineHeight: 1.12, marginTop: 22 }} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9, duration: 0.8 }}>
          What if we could test an oil-production strategy <span className="cyan">before</span> applying it to the real well?
        </motion.h1>
        <motion.div className="mono muted" style={{ marginTop: 28, fontSize: 12, letterSpacing: '0.14em' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2 }}>
          SIH26120 · OIL INDIA LIMITED · BAGHEWALA HEAVY-OIL FIELD · TEAM KAIHATSU
        </motion.div>
      </div>
    </div>
  )
}

export function Outro({ onBack }: { onBack: () => void }) {
  return (
    <div style={full} onClick={onBack}>
      <div style={{ textAlign: 'center', padding: 24 }}>
        <motion.h1 style={{ fontSize: 60, letterSpacing: '0.02em' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>
          DON'T EXPERIMENT ON THE WELL.
        </motion.h1>
        <motion.h1 className="cyan" style={{ fontSize: 60, letterSpacing: '0.02em', marginTop: 10 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2, duration: 0.8 }}>
          EXPERIMENT ON ITS DIGITAL TWIN FIRST.
        </motion.h1>
        <motion.div className="mono muted" style={{ marginTop: 44, fontSize: 13, letterSpacing: '0.16em' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.6 }}>
          SIH26120 — WELL-TO-SURFACE OPTIMIZATION OF CSS + SRP
        </motion.div>
        <motion.div className="mono" style={{ marginTop: 14, fontSize: 13, letterSpacing: '0.16em', color: 'var(--text)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.2 }}>
          TEAM KAIHATSU · R.M.K. COLLEGE OF ENGINEERING AND TECHNOLOGY
        </motion.div>
      </div>
    </div>
  )
}
