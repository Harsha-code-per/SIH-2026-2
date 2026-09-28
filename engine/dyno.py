"""Dynamometer cards from the twin: Gibbs damped wave equation, explicit finite differences.

    m·u_tt = EA·u_xx − c·u_t + m·g_b        u = rod displacement (down +), x = depth

Viscous damping c comes from the same annular-drag physics as the float limit
(drag_c · μ_tubing), so cards change shape as the reservoir cools. Top boundary:
polished-rod motion, with carrier-bar separation when the rods cannot keep up
(rod float). Bottom boundary: pump load with incomplete fillage (fluid pound).
"""
import numpy as np

from . import params as P

E = 2.06e11           # Pa, steel
RHO_STEEL = 7850.0
G_B = 9.81 * (1 - P.RHO_OIL / RHO_STEEL)
NODES = 45
POINTS = 120          # samples per card returned to the UI


def card(spm, stroke_m, mu_cp, drag_c, fillage=1.0, strokes=3):
    """Surface + downhole card for one operating point (last of `strokes` cycles)."""
    L = P.PUMP_DEPTH
    m = P.ROD_WEIGHT_BUOYANT_N / (G_B * L)          # kg/m, consistent with the float model
    ea = E * m / RHO_STEEL
    dx = L / (NODES - 1)
    a = np.sqrt(E / RHO_STEEL)
    dt = 0.8 * dx / a
    w = 2 * np.pi * spm / 60
    c = drag_c * mu_cp * 1e-3 + 0.15 * m * np.pi * a / L  # viscous + structural damping, N·s/m²
    period = 60 / spm
    steps = int(strokes * period / dt)
    keep = int(period / dt)

    u = np.zeros(NODES)
    u_old = u.copy()
    k = dt * dt / m
    attached, plunger_top, fluid_on = True, 0.0, True
    s_down = stroke_m
    rec = np.empty((keep, 4))  # carrier pos, surface load, plunger pos, pump load
    sep = np.zeros(keep, bool)
    prev_up = False

    for i in range(steps):
        t = i * dt
        carrier = stroke_m / 2 * (1 - np.cos(w * t))
        new = u.copy()
        lap = (u[2:] - 2 * u[1:-1] + u[:-2]) / (dx * dx)
        new[1:-1] = 2 * u[1:-1] - u_old[1:-1] + k * (ea * lap - c * (u[1:-1] - u_old[1:-1]) / dt + m * G_B)

        # pump boundary: fluid load on upstroke; on downstroke it stays until the plunger hits liquid.
        # Stroke direction follows the carrier delayed by the stress-wave travel time (the plunger's
        # own velocity rings too much to use).
        v_p = (u[-1] - u_old[-1]) / dt
        up = np.sin(w * (t - L / a)) < 0
        if up and not prev_up:
            fluid_on = True
        if not up and prev_up:
            plunger_top = u[-1]
        if not up and u[-1] - plunger_top > (1 - fillage) * s_down:
            fluid_on = False
        prev_up = up
        f_pump = (P.FLUID_LOAD_N if fluid_on else 0.0) + 0.02 * drag_c * mu_cp * 1e-3 * L * (-v_p)
        new[-1] = new[-2] + f_pump * dx / ea

        # surface boundary: bridle holds the rods only in tension (rod float = separation)
        if attached:
            new[0] = carrier
            if ea * (new[1] - new[0]) / dx < 0:
                attached = False
        if not attached:
            new[0] = new[1]
            if carrier <= new[0]:
                attached, new[0] = True, carrier
        u_old, u = u, new

        j = i - (steps - keep)
        if j >= 0:
            rec[j] = carrier, max(ea * (u[1] - u[0]) / dx, 0.0) if attached else 0.0, u[-1], f_pump
            sep[j] = not attached
        if i == steps - keep:  # downhole stroke of the previous cycle feeds the fluid-pound trigger
            s_down = max(float(np.ptp(u_old[-1:])) or stroke_m, 0.3 * stroke_m)

    idx = np.linspace(0, keep - 1, POINTS).astype(int)
    r = rec[idx]
    plunger = r[:, 2] - r[:, 2].min()
    return dict(
        surface=np.column_stack([r[:, 0], r[:, 1] / 1e3]).round(3).tolist(),
        downhole=np.column_stack([plunger, r[:, 3] / 1e3]).round(3).tolist(),
        separated=sep[idx].tolist(),
        peak_kn=round(float(rec[:, 1].max() / 1e3), 1), min_kn=round(float(rec[:, 1].min() / 1e3), 1),
        downhole_stroke_m=round(float(np.ptp(rec[:, 2])), 2),
        diagnosis=diagnose(sep.mean(), fillage),
    )


def diagnose(separated_frac, fillage):
    # ponytail: rule-based card diagnosis from the solved physics; a CNN on real OIL cards replaces it
    if separated_frac > 0.02:
        return "ROD FLOAT: carrier-bar separation, impact loading on return"
    if fillage < 0.7:
        return "FLUID POUND: incomplete pump fillage, impact on downstroke"
    return "NORMAL: full pump, rods follow the carrier bar"


if __name__ == "__main__":
    import time
    for mu, fill in ((50, 1.0), (5000, 1.0), (21000, 1.0), (300, 0.5)):
        t0 = time.perf_counter()
        c = card(3.3, 2.5, mu, 4.0, fill)
        print(mu, fill, f"{(time.perf_counter() - t0) * 1e3:.0f} ms", c["peak_kn"], c["min_kn"], c["downhole_stroke_m"], c["diagnosis"])
