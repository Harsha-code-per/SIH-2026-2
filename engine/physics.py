"""Well-to-surface physics for one CSS cycle + the SRP that lifts it.

Chain: steam → heated zone (Marx–Langenheim-style heat balance) → cooling →
viscosity (Walther / ASTM D341) → inflow (Boberg–Lantz hot/cold radial flow) →
SRP capacity, rod-fall (float) limit, loads (Mills / modified Goodman), energy.

Every function is numpy-vectorized so the optimizer can simulate thousands of
candidate strategies in one call.
"""
import numpy as np

from . import params as P

# --- Walther: log10(log10(mu + 0.7)) = A - B*log10(T_K), fitted on two anchors ---
_Y = lambda mu: np.log10(np.log10(mu + 0.7))
_B = (_Y(P.MU_50C) - _Y(P.MU_200C)) / (np.log10(473.15) - np.log10(323.15))
_A = _Y(P.MU_50C) + _B * np.log10(323.15)


def viscosity_cp(t_c):
    return 10 ** (10 ** (_A - _B * np.log10(np.asarray(t_c) + 273.15))) - 0.7


def t_sat_c(p_bar):
    """Saturation temperature, ±2% vs steam tables over 10–170 bar."""
    return 100.0 * (np.asarray(p_bar) / 1.013) ** 0.25


def latent_kj(t_c):
    """Watson correlation for latent heat of water."""
    return 2257.0 * np.clip((374.0 - t_c) / 274.0, 0, None) ** 0.38


def injection_days(steam_t, p_bar):
    rate = np.clip(2.2 * (p_bar - 45.0), 40.0, P.GEN_MAX_TPD)  # injectivity rises with pressure
    return steam_t / rate


def soak_efficiency(soak_d):
    """Short soak → uncondensed steam is back-produced; long soak → heat lost to
    over/underburden. Interior optimum near 4–5 days."""
    return (1 - 0.35 * np.exp(-soak_d / 2.0)) * np.exp(-soak_d / 60.0)


def heated_zone(steam_t, p_bar, soak_d):
    """Returns (T_steam °C, heated radius m, injection days)."""
    ts = t_sat_c(p_bar)
    inj = injection_days(steam_t, p_bar)
    quality = np.clip(0.8 - 0.004 * inj, 0.4, 0.8)  # wellbore losses grow with slow injection
    heat_j = steam_t * 1e3 * (4.19 * (ts - P.T_RES) + quality * latent_kj(ts)) * 1e3
    heat_j = heat_j * np.exp(-inj / 120.0) * soak_efficiency(soak_d)
    vol = heat_j / (P.M_R * (ts - P.T_RES))
    r_h = np.clip(np.sqrt(vol / (np.pi * P.PAY_H)), 2 * P.R_W, 0.8 * P.R_E)
    return ts, r_h, inj


def stimulation_ratio(mu_hot, r_h, skin=P.SKIN_COLD):
    """Boberg–Lantz steady radial flow: hot/cold productivity. Heating also
    clears the near-wellbore asphaltene skin inside r_h."""
    mu_cold = viscosity_cp(P.T_RES)
    cold = np.log(P.R_E / P.R_W) + skin
    hot = (mu_hot / mu_cold) * np.log(r_h / P.R_W) + np.log(P.R_E / r_h)
    return cold / hot


def pump_bpd_per_spm(stroke_m):
    return 0.1166 * (stroke_m / 0.0254) * P.PUMP_BORE_IN ** 2  # API displacement, bbl/d per SPM


def volumetric_eff(mu_cp):
    return 0.9 - 0.25 * np.clip((np.log10(mu_cp) - 1) / 3, 0, 1)  # viscous oil fills slowly


def drag_n(mu_cp, v, drag_c):
    """Annular Couette drag on the whole rod string, coupling/plunger effects in drag_c."""
    return drag_c * (mu_cp * 1e-3) * P.PUMP_DEPTH * v


def safe_spm(mu_cp, stroke_m, drag_c, margin=P.MIN_FLOAT_MARGIN):
    """Highest SPM whose peak downstroke speed (π·S·N/60) stays `margin` times
    below the rods' terminal fall velocity through the viscous column."""
    v_fall = P.ROD_WEIGHT_BUOYANT_N / (drag_c * (mu_cp * 1e-3) * P.PUMP_DEPTH)
    return 60 * v_fall / (margin * np.pi * stroke_m)


def rod_mechanics(spm, stroke_m, mu_cp, drag_c):
    """Float margin, modified-Goodman loading ratio and motor power (kW)."""
    alpha = spm ** 2 * (stroke_m / 0.0254) / 70471.0  # Mills acceleration factor
    v_pk = np.pi * stroke_m * spm / 60
    f = drag_n(mu_cp, v_pk, drag_c)
    w = P.ROD_WEIGHT_BUOYANT_N
    float_margin = w * (1 - alpha) / np.maximum(f, 1e-9)
    s_max = (w * (1 + alpha) + P.FLUID_LOAD_N + f) / P.ROD_AREA_M2
    s_min = np.maximum(w * (1 - alpha) - f, 0) / P.ROD_AREA_M2
    s_allow = 0.9 * (P.ROD_TENSILE_PA / 4 + 0.5625 * s_min)
    goodman = (s_max - s_min) / np.maximum(s_allow - s_min, 1.0)
    v_avg = 2 * stroke_m * spm / 60
    friction_kw = 2 * drag_n(mu_cp, v_avg, drag_c) * v_avg / 1e3
    return float_margin, goodman, friction_kw


