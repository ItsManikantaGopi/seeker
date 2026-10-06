/**
 * Scripted scoring (chapter 30).
 *
 * Painless is a real language; this is a small arithmetic expression evaluator
 * with the same job: take the base relevance score and the document's stored
 * values, and apply business logic on top.
 *
 * It is a hand-written Pratt parser rather than `eval`, for the obvious reason —
 * a search engine that runs arbitrary user code in its scoring loop has invented
 * a remote code execution feature, not a ranking feature. Painless is called
 * Painless because it is a *restricted* language.
 */

export interface ScriptVariables {
  _score: number;
  price: number;
  rating: number;
  created_at: number;
  lat: number;
  lon: number;
  [key: string]: number;
}

type Node =
  | { kind: "number"; value: number }
  | { kind: "variable"; name: string }
  | { kind: "unary"; op: "-"; operand: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "call"; name: string; args: Node[] }
  | { kind: "conditional"; test: Node; consequent: Node; alternate: Node };

export interface CompiledScript {
  source: string;
  /** Set when the script failed to parse. `evaluate` then returns the base score. */
  error: string | null;
  /** Variables the script reads, for the "what does this script touch" display. */
  variables: string[];
  evaluate(vars: ScriptVariables): number;
  /** A readable form of the parsed tree. */
  describe(): string;
}

const FUNCTIONS: Record<string, { arity: number; fn: (...args: number[]) => number }> = {
  min: { arity: 2, fn: (a, b) => Math.min(a, b) },
  max: { arity: 2, fn: (a, b) => Math.max(a, b) },
  log: { arity: 1, fn: (a) => (a > 0 ? Math.log(a) : 0) },
  log1p: { arity: 1, fn: (a) => (a > -1 ? Math.log1p(a) : 0) },
  sqrt: { arity: 1, fn: (a) => (a >= 0 ? Math.sqrt(a) : 0) },
  abs: { arity: 1, fn: Math.abs },
  pow: { arity: 2, fn: (a, b) => a ** b },
  round: { arity: 1, fn: Math.round },
  floor: { arity: 1, fn: Math.floor },
  ceil: { arity: 1, fn: Math.ceil },
};

export const SCRIPT_FUNCTIONS = Object.keys(FUNCTIONS);
export const SCRIPT_VARIABLES = ["_score", "rating", "price", "created_at", "lat", "lon"];

type Token =
  | { type: "number"; value: number }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: string }
  | { type: "eof" };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const OPERATORS = [
    "&&", "||", "<=", ">=", "==", "!=", "+", "-", "*", "/", "%", "(", ")",
    ",", "<", ">", "?", ":",
  ];

  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      let j = i;
      while (j < source.length && /[0-9.]/.test(source[j])) j++;
      const text = source.slice(i, j);
      const value = Number(text);
      if (Number.isNaN(value)) throw new Error(`bad number "${text}"`);
      tokens.push({ type: "number", value });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_.]/.test(source[j])) j++;
      // Accept `doc['rating'].value`-ish paths by keeping the last segment.
      const raw = source.slice(i, j);
      tokens.push({ type: "identifier", value: raw });
      i = j;
      continue;
    }
    const op = OPERATORS.find((o) => source.startsWith(o, i));
    if (!op) throw new Error(`unexpected character "${ch}" at ${i}`);
    tokens.push({ type: "operator", value: op });
    i += op.length;
  }
  tokens.push({ type: "eof" });
  return tokens;
}

const BINARY_PRECEDENCE: Record<string, number> = {
  "||": 1, "&&": 2,
  "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6, "%": 6,
};

