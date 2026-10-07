/**
 * Query execution as iterators (chapter 6).
 *
 * The book's warning is the design constraint here: "the production engine should
 * use iterators rather than materializing enormous sets". Every scorer below
 * exposes the same three moves —
 *
 *   docId()          where am I
 *   nextDoc()        go to the next match
 *   advance(target)  go to the first match >= target
 *
 * — so an AND of an OR of a phrase of terms composes without anyone allocating a
 * list of document ids. `advance` is the important one: it is what lets a cheap
 * clause drag an expensive one forward and skip everything in between.
 */

import { bm25, bm25Explanation, bm25MaxScore, type Bm25Params } from "./bm25";
import type { InvertedIndex } from "./inverted-index";
import { NO_MORE_DOCS, type ExecStats, type Explanation, type Posting } from "./types";

export interface ScoringContext {
  index: InvertedIndex;
  params: Bm25Params;
  stats: ExecStats;
}

export interface Scorer {
  readonly label: string;
  docId(): number;
  nextDoc(): number;
  advance(target: number): number;
  /** Score for the current document. Zero for non-scoring clauses. */
  score(): number;
  /** Upper bound on `score()` over all documents. Used for pruning. */
  maxScore(): number;
  /** Estimated number of matches, for query planning. */
  cost(): number;
  children(): Scorer[];
  /** Explanation for the current document. */
  explain(): Explanation | null;
  matchedTerms(): string[];
}

abstract class BaseScorer implements Scorer {
  abstract readonly label: string;
  protected current = -1;