def simulate(x, well, days=180, controller=True, spm_override=None):
    """Simulate one CSS cycle for N candidate strategies at once.

    x: dict of arrays (params.DECISIONS). well: dict with q_cold, skin, tau0,
    drag_c, deg (per-cycle decline), cycle (cycle number).
    controller=True  → thermal-aware SPM schedule (our system)
    controller=False → constant SPM at spm_max (current manual practice)
    spm_override: (days,) or (N, days) SPM actually applied; NaN keeps the rule above.
        Used for issued work orders and operator changes mid-cycle.
    Returns dict of (N, days) arrays + (N,) summaries.
    """
    steam, p, soak, stroke, spm_max, heater_kw = np.broadcast_arrays(
        *(np.atleast_1d(np.asarray(x[k], float)) for k in P.DECISIONS), np.atleast_1d(np.asarray(x.get("heater_kw", 0.0), float)))
    n = steam.shape[0]
    heater_w = heater_kw * 1e3
    ts, r_h, inj = heated_zone(steam, p, soak)
    start = inj + soak
    tau = well["tau0"] * (r_h / 6.0) ** 0.8  # bigger heated zone cools slower
    q_cold = np.reshape(well["q_cold"] * well["deg"] ** (np.asarray(well["cycle"]) - 1.0), (-1, 1))
    per_spm = pump_bpd_per_spm(stroke)

    t = np.arange(days)[None, :] - start[:, None]  # days since production start
    on = t >= 0
    tp = np.clip(t, 0, None)
    t_res = P.T_RES + (ts[:, None] - P.T_RES) * np.exp(-tp / tau[:, None])
    mu_res = viscosity_cp(t_res)
    wc = 0.25 + 0.45 * np.exp(-tp / 12.0)  # condensed steam flows back first
    oil_in = q_cold * stimulation_ratio(mu_res, r_h[:, None], well["skin"])
    gross_in = oil_in / (1 - wc)
    # downhole heater at the pump warms the produced fluid; most of it leaks to the formation on the way up
    m_dot = gross_in * 0.159 * 980 / 86400
    t_tub = P.T_RES + 0.75 * (t_res - P.T_RES) - 4.0  # fluid cools rising 1,100 m
    heater_on = on & (heater_w[:, None] > 0) & (t_tub < P.HEATER_ON_BELOW_C)  # thermostatic
    t_tub = t_tub + np.where(heater_on, heater_w[:, None] / (m_dot * P.FLUID_CP + P.HEATER_LOSS_W_PER_K), 0.0)
    mu_tub = viscosity_cp(t_tub)
    ev = volumetric_eff(mu_tub)

    ceiling = np.broadcast_to(spm_max[:, None], t.shape)
    limit = safe_spm(mu_tub, stroke[:, None], well["drag_c"])
    if controller:
        fill = gross_in / (0.85 * per_spm[:, None] * ev)  # match pump to inflow: no fluid pound
        spm = np.clip(np.minimum.reduce([ceiling, fill, limit]), P.MIN_SPM, ceiling)
    else:
        spm = ceiling.copy()
    if spm_override is not None:
        ov = np.broadcast_to(np.asarray(spm_override, float), t.shape)
        spm = np.where(np.isnan(ov), spm, ov)
    cap = per_spm[:, None] * spm * ev
    fillage = gross_in / cap
    oil = np.where(on, np.minimum(gross_in, cap) * (1 - wc), 0.0)
    fm, goodman, fric_kw = rod_mechanics(spm, stroke[:, None], mu_tub, well["drag_c"])
    hyd_kw = 1000 * 9.81 * P.PUMP_DEPTH * (np.minimum(gross_in, cap) * 0.159 / 86400) / 1e3
    kwh = np.where(on, (hyd_kw + fric_kw) / 0.55 * 24 + 1.2 * 24 + np.where(heater_on, heater_w[:, None] / 1e3 * 24, 0.0), 0.0)

    econ = on & (oil < P.ECON_LIMIT_BOPD) & (tp > 10)
    cutoff = np.where(econ.any(1), econ.argmax(1), days)
    live = on & (np.arange(days)[None, :] < cutoff[:, None])  # risk only counts while producing
    float_day = live & (fm < 1.0)
    pound_day = live & (fillage < 0.7)
    cum = np.cumsum(oil, axis=1)
    peak_goodman = goodman.max(1, where=live, initial=0)
    # ponytail: hand-set hazard weights; refit on OIL's rod-failure log once available
    risk = 1 - np.exp(-(0.012 * float_day.sum(1) + 0.002 * pound_day.sum(1)
                        + 0.5 * np.clip(peak_goodman - 0.9, 0, None)))

    return dict(
        t_res=t_res, mu_res=mu_res, mu_tub=mu_tub, oil=oil, cum=cum, spm=np.where(on, spm, 0.0),
        safe_spm=limit, float_margin=fm, fillage=fillage, kwh=kwh, cum_kwh=np.cumsum(kwh, 1), wc=wc,
        t_steam=ts, r_heated=r_h, inj_days=inj, prod_start=start, cutoff_day=cutoff,
        float_days=float_day.sum(1), pound_days=pound_day.sum(1), heater_days=(heater_on & live).sum(1),
        peak_goodman=peak_goodman, failure_risk=risk,
    )
