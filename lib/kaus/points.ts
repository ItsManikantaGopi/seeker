/**
 * Points and range indexing (chapter 20).
 *
 * Text search asks "does this document contain this term?". Numeric search asks
 * "is this value between A and B?". A term dictionary answers the first question
 * badly for the second: you would have to enumerate every value in the range as
 * a term.
 *
 * Sort the values once and binary search the endpoints. That single change is
 * already the difference between reading every document and reading an interval.
 */

import type { PointEntry } from "./inverted-index";

export interface BinarySearchStep {
  lo: number;
  hi: number;
  mid: number;
  midValue: number;
  decision: "go-right" | "go-left" | "found-boundary";
}

export interface BoundResult {
  index: number;
  steps: BinarySearchStep[];
  comparisons: number;
}

/** First index whose value is >= target. */
export function lowerBound(values: PointEntry[], target: number): BoundResult {
  const steps: BinarySearchStep[] = [];
  let lo = 0;
  let hi = values.length;
  let comparisons = 0;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    comparisons++;
    const midValue = values[mid].value;
    if (midValue < target) {
      steps.push({ lo, hi, mid, midValue, decision: "go-right" });
      lo = mid + 1;
    } else {
      steps.push({ lo, hi, mid, midValue, decision: "go-left" });
      hi = mid;
    }
  }
  return { index: lo, steps, comparisons };
}

/** First index whose value is > target. */
export function upperBound(values: PointEntry[], target: number): BoundResult {
  const steps: BinarySearchStep[] = [];
  let lo = 0;
  let hi = values.length;
  let comparisons = 0;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    comparisons++;
    const midValue = values[mid].value;
    if (midValue <= target) {
      steps.push({ lo, hi, mid, midValue, decision: "go-right" });
      lo = mid + 1;
    } else {
      steps.push({ lo, hi, mid, midValue, decision: "go-left" });
      hi = mid;
    }
  }
  return { index: lo, steps, comparisons };
}

export interface RangeQuery {
  gte?: number;
  lte?: number;
  gt?: number;
  lt?: number;
}

export interface PointRangeResult {
  docIds: number[];
  /** The half-open interval of the sorted array that matched. */
  from: number;
  to: number;
  comparisons: number;
  lowerSteps: BinarySearchStep[];
  upperSteps: BinarySearchStep[];
  /** How many values the naive alternative would have examined. */
  scanCost: number;
}

/**
 * Resolve a range query against the sorted point values.
 * Strict bounds are handled by nudging which boundary function we use.
 */
export function pointRange(values: PointEntry[], query: RangeQuery): PointRangeResult {
  const lowerTarget = query.gte ?? query.gt;
  const upperTarget = query.lte ?? query.lt;

  let from = 0;
  let lowerSteps: BinarySearchStep[] = [];
  let comparisons = 0;
  if (lowerTarget !== undefined) {
    // `gte 100` starts at the first 100; `gt 100` starts after the last 100.
    const r = query.gt !== undefined
      ? upperBound(values, query.gt)
      : lowerBound(values, lowerTarget);
    from = r.index;
    lowerSteps = r.steps;
    comparisons += r.comparisons;
  }

  let to = values.length;
  let upperSteps: BinarySearchStep[] = [];
  if (upperTarget !== undefined) {
    const r = query.lt !== undefined
      ? lowerBound(values, query.lt)
      : upperBound(values, upperTarget);
    to = r.index;
    upperSteps = r.steps;
    comparisons += r.comparisons;
  }

  const docIds: number[] = [];
  for (let i = from; i < Math.max(from, to); i++) docIds.push(values[i].docId);
  // Postings must be in docId order for the iterators in chapter 6 to work.
  docIds.sort((a, b) => a - b);

  return {
    docIds,
    from,
    to: Math.max(from, to),
    comparisons,
    lowerSteps,
    upperSteps,
    scanCost: values.length,
  };
}

/** The oracle: look at every value. Used for differential testing. */
export function naivePointRange(values: PointEntry[], query: RangeQuery): number[] {
  const out: number[] = [];
  for (const { value, docId } of values) {
    if (query.gte !== undefined && value < query.gte) continue;
    if (query.gt !== undefined && value <= query.gt) continue;
    if (query.lte !== undefined && value > query.lte) continue;
    if (query.lt !== undefined && value >= query.lt) continue;
    out.push(docId);
  }
  return out.sort((a, b) => a - b);
}

export function describeRange(field: string, query: RangeQuery): string {
  const parts: string[] = [];
  if (query.gte !== undefined) parts.push(`${field} >= ${query.gte}`);
  if (query.gt !== undefined) parts.push(`${field} > ${query.gt}`);
  if (query.lte !== undefined) parts.push(`${field} <= ${query.lte}`);
  if (query.lt !== undefined) parts.push(`${field} < ${query.lt}`);
  return parts.length ? parts.join(" AND ") : `${field}: any`;
}