  docId(): number {
    return this.current;
  }
  abstract nextDoc(): number;
  abstract advance(target: number): number;
  score(): number {
    return 0;
  }
  maxScore(): number {
    return 0;
  }
  abstract cost(): number;
  children(): Scorer[] {
    return [];
  }
  explain(): Explanation | null {
    return null;
  }
  matchedTerms(): string[] {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Leaf: one term, one postings list
// ---------------------------------------------------------------------------

export class TermScorer extends BaseScorer {
  readonly label: string;
  private cursor = -1;
  private readonly cachedMaxScore: number;

  constructor(
    readonly field: string,
    readonly term: string,
    private readonly postings: Posting[],
    private readonly ctx: ScoringContext,
    private readonly boost = 1,
    /** Filter clauses match without scoring (chapter 11). */
    private readonly scoring = true,
  ) {
    super();
    this.label = `term(${field}:${term})`;
    ctx.stats.termLookups++;

    if (postings.length === 0 || !scoring) {
      this.cachedMaxScore = 0;
    } else {
      let maxTf = 0;
      let minLength = Infinity;
      for (const p of postings) {
        if (p.freq > maxTf) maxTf = p.freq;
        const len = ctx.index.fieldLength(field, p.docId);
        if (len < minLength) minLength = len;
      }
      this.cachedMaxScore = bm25MaxScore(
        maxTf,
        minLength === Infinity ? 1 : minLength,
        ctx.index.avgFieldLength(field),
        ctx.index.numDocs,
        postings.length,
        ctx.params,
        boost,
      );
    }
  }

  currentPosting(): Posting | null {
    return this.cursor >= 0 && this.cursor < this.postings.length ? this.postings[this.cursor] : null;
  }

  nextDoc(): number {
    this.cursor++;
    this.ctx.stats.postingsRead++;
    this.current = this.cursor < this.postings.length ? this.postings[this.cursor].docId : NO_MORE_DOCS;
    return this.current;
  }

  advance(target: number): number {
    this.ctx.stats.advanceCalls++;
    if (this.current >= target && this.current !== -1) return this.current;

    // Galloping search: double the step until we overshoot, then binary search.
    // A linear walk would work too; this is what makes "skip" more than a word.
    let lo = Math.max(this.cursor, 0);
    let step = 1;
    let hi = lo;
    while (hi < this.postings.length && this.postings[hi].docId < target) {
      lo = hi;
      step *= 2;
      hi = lo + step;
      this.ctx.stats.postingsRead++;
    }
    hi = Math.min(hi, this.postings.length);

    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      this.ctx.stats.postingsRead++;
      if (this.postings[mid].docId < target) lo = mid + 1;
      else hi = mid;
    }
    this.cursor = lo;
    this.current = lo < this.postings.length ? this.postings[lo].docId : NO_MORE_DOCS;
    return this.current;
  }

  score(): number {
    if (!this.scoring) return 0;
    const posting = this.currentPosting();
    if (!posting) return 0;
    return bm25({
      tf: posting.freq,
      fieldLength: this.ctx.index.fieldLength(this.field, posting.docId),
      avgFieldLength: this.ctx.index.avgFieldLength(this.field),
      numDocs: this.ctx.index.numDocs,
      docFreq: this.postings.length,
      params: this.ctx.params,
      boost: this.boost,
    }).score;
  }

  maxScore(): number {
    return this.cachedMaxScore;
  }

  cost(): number {
    return this.postings.length;
  }

  explain(): Explanation | null {
    const posting = this.currentPosting();
    if (!posting) return null;
    if (!this.scoring) {
      return { value: 0, description: `${this.label} matched as a filter (no score contribution)` };
    }
    return bm25Explanation(this.term, this.field, {
      tf: posting.freq,
      fieldLength: this.ctx.index.fieldLength(this.field, posting.docId),
      avgFieldLength: this.ctx.index.avgFieldLength(this.field),
      numDocs: this.ctx.index.numDocs,
      docFreq: this.postings.length,
      params: this.ctx.params,
      boost: this.boost,
    });
  }

  matchedTerms(): string[] {
    return this.current === NO_MORE_DOCS || this.current < 0 ? [] : [`${this.field}:${this.term}`];
  }
}

/** A term that is not in the dictionary at all (chapter 9). Matches nothing. */
export class EmptyScorer extends BaseScorer {
  readonly label: string;
  constructor(label: string) {
    super();
    this.label = label;
  }
  nextDoc(): number {
    this.current = NO_MORE_DOCS;
    return this.current;
  }
  advance(): number {
    this.current = NO_MORE_DOCS;
    return this.current;
  }
  cost(): number {
    return 0;
  }
  explain(): Explanation | null {
    return { value: 0, description: `${this.label} — term not in the dictionary, no postings, no candidates` };
  }
}

export class MatchAllScorer extends BaseScorer {
  readonly label = "match_all";
  constructor(private readonly maxDoc: number, private readonly boost = 1) {
    super();
  }
  nextDoc(): number {
    this.current = this.current + 1 >= this.maxDoc ? NO_MORE_DOCS : this.current + 1;
    return this.current;
  }
  advance(target: number): number {
    this.current = target >= this.maxDoc ? NO_MORE_DOCS : target;
    return this.current;
  }
  score(): number {
    return this.boost;
  }
  maxScore(): number {
    return this.boost;
  }
  cost(): number {
    return this.maxDoc;
  }
  explain(): Explanation | null {
    return { value: this.boost, description: "match_all: constant score" };
  }
}

/** Wraps a pre-resolved sorted docId list — used by point ranges (chapter 20). */
export class DocIdListScorer extends BaseScorer {
  readonly label: string;
  private cursor = -1;
  constructor(
    label: string,
    private readonly docIds: number[],
    private readonly constantScore = 0,
    private readonly stats?: ExecStats,
  ) {
    super();
    this.label = label;
  }
  nextDoc(): number {
    this.cursor++;
    this.current = this.cursor < this.docIds.length ? this.docIds[this.cursor] : NO_MORE_DOCS;
    return this.current;
  }
  advance(target: number): number {
    if (this.stats) this.stats.advanceCalls++;
    let lo = Math.max(this.cursor, 0);
    let hi = this.docIds.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.docIds[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    this.cursor = lo;
    this.current = lo < this.docIds.length ? this.docIds[lo] : NO_MORE_DOCS;
    return this.current;
  }
  score(): number {
    return this.constantScore;
  }
  maxScore(): number {
    return this.constantScore;
  }
  cost(): number {
    return this.docIds.length;
  }
  explain(): Explanation | null {
    return {
      value: this.constantScore,
      description: this.constantScore === 0
        ? `${this.label} matched (filter, no score contribution)`
        : `${this.label} matched with constant score`,
    };
  }
}

// ---------------------------------------------------------------------------
// AND
// ---------------------------------------------------------------------------

export class ConjunctionScorer extends BaseScorer {
  readonly label = "AND";
  private readonly subs: Scorer[];

