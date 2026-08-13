/**
 * A query-string parser (chapters 6, 11 and 12).
 *
 * The book shows queries as text — `title:kubernetes AND status:published`,
 * `kubernets~1`, `kube*`, `"kubernetes deployment"` — and then shows them as
 * execution trees. This turns the first into the second, so the labs can display
 * the text you typed next to the tree it became.
 *
 * Supported:
 *
 *   term                     bare term against the default fields
 *   field:term               term on one field
 *   "a b"                    phrase, `"a b"~2` for slop
 *   term~                    fuzzy with AUTO edits, `term~1` for a fixed number
 *   pref*  or  te?m          prefix and wildcard
 *   /regex/                  regular expression
 *   field:[100 TO 200]       inclusive range, `{ }` for exclusive
 *   field:>=100              open-ended range
 *   AND OR NOT  &&  ||  !    boolean operators
 *   +required  -excluded     clause modifiers
 *   term^2                   boost
 *   ( )                      grouping
 */

import { autoFuzziness } from "./term-dictionary";
import type { Query } from "./query";

export interface ParseError {
  message: string;
  position: number;
}

export interface ParseResult {
  query: Query;
  errors: ParseError[];
  /** The token stream, for showing how the text was read. */
  tokens: ParsedToken[];
}

export interface ParsedToken {
  type: "term" | "phrase" | "field" | "operator" | "modifier" | "paren" | "range" | "regex" | "boost" | "fuzzy";
  text: string;
  start: number;
  end: number;
}

export interface ParserOptions {
  /** Fields a bare term searches. More than one produces an OR. */
  defaultFields?: string[];
  /** `AND` or `OR` between adjacent clauses with no explicit operator. */
  defaultOperator?: "and" | "or";
  numericFields?: Set<string>;
}

const DEFAULT_NUMERIC = new Set(["price", "rating", "created_at"]);

interface Lexeme {
  kind: "word" | "quoted" | "regex" | "punct";
  value: string;
  start: number;
  end: number;
}

