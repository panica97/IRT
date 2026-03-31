"""Grid generation for stress-test parameter sweeps.

Handles two sweep modes:
- **Multi-param grid**: cartesian product of all param ranges.
- **Single-param sweeps**: one param at a time, others at defaults.

Each param spec is either:
- Range: ``{"min": 5, "max": 30, "step": 5}``
- List:  ``{"type": "list", "values": [10, 20, 30]}``
"""

from __future__ import annotations

import itertools
from typing import Any, Dict, List, Tuple


def _expand_spec(spec: dict) -> List[Any]:
    """Expand a single param spec into a list of values.

    Parameters
    ----------
    spec : dict
        Either ``{"min": N, "max": M, "step": S}`` or
        ``{"type": "list", "values": [...]}``.

    Returns
    -------
    list
        Expanded values.
    """
    if spec.get("type") == "list":
        return list(spec["values"])

    # Range spec
    lo = spec["min"]
    hi = spec["max"]
    step = spec["step"]

    values: List[Any] = []
    current = lo
    while current <= hi + 1e-9:  # tolerance for float rounding
        # Keep int type if inputs are all int
        if isinstance(lo, int) and isinstance(hi, int) and isinstance(step, int):
            values.append(int(round(current)))
        else:
            values.append(round(current, 10))
        current += step

    return values


def build_multi_grid(param_overrides: Dict[str, dict]) -> List[Dict[str, Any]]:
    """Build cartesian product of all param overrides.

    Parameters
    ----------
    param_overrides : dict
        ``{param_path: spec, ...}`` where spec is a range or list spec.

    Returns
    -------
    list[dict]
        Each dict maps ``{param_path: value}`` for one grid point.
    """
    if not param_overrides:
        return []

    param_names = list(param_overrides.keys())
    param_values = [_expand_spec(param_overrides[name]) for name in param_names]

    grid: List[Dict[str, Any]] = []
    for combo in itertools.product(*param_values):
        grid.append(dict(zip(param_names, combo)))

    return grid


def build_single_sweeps(
    single_overrides: Dict[str, dict],
) -> List[Tuple[Dict[str, Any], str]]:
    """Build one-at-a-time sweep variations.

    Each param is swept independently: only that param changes,
    all others stay at their defaults (not included in the override dict).

    Parameters
    ----------
    single_overrides : dict
        ``{param_path: spec, ...}``.

    Returns
    -------
    list[tuple[dict, str]]
        Each tuple is ``(override_dict, param_name)`` where override_dict
        has a single key/value for the swept param.
    """
    if not single_overrides:
        return []

    sweeps: List[Tuple[Dict[str, Any], str]] = []
    for param_name, spec in single_overrides.items():
        values = _expand_spec(spec)
        for val in values:
            sweeps.append(({param_name: val}, param_name))

    return sweeps
