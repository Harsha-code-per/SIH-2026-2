"""Baghewala anchors + engineering bounds.

Published anchors are cited. Everything marked ASSUMED is a tunable knob until
OIL field data replaces it: history matching in twin.py overrides per-well values.
"""

# --- Field anchors (published) ---
T_RES = 47.0        # °C  reservoir temp, SIH PS 26120 (46–48 °C)
MU_50C = 11_500.0   # cP  crude viscosity @ 50 °C, oil-india.com/rajasthan-fields (10,000–13,000)
API = 17.0          # °API, SIH PS (17–19) / OIL site (14–17)
PUMP_DEPTH = 1100.0 # m   pump setting depth, SPE APOG 2023-535203 (~1,100 m; reservoir ~1,150 m)

# --- Fluid / rock (ASSUMED, typical for 15–19° API crude in sandstone) ---
MU_200C = 12.0      # cP  @ 200 °C, second Walther anchor
RHO_OIL = 950.0     # kg/m3
PAY_H = 20.0        # m   net pay
R_W = 0.1           # m   wellbore radius
R_E = 60.0          # m   drainage radius
M_R = 2.4e6         # J/m3/K volumetric heat capacity of saturated sandstone
SKIN_COLD = 5.0     # near-wellbore asphaltene damage (PS: high asphaltene); heat removes it

# --- Steam / injection (ASSUMED) ---
FRAC_LIMIT_BAR = 150.0   # wellhead limit: ~180 bar frac at 1,150 m less safety margin
GEN_MAX_TPD = 140.0      # steam generator capacity, t/day CWE

# --- SRP string (ASSUMED: 7/8"–3/4" taper, 1.25" pump, 2-7/8" tubing, grade D rods) ---
PUMP_BORE_IN = 1.25
ROD_WEIGHT_BUOYANT_N = 25_000.0
FLUID_LOAD_N = 8_200.0
ROD_AREA_M2 = 3.88e-4    # 7/8" top rod
ROD_TENSILE_PA = 793e6   # 115 ksi, grade D
MIN_FLOAT_MARGIN = 1.25  # controller keeps rod-fall velocity ≥ 1.25 × polished-rod speed
MIN_SPM = 1.0
ECON_LIMIT_BOPD = 10.0   # below this oil rate the cycle should end → re-steam trigger

# --- Decision space the optimizer may search (wider than history on purpose) ---
BOUNDS = {
    "steam_t":   (300.0, 1800.0),  # t CWE per cycle
    "inj_p_bar": (70.0, 165.0),    # wellhead injection pressure
    "soak_d":    (1.0, 12.0),      # days
    "stroke_m":  (1.6, 3.0),       # stroke length
    "spm_max":   (2.0, 8.0),       # SPM ceiling (VFD upper setpoint)
}
DECISIONS = list(BOUNDS)
SPM_PER_HZ = 6.0 / 50.0            # VFD: 50 Hz ≙ 6 SPM on this unit (ASSUMED)

# --- Economics for ranking plans (ASSUMED, INR) ---
STEAM_COST_PER_T = 2500.0  # fuel + water treatment per tonne CWE
POWER_COST_PER_KWH = 9.0
MAX_FAILURE_RISK = 0.15
WORKOVER_COST = 1_200_000.0  # rod-failure workover: rig, rods, lost production (ASSUMED)