function lex(input: string): Lexeme[] {
  const out: Lexeme[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      const end = input.indexOf('"', i + 1);
      if (end === -1) {
        out.push({ kind: "quoted", value: input.slice(i + 1), start: i, end: input.length });
        i = input.length;
      } else {
        out.push({ kind: "quoted", value: input.slice(i + 1, end), start: i, end: end + 1 });
        i = end + 1;
      }
      continue;
    }
    if (ch === "/") {
      const end = input.indexOf("/", i + 1);
      if (end !== -1) {
        out.push({ kind: "regex", value: input.slice(i + 1, end), start: i, end: end + 1 });
        i = end + 1;
        continue;
      }
    }
    if ("():+-^~[]{}".includes(ch)) {
      // A leading `-` or `+` is a modifier; inside a word it is just a character.
      out.push({ kind: "punct", value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    let j = i;
    while (j < input.length && !/\s/.test(input[j]) && !"():+^~[]{}\"".includes(input[j])) {
      // `-` continues a word unless it starts one (handled above).
      j++;
    }
    if (j === i) j++;
    out.push({ kind: "word", value: input.slice(i, j), start: i, end: j });
    i = j;
  }
  return out;
}

export function parseQueryString(input: string, options: ParserOptions = {}): ParseResult {
  const defaultFields = options.defaultFields ?? ["title", "body"];
  const defaultOperator = options.defaultOperator ?? "or";
  const numericFields = options.numericFields ?? DEFAULT_NUMERIC;

  const lexemes = lex(input);
  const errors: ParseError[] = [];
  const tokens: ParsedToken[] = [];
  let pos = 0;

  const peek = (offset = 0): Lexeme | undefined => lexemes[pos + offset];
  const isPunct = (l: Lexeme | undefined, v: string) => l?.kind === "punct" && l.value === v;
  const isKeyword = (l: Lexeme | undefined, ...words: string[]) =>
    l?.kind === "word" && words.includes(l.value.toUpperCase());

  function fail(message: string, position: number) {
    errors.push({ message, position });
  }

  /** Wrap a query so a bare term hits every default field. */
  function overDefaultFields(build: (field: string) => Query): Query {
    if (defaultFields.length === 1) return build(defaultFields[0]);
    return { kind: "bool", should: defaultFields.map(build), minimumShouldMatch: 1 };
  }

  function parseRange(field: string, inclusive: boolean): Query | null {
    // We are positioned just after `[` or `{`.
    const open = inclusive ? "[" : "{";
    const close = inclusive ? "]" : "}";
    const startLexeme = lexemes[pos - 1];
    const lower = peek();
    if (!lower || lower.kind !== "word") {
      fail(`expected a lower bound after "${open}"`, startLexeme?.start ?? 0);
      return null;
    }
    pos++;
    if (!isKeyword(peek(), "TO")) {
      fail(`expected TO inside the range for "${field}"`, lower.start);
      return null;
    }
    pos++;
    const upper = peek();
    if (!upper || upper.kind !== "word") {
      fail(`expected an upper bound before "${close}"`, lower.start);
      return null;
    }
    pos++;
    if (isPunct(peek(), close)) pos++;
    else fail(`missing "${close}" to close the range`, lower.start);

    tokens.push({
      type: "range",
      text: `${open}${lower.value} TO ${upper.value}${close}`,
      start: startLexeme?.start ?? lower.start,
      end: upper.end + 1,
    });

    const isNumeric = numericFields.has(field);
    const toBound = (raw: string): number | string | undefined => {
      if (raw === "*") return undefined;
      if (!isNumeric) return raw;
      const n = Number(raw);
      return Number.isNaN(raw === "" ? NaN : n) ? raw : n;
    };

    const lo = toBound(lower.value);
    const hi = toBound(upper.value);
    return {
      kind: "range",
      field,
      ...(inclusive ? { gte: lo, lte: hi } : { gt: lo, lt: hi }),
    } as Query;
  }

  function parseComparison(field: string, word: Lexeme): Query | null {
    const match = /^(>=|<=|>|<)(.+)$/.exec(word.value);
    if (!match) return null;
    const [, op, rawValue] = match;
    const isNumeric = numericFields.has(field);
    const parsed = isNumeric ? Number(rawValue) : rawValue;
    if (isNumeric && Number.isNaN(parsed as number)) {
      fail(`"${rawValue}" is not a number`, word.start);
      return null;
    }
    tokens.push({ type: "range", text: `${field}${op}${rawValue}`, start: word.start, end: word.end });
    const key = op === ">=" ? "gte" : op === "<=" ? "lte" : op === ">" ? "gt" : "lt";
    return { kind: "range", field, [key]: parsed } as Query;
  }

  /** A single term/phrase/pattern, with its optional `~` and `^` suffixes. */
  function parseTermLike(field: string, explicitField: boolean): Query | null {
    const lexeme = peek();
    if (!lexeme) return null;

    if (lexeme.kind === "quoted") {
      pos++;
      tokens.push({ type: "phrase", text: `"${lexeme.value}"`, start: lexeme.start, end: lexeme.end });
      let slop = 0;
      if (isPunct(peek(), "~")) {
        pos++;
        const n = peek();
        if (n?.kind === "word" && /^\d+$/.test(n.value)) {
          slop = Number(n.value);
          tokens.push({ type: "fuzzy", text: `~${slop}`, start: n.start, end: n.end });
          pos++;
        } else {
          fail("phrase slop needs a number, as in \"a b\"~2", lexeme.end);
        }
      }
      const build = (f: string): Query => ({ kind: "phrase", field: f, text: lexeme.value, slop });
      return explicitField ? build(field) : overDefaultFields(build);
    }

    if (lexeme.kind === "regex") {
      pos++;
      tokens.push({ type: "regex", text: `/${lexeme.value}/`, start: lexeme.start, end: lexeme.end });
      const build = (f: string): Query => ({ kind: "regexp", field: f, pattern: lexeme.value });
      return explicitField ? build(field) : overDefaultFields(build);
    }

    if (isPunct(lexeme, "[") || isPunct(lexeme, "{")) {
      const inclusive = lexeme.value === "[";
      pos++;
      return parseRange(field, inclusive);
    }

    if (lexeme.kind !== "word") return null;

    const comparison = parseComparison(field, lexeme);
    if (comparison) {
      pos++;
      return comparison;
    }

    pos++;
    const raw = lexeme.value;

    // Fuzzy suffix.
    let fuzzyEdits: number | null = null;
    if (isPunct(peek(), "~")) {
      const tilde = peek()!;
      pos++;
      const n = peek();
      if (n?.kind === "word" && /^\d+$/.test(n.value)) {
        fuzzyEdits = Number(n.value);
        tokens.push({ type: "fuzzy", text: `~${n.value}`, start: tilde.start, end: n.end });
        pos++;
      } else {
        fuzzyEdits = autoFuzziness(raw);
        tokens.push({ type: "fuzzy", text: "~AUTO", start: tilde.start, end: tilde.end });
      }
    }

    tokens.push({ type: "term", text: raw, start: lexeme.start, end: lexeme.end });

    const build = (f: string): Query => {
      if (fuzzyEdits !== null) {
        return { kind: "fuzzy", field: f, value: raw.toLowerCase(), maxEdits: fuzzyEdits };
      }
      const hasStar = raw.includes("*");
      const hasQuestion = raw.includes("?");
      if (hasStar && !hasQuestion && raw.endsWith("*") && raw.indexOf("*") === raw.length - 1) {
        return { kind: "prefix", field: f, value: raw.slice(0, -1).toLowerCase() };
      }
      if (hasStar || hasQuestion) {
        return { kind: "wildcard", field: f, pattern: raw.toLowerCase() };
      }
      // Keyword fields are not analyzed, so a bare value is a `term` there and a
      // `match` on a text field. This is chapter 10's distinction, applied.
      const isText = f === "title" || f === "body";
      return isText
        ? { kind: "match", field: f, text: raw }
        : { kind: "term", field: f, value: raw };
    };

    return explicitField ? build(field) : overDefaultFields(build);
  }

  function parsePrimary(): Query | null {
    const lexeme = peek();
    if (!lexeme) return null;

    if (isPunct(lexeme, "(")) {
      tokens.push({ type: "paren", text: "(", start: lexeme.start, end: lexeme.end });
      pos++;
      const inner = parseOr();
      if (isPunct(peek(), ")")) {
        tokens.push({ type: "paren", text: ")", start: peek()!.start, end: peek()!.end });
        pos++;
      } else {
        fail("missing closing parenthesis", lexeme.start);
      }
      return inner;
    }

    // `field:` prefix?
    if (lexeme.kind === "word" && isPunct(peek(1), ":")) {
      const field = lexeme.value;
      tokens.push({ type: "field", text: `${field}:`, start: lexeme.start, end: lexeme.end + 1 });
      pos += 2;
      const inner = parseTermLike(field, true);
      if (!inner) {
        fail(`nothing to search for on field "${field}"`, lexeme.start);
        return null;
      }
      return inner;
    }

    return parseTermLike(defaultFields[0], false);
  }

  function parseModified(): Query | null {
    const lexeme = peek();
    let required = false;
    let prohibited = false;

    while (isPunct(peek(), "+") || isPunct(peek(), "-") || isKeyword(peek(), "NOT", "!")) {
      const l = peek()!;
      if (isPunct(l, "+")) required = true;
      else prohibited = true;
      tokens.push({ type: "modifier", text: l.value, start: l.start, end: l.end });
      pos++;
    }

    const inner = parsePrimary();
    if (!inner) {
      if (required || prohibited) fail("a modifier must be followed by something to match", lexeme?.start ?? 0);
      return null;
    }

    let result = inner;
    if (prohibited) result = { kind: "bool", must_not: [inner] };
    else if (required) result = { kind: "bool", must: [inner] };

    // Boost suffix.
    if (isPunct(peek(), "^")) {
      const caret = peek()!;
      pos++;
      const n = peek();
      if (n?.kind === "word" && /^\d+(\.\d+)?$/.test(n.value)) {
        tokens.push({ type: "boost", text: `^${n.value}`, start: caret.start, end: n.end });
        pos++;
        result = { ...result, boost: Number(n.value) } as Query;
      } else {
        fail("^ must be followed by a number", caret.start);
      }
    }
    return result;
  }

  function parseAnd(): Query | null {
    const clauses: Query[] = [];
    const first = parseModified();
    if (!first) return null;
    clauses.push(first);

    for (;;) {
      const l = peek();
      if (!l) break;
      if (isKeyword(l, "AND", "&&")) {
        tokens.push({ type: "operator", text: l.value.toUpperCase(), start: l.start, end: l.end });
        pos++;
        const next = parseModified();
        if (!next) {
          fail("AND needs a clause on both sides", l.start);
          break;
        }
        clauses.push(next);
        continue;
      }
      if (isKeyword(l, "OR", "||") || isPunct(l, ")")) break;
      // Adjacent clauses with no operator use the default operator.
      if (defaultOperator === "and") {
        const next = parseModified();
        if (!next) break;
        clauses.push(next);
        continue;
      }
      break;
    }

    if (clauses.length === 1) return clauses[0];
    return { kind: "bool", must: clauses };
  }

  function parseOr(): Query | null {
    const clauses: Query[] = [];
    const first = parseAnd();
    if (!first) return null;
    clauses.push(first);

    for (;;) {
      const l = peek();
      if (!l) break;
      if (isKeyword(l, "OR", "||")) {
        tokens.push({ type: "operator", text: "OR", start: l.start, end: l.end });
        pos++;
        const next = parseAnd();
        if (!next) {
          fail("OR needs a clause on both sides", l.start);
          break;
        }
        clauses.push(next);
        continue;
      }
      if (isPunct(l, ")")) break;
      if (defaultOperator === "or") {
        const next = parseAnd();
        if (!next) break;
        clauses.push(next);
        continue;
      }
      break;
    }

    if (clauses.length === 1) return clauses[0];
    return { kind: "bool", should: clauses, minimumShouldMatch: 1 };
  }

  if (input.trim() === "") {
    return { query: { kind: "match_all" }, errors: [], tokens: [] };
  }

  const parsed = parseOr();

  if (pos < lexemes.length) {
    const leftover = lexemes[pos];
    fail(`could not read "${leftover.value}"`, leftover.start);
  }

  return {
    query: parsed ?? { kind: "match_none" },
    errors,
    tokens: tokens.sort((a, b) => a.start - b.start),
  };
}

export const EXAMPLE_QUERIES: { label: string; query: string; teaches: string }[] = [
  { label: "One term", query: "kubernetes", teaches: "One dictionary lookup, one postings list." },
  { label: "Two terms (OR)", query: "kubernetes deployment", teaches: "Union of postings, scores add up per document." },
  { label: "Explicit AND", query: "kubernetes AND deployment", teaches: "Leapfrog intersection — watch the advance count." },
  { label: "Field-scoped", query: "title:kubernetes AND status:published", teaches: "A text field and a keyword field behave differently." },
  { label: "Phrase", query: '"kubernetes deployment"', teaches: "Positions decide this, not just membership." },
  { label: "Sloppy phrase", query: '"kubernetes service"~3', teaches: "Slop allows distance between the words." },
  { label: "Prefix", query: "kube*", teaches: "Vocabulary traversal, then a term per match." },
  { label: "Wildcard", query: "deploy*ent", teaches: "The literal prefix still narrows the scan." },
  { label: "Fuzzy", query: "kubernets~1", teaches: "The misspelled document becomes findable." },
  { label: "Range", query: "price:[100 TO 200]", teaches: "A point index, not a term lookup." },
  { label: "Exclusion", query: "kubernetes -status:draft", teaches: "must_not skips documents after matching." },
  { label: "Boost", query: "title:kubernetes^3 body:kubernetes", teaches: "The same term, weighted differently per field." },
  { label: "Grouped", query: "(redis OR kafka) AND status:published", teaches: "Grouping changes the execution tree." },
  { label: "Missing term", query: "terraform AND kubernetes", teaches: "One clause with no postings empties the whole AND." },
];
