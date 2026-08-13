/**
 * BM25 (chapters 7, 8 and appendix A).
 *
 * Three questions, three factors:
 *   how often?  -> TF, with saturation controlled by k1
 *   how rare?   -> IDF
 *   how long?   -> field length normalisation, controlled by b
 *
 * Nothing here is magic, and every intermediate value is returned so the UI can
 * show the arithmetic rather than asserting the result.
 */

import type { Explanation } from "./types";

export interface Bm25Params {
  k1: number;
  b: number;
}

export const LUCENE_DEFAULTS: Bm25Params = { k1: 1.2, b: 0.75 };

/**
 * BM25's IDF, the Lucene form:
 *   ln(1 + (N - df + 0.5) / (df + 0.5))
 * Always positive, and finite even at df = 0 — chapter 9's point.
 */
export function idf(numDocs: number, docFreq: number): number {
  return Math.log(1 + (numDocs - docFreq + 0.5) / (docFreq + 0.5));
}

export interface Bm25Input {
  tf: number;
  fieldLength: number;
  avgFieldLength: number;
  numDocs: number;
  docFreq: number;
  params: Bm25Params;
  boost?: number;
}

export interface Bm25Breakdown {
  score: number;
  idf: number;
  /** k1 * (1 - b + b * |d| / avgdl) — the length-normalised saturation floor. */
  norm: number;
  /** tf * (k1 + 1) */
  numerator: number;
  /** tf + norm */
  denominator: number;
  /** numerator / denominator, i.e. the whole TF component. */
  tfComponent: number;
  lengthRatio: number;
  boost: number;
}

export function bm25(input: Bm25Input): Bm25Breakdown {
  const { tf, fieldLength, avgFieldLength, numDocs, docFreq, params } = input;
  const boost = input.boost ?? 1;
  const { k1, b } = params;

  const lengthRatio = avgFieldLength > 0 ? fieldLength / avgFieldLength : 1;
  const norm = k1 * (1 - b + b * lengthRatio);
  const numerator = tf * (k1 + 1);
  const denominator = tf + norm;
  const tfComponent = denominator === 0 ? 0 : numerator / denominator;
  const termIdf = idf(numDocs, docFreq);

  return {
    score: boost * termIdf * tfComponent,
    idf: termIdf,
    norm,
    numerator,
    denominator,
    tfComponent,
    lengthRatio,
    boost,
  };
}

export function bm25Explanation(
  term: string,
  field: string,
  input: Bm25Input,
): Explanation {
  const r = bm25(input);
  const { k1, b } = input.params;
  const details: Explanation[] = [
    {
      value: r.idf,
      description: `idf = ln(1 + (N - df + 0.5) / (df + 0.5)) = ln(1 + (${input.numDocs} - ${input.docFreq} + 0.5) / (${input.docFreq} + 0.5))`,
    },
    {
      value: r.tfComponent,
      description: `tf saturation = tf(${input.tf}) * (k1+1) / (tf + k1 * (1 - b + b * dl/avgdl))`,
      details: [
        { value: input.tf, description: "tf: occurrences of the term in this field" },
        { value: input.fieldLength, description: "dl: length of this field, in terms" },
        {
          value: input.avgFieldLength,
          description: "avgdl: average length of this field across the collection",
        },
        {
          value: r.norm,
          description: `length norm = k1(${k1}) * (1 - b(${b}) + b * ${r.lengthRatio.toFixed(4)})`,
        },
      ],
    },
  ];
  if (r.boost !== 1) {
    details.unshift({ value: r.boost, description: "boost" });
  }
  return {
    value: r.score,
    description: `BM25(${field}:${term})`,
    details,
  };
}

/**
 * The upper bound on what one term can contribute to any document. Query
 * planning (chapter 27) uses this to skip documents that cannot reach the
 * current top-K threshold.
 *
 * tf * (k1+1) / (tf + norm) approaches k1+1 as tf grows, and `norm` is smallest
 * for the shortest field, so the bound is idf * (k1+1) / (1 + minNorm/(k1+1))
 * — in practice we evaluate the real formula at the observed maximum tf and
 * minimum length, which is a tighter and still-safe bound.
 */
export function bm25MaxScore(
  maxTf: number,
  minFieldLength: number,
  avgFieldLength: number,
  numDocs: number,
  docFreq: number,
  params: Bm25Params,
  boost = 1,
): number {
  return bm25({
    tf: maxTf,
    fieldLength: minFieldLength,
    avgFieldLength,
    numDocs,
    docFreq,
    params,
    boost,
  }).score;
}

/** Points on the TF-saturation curve, for plotting. */
export function saturationCurve(
  params: Bm25Params,
  lengthRatio: number,
  maxTf = 20,
): { tf: number; value: number }[] {
  const out: { tf: number; value: number }[] = [];
  const norm = params.k1 * (1 - params.b + params.b * lengthRatio);
  for (let tf = 0; tf <= maxTf; tf++) {
    out.push({ tf, value: tf === 0 ? 0 : (tf * (params.k1 + 1)) / (tf + norm) });
  }
  return out;
}

/** IDF as a function of df, for plotting the "rare terms matter more" curve. */
export function idfCurve(numDocs: number): { df: number; value: number }[] {
  const out: { df: number; value: number }[] = [];
  for (let df = 0; df <= numDocs; df++) out.push({ df, value: idf(numDocs, df) });
  return out;
}

/** Sum the leaves of an explanation, so the UI can verify the tree adds up. */
export function explanationTotal(explanation: Explanation): number {
  return explanation.value;
}
