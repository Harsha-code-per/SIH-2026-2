export type X = { steam_t: number; inj_p_bar: number; soak_d: number; stroke_m: number; spm_max: number }
export type Mission = { well_id: string; target_bbl: number; deadline_d: number; steam_budget_t: number; energy_budget_kwh: number }
export type Series = Record<'t_res' | 'mu_tub' | 'oil' | 'cum' | 'spm' | 'safe_spm' | 'float_margin' | 'cum_kwh' | 'fillage', number[]>

export type Strategy = {
  label: string; verdict: string; x: X; p10: number; p50: number; p90: number; sor: number
  energy_kwh: number; kwh_per_bbl: number; cost_per_bbl: number; failure_risk: number; float_days: number; co2_t: number
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
  envelope: Record<keyof X, [number, number]>; cycles: Cycle[]; history_steam_t: [number, number]; suggested: Mission
  anomalies: { cycle: number; anomaly_days: number; rod_failure: boolean; lead_days: number | null }[]
}
export type Plan = {
  mission: Mission; feasible: boolean; message?: string; n: number
  funnel: { gate: string; reason: string; rejected: number }[]; trace: string[]; state: WellState
  strategies: Strategy[]; recommended: Recommended
  baseline: { x: X; p50: number; energy_kwh: number; float_days: number; failure_risk: number; sor: number; cost_per_bbl: number; co2_t: number; series: Series
    inj_days: number; prod_start: number; r_heated: number; t_steam: number; resteam_day: number }
  evidence: { cycle: number; steam_t: number; inj_p_bar: number; soak_d: number; cum_oil_bbl: number; rod_failure: boolean; float_days: number }[]
  conformal_q: number; loco_mape: number; days: number
}
export type Field = {
  conformal_q: number; loco_mape: number; n_holdout: number; failures: number; failures_warned: number
  wells: { well_id: string; cycles: number; rod_failures: number; last_cum_bbl: number }[]
}
export type Explanation = { text: string; source: 'llm' | 'template'; guard: string }

