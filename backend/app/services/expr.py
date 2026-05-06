"""Tiny safe expression evaluator for task-definition rules.

Used by `show_if`, `auto_complete_when`, completion `expression`, spawn
`when`, and clock `applies_when`. Hand-written recursive descent
parser + interpreter — no `eval`, no `literal_eval`, no Python parsing
hooks of any kind. ~250 lines.

Grammar
-------
    expr        := or_expr
    or_expr     := and_expr ('||' and_expr)*
    and_expr    := not_expr ('&&' not_expr)*
    not_expr    := '!' not_expr | comparison
    comparison  := value (op value)?
    op          := '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'not in'
    value       := number | string | boolean | null | array | identifier | '(' expr ')'
    identifier  := name ('.' name)*

Identifiers resolve against a context dict; dotted paths walk it. Missing
keys are `None`. Comparisons with `None` follow SQL-ish semantics:
`None == None` → True, `None == 'x'` → False, ordering with `None` →
False.

Errors
------
- `ExpressionParseError` from `parse()` — raised eagerly on bad syntax.
- `ExpressionEvalError` from `evaluate()` — raised on runtime failure
  (e.g. ordering mismatched types). The wrappers used from `show_if` etc.
  catch this and return `False` (fail closed).
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any, ClassVar


class ExpressionError(Exception):
    pass


class ExpressionParseError(ExpressionError):
    pass


class ExpressionEvalError(ExpressionError):
    pass


# ---------- AST nodes ----------


@dataclass(frozen=True)
class Lit:
    value: Any


@dataclass(frozen=True)
class Ident:
    path: tuple[str, ...]


@dataclass(frozen=True)
class Arr:
    items: tuple[Node, ...]


@dataclass(frozen=True)
class Not:
    inner: Node


@dataclass(frozen=True)
class And:
    left: Node
    right: Node


@dataclass(frozen=True)
class Or:
    left: Node
    right: Node


@dataclass(frozen=True)
class Cmp:
    op: str
    left: Node
    right: Node


Node = Lit | Ident | Arr | Not | And | Or | Cmp


# ---------- tokenizer ----------


class Tok:
    NUMBER = "NUMBER"
    STRING = "STRING"
    IDENT = "IDENT"
    LPAREN = "("
    RPAREN = ")"
    LBRACK = "["
    RBRACK = "]"
    COMMA = ","
    OR = "||"
    AND = "&&"
    NOT = "!"
    EQ = "=="
    NEQ = "!="
    LTE = "<="
    GTE = ">="
    LT = "<"
    GT = ">"
    KW_IN = "in"
    KW_NOT_IN = "not in"
    KW_TRUE = "true"
    KW_FALSE = "false"
    KW_NULL = "null"
    EOF = "EOF"


_KEYWORDS = {
    "true": Tok.KW_TRUE,
    "false": Tok.KW_FALSE,
    "null": Tok.KW_NULL,
    "in": Tok.KW_IN,
    "not": "NOT_KW",  # disambiguated when followed by "in"
}


def _tokenize(src: str) -> list[tuple[str, Any]]:
    out: list[tuple[str, Any]] = []
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        if c.isspace():
            i += 1
            continue
        if c.isdigit() or (c == "-" and i + 1 < n and src[i + 1].isdigit()):
            j = i + 1
            while j < n and (src[j].isdigit() or src[j] == "."):
                j += 1
            chunk = src[i:j]
            try:
                out.append((Tok.NUMBER, float(chunk) if "." in chunk else int(chunk)))
            except ValueError as e:
                raise ExpressionParseError(f"bad number {chunk!r}") from e
            i = j
            continue
        if c == "'" or c == '"':
            quote = c
            j = i + 1
            buf: list[str] = []
            while j < n and src[j] != quote:
                if src[j] == "\\" and j + 1 < n:
                    buf.append(src[j + 1])
                    j += 2
                else:
                    buf.append(src[j])
                    j += 1
            if j >= n:
                raise ExpressionParseError("unterminated string literal")
            out.append((Tok.STRING, "".join(buf)))
            i = j + 1
            continue
        if c.isalpha() or c == "_":
            j = i + 1
            while j < n and (src[j].isalnum() or src[j] in "_."):
                j += 1
            word = src[i:j]
            if word == "not":
                # Look-ahead for "not in"
                k = j
                while k < n and src[k].isspace():
                    k += 1
                if src[k : k + 2] == "in" and (k + 2 == n or not src[k + 2].isalnum()):
                    out.append((Tok.KW_NOT_IN, "not in"))
                    i = k + 2
                    continue
                raise ExpressionParseError("'not' must be followed by 'in'")
            kw = _KEYWORDS.get(word)
            if kw is not None:
                out.append((kw, word))
            else:
                out.append((Tok.IDENT, word))
            i = j
            continue
        # multi-char operators
        if src[i : i + 2] in ("||", "&&", "==", "!=", "<=", ">="):
            out.append((src[i : i + 2], src[i : i + 2]))
            i += 2
            continue
        if c in "()[],<>!":
            out.append((c, c))
            i += 1
            continue
        raise ExpressionParseError(f"unexpected character {c!r} at offset {i}")
    out.append((Tok.EOF, None))
    return out


# ---------- parser ----------


class _Parser:
    _COMP_OPS: ClassVar[set[str]] = {
        Tok.EQ,
        Tok.NEQ,
        Tok.LT,
        Tok.LTE,
        Tok.GT,
        Tok.GTE,
        Tok.KW_IN,
        Tok.KW_NOT_IN,
    }

    def __init__(self, tokens: list[tuple[str, Any]]) -> None:
        self.t = tokens
        self.i = 0

    def _peek(self) -> tuple[str, Any]:
        return self.t[self.i]

    def _eat(self) -> tuple[str, Any]:
        tk = self.t[self.i]
        self.i += 1
        return tk

    def _expect(self, kind: str) -> tuple[str, Any]:
        tk = self._eat()
        if tk[0] != kind:
            raise ExpressionParseError(f"expected {kind}, got {tk[0]}")
        return tk

    def parse(self) -> Node:
        node = self._or()
        if self._peek()[0] != Tok.EOF:
            raise ExpressionParseError(f"unexpected trailing tokens starting at {self._peek()}")
        return node

    def _or(self) -> Node:
        node = self._and()
        while self._peek()[0] == Tok.OR:
            self._eat()
            node = Or(node, self._and())
        return node

    def _and(self) -> Node:
        node = self._not()
        while self._peek()[0] == Tok.AND:
            self._eat()
            node = And(node, self._not())
        return node

    def _not(self) -> Node:
        if self._peek()[0] == Tok.NOT:
            self._eat()
            return Not(self._not())
        return self._cmp()

    def _cmp(self) -> Node:
        left = self._value()
        if self._peek()[0] in self._COMP_OPS:
            op = self._eat()[0]
            right = self._value()
            return Cmp(op, left, right)
        return left

    def _value(self) -> Node:
        kind, val = self._peek()
        if kind == Tok.NUMBER or kind == Tok.STRING:
            self._eat()
            return Lit(val)
        if kind == Tok.KW_TRUE:
            self._eat()
            return Lit(True)
        if kind == Tok.KW_FALSE:
            self._eat()
            return Lit(False)
        if kind == Tok.KW_NULL:
            self._eat()
            return Lit(None)
        if kind == Tok.IDENT:
            self._eat()
            return Ident(tuple(val.split(".")))
        if kind == Tok.LPAREN:
            self._eat()
            inner = self._or()
            self._expect(Tok.RPAREN)
            return inner
        if kind == Tok.LBRACK:
            self._eat()
            items: list[Node] = []
            if self._peek()[0] != Tok.RBRACK:
                items.append(self._value())
                while self._peek()[0] == Tok.COMMA:
                    self._eat()
                    items.append(self._value())
            self._expect(Tok.RBRACK)
            return Arr(tuple(items))
        raise ExpressionParseError(f"unexpected token {kind!r}")


@lru_cache(maxsize=2048)
def parse(expression: str) -> Node:
    tokens = _tokenize(expression)
    return _Parser(tokens).parse()


# ---------- interpreter ----------


def _resolve(path: tuple[str, ...], ctx: dict) -> Any:
    cur: Any = ctx
    for part in path:
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
        if cur is None:
            return None
    return cur


def _value_of(node: Node, ctx: dict) -> Any:
    if isinstance(node, Lit):
        return node.value
    if isinstance(node, Ident):
        return _resolve(node.path, ctx)
    if isinstance(node, Arr):
        return [_value_of(item, ctx) for item in node.items]
    # And/Or/Not/Cmp aren't values per se, but `_or()` may produce them
    # at the top — the caller (evaluate) handles those branches.
    return _evaluate_bool(node, ctx)


def _cmp(op: str, a: Any, b: Any) -> bool:
    # SQL-ish None semantics: equality survives, ordering against None is
    # always False (consistent for both `<` and `>`).
    if op == Tok.EQ:
        return a == b
    if op == Tok.NEQ:
        return a != b
    if op == Tok.KW_IN:
        if b is None:
            return False
        try:
            return a in b
        except TypeError as e:
            raise ExpressionEvalError(f"`in` rhs not iterable: {b!r}") from e
    if op == Tok.KW_NOT_IN:
        if b is None:
            return True
        try:
            return a not in b
        except TypeError as e:
            raise ExpressionEvalError(f"`not in` rhs not iterable: {b!r}") from e
    if a is None or b is None:
        return False
    try:
        if op == Tok.LT:
            return a < b
        if op == Tok.LTE:
            return a <= b
        if op == Tok.GT:
            return a > b
        if op == Tok.GTE:
            return a >= b
    except TypeError as e:
        raise ExpressionEvalError(
            f"cannot compare {type(a).__name__} {op} {type(b).__name__}"
        ) from e
    raise ExpressionEvalError(f"unknown operator {op!r}")


def _truthy(v: Any) -> bool:
    if v is None:
        return False
    if isinstance(v, bool):
        return v
    if isinstance(v, int | float):
        return v != 0
    if isinstance(v, str):
        return len(v) > 0
    if isinstance(v, list | tuple | dict):
        return len(v) > 0
    return True


def _evaluate_bool(node: Node, ctx: dict) -> bool:
    if isinstance(node, Or):
        return _evaluate_bool(node.left, ctx) or _evaluate_bool(node.right, ctx)
    if isinstance(node, And):
        return _evaluate_bool(node.left, ctx) and _evaluate_bool(node.right, ctx)
    if isinstance(node, Not):
        return not _evaluate_bool(node.inner, ctx)
    if isinstance(node, Cmp):
        return _cmp(node.op, _value_of(node.left, ctx), _value_of(node.right, ctx))
    # Bare value → truthiness
    return _truthy(_value_of(node, ctx))


def evaluate(expression: str, context: dict) -> bool:
    """Parse + evaluate. Errors propagate; callers that want fail-closed
    behaviour should wrap with try/except (see `safe_evaluate`)."""
    return _evaluate_bool(parse(expression), context)


def safe_evaluate(expression: str | None, context: dict, *, default: bool = False) -> bool:
    """Wrapper for `show_if` etc. — broken rules return `default` (False
    by default, which hides the field rather than crashing the form)."""
    if not expression:
        return True  # no rule = always shown
    try:
        return evaluate(expression, context)
    except ExpressionError:
        return default
