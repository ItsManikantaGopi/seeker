/**
 * Query planning (chapters 6 and 27).
 *
 * Two ideas, both about not doing work:
 *
 * 1. **Drive from the cheapest clause.** `A AND B` where A has 1,000 matches and
 *    B has 10,000,000 should walk A and probe B, not the other way round.
 * 2. **Do not score what cannot win.** If the top-K heap already holds twenty
 *    documents scoring above 8.0, a document whose best possible score is 3.0 is
 *    not worth computing. That is WAND, and the upper bounds come from BM25.
 */

import { TopKHeap } from "./iterators";
import type { Posting } from "./types";

// ---------------------------------------------------------------------------
// Chapter 6: the two-pointer intersection, step by step
// ---------------------------------------------------------------------------

export interface IntersectionStep {
  i: number;
  j: number;
  a: number | null;
  b: number | null;
  action: "emit" | "advance-a" | "advance-b" | "done";
  note: string;
}

export interface IntersectionTrace {
  result: number[];
  steps: IntersectionStep[];
  comparisons: number;
}

/** The book's worked example: A = [2,5,9,20], B = [1,5,7,9] gives [5,9]. */
export function intersectWithTrace(a: number[], b: number[]): IntersectionTrace {
  const steps: IntersectionStep[] = [];
  const result: number[] = [];
  let i = 0;
  let j = 0;
  let comparisons = 0;

  while (i < a.length && j < b.length) {
    comparisons++;
    const av = a[i];
    const bv = b[j];
    if (av === bv) {
      result.push(av);
      steps.push({ i, j, a: av, b: bv, action: "emit", note: `${av} == ${bv} — both lists have it, emit and advance both` });
      i++;
      j++;
    } else if (av < bv) {
      steps.push({ i, j, a: av, b: bv, action: "advance-a", note: `${av} < ${bv} — A is behind, so ${av} cannot be in B; advance A` });
      i++;
    } else {
      steps.push({ i, j, a: av, b: bv, action: "advance-b", note: `${av} > ${bv} — B is behind; advance B` });
      j++;
    }
  }
  steps.push({
    i, j,
    a: i < a.length ? a[i] : null,
    b: j < b.length ? b[j] : null,
    action: "done",
    note: "One list is exhausted, so no further match is possible.",
  });
  return { result, steps, comparisons };
}

/**
 * The same intersection using `advance` instead of single steps. When one list is
 * much shorter, skipping turns a linear walk of the long list into a handful of
 * binary searches.
 */
export function intersectWithSkipping(a: number[], b: number[]): {
  result: number[];
  advances: number;
  comparisons: number;
} {
  const result: number[] = [];
  let advances = 0;
  let comparisons = 0;

  // Drive from the shorter list. This single line is the plan.
  const [lead, follow] = a.length <= b.length ? [a, b] : [b, a];
  let followCursor = 0;

  for (const target of lead) {
    // Galloping search for `target` in `follow`, starting where we left off.
    let lo = followCursor;
    let step = 1;
    while (lo + step < follow.length && follow[lo + step] < target) {
      lo += step;
      step *= 2;
      comparisons++;
    }
    let hi = Math.min(lo + step + 1, follow.length);
    advances++;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      comparisons++;
      if (follow[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    followCursor = lo;
    if (lo < follow.length && follow[lo] === target) result.push(target);
    if (followCursor >= follow.length) break;
  }
  return { result, advances, comparisons };
}

export interface PlanComparison {
  order: string[];
  /** Total postings entries touched. */
  work: number;
  advances: number;
  matches: number;
}

/**
 * Show both orderings of a conjunction so the difference is a number and not an
 * assertion.
 */
export function compareJoinOrders(
  clauses: { label: string; docIds: number[] }[],
): PlanComparison[] {
  const orders: { label: string; list: { label: string; docIds: number[] }[] }[] = [
    { label: "cheapest first", list: [...clauses].sort((x, y) => x.docIds.length - y.docIds.length) },
    { label: "most expensive first", list: [...clauses].sort((x, y) => y.docIds.length - x.docIds.length) },
  ];

  return orders.map(({ list }) => {
    let current = list[0].docIds;
    let work = list[0].docIds.length;
    let advances = 0;
    for (const clause of list.slice(1)) {
      const r = intersectWithSkipping(current, clause.docIds);
      // The driver walks its own list; the probe costs a search per driver entry.
      work += Math.min(current.length, clause.docIds.length) + r.comparisons;
      advances += r.advances;
      current = r.result;
    }
    return {
      order: list.map((c) => `${c.label} (${c.docIds.length})`),
      work,
      advances,
      matches: current.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Chapter 27: top-K with upper-bound pruning (WAND)
// ---------------------------------------------------------------------------

export interface WandTerm {
  term: string;
  /** Postings in doc-id order, each carrying its precomputed BM25 contribution. */
  entries: { docId: number; score: number }[];
  /** Upper bound on this term's contribution to any document. */
  maxScore: number;
}

export function wandTermFromPostings(
  term: string,
  postings: Posting[],
  scoreOf: (posting: Posting) => number,
): WandTerm {
  const entries = postings.map((p) => ({ docId: p.docId, score: scoreOf(p) }));
  return {
    term,
    entries,
    maxScore: entries.reduce((m, e) => Math.max(m, e.score), 0),
  };
}

export interface TopKRunStats {
  /** Documents whose score was actually computed. */
  fullEvaluations: number;
  /** Documents skipped because their upper bound could not reach the threshold. */
  skipped: number;
  /** Postings entries touched. */
  postingsTouched: number;
  /** The heap threshold over time, for plotting. */
  thresholdHistory: number[];
  hits: { docId: number; score: number }[];
}

/** Score every document that matches any term. The honest baseline. */
export function exhaustiveTopK(terms: WandTerm[], k: number): TopKRunStats {
  const heap = new TopKHeap(k);
  const scores = new Map<number, number>();
  let postingsTouched = 0;
  const thresholdHistory: number[] = [];

  for (const term of terms) {
    for (const entry of term.entries) {
      postingsTouched++;
      scores.set(entry.docId, (scores.get(entry.docId) ?? 0) + entry.score);
    }
  }
  for (const [docId, score] of [...scores.entries()].sort((a, b) => a[0] - b[0])) {
    heap.offer(docId, score);
    thresholdHistory.push(heap.threshold === -Infinity ? 0 : heap.threshold);
  }

  return {
    fullEvaluations: scores.size,
    skipped: 0,
    postingsTouched,
    thresholdHistory,
    hits: heap.drain(),
  };
}

/**
 * WAND. Keep the terms sorted by their current document, then find the *pivot*:
 * the first term at which the accumulated upper bounds could beat the threshold.
 * Every document before the pivot's document is provably uncompetitive, so we
 * jump straight there.
 */
export function wandTopK(terms: WandTerm[], k: number): TopKRunStats {
  const cursors = terms.map((term) => ({ term, index: 0 }));
  const heap = new TopKHeap(k);
  let fullEvaluations = 0;
  let skipped = 0;
  let postingsTouched = 0;
  const thresholdHistory: number[] = [];

  const docOf = (c: typeof cursors[number]) =>
    c.index < c.term.entries.length ? c.term.entries[c.index].docId : Infinity;

  /** Move a cursor to the first entry with docId >= target. */
  const advanceTo = (c: typeof cursors[number], target: number) => {
    while (c.index < c.term.entries.length && c.term.entries[c.index].docId < target) {
      c.index++;
      postingsTouched++;
    }
  };

  for (;;) {
    const live = cursors.filter((c) => docOf(c) !== Infinity);
    if (live.length === 0) break;
    live.sort((a, b) => docOf(a) - docOf(b));

    const threshold = heap.threshold === -Infinity ? 0 : heap.threshold;

    // Find the pivot: accumulate upper bounds in doc order until they could win.
    let accumulated = 0;
    let pivotIndex = -1;
    for (let i = 0; i < live.length; i++) {
      accumulated += live[i].term.maxScore;
      if (accumulated > threshold) {
        pivotIndex = i;
        break;
      }
    }

    if (pivotIndex === -1) {
      // Even every remaining term together cannot beat the threshold. Done.
      break;
    }

    const pivotDoc = docOf(live[pivotIndex]);

    if (docOf(live[0]) === pivotDoc) {
      // All terms up to the pivot are already on the pivot document: evaluate it.
      let score = 0;
      for (const c of live) {
        if (docOf(c) === pivotDoc) {
          score += c.term.entries[c.index].score;
          postingsTouched++;
        }
      }
      fullEvaluations++;
      heap.offer(pivotDoc, score);
      thresholdHistory.push(heap.threshold === -Infinity ? 0 : heap.threshold);
      for (const c of live) if (docOf(c) === pivotDoc) c.index++;
    } else {
      // Skip: every document between here and the pivot is uncompetitive.
      for (let i = 0; i < pivotIndex; i++) {
        const before = docOf(live[i]);
        advanceTo(live[i], pivotDoc);
        const after = docOf(live[i]);
        if (after > before) skipped++;
      }
    }
  }

  return {
    fullEvaluations,
    skipped,
    postingsTouched,
    thresholdHistory,
    hits: heap.drain(),
  };
}

// ---------------------------------------------------------------------------
// Chapter 34: rescoring
// ---------------------------------------------------------------------------

export interface RescoreResult {
  /** What cheap retrieval produced. */
  firstPass: { docId: number; score: number }[];
  /** What the expensive scorer produced from that window. */
  secondPass: { docId: number; score: number; cheapScore: number }[];
  /** Documents the expensive scorer would have promoted but never saw. */
  missedPromotions: { docId: number; trueScore: number; rank: number }[];
  expensiveEvaluations: number;
  evaluationsAvoided: number;
}

/**
 * Cheap retrieval to a window, then an expensive scorer inside it. The honest
 * part is `missedPromotions`: a window is a bet that the cheap scorer got the
 * *candidates* right, and this shows you what the bet cost.
 */
export function rescore(
  candidates: { docId: number; cheapScore: number }[],
  windowSize: number,
  expensiveScore: (docId: number, cheapScore: number) => number,
  topK: number,
): RescoreResult {
  const ranked = [...candidates].sort((a, b) => b.cheapScore - a.cheapScore);
  const window = ranked.slice(0, windowSize);

  const rescored = window
    .map((c) => ({
      docId: c.docId,
      score: expensiveScore(c.docId, c.cheapScore),
      cheapScore: c.cheapScore,
    }))
    .sort((a, b) => b.score - a.score);

  // What would have happened if we had rescored everything?
  const fullyRescored = ranked
    .map((c) => ({ docId: c.docId, score: expensiveScore(c.docId, c.cheapScore) }))
    .sort((a, b) => b.score - a.score);

  const kept = new Set(rescored.slice(0, topK).map((r) => r.docId));
  const missedPromotions = fullyRescored
    .slice(0, topK)
    .map((r, rank) => ({ docId: r.docId, trueScore: r.score, rank }))
    .filter((r) => !kept.has(r.docId));

  return {
    firstPass: ranked.slice(0, windowSize).map((c) => ({ docId: c.docId, score: c.cheapScore })),
    secondPass: rescored.slice(0, topK),
    missedPromotions,
    expensiveEvaluations: window.length,
    evaluationsAvoided: Math.max(0, candidates.length - window.length),
  };
}
