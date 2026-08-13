/**
 * The term dictionary as the query engine sees it (chapters 12, 15, 16, 19).
 *
 * Every "which terms match this pattern?" question lands here, and each one gets
 * answered by a different structure:
 *
 *   exact         binary search / FST lookup
 *   prefix        sorted range, or a trie walk plus subtree enumeration
 *   wildcard      literal prefix to narrow, then a regex over what is left
 *   regexp        no prefix to exploit, so the whole vocabulary is enumerated
 *   fuzzy         Levenshtein automaton intersected with the trie
 *
 * The costs reported here are what the labs display. They are counted, not
 * guessed.
 */

import { buildBlockTree, type BlockTree } from "./blocktree";
import { buildOrdinalFst, type Fst } from "./fst";
import { buildLevenshteinAutomaton } from "./levenshtein-automaton";
import { Trie } from "./trie";

export interface ExpansionResult {
  terms: string[];
  /** How the terms were found, for display. */
  method: string;
  /** Units of work: term comparisons, trie nodes, automaton transitions. */
  work: number;
  /** True when `maxExpansions` cut the list short (chapter 15). */
  clipped: boolean;
  /** Terms that matched before clipping, when clipping happened. */
  totalBeforeClip: number;
  note?: string;
}

export class TermDictionary {
  private trieCache: Trie | null = null;
  private fstCache: Fst | null = null;
  private blockTreeCache: BlockTree | null = null;

  constructor(readonly field: string, readonly sortedTerms: string[]) {}

  get size(): number {
    return this.sortedTerms.length;
  }

  trie(): Trie {
    if (!this.trieCache) this.trieCache = Trie.from(this.sortedTerms);
    return this.trieCache;
  }

  fst(): Fst {
    if (!this.fstCache) this.fstCache = buildOrdinalFst(this.sortedTerms);
    return this.fstCache;
  }

  blockTree(blockSize = 8): BlockTree {
    if (!this.blockTreeCache || this.blockTreeCache.blockSize !== blockSize) {
      this.blockTreeCache = buildBlockTree(this.sortedTerms, blockSize);
    }
    return this.blockTreeCache;
  }

