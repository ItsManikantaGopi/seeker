/**
 * The query language and its compiler (chapters 6, 10, 11, 12).
 *
 * A query is data: a tree of clauses. Compiling it produces a tree of scorers
 * (chapter 6's "execution tree"), and the two trees have the same shape, which is
 * what makes the visualisation in the labs honest rather than decorative.
 *
 * The important boundary the book keeps drawing:
 *
 *   `keyword` is a field type. `term` is a query type.
 *   `match` analyzes its input. `term` does not.
 */

import { analyzeToTerms, DEFAULT_ANALYZER, KEYWORD_ANALYZER, type AnalyzerConfig } from "./analyzer";
import { LUCENE_DEFAULTS, type Bm25Params } from "./bm25";
import type { InvertedIndex } from "./inverted-index";
import { dateToNumber } from "./inverted-index";
import {
  BoostScorer, ConjunctionScorer, ConstantScoreScorer, DisjunctionScorer,
  DocIdListScorer, EmptyScorer, ExclusionScorer, MatchAllScorer, PhraseScorer,
  ReqOptScorer, ScriptScoreScorer, TermScorer, TopKHeap,
  type Scorer, type ScoringContext,
} from "./iterators";
import { pointRange, type RangeQuery } from "./points";
import { compileScript } from "./script";
import { TermDictionary, autoFuzziness } from "./term-dictionary";
import {
  NO_MORE_DOCS, newExecStats,
  type ExecStats, type Explanation, type Hit, type SearchResult,
} from "./types";

// ---------------------------------------------------------------------------
// The AST
// ---------------------------------------------------------------------------

export interface QueryBase {
  boost?: number;
}

export type Query =
  | ({ kind: "match_all" } & QueryBase)
  | ({ kind: "match_none" } & QueryBase)
  | ({ kind: "term"; field: string; value: string } & QueryBase)
  | ({ kind: "terms"; field: string; values: string[] } & QueryBase)
  | ({ kind: "match"; field: string; text: string; operator?: "or" | "and"; minimumShouldMatch?: number } & QueryBase)
  | ({ kind: "phrase"; field: string; text: string; slop?: number } & QueryBase)
  | ({ kind: "prefix"; field: string; value: string; maxExpansions?: number } & QueryBase)
  | ({ kind: "wildcard"; field: string; pattern: string; maxExpansions?: number } & QueryBase)
  | ({ kind: "regexp"; field: string; pattern: string; maxExpansions?: number } & QueryBase)
  | ({
      kind: "fuzzy"; field: string; value: string;
      maxEdits?: number; prefixLength?: number; maxExpansions?: number; transpositions?: boolean;
    } & QueryBase)
  | ({ kind: "range"; field: string } & RangeQuery & QueryBase)
  | ({
      kind: "bool";
      must?: Query[]; filter?: Query[]; should?: Query[]; must_not?: Query[];
      minimumShouldMatch?: number;
    } & QueryBase)
  | ({ kind: "script_score"; query: Query; script: string } & QueryBase);

