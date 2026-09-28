import { useEffect, useRef, useState } from 'react'
import type { Series } from './api'

export type Run = { series: Series; inj_days: number; prod_start: number; r_heated: number; t_steam: number; resteam_day: number }

const T_RES = 47
const WELL_X = 190
const SURFACE = 150
const PUMP_Y = 568
const RES_TOP = 588
const RES_BOT = 636
const SPEEDUP = 5 // pump animation runs 5× real time so strokes are visible on camera

export function phaseOf(run: Run | null, day: number) {
  if (!run) return 'COLD'
  if (day < run.inj_days) return 'INJECTION'
  if (day < run.prod_start) return 'SOAK'
  if (day >= run.resteam_day) return 'RE-STEAM DUE'
  return 'PRODUCTION'
}

function heatColor(h: number) {
  // cold sandstone → dull red → amber → white-hot steam
  const stops = [[60, 40, 30], [150, 55, 30], [244, 162, 97], [255, 226, 180]]
  const x = Math.min(Math.max(h, 0), 1) * (stops.length - 1)
  const i = Math.min(Math.floor(x), stops.length - 2)
  const f = x - i
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f))
  return `rgb(${c.join(',')})`
}

/** Stylised well-to-surface cross-section: reservoir heating, wellbore flow, SRP stroke. */
export function WellScene({ run, day, spmIdle = 2.5, floatIdle = false }: { run: Run | null; day: number; spmIdle?: number; floatIdle?: boolean }) {
  const [t, setT] = useState(0)
  const phase = useRef(0)
  const d = Math.max(0, Math.min(Math.floor(day), (run?.series.spm.length ?? 1) - 1))
  const stage = phaseOf(run, day)
  const spm = run ? run.series.spm[d] : spmIdle
  const spmRef = useRef(spm)
  spmRef.current = spm

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      phase.current += (dt * spmRef.current * SPEEDUP) / 60
      setT(now / 1000)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const heat = run ? (run.series.t_res[d] - T_RES) / (run.t_steam - T_RES) : 0
  const grow = !run ? 0 : stage === 'INJECTION' ? day / Math.max(run.inj_days, 0.1) : 1
  const rx = run ? (14 + (run.r_heated / 16) * 250) * Math.sqrt(grow) : 0
  const oil = run ? run.series.oil[d] : 0
  const floating = run ? stage !== 'INJECTION' && stage !== 'SOAK' && run.series.float_margin[d] < 1 : floatIdle

  const theta = (spm > 0 ? 11 : 0) * Math.sin(phase.current * 2 * Math.PI)
  const rad = (theta * Math.PI) / 180
  const tipY = 70 - 112 * Math.sin(rad)
  const rodShift = 70 - tipY
  const crank = phase.current * 2 * Math.PI

  const steamDots = stage === 'INJECTION' ? Array.from({ length: 14 }, (_, i) => SURFACE + (((t * 180 + i * 34) % 440))) : []
  const oilN = stage === 'PRODUCTION' || stage === 'RE-STEAM DUE' ? Math.round(4 + oil / 2) : 0
  const oilDots = Array.from({ length: oilN }, (_, i) => PUMP_Y - (((t * (20 + oil * 3) + (i * 420) / oilN) % 420)))

  const strata = [
    { y: SURFACE, h: 120, name: 'TERTIARY / QUATERNARY COVER', fill: '#0d1419' },
    { y: 270, h: 150, name: 'NAGAUR GROUP', fill: '#0f171d' },
    { y: 420, h: 168, name: 'BILARA GROUP', fill: '#0c1318' },
  ]

  return (
    <svg viewBox="0 0 520 660" style={{ width: '100%', height: '100%' }} role="img" aria-label="Well cross-section">
      <defs>
        <radialGradient id="hz">
          <stop offset="0%" stopColor={heatColor(heat + 0.15)} stopOpacity={0.95} />
          <stop offset="60%" stopColor={heatColor(heat)} stopOpacity={0.75} />
          <stop offset="100%" stopColor={heatColor(heat * 0.6)} stopOpacity={0} />
        </radialGradient>
        <pattern id="sand" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="0.7" fill="#3a3122" />
          <circle cx="4.5" cy="4.2" r="0.5" fill="#2c261b" />
        </pattern>
        <filter id="glow"><feGaussianBlur stdDeviation="3" /></filter>
      </defs>

      {strata.map((s) => (
        <g key={s.name}>
          <rect x={0} y={s.y} width={520} height={s.h} fill={s.fill} />
          <text x={510} y={s.y + 16} textAnchor="end" className="mono" fontSize="9" fill="#34424e" letterSpacing="1.5">{s.name}</text>
        </g>
      ))}
      <rect x={0} y={RES_TOP} width={520} height={RES_BOT - RES_TOP} fill="#17140f" />
      <rect x={0} y={RES_TOP} width={520} height={RES_BOT - RES_TOP} fill="url(#sand)" />
      <text x={510} y={RES_TOP + 14} textAnchor="end" className="mono" fontSize="9" fill="#8a6f45" letterSpacing="1.5">JODHPUR SANDSTONE · RESERVOIR</text>
      {run && rx > 0 && <ellipse cx={WELL_X} cy={(RES_TOP + RES_BOT) / 2} rx={rx} ry={(RES_BOT - RES_TOP) / 2 + 2} fill="url(#hz)" />}
      <rect x={0} y={RES_BOT} width={520} height={24} fill="#0a0f13" />
      <line x1={0} x2={520} y1={SURFACE} y2={SURFACE} stroke="#2c3a44" strokeWidth={1.5} />

      {[['0 m', SURFACE], ['550 m', 360], ['1,100 m · pump', PUMP_Y], ['1,150 m', RES_BOT - 8]].map(([l, y]) => (
        <g key={l as string}>
          <line x1={14} x2={24} y1={y as number} y2={y as number} stroke="#3b4a55" />
          <text x={28} y={(y as number) + 3} className="mono" fontSize="9" fill="#56656f">{l}</text>
        </g>
      ))}

      {/* wellbore */}
      <rect x={WELL_X - 9} y={SURFACE} width={18} height={RES_BOT - SURFACE} fill="#0a0e11" stroke="#34444f" />
      <rect x={WELL_X - 4.5} y={SURFACE} width={9} height={PUMP_Y - SURFACE + 14} fill="#0c1216" stroke="#2a3843" />
      <line x1={WELL_X} x2={WELL_X} y1={SURFACE - 20 + rodShift} y2={PUMP_Y + rodShift * 0.2} stroke={floating ? 'var(--red)' : '#9fb3c1'} strokeWidth={2} strokeDasharray="16 5" strokeDashoffset={-rodShift} />
      <rect x={WELL_X - 6} y={PUMP_Y} width={12} height={18} rx={2} fill="#26333d" stroke={floating ? 'var(--red)' : '#4b5d69'} />
      {steamDots.map((y, i) => <circle key={i} cx={WELL_X + (i % 2 ? 2 : -2)} cy={y} r={2.2} fill="#f5f7fa" opacity={0.85} />)}
      {oilDots.map((y, i) => <circle key={i} cx={WELL_X + (i % 2 ? 1.6 : -1.6)} cy={y} r={2} fill="var(--amber)" opacity={0.9} />)}
      {stage === 'INJECTION' && <circle cx={WELL_X} cy={RES_TOP + 24} r={10 + (t * 30) % 20} fill="none" stroke="#f5f7fa" opacity={0.4} />}

      {floating && (
        <g>
          <circle cx={WELL_X} cy={PUMP_Y + 8} r={16} fill="var(--red)" opacity={0.35 + 0.25 * Math.sin(t * 8)} filter="url(#glow)" />
          <text x={WELL_X + 22} y={PUMP_Y - 6} className="mono" fontSize="11" fontWeight={700} fill="var(--red)" letterSpacing="1">ROD FLOAT · IMPACT LOADING</text>
        </g>
      )}

      {/* surface: pumping unit */}
      <rect x={WELL_X - 14} y={SURFACE - 12} width={28} height={12} fill="#1c262e" stroke="#3a4a55" />
      <rect x={170} y={SURFACE - 6} width={250} height={6} fill="#1a232a" />
      <path d={`M 290 ${SURFACE - 6} L 300 70 L 310 ${SURFACE - 6}`} fill="none" stroke="#56687a" strokeWidth={4} />
      <path d={`M 276 ${SURFACE - 6} L 300 72 L 324 ${SURFACE - 6}`} fill="none" stroke="#3a4a58" strokeWidth={2} />
      <g transform={`rotate(${theta} 300 70)`}>
        <rect x={188} y={65} width={200} height={10} rx={2} fill="#6b7f90" />
        <path d="M 188 58 Q 172 70 188 96 L 198 96 L 198 58 Z" fill="#8397a8" />
      </g>
      <line x1={WELL_X - 2} x2={WELL_X - 2} y1={tipY + 24} y2={SURFACE - 20 + rodShift} stroke="#c9d6df" strokeWidth={1.5} />
      <rect x={WELL_X - 12} y={SURFACE - 22 + rodShift} width={20} height={4} fill="#c9d6df" />
      <line x1={380} y1={70 + 80 * Math.sin(rad)} x2={392 + 18 * Math.cos(crank)} y2={122 + 18 * Math.sin(crank)} stroke="#56687a" strokeWidth={3} />
      <circle cx={392} cy={122} r={6} fill="#56687a" />
      <g transform={`rotate(${(crank * 180) / Math.PI} 392 122)`}>
        <rect x={392} y={116} width={34} height={12} rx={3} fill="#3e4f5c" />
      </g>
      <text x={430} y={60} className="mono" fontSize="10" fill="var(--muted)">SRP · {spm.toFixed(2)} SPM</text>
    </svg>
  )
}
