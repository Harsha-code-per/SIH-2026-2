import type { Card } from './api'

const W = 260
const H = 150
const PAD = { l: 34, r: 8, t: 10, b: 20 }

function Plot({ pts, sep, xmax, ymin, ymax, color, title, unit }: {
  pts: [number, number][]; sep?: boolean[]; xmax: number; ymin: number; ymax: number; color: string; title: string; unit: string
}) {
  const x = (v: number) => PAD.l + (v / xmax) * (W - PAD.l - PAD.r)
  const y = (v: number) => H - PAD.b - ((v - ymin) / (ymax - ymin)) * (H - PAD.t - PAD.b)
  const d = pts.map(([a, b], i) => `${i ? 'L' : 'M'}${x(a).toFixed(1)},${y(b).toFixed(1)}`).join('') + 'Z'
  const ticks = [ymin, (ymin + ymax) / 2, ymax]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }} role="img" aria-label={title}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text x={PAD.l - 4} y={y(t) + 3} textAnchor="end" fontSize="8" fill="var(--muted)" className="mono">{t.toFixed(0)}</text>
        </g>
      ))}
      <text x={PAD.l} y={H - 5} fontSize="8" fill="var(--muted)" className="mono">{title}</text>
      <text x={W - PAD.r} y={H - 5} textAnchor="end" fontSize="8" fill="var(--muted)" className="mono">{unit}</text>
      <path d={d} fill={color} fillOpacity={0.08} stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
      {sep && pts.map(([a, b], i) => sep[i] && <circle key={i} cx={x(a)} cy={y(b)} r={2.2} fill="var(--red)" />)}
    </svg>
  )
}

/** Surface + downhole dynamometer cards solved from the twin (Gibbs wave equation). */
export function DynoCard({ card, stroke }: { card: Card | null; stroke: number }) {
  if (!card) return <div className="mono muted" style={{ fontSize: 12 }}>solving wave equation…</div>
  const tone = card.diagnosis.startsWith('ROD FLOAT') ? 'red' : card.diagnosis.startsWith('FLUID') ? 'amber' : 'ok'
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 8 }}>
        <Plot pts={card.surface} sep={card.separated} xmax={stroke} ymin={0} ymax={Math.max(80, card.peak_kn)} color="var(--cyan)" title="SURFACE · position (m)" unit="load kN" />
        <Plot pts={card.downhole} xmax={Math.max(stroke, card.downhole_stroke_m)} ymin={-4} ymax={12} color="var(--amber)" title="DOWNHOLE · plunger (m)" unit="pump kN" />
      </div>
      <div className={`mono ${tone}`} style={{ fontSize: 11, fontWeight: 700, marginTop: 6 }}>{card.diagnosis}</div>
      <div className="mono muted" style={{ fontSize: 10 }}>peak {card.peak_kn} kN · min {card.min_kn} kN · plunger stroke {card.downhole_stroke_m} m</div>
    </div>
  )
}