  constructor(subs: Scorer[], private readonly stats: ExecStats) {
    super();
    // Chapter 27: drive from the cheapest clause. Sorting here is the whole
    // "query planning" step for a conjunction.
    this.subs = [...subs].sort((a, b) => a.cost() - b.cost());
  }

  private align(from: number): number {
    let doc = from;
    if (doc === NO_MORE_DOCS) return NO_MORE_DOCS;
    // Leapfrog: whenever one clause jumps ahead, drag the others to it.
    restart: for (;;) {
      for (const sub of this.subs) {
        if (sub.docId() < doc) {
          const landed = sub.advance(doc);
          if (landed === NO_MORE_DOCS) return NO_MORE_DOCS;
          if (landed > doc) {
            doc = landed;
            continue restart;
          }
        }
      }
      return doc;
    }
  }

  nextDoc(): number {
    const lead = this.subs[0];
    const next = lead.nextDoc();
    this.current = this.align(next);
    this.stats.docsVisited++;
    return this.current;
  }

  advance(target: number): number {
    const lead = this.subs[0];
    const next = lead.advance(target);
    this.current = this.align(next);
    return this.current;
  }

  score(): number {
    let total = 0;
    for (const sub of this.subs) total += sub.score();
    return total;
  }
  maxScore(): number {
    let total = 0;
    for (const sub of this.subs) total += sub.maxScore();
    return total;
  }
  cost(): number {
    // A conjunction cannot match more often than its rarest clause.
    return Math.min(...this.subs.map((s) => s.cost()));
  }
  children(): Scorer[] {
    return this.subs;
  }
  explain(): Explanation | null {
    const details = this.subs.map((s) => s.explain()).filter((e): e is Explanation => e !== null);
    return { value: this.score(), description: "sum of AND clauses", details };
  }
  matchedTerms(): string[] {
    return this.subs.flatMap((s) => s.matchedTerms());
  }
}

// ---------------------------------------------------------------------------
// OR
// ---------------------------------------------------------------------------

export class DisjunctionScorer extends BaseScorer {
  readonly label: string;

  constructor(
    private readonly subs: Scorer[],
    private readonly minimumShouldMatch: number,
    private readonly stats: ExecStats,
  ) {
    super();
    this.label = minimumShouldMatch > 1 ? `OR(min ${minimumShouldMatch})` : "OR";
  }

  private findNext(): number {
    for (;;) {
      let min = NO_MORE_DOCS;
      for (const sub of this.subs) {
        const d = sub.docId();
        if (d !== -1 && d < min) min = d;
      }
      if (min === NO_MORE_DOCS) return NO_MORE_DOCS;

      let matches = 0;
      for (const sub of this.subs) if (sub.docId() === min) matches++;
      this.stats.docsVisited++;
      if (matches >= this.minimumShouldMatch) return min;

      // Not enough clauses agreed on this document — step past it.
      this.stats.docsSkipped++;
      for (const sub of this.subs) if (sub.docId() === min) sub.nextDoc();
    }
  }

  nextDoc(): number {
    for (const sub of this.subs) {
      if (sub.docId() === -1 || sub.docId() <= this.current) sub.nextDoc();
    }
    this.current = this.findNext();
    return this.current;
  }

  advance(target: number): number {
    for (const sub of this.subs) {
      if (sub.docId() === -1 || sub.docId() < target) sub.advance(target);
    }
    this.current = this.findNext();
    return this.current;
  }

