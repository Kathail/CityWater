from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.expr import (
    ExpressionError,
    evaluate,
    safe_evaluate,
)

FIXTURES_PATH = Path(__file__).parent / "fixtures" / "expr_cases.json"


def _load_cases() -> list[dict]:
    return json.loads(FIXTURES_PATH.read_text())


@pytest.mark.parametrize("case", _load_cases(), ids=lambda c: c["expression"])
def test_expression_fixture(case: dict) -> None:
    expr = case["expression"]
    ctx = case["context"]
    expected = case["expected"]
    if expected == "error":
        with pytest.raises(ExpressionError):
            evaluate(expr, ctx)
    else:
        assert evaluate(expr, ctx) is expected


def test_safe_evaluate_returns_default_on_error() -> None:
    assert safe_evaluate("(x", {"x": 1}) is False
    assert safe_evaluate("(x", {"x": 1}, default=True) is True


def test_safe_evaluate_empty_returns_true() -> None:
    # No `show_if` = always shown.
    assert safe_evaluate(None, {}) is True
    assert safe_evaluate("", {}) is True
