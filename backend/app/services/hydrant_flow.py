from __future__ import annotations

from typing import Literal


def gpm_at_20psi(static_psi: int, residual_psi: int, flow_gpm: int) -> int | None:
    """NFPA 291: Q20 = Q * ((H_s - 20) / (H_s - H_r))^0.54"""
    if static_psi <= 20 or static_psi <= residual_psi:
        return None
    ratio = (static_psi - 20) / (static_psi - residual_psi)
    if ratio <= 0:
        return None
    return round(flow_gpm * (ratio**0.54))


def color_class(
    gpm_at_20: int | None,
) -> Literal["blue", "green", "orange", "red"] | None:
    """NFPA 291 marking colors: blue ≥ 1500 GPM, green 1000-1499, orange 500-999, red < 500."""
    if gpm_at_20 is None:
        return None
    if gpm_at_20 >= 1500:
        return "blue"
    if gpm_at_20 >= 1000:
        return "green"
    if gpm_at_20 >= 500:
        return "orange"
    return "red"