  score(): number {
    let total = 0;
    for (const sub of this.subs) if (sub.docId() === this.current) total += sub.score();
    return total;
  }
  maxScore(): number {
    let total = 0;
    for (const sub of this.subs) total += sub.maxScore();
    return total;
  }
  cost(): number {
    let total = 0;
    for (const sub of this.subs) total += sub.cost();
    return total;
  }
  children(): Scorer[] {
    return this.subs;
  }
  explain(): Explanation | null {
    const details = this.subs
      .filter((s) => s.docId() === this.current)
      .map((s) => s.explain())
      .filter((e): e is Explanation => e !== null);
    return { value: this.score(), description: "sum of matching OR clauses", details };
  }
  matchedTerms(): string[] {
    return this.subs.filter((s) => s.docId() === this.current).flatMap((s) => s.matchedTerms());
  }
}

// ---------------------------------------------------------------------------
// must + should: required drives, optional only adds score
// ---------------------------------------------------------------------------

export class ReqOptScorer extends BaseScorer {
  readonly label = "must + should";
  constructor(private readonly required: Scorer, private readonly optional: Scorer) {
    super();
  }
  private syncOptional() {
    if (this.current === NO_MORE_DOCS) return;
    if (this.optional.docId() < this.current) this.optional.advance(this.current);
  }
  nextDoc(): number {
    this.current = this.required.nextDoc();
    this.syncOptional();
    return this.current;
  }
  advance(target: number): number {
    this.current = this.required.advance(target);
    this.syncOptional();
    return this.current;
  }
  score(): number {
    const optional = this.optional.docId() === this.current ? this.optional.score() : 0;
    return this.required.score() + optional;
  }
  maxScore(): number {
    return this.required.maxScore() + this.optional.maxScore();
  }
  cost(): number {
    return this.required.cost();
  }
  children(): Scorer[] {
    return [this.required, this.optional];
  }
  explain(): Explanation | null {
    const details: Explanation[] = [];
    const req = this.required.explain();
    if (req) details.push(req);
    if (this.optional.docId() === this.current) {
      const opt = this.optional.explain();
      if (opt) details.push({ ...opt, description: `optional (should): ${opt.description}` });
    } else {
      details.push({ value: 0, description: "no should clause matched this document" });
    }
    return { value: this.score(), description: "required score + optional boost", details };
  }
  matchedTerms(): string[] {
    const out = this.required.matchedTerms();
    if (this.optional.docId() === this.current) out.push(...this.optional.matchedTerms());
    return out;
  }
}

// ---------------------------------------------------------------------------
// must_not
// ---------------------------------------------------------------------------

export class ExclusionScorer extends BaseScorer {
  readonly label = "must_not";
  constructor(
    private readonly main: Scorer,
    private readonly excluded: Scorer[],
    private readonly stats: ExecStats,
  ) {
    super();
  }
  private isExcluded(doc: number): boolean {
    for (const sub of this.excluded) {
      if (sub.docId() < doc) sub.advance(doc);
      if (sub.docId() === doc) return true;
    }
    return false;
  }
  private skipExcluded(start: number): number {
    let doc = start;
    while (doc !== NO_MORE_DOCS && this.isExcluded(doc)) {
      this.stats.docsSkipped++;
      doc = this.main.nextDoc();
    }
    return doc;
  }
  nextDoc(): number {
    this.current = this.skipExcluded(this.main.nextDoc());
    return this.current;
  }
  advance(target: number): number {
    this.current = this.skipExcluded(this.main.advance(target));
    return this.current;
  }
  score(): number {
    return this.main.score();
  }
  maxScore(): number {
    return this.main.maxScore();
  }
  cost(): number {
    return this.main.cost();
  }
  children(): Scorer[] {
    return [this.main, ...this.excluded];
  }
  explain(): Explanation | null {
    const inner = this.main.explain();
    return inner
      ? { value: inner.value, description: "matched and not excluded", details: [inner] }
      : null;
  }
  matchedTerms(): string[] {
    return this.main.matchedTerms();
  }
}

// ---------------------------------------------------------------------------
// Phrase (chapter 5 positions, chapter 12 phrase query)
// ---------------------------------------------------------------------------

export interface PhraseMatch {
  /** Position of the first term of the match. */
  start: number;
  /** Chosen position for each query term. */
  positions: number[];
  /** last - first - (n - 1): how much slack the match used. */
  slack: number;
}

export class PhraseScorer extends BaseScorer {
  readonly label: string;
  private readonly conjunction: ConjunctionScorer;
  private lastMatches: PhraseMatch[] = [];
  private readonly summedIdf: number;
  private readonly totalDocFreq: number;

  constructor(
    readonly field: string,
    readonly terms: string[],
    private readonly termScorers: TermScorer[],
    private readonly slop: number,
    private readonly ctx: ScoringContext,
    private readonly boost = 1,
    private readonly scoring = true,
  ) {
    super();
    this.label = `phrase(${field}:"${terms.join(" ")}"${slop ? `~${slop}` : ""})`;
    this.conjunction = new ConjunctionScorer(termScorers, ctx.stats);

    // A phrase behaves like a single rare term: sum the term idfs, and use the
    // rarest term's document frequency as the phrase's own upper bound.
    let summed = 0;
    let minDf = Infinity;
    for (const ts of termScorers) {
      const df = ts.cost();
      minDf = Math.min(minDf, df);
      summed += Math.log(1 + (ctx.index.numDocs - df + 0.5) / (df + 0.5));
    }
    this.summedIdf = summed;
    this.totalDocFreq = minDf === Infinity ? 0 : minDf;
  }

