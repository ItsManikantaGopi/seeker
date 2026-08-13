/**
 * Levenshtein automata (chapter 14).
 *
 * The brute force in chapter 13 asks "what is the distance between these two
 * known strings?" — once per term in the vocabulary. The automaton asks a
 * different question:
 *
 *   > build a recognizer for every string within N edits of the query
 *
 * and then runs the term dictionary through it. The automaton does not generate
 * words; it accepts or rejects them. The dictionary supplies the actual terms.
 *
 * ## The NFA
 *
 * A state is "I have consumed `i` characters of the query using `e` edits".
 * Reading one character of the candidate term, from state (i, e):
 *
 *   match        query[i] === ch          -> (i+1, e)     free
 *   substitute   query[i] !== ch          -> (i+1, e+1)
 *   insert       the term has a spare char -> (i,   e+1)
 *   delete       (consumes no input)      -> (i+1, e+1)   epsilon
 *
 * Damerau's adjacent transposition needs one extra state kind, `T(i, e)`:
 * "I have read query[i+1] out of order and still owe a match of query[i]".
 *
 * We determinize eagerly over a deliberately tiny alphabet: the distinct
 * characters of the query plus one sentinel meaning "any other character",
 * because every character absent from the query behaves identically.
 *
 * Note there is no subsumption pruning here. It is a real optimisation, but the
 * obvious form of it silently deletes epsilon-successors that later transitions
 * need, and a fuzzy matcher that quietly loses terms is worse than a slightly
 * larger DFA. Chapter 42's rule applies: be correct against the oracle first.
 */

/**
 * Sentinel for "any character that does not appear in the query". A NUL byte
 * can never occur in a real indexed term, so it cannot collide with the query.
 */
export const ANY_OTHER = String.fromCharCode(0);

export type NfaKind = "n" | "t";

export interface NfaState {
  kind: NfaKind;
  /** Characters of the query consumed so far. */
  i: number;
  /** Edits used so far. */
  e: number;
}

export interface DfaState {
  id: number;
  /** The NFA states this DFA state represents. */
  nfa: NfaState[];
  label: string;
  accepting: boolean;
  /** Fewest edits used by any live NFA state: a lower bound on the distance. */
  minEdits: number;
  /** char (or ANY_OTHER) -> destination state id. A missing key means dead. */
  transitions: Map<string, number>;
}

export interface LevenshteinAutomaton {
  query: string;
  maxEdits: number;
  transpositions: boolean;
  /** Query characters, then the ANY_OTHER sentinel last. */
  alphabet: string[];
  states: DfaState[];
  start: number;
  size: number;
  /** Follow one character. Returns DEAD_STATE when the term cannot match. */
  step(stateId: number, ch: string): number;
  accepts(term: string): boolean;
  isDead(stateId: number): boolean;
  /** Walk a term and return the state trail, for visualisation. */
  trace(term: string): { ch: string; from: number; to: number; symbol: string }[];
}

export const DEAD_STATE = -1;

function stateKey(s: NfaState): string {
  return `${s.kind}${s.i}:${s.e}`;
}

function setKey(states: NfaState[]): string {
  return states.map(stateKey).join(",");
}

function labelOf(states: NfaState[]): string {
  if (states.length === 0) return "∅";
  return states
    .map((s) => (s.kind === "n" ? `${s.i}^${s.e}` : `T${s.i}^${s.e}`))
    .join(" ");
}

function dedupe(states: NfaState[]): NfaState[] {
  const seen = new Set<string>();
  const out: NfaState[] = [];
  for (const s of states) {
    const k = stateKey(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out.sort((a, b) => a.i - b.i || a.e - b.e || a.kind.localeCompare(b.kind));
}

export function buildLevenshteinAutomaton(
  query: string,
  maxEdits: number,
  options: { transpositions?: boolean } = {},
): LevenshteinAutomaton {
  const transpositions = options.transpositions ?? false;
  const n = query.length;

  const querySet = new Set<string>(query.split(""));
  const alphabet = [...querySet].sort();
  alphabet.push(ANY_OTHER);

  /** Follow epsilon (deletion) moves: consume a query char, no input char. */
  function closure(states: NfaState[]): NfaState[] {
    const out: NfaState[] = [];
    const seen = new Set<string>();
    const stack = [...states];
    while (stack.length) {
      const s = stack.pop()!;
      const k = stateKey(s);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
      if (s.kind === "n" && s.e < maxEdits && s.i < n) {
        stack.push({ kind: "n", i: s.i + 1, e: s.e + 1 });
      }
    }
    return dedupe(out);
  }

  function move(states: NfaState[], ch: string): NfaState[] {
    const isRealChar = ch !== ANY_OTHER;
    const out: NfaState[] = [];
    for (const s of states) {
      if (s.kind === "t") {
        // Mid-transposition: the next character must be the one we skipped.
        if (isRealChar && s.i < n && query[s.i] === ch) {
          out.push({ kind: "n", i: s.i + 2, e: s.e });
        }
        continue;
      }
      const matches = isRealChar && s.i < n && query[s.i] === ch;
      if (matches) out.push({ kind: "n", i: s.i + 1, e: s.e });
      if (s.e < maxEdits) {
        if (s.i < n && !matches) out.push({ kind: "n", i: s.i + 1, e: s.e + 1 }); // substitute
        out.push({ kind: "n", i: s.i, e: s.e + 1 }); // extra character in the term
        if (transpositions && isRealChar && s.i + 1 < n && query[s.i + 1] === ch) {
          out.push({ kind: "t", i: s.i, e: s.e + 1 });
        }
      }
    }
    return closure(out);
  }

  /** Accept when whatever is left of the query fits in the remaining budget. */
  function isAccepting(states: NfaState[]): boolean {
    return states.some((s) => s.kind === "n" && n - s.i <= maxEdits - s.e);
  }

  const states: DfaState[] = [];
  const byKey = new Map<string, number>();

  function intern(nfa: NfaState[]): number {
    if (nfa.length === 0) return DEAD_STATE;
    const k = setKey(nfa);
    const existing = byKey.get(k);
    if (existing !== undefined) return existing;
    const id = states.length;
    byKey.set(k, id);
    states.push({
      id,
      nfa,
      label: labelOf(nfa),
      accepting: isAccepting(nfa),
      minEdits: Math.min(...nfa.map((s) => s.e)),
      transitions: new Map(),
    });
    return id;
  }

  const start = intern(closure([{ kind: "n", i: 0, e: 0 }]));

  const seen = new Set<number>([start]);
  const queue: number[] = [start];
  while (queue.length) {
    const id = queue.shift()!;
    const state = states[id];
    for (const ch of alphabet) {
      const destId = intern(move(state.nfa, ch));
      if (destId === DEAD_STATE) continue;
      state.transitions.set(ch, destId);
      if (!seen.has(destId)) {
        seen.add(destId);
        queue.push(destId);
      }
    }
  }

  const automaton: LevenshteinAutomaton = {
    query,
    maxEdits,
    transpositions,
    alphabet,
    states,
    start,
    size: states.length,
    step(stateId: number, ch: string): number {
      if (stateId === DEAD_STATE) return DEAD_STATE;
      const state = states[stateId];
      const symbol = querySet.has(ch) ? ch : ANY_OTHER;
      const dest = state.transitions.get(symbol);
      return dest === undefined ? DEAD_STATE : dest;
    },
    accepts(term: string): boolean {
      let s = start;
      for (const ch of term) {
        s = automaton.step(s, ch);
        if (s === DEAD_STATE) return false;
      }
      return states[s].accepting;
    },
    isDead(stateId: number): boolean {
      return stateId === DEAD_STATE;
    },
    trace(term: string) {
      const trail: { ch: string; from: number; to: number; symbol: string }[] = [];
      let s = start;
      for (const ch of term) {
        const symbol = querySet.has(ch) ? ch : ANY_OTHER;
        const to = automaton.step(s, ch);
        trail.push({ ch, from: s, to, symbol });
        s = to;
        if (s === DEAD_STATE) break;
      }
      return trail;
    },
  };
  return automaton;
}

export interface AutomatonScanResult {
  terms: string[];
  /** DFA transitions actually followed. */
  transitions: number;
  termsTouched: number;
  /** Characters examined. Compare against brute force's comparison count. */
  charComparisons: number;
  /** Terms abandoned before their last character, thanks to a dead state. */
  earlyExits: number;
}

/**
 * Run every term through the automaton. Still linear in the vocabulary — that is
 * what chapters 16 to 19 fix — but each term costs a single pass with no table,
 * and most terms die on their first or second character.
 */
export function scanWithAutomaton(
  automaton: LevenshteinAutomaton,
  vocabulary: string[],
): AutomatonScanResult {
  const terms: string[] = [];
  let transitions = 0;
  let charComparisons = 0;
  let earlyExits = 0;

  for (const term of vocabulary) {
    let s = automaton.start;
    let dead = false;
    let consumed = 0;
    for (const ch of term) {
      transitions++;
      charComparisons++;
      consumed++;
      s = automaton.step(s, ch);
      if (automaton.isDead(s)) {
        dead = true;
        break;
      }
    }
    if (dead) {
      if (consumed < term.length) earlyExits++;
      continue;
    }
    if (automaton.states[s].accepting) terms.push(term);
  }
  return {
    terms,
    transitions,
    termsTouched: vocabulary.length,
    charComparisons,
    earlyExits,
  };
}

/**
 * Prefix constraint (chapter 15). `prefix_length = 3` means the first three
 * characters must match exactly, so we only build an automaton for the tail.
 */
export interface FuzzyPlan {
  fixedPrefix: string;
  automaton: LevenshteinAutomaton;
  maxEdits: number;
  prefixLength: number;
}

export function planFuzzy(
  query: string,
  maxEdits: number,
  options: { prefixLength?: number; transpositions?: boolean } = {},
): FuzzyPlan {
  const prefixLength = Math.min(options.prefixLength ?? 0, query.length);
  const fixedPrefix = query.slice(0, prefixLength);
  return {
    fixedPrefix,
    prefixLength,
    maxEdits,
    automaton: buildLevenshteinAutomaton(query.slice(prefixLength), maxEdits, {
      transpositions: options.transpositions,
    }),
  };
}

export function planAccepts(plan: FuzzyPlan, term: string): boolean {
  if (!term.startsWith(plan.fixedPrefix)) return false;
  return plan.automaton.accepts(term.slice(plan.prefixLength));
}