export function describeQuery(query: Query): string {
  switch (query.kind) {
    case "match_all": return "match_all";
    case "match_none": return "match_none";
    case "term": return `term(${query.field}:${query.value})`;
    case "terms": return `terms(${query.field}:${query.values.join(",")})`;
    case "match": return `match(${query.field}:"${query.text}"${query.operator === "and" ? " AND" : ""})`;
    case "phrase": return `phrase(${query.field}:"${query.text}"${query.slop ? `~${query.slop}` : ""})`;
    case "prefix": return `prefix(${query.field}:${query.value}*)`;
    case "wildcard": return `wildcard(${query.field}:${query.pattern})`;
    case "regexp": return `regexp(${query.field}:/${query.pattern}/)`;
    case "fuzzy": return `fuzzy(${query.field}:${query.value}~${query.maxEdits ?? "auto"})`;
    case "range": {
      const parts: string[] = [];
      if (query.gte !== undefined) parts.push(`>= ${query.gte}`);
      if (query.gt !== undefined) parts.push(`> ${query.gt}`);
      if (query.lte !== undefined) parts.push(`<= ${query.lte}`);
      if (query.lt !== undefined) parts.push(`< ${query.lt}`);
      return `range(${query.field} ${parts.join(" ")})`;
    }
    case "bool": {
      const parts: string[] = [];
      if (query.must?.length) parts.push(`must[${query.must.length}]`);
      if (query.filter?.length) parts.push(`filter[${query.filter.length}]`);
      if (query.should?.length) parts.push(`should[${query.should.length}]`);
      if (query.must_not?.length) parts.push(`must_not[${query.must_not.length}]`);
      return `bool(${parts.join(" ")})`;
    }
    case "script_score": return `script_score(${query.script})`;
  }
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

export interface ExpansionRecord {
  query: string;
  field: string;
  method: string;
  terms: string[];
  work: number;
  clipped: boolean;
  totalBeforeClip: number;
  note?: string;
}

export interface CompileContext extends ScoringContext {
  /** Which analyzer to use for a field at query time (chapter 3). */
  analyzerFor(field: string): AnalyzerConfig;
  dictionary(field: string): TermDictionary;
  expansions: ExpansionRecord[];
  resolvedTerms: { field: string; term: string; docFreq: number }[];
  /** Numeric fields are points, not terms. */
  isNumericField(field: string): boolean;
  maxClauses: number;
}

const NUMERIC_FIELDS = new Set(["price", "rating", "created_at"]);

export function isNumericField(field: string): boolean {
  return NUMERIC_FIELDS.has(field);
}

/** Numeric fields keep their own units; dates are stored as day numbers. */
function coerceNumeric(field: string, value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  if (field === "created_at") return dateToNumber(value);
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function recordTerm(ctx: CompileContext, field: string, term: string) {
  const docFreq = ctx.index.docFreq(field, term);
  if (!ctx.resolvedTerms.some((r) => r.field === field && r.term === term)) {
    ctx.resolvedTerms.push({ field, term, docFreq });
  }
}

function termScorer(
  ctx: CompileContext,
  field: string,
  term: string,
  boost: number,
  scoring: boolean,
): Scorer {
  recordTerm(ctx, field, term);
  const postings = ctx.index.postings(field, term);
  if (!postings || postings.length === 0) {
    // Chapter 9: no postings means no candidates. Not a zero score — no document.
    return new EmptyScorer(`term(${field}:${term}) [not in dictionary]`);
  }
  return new TermScorer(field, term, postings, ctx, boost, scoring);
}

/** Expand a multi-term query into a disjunction, honouring `maxExpansions`. */
function expansionScorer(
  ctx: CompileContext,
  field: string,
  label: string,
  expansion: { terms: string[]; method: string; work: number; clipped: boolean; totalBeforeClip: number; note?: string },
  boost: number,
  scoring: boolean,
): Scorer {
  ctx.expansions.push({
    query: label, field,
    method: expansion.method,
    terms: expansion.terms,
    work: expansion.work,
    clipped: expansion.clipped,
    totalBeforeClip: expansion.totalBeforeClip,
    note: expansion.note,
  });
  ctx.stats.termsExpanded += expansion.terms.length;
  if (expansion.clipped) ctx.stats.expansionsClipped += expansion.totalBeforeClip - expansion.terms.length;

  if (expansion.terms.length === 0) return new EmptyScorer(`${label} [no matching terms]`);
  const subs = expansion.terms.map((t) => termScorer(ctx, field, t, boost, scoring));
  if (subs.length === 1) return subs[0];
  return new DisjunctionScorer(subs, 1, ctx.stats);
}

export function compile(query: Query, ctx: CompileContext, scoring = true): Scorer {
  const boost = query.boost ?? 1;

  switch (query.kind) {
    case "match_all":
      return new MatchAllScorer(ctx.index.maxDoc, boost);

    case "match_none":
      return new EmptyScorer("match_none");

    case "term":
      // A term query does not analyze its input. That is the whole point of it.
      return termScorer(ctx, query.field, query.value, boost, scoring);

    case "terms": {
      const subs = query.values.map((v) => termScorer(ctx, query.field, v, boost, scoring));
      if (subs.length === 0) return new EmptyScorer("terms[]");
      if (subs.length === 1) return subs[0];
      return new DisjunctionScorer(subs, 1, ctx.stats);
    }

    case "match": {
      // A match query *does* analyze, with the same analyzer the field used at
      // index time. Chapter 3: mismatched analysis is how queries silently miss.
      const terms = analyzeToTerms(query.text, ctx.analyzerFor(query.field));
      if (terms.length === 0) return new EmptyScorer(`match(${query.field}) [analyzed to nothing]`);
      const subs = terms.map((t) => termScorer(ctx, query.field, t, boost, scoring));
      if (subs.length === 1) return subs[0];
      if (query.operator === "and") return new ConjunctionScorer(subs, ctx.stats);
      const min = query.minimumShouldMatch ?? 1;
      return new DisjunctionScorer(subs, Math.max(1, Math.min(min, subs.length)), ctx.stats);
    }

    case "phrase": {
      const terms = analyzeToTerms(query.text, ctx.analyzerFor(query.field));
      if (terms.length === 0) return new EmptyScorer(`phrase(${query.field}) [analyzed to nothing]`);
      if (terms.length === 1) return termScorer(ctx, query.field, terms[0], boost, scoring);

      const termScorers = [];
      for (const t of terms) {
        recordTerm(ctx, query.field, t);
        const postings = ctx.index.postings(query.field, t);
        if (!postings || postings.length === 0) {
          return new EmptyScorer(`phrase(${query.field}:"${query.text}") [${t} not in dictionary]`);
        }
        termScorers.push(new TermScorer(query.field, t, postings, ctx, 1, false));
      }
      return new PhraseScorer(
        query.field, terms, termScorers, query.slop ?? 0, ctx, boost, scoring,
      );
    }

    case "prefix": {
      const dict = ctx.dictionary(query.field);
      return expansionScorer(
        ctx, query.field, `${query.value}*`,
        dict.prefixRange(query.value, query.maxExpansions ?? ctx.maxClauses),
        boost, scoring,
      );
    }

    case "wildcard": {
      const dict = ctx.dictionary(query.field);
      return expansionScorer(
        ctx, query.field, query.pattern,
        dict.wildcard(query.pattern, query.maxExpansions ?? ctx.maxClauses),
        boost, scoring,
      );
    }

    case "regexp": {
      const dict = ctx.dictionary(query.field);
      return expansionScorer(
        ctx, query.field, `/${query.pattern}/`,
        dict.regexp(query.pattern, query.maxExpansions ?? ctx.maxClauses),
        boost, scoring,
      );
    }

    case "fuzzy": {
      const dict = ctx.dictionary(query.field);
      const maxEdits = query.maxEdits ?? autoFuzziness(query.value);
      const result = dict.fuzzy(query.value, {
        maxEdits,
        prefixLength: query.prefixLength,
        maxExpansions: query.maxExpansions ?? ctx.maxClauses,
        transpositions: query.transpositions,
      });
      return expansionScorer(
        ctx, query.field, `${query.value}~${maxEdits}`, result, boost, scoring,
      );
    }

    case "range": {
      if (!ctx.isNumericField(query.field)) {
        // A range over a keyword field is a term range: valid, but it walks the
        // dictionary rather than a point index.
        const dict = ctx.dictionary(query.field);
        const lower = query.gte ?? query.gt;
        const upper = query.lte ?? query.lt;
        const terms = dict.sortedTerms.filter((t) => {
          if (lower !== undefined && (query.gt !== undefined ? t <= String(lower) : t < String(lower))) return false;
          if (upper !== undefined && (query.lt !== undefined ? t >= String(upper) : t > String(upper))) return false;
          return true;
        });
        return expansionScorer(
          ctx, query.field, `range(${query.field})`,
          {
            terms, method: "term range over the sorted dictionary",
            work: dict.size, clipped: false, totalBeforeClip: terms.length,
            note: "This field is not numeric, so there is no point index to use.",
          },
          boost, false,
        );
      }

      const values = ctx.index.pointValues(query.field);
      const range: RangeQuery = {
        gte: coerceNumeric(query.field, query.gte),
        lte: coerceNumeric(query.field, query.lte),
        gt: coerceNumeric(query.field, query.gt),
        lt: coerceNumeric(query.field, query.lt),
      };
      const result = pointRange(values, range);
      ctx.stats.pointNodesVisited += result.comparisons;
      ctx.stats.pointNodesSkipped += Math.max(0, result.scanCost - (result.to - result.from) - result.comparisons);
      // A range answers "does this document match", not "how well". When it sits
      // in a scoring position it contributes a constant, like Lucene does.
      return new DocIdListScorer(
        `range(${query.field})`, result.docIds, scoring ? boost : 0, ctx.stats,
      );
    }

    case "bool": {
      const must = (query.must ?? []).map((q) => compile(q, ctx, scoring));
      // Filter clauses are required but never scored, which is what makes them
      // cacheable (chapter 28).
      const filter = (query.filter ?? []).map((q) => new ConstantScoreScorer(compile(q, ctx, false)));
      const should = (query.should ?? []).map((q) => compile(q, ctx, scoring));
      const mustNot = (query.must_not ?? []).map((q) => compile(q, ctx, false));

      const required = [...must, ...filter];
      let base: Scorer;

      if (required.length > 0) {
        const requiredScorer = required.length === 1 ? required[0] : new ConjunctionScorer(required, ctx.stats);
        if (should.length > 0) {
          const min = query.minimumShouldMatch ?? 0;
          if (min > 0) {
            // With minimum_should_match the should clauses become required too.
            base = new ConjunctionScorer(
              [requiredScorer, new DisjunctionScorer(should, Math.min(min, should.length), ctx.stats)],
              ctx.stats,
            );
          } else {
            base = new ReqOptScorer(
              requiredScorer,
              new DisjunctionScorer(should, 1, ctx.stats),
            );
          }
        } else {
          base = requiredScorer;
        }
      } else if (should.length > 0) {
        const min = query.minimumShouldMatch ?? 1;
        base = should.length === 1 && min <= 1
          ? should[0]
          : new DisjunctionScorer(should, Math.max(1, Math.min(min, should.length)), ctx.stats);
      } else if (mustNot.length > 0) {
        base = new MatchAllScorer(ctx.index.maxDoc, boost);
      } else {
        return new EmptyScorer("bool [no clauses]");
      }

      if (mustNot.length > 0) base = new ExclusionScorer(base, mustNot, ctx.stats);
      return boost !== 1 ? new BoostScorer(base, boost) : base;
    }

    case "script_score": {
      const inner = compile(query.query, ctx, scoring);
      const script = compileScript(query.script);
      return new ScriptScoreScorer(
        inner,
        (docId, baseScore) => script.evaluate({
          _score: baseScore,
          price: ctx.index.numericValue("price", docId),
          rating: ctx.index.numericValue("rating", docId),
          created_at: ctx.index.numericValue("created_at", docId),
          lat: ctx.index.numericValue("lat", docId),
          lon: ctx.index.numericValue("lon", docId),
        }),
        query.script,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchOptions {
  topK?: number;
  params?: Bm25Params;
  explain?: boolean;
  /** Cap on expanded clauses, the `indices.query.bool.max_clause_count` idea. */
  maxClauses?: number;
  analyzerFor?: (field: string) => AnalyzerConfig;
}

export interface SearchContext {
  index: InvertedIndex;
  dictionaries: Map<string, TermDictionary>;
}

export function makeSearchContext(index: InvertedIndex): SearchContext {
  return { index, dictionaries: new Map() };
}

export function dictionaryFor(sc: SearchContext, field: string): TermDictionary {
  let dict = sc.dictionaries.get(field);
  if (!dict) {
    dict = new TermDictionary(field, sc.index.sortedTerms(field));
    sc.dictionaries.set(field, dict);
  }
  return dict;
}

function defaultAnalyzerFor(field: string): AnalyzerConfig {
  // Query-time analysis must match index-time analysis, so this mirrors
  // `corpus.analyzerFor`. Text fields analyze; keyword fields do not.
  return field === "title" || field === "body" ? DEFAULT_ANALYZER : KEYWORD_ANALYZER;
}

export function buildCompileContext(
  sc: SearchContext,
  options: SearchOptions = {},
): CompileContext {
  const stats = newExecStats();
  return {
    index: sc.index,
    params: options.params ?? LUCENE_DEFAULTS,
    stats,
    analyzerFor: options.analyzerFor ?? defaultAnalyzerFor,
    dictionary: (field) => dictionaryFor(sc, field),
    expansions: [],
    resolvedTerms: [],
    isNumericField,
    maxClauses: options.maxClauses ?? 1024,
  };
}

export interface FullSearchResult extends SearchResult {
  expansions: ExpansionRecord[];
  /** The compiled scorer tree, flattened for display. */
  plan: PlanNode;
  heapStats: { pushed: number; replaced: number; discarded: number };
}

export interface PlanNode {
  label: string;
  cost: number;
  maxScore: number;
  children: PlanNode[];
}

export function planOf(scorer: Scorer): PlanNode {
  return {
    label: scorer.label,
    cost: scorer.cost(),
    maxScore: scorer.maxScore(),
    children: scorer.children().map(planOf),
  };
}

export function search(
  sc: SearchContext,
  query: Query,
  options: SearchOptions = {},
): FullSearchResult {
  const topK = options.topK ?? 10;
  const ctx = buildCompileContext(sc, options);
  const started = performance.now();

  const scorer = compile(query, ctx);
  const plan = planOf(scorer);
  const heap = new TopKHeap(topK);

  let totalCandidates = 0;
  for (let doc = scorer.nextDoc(); doc !== NO_MORE_DOCS; doc = scorer.nextDoc()) {
    if (sc.index.isDeleted(doc)) continue;
    totalCandidates++;
    ctx.stats.docsScored++;
    heap.offer(doc, scorer.score());
  }

  const drained = heap.drain();
  const hits: Hit[] = drained.map(({ docId, score }) => ({ docId, score }));

  if (options.explain !== false) {
    // Explanations need the scorer positioned on the document, so compile a
    // fresh one and advance to each hit. Cheap for K documents, and it keeps the
    // hot loop above free of explanation bookkeeping.
    for (const hit of hits) {
      const explainCtx = buildCompileContext(sc, options);
      const explainScorer = compile(query, explainCtx);
      const landed = explainScorer.advance(hit.docId);
      if (landed === hit.docId) {
        hit.explanation = explainScorer.explain() ?? undefined;
        hit.matchedTerms = [...new Set(explainScorer.matchedTerms())];
      }
    }
  }

  return {
    hits,
    totalCandidates,
    stats: ctx.stats,
    resolvedTerms: ctx.resolvedTerms,
    tookMicros: (performance.now() - started) * 1000,
    expansions: ctx.expansions,
    plan,
    heapStats: { pushed: heap.pushed, replaced: heap.replaced, discarded: heap.discarded },
  };
}

/** Explain one specific document, whether or not it made the top K. */
export function explainDoc(
  sc: SearchContext,
  query: Query,
  docId: number,
  options: SearchOptions = {},
): { matched: boolean; explanation: Explanation | null } {
  const ctx = buildCompileContext(sc, options);
  const scorer = compile(query, ctx);
  const landed = scorer.advance(docId);
  if (landed !== docId) {
    return {
      matched: false,
      explanation: {
        value: 0,
        description: "This document does not match the query, so it is never scored.",
      },
    };
  }
  return { matched: true, explanation: scorer.explain() };
}

/** Every matching document, unranked. The oracle for differential testing. */
export function collectAll(sc: SearchContext, query: Query, options: SearchOptions = {}): number[] {
  const ctx = buildCompileContext(sc, options);
  const scorer = compile(query, ctx);
  const out: number[] = [];
  for (let doc = scorer.nextDoc(); doc !== NO_MORE_DOCS; doc = scorer.nextDoc()) {
    if (!sc.index.isDeleted(doc)) out.push(doc);
  }
  return out;
}

export type { ExecStats };