  /**
   * Position matching. For each occurrence of the first term we walk the other
   * terms forward, always taking the earliest position that is still ahead of
   * the previous one. `slop` is how much extra distance the whole run may use.
   *
   * This finds in-order matches only. Lucene's sloppy phrase can also match
   * transposed words for slop >= 2; that is a deliberate simplification here and
   * the lab says so.
   */
  private matchPositions(): PhraseMatch[] {
    const lists: number[][] = [];
    for (const ts of this.termScorers) {
      const posting = ts.currentPosting();
      if (!posting || posting.positions.length === 0) return [];
      lists.push(posting.positions);
    }

    const matches: PhraseMatch[] = [];
    const n = lists.length;
    for (const start of lists[0]) {
      const chosen = [start];
      let previous = start;
      let ok = true;
      for (let t = 1; t < n; t++) {
        // Earliest position of term t strictly after the previous term.
        let found = -1;
        for (const p of lists[t]) {
          this.ctx.stats.positionChecks++;
          if (p > previous) {
            found = p;
            break;
          }
        }
        if (found === -1) {
          ok = false;
          break;
        }
        chosen.push(found);
        previous = found;
      }
      if (!ok) continue;
      const slack = chosen[n - 1] - chosen[0] - (n - 1);
      if (slack <= this.slop) matches.push({ start, positions: chosen, slack });
    }
    return matches;
  }

  private nextMatchingDoc(doc: number): number {
    let d = doc;
    while (d !== NO_MORE_DOCS) {
      this.lastMatches = this.matchPositions();
      if (this.lastMatches.length > 0) return d;
      this.ctx.stats.docsSkipped++;
      d = this.conjunction.nextDoc();
    }
    this.lastMatches = [];
    return NO_MORE_DOCS;
  }

  nextDoc(): number {
    this.current = this.nextMatchingDoc(this.conjunction.nextDoc());
    return this.current;
  }
  advance(target: number): number {
    this.current = this.nextMatchingDoc(this.conjunction.advance(target));
    return this.current;
  }

  matches(): PhraseMatch[] {
    return this.lastMatches;
  }

  score(): number {
    if (!this.scoring || this.current === NO_MORE_DOCS) return 0;
    const tf = this.lastMatches.length;
    const { k1, b } = this.ctx.params;
    const dl = this.ctx.index.fieldLength(this.field, this.current);
    const avgdl = this.ctx.index.avgFieldLength(this.field);
    const norm = k1 * (1 - b + b * (avgdl > 0 ? dl / avgdl : 1));
    return this.boost * this.summedIdf * ((tf * (k1 + 1)) / (tf + norm));
  }

  maxScore(): number {
    if (!this.scoring) return 0;
    const { k1 } = this.ctx.params;
    return this.boost * this.summedIdf * (k1 + 1);
  }

