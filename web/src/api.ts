export type X = { steam_t: number; inj_p_bar: number; soak_d: number; stroke_m: number; spm_max: number }
export type Mission = { well_id: string; target_bbl: number; deadline_d: number; steam_budget_t: number; energy_budget_kwh: number }
export type Series = Record<'t_res' | 'mu_tub' | 'oil' | 'cum' | 'spm' | 'safe_spm' | 'float_margin' | 'cum_kwh', number[]>

export type Strategy = {
  label: string; verdict: string; x: X; p10: number; p50: number; p90: number; sor: number
  energy_kwh: number; kwh_per_bbl: number; cost_per_bbl: number; failure_risk: number; float_days: number
  in_envelope: boolean; out_of_envelope: string[]; day_target: number | null; cum: number[]
}
export type Recommended = Strategy & {
  series: Series; prod_start: number; inj_days: number; t_steam: number; r_heated: number; resteam_day: number
  spm_schedule: { from_day: number; spm: number; vfd_hz: number }[]
}
export type Cycle = X & { cycle: number; cycle_days: number; cum_oil_bbl: number; rod_failure: number; float_days: number }
export type WellState = {
  well_id: string; next_cycle: number; cycles_done: number; reservoir_temp_c: number; tubing_visc_cp: number
  oil_rate_bopd: number; spm: number; float_margin: number; rod_failures: number
  envelope: Record<keyof X, [number, number]>; cycles: Cycle[]; history_steam_t: [number, number]
  anomalies: { cycle: number; anomaly_days: number; rod_failure: boolean; lead_days: number | null }[]
}
export type Plan = {
  mission: Mission; feasible: boolean; message?: string; n: number
  funnel: { gate: string; reason: string; rejected: number }[]; trace: string[]; state: WellState
  strategies: Strategy[]; recommended: Recommended
  baseline: { x: X; p50: number; energy_kwh: number; float_days: number; failure_risk: number; sor: number; cost_per_bbl: number; series: Series
    inj_days: number; prod_start: number; r_heated: number; t_steam: number; resteam_day: number }
  evidence: { cycle: number; steam_t: number; inj_p_bar: number; soak_d: number; cum_oil_bbl: number; rod_failure: boolean; float_days: number }[]
  conformal_q: number; loco_mape: number; days: number
}
export type Field = { conformal_q: number; loco_mape: number; n_holdout: number; failures: number; failures_warned: number }
export type Explanation = { text: string; source: 'llm' | 'template'; guard: string }

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? r.statusText)
  return r.json()
}

export const api = {
  field: () => call<Field>('field'),
  well: (id: string) => call<WellState>(`wells/${id}`),
  parse: (text: string, well_id: string) => call<{ mission: Mission; defaulted: string[]; source: string }>('parse', { text, well_id }),
  mission: (m: Mission) => call<Plan>('mission', m),
  explain: (m: Mission) => call<Explanation>('explain', m),
}

export const fmt = (n: number, d = 0) => n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })
