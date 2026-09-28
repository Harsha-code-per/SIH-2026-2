"""Language layer: parse operator intent, explain the engine's decision.

The LLM never produces an operating number. parse() output is range-checked,
and explain() output is rejected if it mentions any number the engine did not
compute. Both fall back to deterministic code when the model is unavailable.
"""
import json
import os
import re
from pathlib import Path

from .optimize import DEMO

_env = Path(__file__).resolve().parent.parent / ".env"
if _env.exists():
    for line in _env.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

MODEL = os.environ.get("NVIDIA_MODEL", "nvidia/nemotron-3-super-120b-a12b")
LIMITS = dict(target_bbl=(100, 10000), deadline_d=(20, 180), steam_budget_t=(200, 2500), energy_budget_kwh=(1000, 50000))
_NUM = re.compile(r"\d[\d,]*\.?\d*")


def _chat(system, user):
    key = os.environ.get("NVIDIA_API_KEY")
    if not key:
        return None
    from openai import OpenAI
    client = OpenAI(base_url="https://integrate.api.nvidia.com/v1", api_key=key, timeout=25)
    out = client.chat.completions.create(model=MODEL, temperature=0.1, max_tokens=400,
                                         extra_body={"chat_template_kwargs": {"enable_thinking": False}},
                                         messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
    return out.choices[0].message.content


def _regex_parse(text):
    t = text.lower().replace(",", "")
    grab = lambda pat: (m := re.search(pat, t)) and float(m.group(1))
    mwh = grab(r"(\d+\.?\d*)\s*mwh")
    return dict(
        target_bbl=grab(r"(\d+\.?\d*)\s*(?:bbl|barrels?)"),
        deadline_d=grab(r"(\d+)\s*days?"),
        steam_budget_t=grab(r"(\d+\.?\d*)\s*(?:t\b|tonnes?|tons?)"),
        energy_budget_kwh=mwh * 1000 if mwh else grab(r"(\d+\.?\d*)\s*kwh"),
    )


def parse(text, well_id=DEMO["well_id"]):
    """Natural language → validated mission. Missing fields use the demo defaults and are reported."""
    source, raw = "rules", None
    try:
        reply = _chat(
            "Extract an oil-well production mission from the operator's sentence. Reply with ONLY a JSON object with "
            "keys target_bbl, deadline_d, steam_budget_t, energy_budget_kwh (numbers or null if not stated). "
            "Convert MWh to kWh. Never guess values that are not stated.", text)
        if reply:
            raw = json.loads(re.search(r"\{.*\}", reply, re.S).group(0))
            source = "llm"
    except Exception:
        raw = None
    raw = raw or _regex_parse(text)
    mission, missing = dict(well_id=well_id), []
    for k, (lo, hi) in LIMITS.items():
        v = raw.get(k)
        ok = isinstance(v, (int, float)) and lo <= v <= hi
        mission[k] = float(v) if ok else float(DEMO[k])
        if not ok:
            missing.append(k)
    return dict(mission=mission, defaulted=missing, source=source)


def _facts(res):
    rec, base, m = res["recommended"], res["baseline"], res["mission"]
    return dict(
        well=m["well_id"], target_bbl=m["target_bbl"], deadline_days=m["deadline_d"],
        steam_tonnes=rec["x"]["steam_t"], injection_pressure_bar=rec["x"]["inj_p_bar"], soak_days=rec["x"]["soak_d"],
        stroke_m=rec["x"]["stroke_m"], spm_start=rec["spm_schedule"][0]["spm"], spm_end=rec["spm_schedule"][-1]["spm"],
        p10_bbl=rec["p10"], p50_bbl=rec["p50"], p90_bbl=rec["p90"], day_target_reached=rec["day_target"],
        steam_oil_ratio=rec["sor"], cost_per_bbl_inr=rec["cost_per_bbl"], baseline_cost_per_bbl_inr=base["cost_per_bbl"],
        baseline_rod_float_days=base["float_days"], feasible_strategies=res["n"] - sum(g["rejected"] for g in res["funnel"]),
        strategies_simulated=res["n"], similar_past_cycles=[e["cycle"] for e in res["evidence"]],
    )


def _template(f):
    return (f"Inject {f['steam_tonnes']:.0f} t of steam at {f['injection_pressure_bar']:.0f} bar and soak {f['soak_days']:g} days. "
            f"The twin expects {f['p50_bbl']:,} bbl by day {f['deadline_days']:.0f} (P10 {f['p10_bbl']:,}), "
            f"so the {f['target_bbl']:,.0f} bbl target holds even in the pessimistic case. "
            f"Run the pump at {f['spm_start']:g} SPM and step down to {f['spm_end']:g} SPM as the reservoir cools. "
            f"This well's typical constant-SPM practice would float the rods for {f['baseline_rod_float_days']} days. "
            f"Of {f['strategies_simulated']:,} strategies simulated, this has the lowest cost per barrel "
            f"(₹{f['cost_per_bbl_inr']:,} vs ₹{f['baseline_cost_per_bbl_inr']:,}), and it sits inside the range this well "
            f"has already been run at (closest past cycles: {', '.join(map(str, f['similar_past_cycles']))}).")


def _numbers(text):
    return {float(n.replace(",", "").rstrip(".")) for n in _NUM.findall(text)}


def guard(text, facts):
    """True only if every number in text is one the engine produced (or trivially small, e.g. 'P10')."""
    allowed = set()
    for v in facts.values():
        for n in (v if isinstance(v, list) else [v]):
            if isinstance(n, (int, float)):
                allowed |= {float(n), round(float(n)), round(float(n), 1)}
    return all(n in allowed or n in (10, 50, 90) for n in _numbers(text))


def explain(res):
    f = _facts(res)
    lf = {k: v for k, v in f.items() if k != "similar_past_cycles"}  # IDs get misread as quantities
    try:
        text = _chat(
            "You are the explanation layer of an oil-well digital twin. Explain to a field engineer, in at most 4 short "
            "sentences, why this CSS + sucker-rod-pump plan was recommended. Use ONLY numbers present in the JSON, "
            "with the units implied by each key name; never compute or invent new numbers. Plain prose, no lists, "
            "no preamble.", json.dumps(lf))
        if text and guard(text, lf):
            return dict(text=text.strip(), source="llm", guard="passed")
        return dict(text=_template(f), source="template", guard="rejected" if text else "offline")
    except Exception:
        return dict(text=_template(f), source="template", guard="offline")