  cost(): number {
    return this.totalDocFreq;
  }
  children(): Scorer[] {
    return this.termScorers;
  }
  explain(): Explanation | null {
    if (this.current === NO_MORE_DOCS) return null;
    return {
      value: this.score(),
      description: `${this.label}: ${this.lastMatches.length} phrase occurrence(s)`,
      details: [
        { value: this.summedIdf, description: "sum of the idf of each phrase term" },
        {
          value: this.lastMatches.length,
          description: `matches at position(s) ${this.lastMatches.map((m) => m.positions.join("-")).join(", ")}`,
        },
      ],
    };
  }
  matchedTerms(): string[] {
    return this.terms.map((t) => `${this.field}:${t}`);
  }
}

// ---------------------------------------------------------------------------
// Wrappers
// ---------------------------------------------------------------------------

export class BoostScorer extends BaseScorer {
  readonly label: string;
  constructor(private readonly inner: Scorer, private readonly boost: number) {
    super();
    this.label = `boost(${boost})`;
  }
  nextDoc(): number {
    this.current = this.inner.nextDoc();
    return this.current;
  }
  advance(target: number): number {
    this.current = this.inner.advance(target);
    return this.current;
  }
  score(): number {
    return this.inner.score() * this.boost;
  }
  maxScore(): number {
    return this.inner.maxScore() * this.boost;
  }
  cost(): number {
    return this.inner.cost();
  }
  children(): Scorer[] {
    return [this.inner];
  }
  explain(): Explanation | null {
    const inner = this.inner.explain();
    if (!inner) return null;
    return {
      value: inner.value * this.boost,
      description: `boosted by ${this.boost}`,
      details: [inner],
    };
  }
  matchedTerms(): string[] {
    return this.inner.matchedTerms();
  }
}

/** Chapter 11's `filter`: required for matching, contributes nothing to score. */
export class ConstantScoreScorer extends BaseScorer {
  readonly label: string;
  constructor(private readonly inner: Scorer, private readonly constant = 0) {
    super();
    this.label = `filter(${inner.label})`;
  }
  nextDoc(): number {
    this.current = this.inner.nextDoc();
    return this.current;
  }
  advance(target: number): number {
    this.current = this.inner.advance(target);
    return this.current;
  }
  score(): number {
    return this.constant;
  }
  maxScore(): number {
    return this.constant;
  }
  cost(): number {
    return this.inner.cost();
  }
  children(): Scorer[] {
    return [this.inner];
  }
  explain(): Explanation | null {
    return {
      value: this.constant,
      description: `${this.inner.label} matched as a filter — no scoring work done`,
    };
  }
  matchedTerms(): string[] {
    return this.inner.matchedTerms();
  }
}

/** Chapter 30: run a script over the base score. */
export class ScriptScoreScorer extends BaseScorer {
  readonly label = "script_score";
  constructor(
    private readonly inner: Scorer,
    private readonly evaluate: (docId: number, baseScore: number) => number,
    private readonly describe: string,
    private readonly onEvaluate?: () => void,
  ) {
    super();
  }
  nextDoc(): number {
    this.current = this.inner.nextDoc();
    return this.current;
  }
  advance(target: number): number {
    this.current = this.inner.advance(target);
    return this.current;
  }
  score(): number {
    this.onEvaluate?.();
    return this.evaluate(this.current, this.inner.score());
  }
  maxScore(): number {
    // A script can return anything, so there is no safe upper bound. Reporting
    // Infinity is the honest answer, and it is exactly why scripts disable
    // top-K pruning (chapter 30).
    return Infinity;
  }
  cost(): number {
    return this.inner.cost();
  }
  children(): Scorer[] {
    return [this.inner];
  }
  explain(): Explanation | null {
    const inner = this.inner.explain();
    const base = this.inner.score();
    return {
      value: this.score(),
      description: `script: ${this.describe}`,
      details: [
        inner ?? { value: base, description: "base score" },
      ],
    };
  }
  matchedTerms(): string[] {
    return this.inner.matchedTerms();
  }
}

// ---------------------------------------------------------------------------
// Top-K collection (chapter 27)
// ---------------------------------------------------------------------------

/**
 * A bounded min-heap. The book's point: do not sort a million results to show
 * twenty. Keep K, and throw away anything that cannot beat the current worst.
 */
export class TopKHeap {
  private readonly heap: { docId: number; score: number }[] = [];
  pushed = 0;
  replaced = 0;
  discarded = 0;

  constructor(readonly k: number) {}

  get size(): number {
    return this.heap.length;
  }

  /** The score a document must beat to enter, once the heap is full. */
  get threshold(): number {
    return this.heap.length < this.k ? -Infinity : this.heap[0].score;
  }

  offer(docId: number, score: number): boolean {
    if (this.heap.length < this.k) {
      this.heap.push({ docId, score });
      this.siftUp(this.heap.length - 1);
      this.pushed++;
      return true;
    }
    if (score > this.heap[0].score) {
      this.heap[0] = { docId, score };
      this.siftDown(0);
      this.replaced++;
      return true;
    }
    this.discarded++;
    return false;
  }

  drain(): { docId: number; score: number }[] {
    return [...this.heap].sort((a, b) => b.score - a.score || a.docId - b.docId);
  }

  private siftUp(i: number) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent].score <= this.heap[i].score) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  private siftDown(i: number) {
    const n = this.heap.length;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.heap[left].score < this.heap[smallest].score) smallest = left;
      if (right < n && this.heap[right].score < this.heap[smallest].score) smallest = right;
      if (smallest === i) break;
      [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
      i = smallest;
    }
  }
}
