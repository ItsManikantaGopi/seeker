/**
 * Finite-state transducers (chapter 18 and appendix B).
 *
 * An automaton answers `input -> accept/reject`. A transducer answers
 * `input -> output`. That one change is what lets a term dictionary say
 * "`kubernetes` lives in block 42 at file offset 981234" instead of merely
 * "`kubernetes` exists".
 *
 * This is the direct incremental construction (Mihov/Daciuk, the same shape
 * Lucene uses): feed sorted keys, keep an uncompiled path for the current key,
 * and freeze states as soon as the input moves past them. Because we freeze
 * bottom-up, "are these two states equivalent?" reduces to comparing a signature
 * string over already-assigned ids.
 *
 * Outputs live in the min-sum semiring: the shared output of a state's arcs is
 * pushed as far towards the root as possible, and the remainder travels onward.
 * That is why a lookup *accumulates* its output along the path instead of
 * finding it in one place.
 */

export interface FstArc {
  label: string;
  target: FstStateNode;
  output: number;
}

export class FstStateNode {
  id = -1;
  isFinal = false;
  finalOutput = 0;
  arcs: FstArc[] = [];

  clear(): void {
    this.id = -1;
    this.isFinal = false;
    this.finalOutput = 0;
    this.arcs = [];
  }

  lastArc(): FstArc | undefined {
    return this.arcs[this.arcs.length - 1];
  }

  arc(label: string): FstArc | undefined {
    return this.arcs.find((a) => a.label === label);
  }

  setTransition(label: string, target: FstStateNode): void {
    const existing = this.arc(label);
    if (existing) existing.target = target;
    else this.arcs.push({ label, target, output: 0 });
  }

  setOutput(label: string, output: number): void {
    const existing = this.arc(label);
    if (existing) existing.output = output;
  }

  /** Future behaviour, as a string. Targets are already frozen, so ids suffice. */
  signature(): string {
    const arcs = this.arcs.map((a) => `${a.label}:${a.target.id}:${a.output}`).join(",");
    return `${this.isFinal ? `F${this.finalOutput}` : "-"}|${arcs}`;
  }
}

export interface FstBuildStats {
  keys: number;
  states: number;
  arcs: number;
  /** States that were reused instead of created, i.e. suffix sharing at work. */
  statesReused: number;
  /** Rough byte estimate, comparable with `Trie.estimateBytes`. */
  estimatedBytes: number;
}

export interface Fst {
  start: FstStateNode;
  states: FstStateNode[];
  stats: FstBuildStats;
  /** Total output for a key, or null when the key is not in the FST. */
  get(key: string): number | null;
  /** Walk a key and report every arc taken — the accumulation, step by step. */
  trace(key: string): {
    steps: { label: string; fromState: number; toState: number; arcOutput: number; running: number }[];
    found: boolean;
    output: number | null;
  };
  /** Enumerate keys under a prefix, in sorted order. */
  prefixKeys(prefix: string, limit?: number): { key: string; output: number }[];
  keys(limit?: number): { key: string; output: number }[];
  /** Reach the state for a prefix, for automaton intersection and block lookup. */
  seekPrefix(prefix: string): { state: FstStateNode | null; output: number; steps: number };
}

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/**
 * Build a minimal FST from **sorted, unique** keys.
 * Outputs must be non-negative (min-sum pushing assumes it).
 */
export function buildFst(entries: { key: string; output: number }[]): Fst {
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].key <= entries[i - 1].key) {
      throw new Error(
        `buildFst requires sorted unique keys; "${entries[i - 1].key}" then "${entries[i].key}"`,
      );
    }
  }

  const frozen = new Map<string, FstStateNode>();
  const frozenList: FstStateNode[] = [];
  let statesReused = 0;

  const maxKeyLength = entries.reduce((m, e) => Math.max(m, e.key.length), 0);
  // tempStates[i] is the state reached after reading i characters of the
  // current key. It stays mutable until the input moves past it.
  const tempStates: FstStateNode[] = Array.from(
    { length: maxKeyLength + 1 },
    () => new FstStateNode(),
  );

  function freeze(state: FstStateNode): FstStateNode {
    const signature = state.signature();
    const existing = frozen.get(signature);
    if (existing) {
      statesReused++;
      return existing;
    }
    const compiled = new FstStateNode();
    compiled.id = frozenList.length;
    compiled.isFinal = state.isFinal;
    compiled.finalOutput = state.finalOutput;
    compiled.arcs = state.arcs.map((a) => ({ ...a }));
    frozen.set(signature, compiled);
    frozenList.push(compiled);
    return compiled;
  }

  let previousKey = "";

  for (const { key, output } of entries) {
    const prefixLen = commonPrefixLength(previousKey, key);

    // 1. Freeze the part of the previous key that this key has moved past.
    for (let i = previousKey.length; i > prefixLen; i--) {
      tempStates[i - 1].setTransition(previousKey[i - 1], freeze(tempStates[i]));
    }

    // 2. Open fresh states for the new suffix.
    for (let i = prefixLen + 1; i <= key.length; i++) {
      tempStates[i].clear();
      tempStates[i - 1].setTransition(key[i - 1], tempStates[i]);
    }
    tempStates[key.length].isFinal = true;

    // 3. Push the output as far towards the root as the shared path allows.
    let remaining = output;
    for (let i = 1; i <= prefixLen; i++) {
      const state = tempStates[i - 1];
      const arc = state.arc(key[i - 1])!;
      const common = Math.min(arc.output, remaining);
      const pushForward = arc.output - common;
      arc.output = common;
      if (pushForward !== 0) {
        // Everything below this arc must absorb what we just took off it.
        const child = tempStates[i];
        for (const a of child.arcs) a.output += pushForward;
        if (child.isFinal) child.finalOutput += pushForward;
      }
      remaining -= common;
    }

    if (key.length === prefixLen) {
      // The previous key is a prefix of this one and both are keys.
      tempStates[key.length].finalOutput = remaining;
    } else {
      tempStates[prefixLen].setOutput(key[prefixLen], remaining);
    }

    previousKey = key;
  }

  // 4. Freeze whatever is left of the final key.
  for (let i = previousKey.length; i > 0; i--) {
    tempStates[i - 1].setTransition(previousKey[i - 1], freeze(tempStates[i]));
  }
  const start = freeze(tempStates[0]);

  let arcCount = 0;
  for (const s of frozenList) arcCount += s.arcs.length;

  // An arc in a byte-oriented FST is roughly a label byte, a vint target and a
  // vint output. States are implicit in the byte array, hence no per-node cost.
  const estimatedBytes = arcCount * 5;

  const fst: Fst = {
    start,
    states: frozenList,
    stats: {
      keys: entries.length,
      states: frozenList.length,
      arcs: arcCount,
      statesReused,
      estimatedBytes,
    },
    get(key: string): number | null {
      let state = start;
      let total = 0;
      for (const ch of key) {
        const arc = state.arc(ch);
        if (!arc) return null;
        total += arc.output;
        state = arc.target;
      }
      return state.isFinal ? total + state.finalOutput : null;
    },
    trace(key: string) {
      const steps: {
        label: string; fromState: number; toState: number; arcOutput: number; running: number;
      }[] = [];
      let state = start;
      let running = 0;
      for (const ch of key) {
        const arc = state.arc(ch);
        if (!arc) return { steps, found: false, output: null };
        running += arc.output;
        steps.push({
          label: ch,
          fromState: state.id,
          toState: arc.target.id,
          arcOutput: arc.output,
          running,
        });
        state = arc.target;
      }
      if (!state.isFinal) return { steps, found: false, output: null };
      return { steps, found: true, output: running + state.finalOutput };
    },
    seekPrefix(prefix: string): { state: FstStateNode | null; output: number; steps: number } {
      let state: FstStateNode = start;
      let output = 0;
      let steps = 0;
      for (const ch of prefix) {
        steps++;
        const nextArc: FstArc | undefined = state.arc(ch);
        if (!nextArc) return { state: null, output: 0, steps };
        output += nextArc.output;
        state = nextArc.target;
      }
      return { state, output, steps };
    },
    prefixKeys(prefix: string, limit = Infinity) {
      const { state, output } = fst.seekPrefix(prefix);
      if (!state) return [];
      const out: { key: string; output: number }[] = [];
      const visit = (node: FstStateNode, acc: string, running: number) => {
        if (out.length >= limit) return;
        if (node.isFinal) out.push({ key: acc, output: running + node.finalOutput });
        for (const arc of [...node.arcs].sort((a, b) => a.label.localeCompare(b.label))) {
          if (out.length >= limit) return;
          visit(arc.target, acc + arc.label, running + arc.output);
        }
      };
      visit(state, prefix, output);
      return out;
    },
    keys(limit = Infinity) {
      return fst.prefixKeys("", limit);
    },
  };
  return fst;
}

/** Build an FST whose output is the term's ordinal — the simplest useful output. */
export function buildOrdinalFst(sortedTerms: string[]): Fst {
  return buildFst(sortedTerms.map((key, i) => ({ key, output: i })));
}

export interface FstGraph {
  nodes: { id: number; final: boolean; finalOutput: number }[];
  edges: { from: number; to: number; label: string; output: number }[];
  /** Layout hint: shortest distance from the start state. */
  depth: Map<number, number>;
}

export function fstToGraph(fst: Fst): FstGraph {
  const nodes = fst.states.map((s) => ({
    id: s.id,
    final: s.isFinal,
    finalOutput: s.finalOutput,
  }));
  const edges: FstGraph["edges"] = [];
  for (const s of fst.states) {
    for (const a of s.arcs) {
      edges.push({ from: s.id, to: a.target.id, label: a.label, output: a.output });
    }
  }
  const depth = new Map<number, number>([[fst.start.id, 0]]);
  const queue = [fst.start];
  while (queue.length) {
    const s = queue.shift()!;
    const d = depth.get(s.id)!;
    for (const a of s.arcs) {
      if (!depth.has(a.target.id)) {
        depth.set(a.target.id, d + 1);
        queue.push(a.target);
      }
    }
  }
  return { nodes, edges, depth };
}

/** Chapter 15 again, this time over the FST rather than the trie. */
export function intersectFstWithAutomaton(
  fst: Fst,
  automaton: { start: number; step(state: number, ch: string): number; isDead(s: number): boolean; states: { accepting: boolean }[] },
  limit = Infinity,
): { terms: { term: string; output: number }[]; arcsFollowed: number; arcsPruned: number } {
  const terms: { term: string; output: number }[] = [];
  let arcsFollowed = 0;
  let arcsPruned = 0;

  const visit = (node: FstStateNode, state: number, acc: string, running: number) => {
    if (terms.length >= limit) return;
    if (node.isFinal && automaton.states[state].accepting) {
      terms.push({ term: acc, output: running + node.finalOutput });
    }
    for (const arc of [...node.arcs].sort((a, b) => a.label.localeCompare(b.label))) {
      if (terms.length >= limit) return;
      const next = automaton.step(state, arc.label);
      if (automaton.isDead(next)) {
        arcsPruned++;
        continue;
      }
      arcsFollowed++;
      visit(arc.target, next, acc + arc.label, running + arc.output);
    }
  };

  visit(fst.start, automaton.start, "", 0);
  return { terms, arcsFollowed, arcsPruned };
}
