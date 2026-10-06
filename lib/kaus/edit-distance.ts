/**
 * Edit distance (chapter 13).
 *
 * The dynamic-programming table is the correctness oracle for everything in
 * chapters 14 and 15. It is slow on purpose: we keep it forever and test the
 * fast path against it (chapter 42).
 */

export type EditOp = "match" | "substitute" | "insert" | "delete" | "transpose";

export interface EditStep {
  op: EditOp;
  /** Index into the source string (a), or -1 for an insertion. */
  i: number;
  /** Index into the target string (b), or -1 for a deletion. */
  j: number;
  a?: string;
  b?: string;
}

export interface EditDistanceResult {
  distance: number;
  /** table[i][j] = edits to turn a[0..i) into b[0..j) */
  table: number[][];
  /** The traceback, from the start of both strings to the end. */
  steps: EditStep[];
  /** Cells on the optimal path, for highlighting. */
  path: [number, number][];
}

export function levenshteinTable(a: string, b: string, transpositions = false): EditDistanceResult {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));

  for (let i = 0; i <= n; i++) table[i][0] = i;
  for (let j = 0; j <= m; j++) table[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        table[i][j] = table[i - 1][j - 1];
      } else {
        table[i][j] = 1 + Math.min(
          table[i - 1][j],     // delete a[i-1]
          table[i][j - 1],     // insert b[j-1]
          table[i - 1][j - 1], // substitute
        );
      }
      // Damerau: adjacent transposition
      if (
        transpositions &&
        i > 1 && j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        table[i][j] = Math.min(table[i][j], table[i - 2][j - 2] + 1);
      }
    }
  }

  // --- traceback ----------------------------------------------------------
  const steps: EditStep[] = [];
  const path: [number, number][] = [];
  let i = n;
  let j = m;
  path.push([i, j]);
  while (i > 0 || j > 0) {
    if (
      transpositions &&
      i > 1 && j > 1 &&
      a[i - 1] === b[j - 2] &&
      a[i - 2] === b[j - 1] &&
      table[i][j] === table[i - 2][j - 2] + 1
    ) {
      steps.push({ op: "transpose", i: i - 2, j: j - 2, a: a.slice(i - 2, i), b: b.slice(j - 2, j) });
      i -= 2;
      j -= 2;
    } else if (i > 0 && j > 0 && a[i - 1] === b[j - 1] && table[i][j] === table[i - 1][j - 1]) {
      steps.push({ op: "match", i: i - 1, j: j - 1, a: a[i - 1], b: b[j - 1] });
      i--;
      j--;
    } else if (i > 0 && j > 0 && table[i][j] === table[i - 1][j - 1] + 1) {
      steps.push({ op: "substitute", i: i - 1, j: j - 1, a: a[i - 1], b: b[j - 1] });
      i--;
      j--;
    } else if (i > 0 && table[i][j] === table[i - 1][j] + 1) {
      steps.push({ op: "delete", i: i - 1, j: -1, a: a[i - 1] });
      i--;
    } else {
      steps.push({ op: "insert", i: -1, j: j - 1, b: b[j - 1] });
      j--;
    }
    path.push([i, j]);
  }

  steps.reverse();
  path.reverse();
  return { distance: table[n][m], table, steps, path };
}

export function levenshtein(a: string, b: string): number {
  // Two-row version: same answer, no table to look at.
  const m = b.length;
  let prev = new Array<number>(m + 1);
  let curr = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= m; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[m];
}

export function damerauLevenshtein(a: string, b: string): number {
  return levenshteinTable(a, b, true).distance;
}

export interface BruteForceResult {
  terms: string[];
  comparisons: number;
  /** Distance for each accepted term, so the UI can group by edit count. */
  distances: Map<string, number>;
}

/**
 * Chapter 13's first fuzzy implementation: compare the query with every term in
 * the vocabulary. This is the oracle, not the plan.
 */
export function bruteForceFuzzy(
  query: string,
  vocabulary: string[],
  maxEdits: number,
  options: { prefixLength?: number; transpositions?: boolean } = {},
): BruteForceResult {
  const prefixLength = options.prefixLength ?? 0;
  const fixed = query.slice(0, prefixLength);
  const terms: string[] = [];
  const distances = new Map<string, number>();
  let comparisons = 0;

  for (const term of vocabulary) {
    comparisons++;
    if (prefixLength > 0 && !term.startsWith(fixed)) continue;
    const d = options.transpositions
      ? damerauLevenshtein(query, term)
      : levenshtein(query, term);
    if (d <= maxEdits) {
      terms.push(term);
      distances.set(term, d);
    }
  }
  return { terms, comparisons, distances };
}