  /** First index whose term is >= target. */
  private lowerBound(target: string): { index: number; comparisons: number } {
    let lo = 0;
    let hi = this.sortedTerms.length;
    let comparisons = 0;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      comparisons++;
      if (this.sortedTerms[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return { index: lo, comparisons };
  }

  has(term: string): boolean {
    const { index } = this.lowerBound(term);
    return this.sortedTerms[index] === term;
  }

  /** Chapter 12's prefix query, done on the sorted dictionary. */
  prefixRange(prefix: string, maxExpansions = Infinity): ExpansionResult {
    if (prefix === "") {
      const clipped = this.sortedTerms.length > maxExpansions;
      return {
        terms: this.sortedTerms.slice(0, maxExpansions),
        method: "empty prefix — the whole vocabulary",
        work: this.sortedTerms.length,
        clipped,
        totalBeforeClip: this.sortedTerms.length,
        note: "An empty prefix expands to every term. This is the shape of query that takes a cluster down.",
      };
    }
    const { index, comparisons } = this.lowerBound(prefix);
    const terms: string[] = [];
    let scanned = 0;
    let total = 0;
    for (let i = index; i < this.sortedTerms.length; i++) {
      scanned++;
      if (!this.sortedTerms[i].startsWith(prefix)) break;
      total++;
      if (terms.length < maxExpansions) terms.push(this.sortedTerms[i]);
    }
    return {
      terms,
      method: `binary search to "${prefix}", then walk while the prefix holds`,
      work: comparisons + scanned,
      clipped: total > terms.length,
      totalBeforeClip: total,
    };
  }

  /**
   * Wildcards. The literal text before the first `*` or `?` is a prefix we can
   * use to narrow the scan — the difference between reading part of the
   * dictionary and reading all of it.
   */
  wildcard(pattern: string, maxExpansions = Infinity): ExpansionResult {
    const firstWild = Math.min(
      ...["*", "?"].map((c) => {
        const i = pattern.indexOf(c);
        return i === -1 ? Infinity : i;
      }),
    );
    const literalPrefix = firstWild === Infinity ? pattern : pattern.slice(0, firstWild);
    const regex = wildcardToRegExp(pattern);

    const start = literalPrefix ? this.lowerBound(literalPrefix) : { index: 0, comparisons: 0 };
    const terms: string[] = [];
    let work = start.comparisons;
    let total = 0;
    for (let i = start.index; i < this.sortedTerms.length; i++) {
      const term = this.sortedTerms[i];
      work++;
      if (literalPrefix && !term.startsWith(literalPrefix)) break;
      if (regex.test(term)) {
        total++;
        if (terms.length < maxExpansions) terms.push(term);
      }
    }
    return {
      terms,
      method: literalPrefix
        ? `narrowed by the literal prefix "${literalPrefix}", then regex-tested ${work} term(s)`
        : `no literal prefix, so every one of the ${this.sortedTerms.length} terms was tested`,
      work,
      clipped: total > terms.length,
      totalBeforeClip: total,
      note: literalPrefix
        ? undefined
        : "A leading wildcard forfeits the sorted order of the dictionary. This is why `*foo` is discouraged.",
    };
  }

  regexp(pattern: string, maxExpansions = Infinity): ExpansionResult {
    let regex: RegExp;
    try {
      regex = new RegExp(`^(?:${pattern})$`, "u");
    } catch {
      return {
        terms: [], method: "invalid regular expression", work: 0,
        clipped: false, totalBeforeClip: 0, note: "The pattern did not compile.",
      };
    }
    const terms: string[] = [];
    let total = 0;
    for (const term of this.sortedTerms) {
      if (regex.test(term)) {
        total++;
        if (terms.length < maxExpansions) terms.push(term);
      }
    }
    return {
      terms,
      method: `tested all ${this.sortedTerms.length} terms against the pattern`,
      work: this.sortedTerms.length,
      clipped: total > terms.length,
      totalBeforeClip: total,
      note: "A regex cannot be narrowed by sorted order in general, so the whole vocabulary is enumerated.",
    };
  }

  /** Chapter 15: automaton intersected with the trie, with a prefix constraint. */
  fuzzy(
    value: string,
    options: {
      maxEdits?: number;
      prefixLength?: number;
      maxExpansions?: number;
      transpositions?: boolean;
    } = {},
  ): ExpansionResult & { automatonStates: number; subtreesPruned: number } {
    const maxEdits = options.maxEdits ?? autoFuzziness(value);
    const prefixLength = Math.min(options.prefixLength ?? 0, value.length);
    const maxExpansions = options.maxExpansions ?? Infinity;

    const fixed = value.slice(0, prefixLength);
    const automaton = buildLevenshteinAutomaton(value.slice(prefixLength), maxEdits, {
      transpositions: options.transpositions,
    });

    // The fixed prefix means we only have to walk part of the trie at all.
    const trie = this.trie();
    const { node } = trie.walk(fixed);
    if (!node) {
      return {
        terms: [], method: `no term starts with the fixed prefix "${fixed}"`,
        work: prefixLength, clipped: false, totalBeforeClip: 0,
        automatonStates: automaton.size, subtreesPruned: 0,
      };
    }

    const matched: string[] = [];
    let nodesVisited = 0;
    let subtreesPruned = 0;

    const visit = (n: typeof node, state: number, acc: string) => {
      nodesVisited++;
      if (n.terminal && automaton.states[state].accepting) matched.push(acc);
      for (const ch of [...n.children.keys()].sort()) {
        const next = automaton.step(state, ch);
        if (automaton.isDead(next)) {
          subtreesPruned++;
          continue;
        }
        visit(n.children.get(ch)!, next, acc + ch);
      }
    };
    visit(node, automaton.start, fixed);

    const terms = matched.slice(0, maxExpansions);
    return {
      terms,
      method:
        `Levenshtein automaton (${automaton.size} states, max ${maxEdits} edit${maxEdits === 1 ? "" : "s"})` +
        `${prefixLength ? ` with "${fixed}" held fixed` : ""} intersected with the trie`,
      work: nodesVisited,
      clipped: matched.length > terms.length,
      totalBeforeClip: matched.length,
      automatonStates: automaton.size,
      subtreesPruned,
      note: prefixLength
        ? `Holding ${prefixLength} character(s) fixed removed most of the trie from consideration.`
        : undefined,
    };
  }
}

export function wildcardToRegExp(pattern: string): RegExp {
  let out = "";
  for (const ch of pattern) {
    if (ch === "*") out += "[\\s\\S]*";
    else if (ch === "?") out += "[\\s\\S]";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "u");
}

/**
 * `AUTO` fuzziness, the way OpenSearch defines it: short terms get no slack,
 * because at one edit "cat" reaches half the dictionary.
 */
export function autoFuzziness(term: string): number {
  if (term.length <= 2) return 0;
  if (term.length <= 5) return 1;
  return 2;
}
