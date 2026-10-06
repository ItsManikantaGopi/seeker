/**
 * Core types shared by every stage of the Kaus engine.
 *
 * Chapter 2 of the book: a document is a logical record, a field is a named
 * value inside it, and different field types demand different index structures.
 */

export type FieldType = "text" | "keyword" | "numeric" | "date" | "geo_point";

/** A raw source document, exactly as a user would hand it to the engine. */
export interface SourceDoc {
  id: string;
  title: string;
  body: string;
  status: string;
  tags: string[];
  author: string;
  price: number;
  rating: number;
  created_at: string;
  lat: number;
  lon: number;
}

/** An internal document: a dense integer id plus the source we can fetch later. */
export interface StoredDoc {
  docId: number;
  source: SourceDoc;
}

export interface FieldMapping {
  name: string;
  type: FieldType;
  /** Which analyzer to run at index time. Only meaningful for `text`. */
  analyzer?: string;
  /** Sub-fields, e.g. `title.keyword`. Chapter 2's multi-field pattern. */
  fields?: FieldMapping[];
  /** Store positions? Phrase queries need them (chapter 5). */
  positions?: boolean;
  description?: string;
}

/** One analysis token. A token is intermediate; a *term* is what gets indexed. */
export interface Token {
  text: string;
  position: number;
  start: number;
  end: number;
  type: string;
  /** Set when a filter removed this token, so the UI can show the gap. */
  removed?: boolean;
}

/** A single posting: which document, how often, and where. */
export interface Posting {
  docId: number;
  freq: number;
  positions: number[];
}

export interface TermStats {
  term: string;
  docFreq: number;
  totalTermFreq: number;
}

export const NO_MORE_DOCS = 2147483647;

/** Counters we thread through query execution so the UI can show real work. */
export interface ExecStats {
  termLookups: number;
  postingsRead: number;
  docsVisited: number;
  advanceCalls: number;
  docsScored: number;
  docsSkipped: number;
  termsExpanded: number;
  expansionsClipped: number;
  positionChecks: number;
  pointNodesVisited: number;
  pointNodesSkipped: number;
}

export function newExecStats(): ExecStats {
  return {
    termLookups: 0,
    postingsRead: 0,
    docsVisited: 0,
    advanceCalls: 0,
    docsScored: 0,
    docsSkipped: 0,
    termsExpanded: 0,
    expansionsClipped: 0,
    positionChecks: 0,
    pointNodesVisited: 0,
    pointNodesSkipped: 0,
  };
}

export function mergeExecStats(a: ExecStats, b: ExecStats): ExecStats {
  const out = { ...a } as unknown as Record<string, number>;
  for (const [k, v] of Object.entries(b)) out[k] += v as number;
  return out as unknown as ExecStats;
}

/** A node in a score explanation tree (mirrors Lucene's `explain`). */
export interface Explanation {
  value: number;
  description: string;
  details?: Explanation[];
}

export interface Hit {
  docId: number;
  score: number;
  explanation?: Explanation;
  /** Which shard produced this hit, when running distributed (chapter 33). */
  shard?: number;
  matchedTerms?: string[];
}

export interface SearchResult {
  hits: Hit[];
  totalCandidates: number;
  stats: ExecStats;
  /** Terms the query actually resolved to after analysis + expansion. */
  resolvedTerms: { field: string; term: string; docFreq: number }[];
  tookMicros: number;
}
