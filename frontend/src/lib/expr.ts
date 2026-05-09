/**
 * Tiny safe expression evaluator — TypeScript mirror of `app/services/expr.py`.
 *
 * Used by `show_if`, `auto_complete_when`, completion `expression`, spawn
 * `when`, clock `applies_when` — anywhere a task definition needs to
 * branch on `task_data` or `entity_ctx`. Hand-written recursive descent
 * parser + interpreter; never falls back to `eval` or `Function()`.
 *
 * The grammar is identical to the Python implementation and the test
 * fixtures (`backend/tests/fixtures/expr_cases.json`) drive both. If the
 * two implementations diverge on any case, the build fails.
 *
 * Grammar:
 *   expr        := or_expr
 *   or_expr     := and_expr ('||' and_expr)*
 *   and_expr    := not_expr ('&&' not_expr)*
 *   not_expr    := '!' not_expr | comparison
 *   comparison  := value (op value)?
 *   op          := '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'not in'
 *   value       := number | string | boolean | null | array | identifier | '(' expr ')'
 *   identifier  := name ('.' name)*
 *
 * SQL-ish None semantics: `null == null` → true, `null > anything` → false.
 */

export class ExpressionError extends Error {}
export class ExpressionParseError extends ExpressionError {}
export class ExpressionEvalError extends ExpressionError {}

// ---------- AST ----------

type Lit = { kind: "lit"; value: unknown };
type Ident = { kind: "ident"; path: readonly string[] };
type Arr = { kind: "arr"; items: readonly Node[] };
type Not = { kind: "not"; inner: Node };
type And = { kind: "and"; left: Node; right: Node };
type Or = { kind: "or"; left: Node; right: Node };
type Cmp = { kind: "cmp"; op: string; left: Node; right: Node };
type Node = Lit | Ident | Arr | Not | And | Or | Cmp;

// ---------- tokenizer ----------

type Token =
  | { type: "NUMBER"; value: number }
  | { type: "STRING"; value: string }
  | { type: "IDENT"; value: string }
  | { type: "TRUE" | "FALSE" | "NULL" | "IN" | "NOT_IN" | "EOF" }
  | {
      type: "(" | ")" | "[" | "]" | "," | "||" | "&&" | "!" | "==" | "!=" | "<" | "<=" | ">" | ">=";
    };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "-" && i + 1 < n && /[0-9]/.test(src[i + 1]))) {
      let j = i + 1;
      while (j < n && /[0-9.]/.test(src[j])) j++;
      const chunk = src.slice(i, j);
      const value = Number(chunk);
      if (Number.isNaN(value)) throw new ExpressionParseError(`bad number ${chunk}`);
      out.push({ type: "NUMBER", value });
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      const buf: string[] = [];
      while (j < n && src[j] !== quote) {
        if (src[j] === "\\" && j + 1 < n) {
          buf.push(src[j + 1]);
          j += 2;
        } else {
          buf.push(src[j]);
          j++;
        }
      }
      if (j >= n) throw new ExpressionParseError("unterminated string literal");
      out.push({ type: "STRING", value: buf.join("") });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_.]/.test(src[j])) j++;
      const word = src.slice(i, j);
      if (word === "not") {
        let k = j;
        while (k < n && /\s/.test(src[k])) k++;
        if (src.slice(k, k + 2) === "in" && (k + 2 === n || !/[A-Za-z0-9_]/.test(src[k + 2]))) {
          out.push({ type: "NOT_IN" });
          i = k + 2;
          continue;
        }
        throw new ExpressionParseError("'not' must be followed by 'in'");
      }
      if (word === "true") out.push({ type: "TRUE" });
      else if (word === "false") out.push({ type: "FALSE" });
      else if (word === "null") out.push({ type: "NULL" });
      else if (word === "in") out.push({ type: "IN" });
      else out.push({ type: "IDENT", value: word });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (
      two === "||" ||
      two === "&&" ||
      two === "==" ||
      two === "!=" ||
      two === "<=" ||
      two === ">="
    ) {
      out.push({ type: two });
      i += 2;
      continue;
    }
    if (
      c === "(" ||
      c === ")" ||
      c === "[" ||
      c === "]" ||
      c === "," ||
      c === "<" ||
      c === ">" ||
      c === "!"
    ) {
      out.push({ type: c });
      i++;
      continue;
    }
    throw new ExpressionParseError(`unexpected character ${c} at offset ${i}`);
  }
  out.push({ type: "EOF" });
  return out;
}

// ---------- parser ----------

const COMP_OPS = new Set(["==", "!=", "<", "<=", ">", ">=", "IN", "NOT_IN"]);

class Parser {
  constructor(
    private toks: Token[],
    private i = 0,
  ) {}

  private peek(): Token {
    return this.toks[this.i];
  }
  private eat(): Token {
    return this.toks[this.i++];
  }
  private expect(t: Token["type"]): Token {
    const tk = this.eat();
    if (tk.type !== t) throw new ExpressionParseError(`expected ${t}, got ${tk.type}`);
    return tk;
  }

  parse(): Node {
    const node = this.or();
    if (this.peek().type !== "EOF") {
      throw new ExpressionParseError(`unexpected trailing token ${this.peek().type}`);
    }
    return node;
  }

  private or(): Node {
    let node = this.and();
    while (this.peek().type === "||") {
      this.eat();
      node = { kind: "or", left: node, right: this.and() };
    }
    return node;
  }

  private and(): Node {
    let node = this.notExpr();
    while (this.peek().type === "&&") {
      this.eat();
      node = { kind: "and", left: node, right: this.notExpr() };
    }
    return node;
  }

  private notExpr(): Node {
    if (this.peek().type === "!") {
      this.eat();
      return { kind: "not", inner: this.notExpr() };
    }
    return this.cmp();
  }

  private cmp(): Node {
    const left = this.value();
    if (COMP_OPS.has(this.peek().type)) {
      const op = this.eat().type;
      const right = this.value();
      return { kind: "cmp", op, left, right };
    }
    return left;
  }

  private value(): Node {
    const t = this.peek();
    if (t.type === "NUMBER" || t.type === "STRING") {
      this.eat();
      return { kind: "lit", value: (t as { value: unknown }).value };
    }
    if (t.type === "TRUE") {
      this.eat();
      return { kind: "lit", value: true };
    }
    if (t.type === "FALSE") {
      this.eat();
      return { kind: "lit", value: false };
    }
    if (t.type === "NULL") {
      this.eat();
      return { kind: "lit", value: null };
    }
    if (t.type === "IDENT") {
      this.eat();
      const ident = t as { value: string };
      return { kind: "ident", path: ident.value.split(".") };
    }
    if (t.type === "(") {
      this.eat();
      const inner = this.or();
      this.expect(")");
      return inner;
    }
    if (t.type === "[") {
      this.eat();
      const items: Node[] = [];
      if (this.peek().type !== "]") {
        items.push(this.value());
        while (this.peek().type === ",") {
          this.eat();
          items.push(this.value());
        }
      }
      this.expect("]");
      return { kind: "arr", items };
    }
    throw new ExpressionParseError(`unexpected token ${t.type}`);
  }
}

// Cache parsed ASTs — task definitions reuse the same expressions across renders.
const parseCache = new Map<string, Node>();

export function parse(expression: string): Node {
  const cached = parseCache.get(expression);
  if (cached) return cached;
  const node = new Parser(tokenize(expression)).parse();
  if (parseCache.size > 2048) parseCache.clear();
  parseCache.set(expression, node);
  return node;
}

// ---------- interpreter ----------

function resolve(path: readonly string[], ctx: unknown): unknown {
  let cur: unknown = ctx;
  for (const part of path) {
    if (cur === null || cur === undefined) return null;
    if (typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[part];
    if (cur === undefined) return null;
  }
  return cur ?? null;
}

function valueOf(node: Node, ctx: unknown): unknown {
  switch (node.kind) {
    case "lit":
      return node.value;
    case "ident":
      return resolve(node.path, ctx);
    case "arr":
      return node.items.map((n) => valueOf(n, ctx));
    default:
      return evaluateBool(node, ctx);
  }
}

function compare(op: string, a: unknown, b: unknown): boolean {
  if (op === "==") return a === b || (a == null && b == null);
  if (op === "!=") return !(a === b || (a == null && b == null));
  if (op === "IN") {
    if (b == null) return false;
    if (Array.isArray(b)) return b.includes(a as never);
    if (typeof b === "string") return typeof a === "string" && b.includes(a);
    throw new ExpressionEvalError(`'in' rhs not iterable`);
  }
  if (op === "NOT_IN") {
    if (b == null) return true;
    if (Array.isArray(b)) return !b.includes(a as never);
    if (typeof b === "string") return typeof a === "string" && !b.includes(a);
    throw new ExpressionEvalError(`'not in' rhs not iterable`);
  }
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) {
    throw new ExpressionEvalError(`cannot compare ${typeof a} ${op} ${typeof b}`);
  }
  // After the type guard, both are the same primitive type and comparable.
  const ax = a as number | string;
  const bx = b as number | string;
  if (op === "<") return ax < bx;
  if (op === "<=") return ax <= bx;
  if (op === ">") return ax > bx;
  if (op === ">=") return ax >= bx;
  throw new ExpressionEvalError(`unknown operator ${op}`);
}

function truthy(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

function evaluateBool(node: Node, ctx: unknown): boolean {
  switch (node.kind) {
    case "or":
      return evaluateBool(node.left, ctx) || evaluateBool(node.right, ctx);
    case "and":
      return evaluateBool(node.left, ctx) && evaluateBool(node.right, ctx);
    case "not":
      return !evaluateBool(node.inner, ctx);
    case "cmp":
      return compare(node.op, valueOf(node.left, ctx), valueOf(node.right, ctx));
    default:
      return truthy(valueOf(node, ctx));
  }
}

export function evaluate(expression: string, context: unknown): boolean {
  return evaluateBool(parse(expression), context);
}

/** Wrapper for `show_if` etc. — broken rules return `default` (false by
 * default, hiding the field rather than crashing the form). */
export function safeEvaluate(
  expression: string | null | undefined,
  context: unknown,
  defaultValue = false,
): boolean {
  if (!expression) return true; // no rule = always shown
  try {
    return evaluate(expression, context);
  } catch (e) {
    if (e instanceof ExpressionError) return defaultValue;
    throw e;
  }
}

const VAR_RE = /\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g;

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "?";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    // Trim trailing-zero on whole-number floats (12.0 -> "12") but keep
    // meaningful decimals as-is. Mirrors the Python `_format_value`.
    return String(v);
  }
  return String(v);
}

/** Substitute `{path}` placeholders against a context dict. Missing
 * keys render as `?` so the operator notices and fills the gap. */
export function interpolate(template: string, ctx: unknown): string {
  return template.replace(VAR_RE, (_match, path: string) =>
    formatValue(resolve(path.split("."), ctx)),
  );
}

/** Like `interpolate`, but also reports which `{path}` placeholders did
 * not resolve. Callers (smart-comment chips, checklist drafts) use this
 * to disable a suggestion until the operator fills the missing fields,
 * rather than offering a "Cleared after ? min." string for one-tap
 * insertion into the audit feed. */
export function interpolateWithMissing(
  template: string,
  ctx: unknown,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const seen = new Set<string>();
  const text = template.replace(VAR_RE, (_match, path: string) => {
    const resolved = resolve(path.split("."), ctx);
    if (resolved === null || resolved === undefined) {
      if (!seen.has(path)) {
        seen.add(path);
        missing.push(path);
      }
    }
    return formatValue(resolved);
  });
  return { text, missing };
}