function parse(source: string): { node: Node; variables: string[] } {
  const tokens = tokenize(source);
  let pos = 0;
  const variables = new Set<string>();

  const peek = (): Token => tokens[pos];
  const next = (): Token => tokens[pos++];

  function expectOperator(value: string) {
    const token = next();
    if (token.type !== "operator" || token.value !== value) {
      throw new Error(`expected "${value}"`);
    }
  }

  function parsePrimary(): Node {
    const token = next();
    if (token.type === "number") return { kind: "number", value: token.value };

    if (token.type === "identifier") {
      const name = token.value;
      if (peek().type === "operator" && (peek() as { value: string }).value === "(") {
        const fn = FUNCTIONS[name];
        if (!fn) throw new Error(`unknown function "${name}"`);
        expectOperator("(");
        const args: Node[] = [];
        if (!(peek().type === "operator" && (peek() as { value: string }).value === ")")) {
          for (;;) {
            args.push(parseExpression(0));
            const t = peek();
            if (t.type === "operator" && t.value === ",") {
              next();
              continue;
            }
            break;
          }
        }
        expectOperator(")");
        if (args.length !== fn.arity) {
          throw new Error(`${name}() takes ${fn.arity} argument(s), got ${args.length}`);
        }
        return { kind: "call", name, args };
      }
      // `doc['rating'].value` style paths reduce to their field name.
      const simple = name.split(".").filter((p) => p !== "value" && p !== "doc").pop() ?? name;
      variables.add(simple);
      return { kind: "variable", name: simple };
    }

    if (token.type === "operator") {
      if (token.value === "(") {
        const inner = parseExpression(0);
        expectOperator(")");
        return inner;
      }
      if (token.value === "-") return { kind: "unary", op: "-", operand: parsePrimary() };
      if (token.value === "+") return parsePrimary();
    }
    throw new Error("unexpected end of expression");
  }

  function parseExpression(minPrecedence: number): Node {
    let left = parsePrimary();
    for (;;) {
      const token = peek();
      if (token.type !== "operator") break;

      if (token.value === "?" && minPrecedence === 0) {
        next();
        const consequent = parseExpression(0);
        expectOperator(":");
        const alternate = parseExpression(0);
        left = { kind: "conditional", test: left, consequent, alternate };
        continue;
      }

      const precedence = BINARY_PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minPrecedence) break;
      next();
      const right = parseExpression(precedence + 1);
      left = { kind: "binary", op: token.value, left, right };
    }
    return left;
  }

  const node = parseExpression(0);
  if (peek().type !== "eof") throw new Error("trailing input after the expression");
  return { node, variables: [...variables] };
}

function evaluateNode(node: Node, vars: ScriptVariables): number {
  switch (node.kind) {
    case "number":
      return node.value;
    case "variable": {
      const value = vars[node.name];
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    }
    case "unary":
      return -evaluateNode(node.operand, vars);
    case "call":
      return FUNCTIONS[node.name].fn(...node.args.map((a) => evaluateNode(a, vars)));
    case "conditional":
      return evaluateNode(node.test, vars) !== 0
        ? evaluateNode(node.consequent, vars)
        : evaluateNode(node.alternate, vars);
    case "binary": {
      const l = evaluateNode(node.left, vars);
      const r = evaluateNode(node.right, vars);
      switch (node.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/": return r === 0 ? 0 : l / r;
        case "%": return r === 0 ? 0 : l % r;
        case "<": return l < r ? 1 : 0;
        case "<=": return l <= r ? 1 : 0;
        case ">": return l > r ? 1 : 0;
        case ">=": return l >= r ? 1 : 0;
        case "==": return l === r ? 1 : 0;
        case "!=": return l !== r ? 1 : 0;
        case "&&": return l !== 0 && r !== 0 ? 1 : 0;
        case "||": return l !== 0 || r !== 0 ? 1 : 0;
        default: return 0;
      }
    }
  }
}

function describeNode(node: Node): string {
  switch (node.kind) {
    case "number": return String(node.value);
    case "variable": return node.name;
    case "unary": return `-${describeNode(node.operand)}`;
    case "call": return `${node.name}(${node.args.map(describeNode).join(", ")})`;
    case "binary": return `(${describeNode(node.left)} ${node.op} ${describeNode(node.right)})`;
    case "conditional":
      return `(${describeNode(node.test)} ? ${describeNode(node.consequent)} : ${describeNode(node.alternate)})`;
  }
}

export function compileScript(source: string): CompiledScript {
  try {
    const { node, variables } = parse(source);
    return {
      source,
      error: null,
      variables,
      evaluate: (vars) => {
        const value = evaluateNode(node, vars);
        return Number.isFinite(value) ? value : 0;
      },
      describe: () => describeNode(node),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      source,
      error: message,
      variables: [],
      // A broken script must not silently zero every score.
      evaluate: (vars) => vars._score,
      describe: () => `invalid: ${message}`,
    };
  }
}

export const SCRIPT_EXAMPLES: { label: string; script: string; why: string }[] = [
  {
    label: "Relevance only",
    script: "_score",
    why: "The baseline. Whatever BM25 said, unchanged.",
  },
  {
    label: "Boost well-rated documents",
    script: "_score * (1 + rating / 5)",
    why: "A gentle multiplier. A 5-star document gets at most twice the score of an unrated one.",
  },
  {
    label: "Free content first",
    script: "price == 0 ? _score * 2 : _score",
    why: "A business rule expressed as a branch. Cheap to evaluate, easy to explain to a stakeholder.",
  },
  {
    label: "Dampen expensive items",
    script: "_score / (1 + log1p(price))",
    why: "Logarithmic damping, so a £300 document is penalised but not erased.",
  },
  {
    label: "Recency blend",
    script: "_score + rating / 10 + created_at / 200000",
    why: "Additive signals. Watch how easily an additive term overwhelms relevance.",
  },
  {
    label: "Ignore relevance entirely",
    script: "rating",
    why: "Sorting by rating with extra steps. If this is what you want, sort by rating — it is cheaper.",
  },
];