export type Card = {
  surface: [number, number][]; downhole: [number, number][]; separated: boolean[]
  peak_kn: number; min_kn: number; downhole_stroke_m: number; diagnosis: string
}
export type Alert = {
  id: number; day: number; kind: 'cooling' | 'drag' | 'float'; text: string; status: 'open' | 'approved' | 'rejected'
  severity: 'info' | 'warning' | 'critical'; action: boolean | null; float_day?: number
  options?: { key: 'spm' | 'heater'; label: string; detail: string; float_days: number; oil: number; kwh: number; co2_t?: number }[]
  recommended?: 'spm' | 'heater'; chosen?: 'spm' | 'heater'
}
export type Live = {
  well_id: string; cycle: number; day: number; stage: string; mission: Mission; x: X
  source: 'simulated' | 'external'; heater: { kw: number; from_d: number } | null
  prod_start: number; inj_days: number; t_steam: number; r_heated: number
  truth_now: { t_res: number; mu_tub: number; spm: number; float_margin: number; oil: number }
  observed: { day: number[]; oil: number[]; min_load_kn: number[]; spm: number[] }
  plan: { oil: number[]; cum: number[]; float_margin: number[]; spm: number[] }
  forecast: { day: number[]; oil: number[]; lo: number[]; hi: number[]; float_margin: number[] }
  issued_spm: number[]
  twin: { q_cold: number; tau0: number; drag_c: number; planned_q_cold: number; planned_tau0: number; planned_drag_c: number }
  kpi: { cum_oil: number; forecast_at_deadline: number; float_days: number; resteam_day: number; cum_kwh: number; co2_t: number }
  alerts: Alert[]; log: { day: number; kind: string; text: string }[]; complete: boolean
}
export type Job = { well_id: string; generator: number; start: number; inj_days: number; steam_t: number; cycle_end: number; gain_per_gen_day: number; x: X }
export type Schedule = {
  jobs: Job[]; field_oil: number[]; per_well: Record<string, number[]>; generators: number; horizon: number
  maintenance: { generator: number; start: number; end: number }[]; outages: { well_id: string; start: number; end: number }[]
  kpi: { oil_bbl: number; steam_t: number; sor: number; wells_steamed: number; cycles: number; float_days: number; expected_failures: number; net_value_cr: number; co2_t: number }
}
export type FieldPlan = { practice: Schedule; sequencing_only: Schedule; welltwin: Schedule }
export type WhatIf = Series & {
  x: X & { heater_kw: number }; in_envelope: boolean; out_of_envelope: string[]
  envelope: Record<keyof X, [number, number]>; bounds: Record<keyof X, [number, number]>; heater_max_kw: number
  p10: number; p50: number; p90: number; energy_kwh: number; sor: number; cost_per_bbl: number; co2_t: number
  float_days: number; heater_days: number; failure_risk: number; prod_start: number; resteam_day: number; r_heated: number
  meets: Record<'target' | 'steam' | 'energy' | 'frac' | 'envelope' | 'rod', boolean>
}
export type WorkOrder = {
  id: number; number: string; status: 'submitted' | 'approved' | 'rejected'; well_id: string; cycle: number; created: number
  prepared_by: string; prepared_at: number; reviewed_by: string | null; reviewed_at: number | null; note: string | null
  plan: {
    mission: Mission; x: X; spm_schedule: { from_day: number; spm: number; vfd_hz: number }[]; p10: number; p50: number; p90: number
    sor: number; energy_kwh: number; co2_t: number; cost_per_bbl: number; t_steam: number; inj_days: number; prod_start: number
    resteam_day: number; day_target: number; evidence: { cycle: number }[]; baseline_float_days: number
  }
}
export type AuditEvent = { id: number; ts: number; actor: string; role: string; kind: string; well_id: string; text: string }
export type Issue = { level: 'ok' | 'warning' | 'error'; file: string; msg: string }
export type TwinSnap = { theta: { q_cold: number; tau0: number; drag_c: number; deg: number }; envelope: Record<keyof X, [number, number]>; cycles: number; conformal_q: number; loco_mape: number }
export type Learned = {
  ok: boolean; issues: Issue[]; source?: string; well_id?: string; cycle?: number; before?: TwinSnap; after?: TwinSnap
  plan_vs_actual?: { day: number[]; actual: number[]; before: number[]; after: number[] }
  cum_error_before?: number | null; cum_error_after?: number | null
}

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
  simulate: (mission: Mission, x: Record<string, number>, controller: boolean) => call<WhatIf>('simulate', { mission, x, controller }),
  dyno: (mission: Mission, mode: 'plan' | 'practice', day: number) => call<Card>('dyno', { mission, mode, day }),
  liveStart: (m: Mission, source: 'simulated' | 'external' = 'simulated') => call<Live>('live/start', { mission: m, source }),
  liveSnapshot: () => call<Live>('live/snapshot'),
  liveStep: (days: number) => call<Live>(`live/step?days=${days}`, {}),
  liveDecide: (alert_id: number, approve: boolean, option?: string) => call<Live>('live/decide', { alert_id, approve, option }),
  liveDyno: () => call<Card>('live/dyno'),
  fieldSchedule: (generators: number, horizon: number, maintenance = '', outages = '') =>
    call<FieldPlan>(`field/schedule?generators=${generators}&horizon=${horizon}&maintenance=${encodeURIComponent(maintenance)}&outages=${encodeURIComponent(outages)}`),
  learnLive: () => call<Learned>('learn/ingest-live', {}),
  learnUpload: (cycles_csv: string, daily_csv: string) => call<Learned>('learn/upload', { cycles_csv, daily_csv }),
  learnUploadXlsx: async (f: File): Promise<Learned> => {
    const r = await fetch('/api/learn/upload-xlsx', { method: 'POST', body: f })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? r.statusText)
    return r.json()
  },
  woCreate: (mission: Mission, prepared_by: string) => call<WorkOrder>('workorders', { mission, prepared_by }),
  woReview: (id: number, reviewer: string, approve: boolean, note = '') => call<WorkOrder>(`workorders/${id}/review`, { reviewer, approve, note }),
  woList: () => call<WorkOrder[]>('workorders'),
  audit: () => call<AuditEvent[]>('audit'),
  learnReset: () => call<{ ok: boolean }>('learn/reset', {}),
  learnTemplate: () => call<{ cycles: string; daily: string }>('learn/template'),
}

export const fmt = (n: number, d = 0) => n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })
