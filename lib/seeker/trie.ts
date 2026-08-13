/**
 * Tries and minimized automata (chapters 16 and 17).
 *
 * A trie shares prefixes: `ca` is stored once for `car`, `cat` and `can`. That
 * is the whole idea, and it is already enough to make prefix enumeration and
 * automaton intersection possible.
 *
 * What a trie does *not* do is share suffixes. `car` and `bar` both end in
 * `r -> END`, and a plain trie stores that ending twice. Chapter 17's minimized
 * automaton fixes exactly that, and the node counts in `minimize()` are the
 * argument for why the FST in chapter 18 is worth the extra machinery.
 */

import type { LevenshteinAutomaton } from "./levenshtein-automaton";

export interface TrieNode {
  id: number;
  /** The character on the edge that leads *into* this node. "" for the root. */
  char: string;
  children: Map<string, TrieNode>;
  terminal: boolean;
  /** Optional payload — the FST chapter turns this into a real output. */
  output?: number;
  depth: number;
}

export class Trie {
  readonly root: TrieNode = {
    id: 0,
    char: "",
    children: new Map(),
    terminal: false,
    depth: 0,
  };
  private nextId = 1;
  private size = 0;

  static from(terms: string[], outputs?: (term: string, i: number) => number): Trie {
    const trie = new Trie();
    terms.forEach((t, i) => trie.insert(t, outputs ? outputs(t, i) : undefined));
    return trie;
  }

  insert(term: string, output?: number): void {
    let node = this.root;
    for (const ch of term) {
      let next = node.children.get(ch);
      if (!next) {
        next = {
          id: this.nextId++,
          char: ch,
          children: new Map(),
          terminal: false,
          depth: node.depth + 1,
        };
        node.children.set(ch, next);
      }
      node = next;
    }
    if (!node.terminal) this.size++;
    node.terminal = true;
    node.output = output;
  }

  get termCount(): number {
    return this.size;
  }

  /** Exact lookup: O(length of term), independent of vocabulary size. */
  contains(term: string): { found: boolean; steps: number; output?: number } {
    let node: TrieNode | undefined = this.root;
    let steps = 0;
    for (const ch of term) {
      steps++;
      node = node.children.get(ch);
      if (!node) return { found: false, steps };
    }
    return { found: node.terminal, steps, output: node.output };
  }

  /** Reach the node for a prefix, or null if no term has that prefix. */
  walk(prefix: string): { node: TrieNode | null; steps: number } {
    let node: TrieNode | undefined = this.root;
    let steps = 0;
    for (const ch of prefix) {
      steps++;
      node = node.children.get(ch);
      if (!node) return { node: null, steps };
    }
    return { node, steps };
  }

  /** Enumerate every term under a node, in sorted order. */
  collect(node: TrieNode, prefix: string, limit = Infinity): string[] {
    const out: string[] = [];
    const visit = (n: TrieNode, acc: string) => {
      if (out.length >= limit) return;
      if (n.terminal) out.push(acc);
      for (const ch of [...n.children.keys()].sort()) {
        if (out.length >= limit) return;
        visit(n.children.get(ch)!, acc + ch);
      }
    };
    visit(node, prefix);
    return out;
  }

  /** Chapter 12's prefix query: reach the prefix, then enumerate the subtree. */
  prefixSearch(prefix: string, limit = Infinity): {
    terms: string[];
    steps: number;
    nodesVisited: number;
  } {
    const { node, steps } = this.walk(prefix);
    if (!node) return { terms: [], steps, nodesVisited: steps };
    const terms = this.collect(node, prefix, limit);
    return { terms, steps, nodesVisited: steps + this.countNodes(node) };
  }

  countNodes(from: TrieNode = this.root): number {
    let count = 1;
    for (const child of from.children.values()) count += this.countNodes(child);
    return count;
  }

  countEdges(from: TrieNode = this.root): number {
    let count = 0;
    for (const child of from.children.values()) count += 1 + this.countEdges(child);
    return count;
  }

  /**
   * A rough memory figure for a pointer-heavy trie: per node, an object header,
   * a flag, and a hash map entry per outgoing edge. The absolute number is not
   * the point; the ratio against the minimized automaton and the FST is.
   */
  estimateBytes(): number {
    const nodes = this.countNodes();
    const edges = this.countEdges();
    const BYTES_PER_NODE = 40;
    const BYTES_PER_EDGE = 48;
    return nodes * BYTES_PER_NODE + edges * BYTES_PER_EDGE;
  }

  /**
   * Chapter 15: run a fuzzy automaton over the trie instead of over the term
   * list. Shared prefixes mean one dead automaton state kills an entire subtree.
   */
  intersectAutomaton(
    automaton: LevenshteinAutomaton,
    limit = Infinity,
  ): {
    terms: string[];
    nodesVisited: number;
    subtreesPruned: number;
    transitions: number;
  } {
    const terms: string[] = [];
    let nodesVisited = 0;
    let subtreesPruned = 0;
    let transitions = 0;

    const visit = (node: TrieNode, state: number, acc: string) => {
      if (terms.length >= limit) return;
      nodesVisited++;
      if (node.terminal && automaton.states[state].accepting) terms.push(acc);
      for (const ch of [...node.children.keys()].sort()) {
        transitions++;
        const next = automaton.step(state, ch);
        if (automaton.isDead(next)) {
          // Everything below this edge shares the prefix, so it all dies here.
          subtreesPruned++;
          continue;
        }
        visit(node.children.get(ch)!, next, acc + ch);
      }
    };

    visit(this.root, automaton.start, "");
    return { terms, nodesVisited, subtreesPruned, transitions };
  }

  /** A serialisable shape for drawing the tree. */
  toGraph(maxNodes = 400): {
    nodes: { id: number; label: string; terminal: boolean; depth: number; output?: number }[];
    edges: { from: number; to: number; label: string }[];
    truncated: boolean;
  } {
    const nodes: { id: number; label: string; terminal: boolean; depth: number; output?: number }[] = [];
    const edges: { from: number; to: number; label: string }[] = [];
    let truncated = false;
    const queue: TrieNode[] = [this.root];
    while (queue.length) {
      const node = queue.shift()!;
      if (nodes.length >= maxNodes) {
        truncated = true;
        break;
      }
      nodes.push({
        id: node.id,
        label: node.char === "" ? "ROOT" : node.char,
        terminal: node.terminal,
        depth: node.depth,
        output: node.output,
      });
      for (const ch of [...node.children.keys()].sort()) {
        const child = node.children.get(ch)!;
        edges.push({ from: node.id, to: child.id, label: ch });
        queue.push(child);
      }
    }
    return { nodes, edges, truncated };
  }
}

// ---------------------------------------------------------------------------
// Chapter 17: minimizing the trie into a DAWG
// ---------------------------------------------------------------------------

export interface DawgNode {
  id: number;
  terminal: boolean;
  /** char -> node id */
  edges: Map<string, number>;
}

export interface MinimizeResult {
  nodes: DawgNode[];
  start: number;
  trieNodeCount: number;
  dawgNodeCount: number;
  trieEdgeCount: number;
  dawgEdgeCount: number;
  /** Which trie nodes collapsed together, for the "shared suffix" story. */
  mergedGroups: { signature: string; trieNodeIds: number[] }[];
}

/**
 * Bottom-up minimization. Two nodes are equivalent when their *future behaviour*
 * is identical: same terminal flag, same outgoing labels, and equivalent
 * targets. Because we process children first, "equivalent target" is just
 * "same assigned id", so a signature string is enough.
 */
export function minimize(trie: Trie): MinimizeResult {
  const nodes: DawgNode[] = [];
  const bySignature = new Map<string, number>();
  const trieIdsBySignature = new Map<string, number[]>();

  function compile(node: TrieNode): number {
    const parts: string[] = [];
    const edges = new Map<string, number>();
    for (const ch of [...node.children.keys()].sort()) {
      const childId = compile(node.children.get(ch)!);
      edges.set(ch, childId);
      parts.push(`${ch}>${childId}`);
    }
    const signature = `${node.terminal ? "F" : "-"}|${parts.join(",")}`;

    const group = trieIdsBySignature.get(signature);
    if (group) group.push(node.id);
    else trieIdsBySignature.set(signature, [node.id]);

    const existing = bySignature.get(signature);
    if (existing !== undefined) return existing;

    const id = nodes.length;
    nodes.push({ id, terminal: node.terminal, edges });
    bySignature.set(signature, id);
    return id;
  }

  const start = compile(trie.root);
  let dawgEdgeCount = 0;
  for (const n of nodes) dawgEdgeCount += n.edges.size;

  const mergedGroups = [...trieIdsBySignature.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([signature, trieNodeIds]) => ({ signature, trieNodeIds }))
    .sort((a, b) => b.trieNodeIds.length - a.trieNodeIds.length);

  return {
    nodes,
    start,
    trieNodeCount: trie.countNodes(),
    dawgNodeCount: nodes.length,
    trieEdgeCount: trie.countEdges(),
    dawgEdgeCount,
    mergedGroups,
  };
}

export function dawgAccepts(result: MinimizeResult, term: string): boolean {
  let id = result.start;
  for (const ch of term) {
    const next = result.nodes[id].edges.get(ch);
    if (next === undefined) return false;
    id = next;
  }
  return result.nodes[id].terminal;
}

export function dawgTerms(result: MinimizeResult, limit = Infinity): string[] {
  const out: string[] = [];
  const visit = (id: number, acc: string) => {
    if (out.length >= limit) return;
    const node = result.nodes[id];
    if (node.terminal) out.push(acc);
    for (const ch of [...node.edges.keys()].sort()) {
      if (out.length >= limit) return;
      visit(node.edges.get(ch)!, acc + ch);
    }
  };
  visit(result.start, "");
  return out;
}
