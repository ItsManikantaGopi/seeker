/**
 * The inverted index (chapters 4 and 5).
 *
 * Chapter 4 starts with `term -> set(docID)`. That is genuinely all you need to
 * beat a full scan. Chapter 5 then adds what a real postings list carries:
 * frequency and positions. This class is the chapter-5 version, because the
 * chapter-4 version is one line and we can show it side by side in the UI.
 */

import { analyzeToTerms, KEYWORD_ANALYZER } from "./analyzer";
import type { AnalyzerConfig } from "./analyzer";
import type { Posting, SourceDoc, StoredDoc, TermStats } from "./types";

export interface FieldIndex {
  field: string;
  /** term -> postings, each postings list sorted by ascending docId. */
  terms: Map<string, Posting[]>;
  /** Number of indexed terms per document. `norms`, in Lucene language. */
  fieldLength: number[];
  docsWithField: number;
  sumFieldLength: number;
  hasPositions: boolean;
}

export interface PointEntry {
  value: number;
  docId: number;
}

export interface FieldStats {
  field: string;
  vocabularySize: number;
  postingsEntries: number;
  avgFieldLength: number;
  maxFieldLength: number;
}

/** A date string becomes a number. Chapter 2: "date/numeric". */
export function dateToNumber(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : Math.round(t / 86400000);
}

export function numberToDate(days: number): string {
  return new Date(days * 86400000).toISOString().slice(0, 10);
}

export type AnalyzerResolver = (field: string) => AnalyzerConfig;

export class InvertedIndex {
  readonly docs: StoredDoc[] = [];
  readonly fields = new Map<string, FieldIndex>();
  /** Sorted numeric values per field — the chapter 20 point index. */
  readonly points = new Map<string, PointEntry[]>();
  /** (lat, lon, docId) triples for the KD/BKD chapters. */
  readonly geoPoints: { lat: number; lon: number; docId: number }[] = [];
  readonly deleted = new Set<number>();

  private pointsSorted = true;
  private sortedTermCache = new Map<string, string[]>();

  constructor(private readonly resolveAnalyzer: AnalyzerResolver) {}

  get numDocs(): number {
    return this.docs.length - this.deleted.size;
  }

  get maxDoc(): number {
    return this.docs.length;
  }

  private fieldIndex(field: string, hasPositions: boolean): FieldIndex {
    let fi = this.fields.get(field);
    if (!fi) {
      fi = {
        field,
        terms: new Map(),
        fieldLength: [],
        docsWithField: 0,
        sumFieldLength: 0,
        hasPositions,
      };
      this.fields.set(field, fi);
    }
    return fi;
  }

  private indexTerms(field: string, docId: number, terms: string[], hasPositions: boolean) {
    const fi = this.fieldIndex(field, hasPositions);
    // Group by term so each term gets exactly one posting for this document.
    const grouped = new Map<string, number[]>();
    terms.forEach((term, position) => {
      const list = grouped.get(term);
      if (list) list.push(position);
      else grouped.set(term, [position]);
    });

    for (const [term, positions] of grouped) {
      let postings = fi.terms.get(term);
      if (!postings) {
        postings = [];
        fi.terms.set(term, postings);
      }
      postings.push({
        docId,
        freq: positions.length,
        positions: hasPositions ? positions : [],
      });
    }

    fi.fieldLength[docId] = terms.length;
    fi.sumFieldLength += terms.length;
    if (terms.length > 0) fi.docsWithField++;
    this.sortedTermCache.delete(field);
  }

  private addPoint(field: string, value: number, docId: number) {
    let list = this.points.get(field);
    if (!list) {
      list = [];
      this.points.set(field, list);
    }
    list.push({ value, docId });
    this.pointsSorted = false;
  }

  add(source: SourceDoc): number {
    const docId = this.docs.length;
    this.docs.push({ docId, source });

    // --- text fields -------------------------------------------------------
    this.indexTerms("title", docId, analyzeToTerms(source.title, this.resolveAnalyzer("title")), true);
    this.indexTerms("body", docId, analyzeToTerms(source.body, this.resolveAnalyzer("body")), true);

    // --- keyword fields ----------------------------------------------------
    this.indexTerms("title.keyword", docId, analyzeToTerms(source.title, KEYWORD_ANALYZER), false);
    this.indexTerms("status", docId, [source.status], false);
    this.indexTerms("author", docId, [source.author], false);
    this.indexTerms("tags", docId, source.tags.slice(), false);

    // --- points ------------------------------------------------------------
    this.addPoint("price", source.price, docId);
    this.addPoint("rating", source.rating, docId);
    this.addPoint("created_at", dateToNumber(source.created_at), docId);
    this.geoPoints.push({ lat: source.lat, lon: source.lon, docId });

    return docId;
  }

  addAll(sources: SourceDoc[]): void {
    for (const s of sources) this.add(s);
  }

  /** Chapter 23: a delete is a tombstone, not an edit. */
  delete(docId: number): void {
    this.deleted.add(docId);
  }

  isDeleted(docId: number): boolean {
    return this.deleted.has(docId);
  }

  private ensurePointsSorted() {
    if (this.pointsSorted) return;
    for (const list of this.points.values()) list.sort((a, b) => a.value - b.value);
    this.pointsSorted = true;
  }

  /** Sorted point values for a numeric field — the chapter 20 structure. */
  pointValues(field: string): PointEntry[] {
    this.ensurePointsSorted();
    return this.points.get(field) ?? [];
  }

  postings(field: string, term: string): Posting[] | undefined {
    return this.fields.get(field)?.terms.get(term);
  }

  docFreq(field: string, term: string): number {
    return this.fields.get(field)?.terms.get(term)?.length ?? 0;
  }

  totalTermFreq(field: string, term: string): number {
    const postings = this.postings(field, term);
    if (!postings) return 0;
    let total = 0;
    for (const p of postings) total += p.freq;
    return total;
  }

  fieldLength(field: string, docId: number): number {
    return this.fields.get(field)?.fieldLength[docId] ?? 0;
  }

  avgFieldLength(field: string): number {
    const fi = this.fields.get(field);
    if (!fi || fi.docsWithField === 0) return 0;
    return fi.sumFieldLength / fi.docsWithField;
  }

  /** The term dictionary as a sorted array — chapters 6, 16 and 19 all use it. */
  sortedTerms(field: string): string[] {
    const cached = this.sortedTermCache.get(field);
    if (cached) return cached;
    const fi = this.fields.get(field);
    const terms = fi ? [...fi.terms.keys()].sort() : [];
    this.sortedTermCache.set(field, terms);
    return terms;
  }

  termStats(field: string): TermStats[] {
    const fi = this.fields.get(field);
    if (!fi) return [];
    return this.sortedTerms(field).map((term) => ({
      term,
      docFreq: fi.terms.get(term)!.length,
      totalTermFreq: this.totalTermFreq(field, term),
    }));
  }

  fieldStats(field: string): FieldStats {
    const fi = this.fields.get(field);
    if (!fi) {
      return { field, vocabularySize: 0, postingsEntries: 0, avgFieldLength: 0, maxFieldLength: 0 };
    }
    let entries = 0;
    for (const postings of fi.terms.values()) entries += postings.length;
    return {
      field,
      vocabularySize: fi.terms.size,
      postingsEntries: entries,
      avgFieldLength: this.avgFieldLength(field),
      maxFieldLength: fi.fieldLength.reduce((a, b) => Math.max(a, b ?? 0), 0),
    };
  }

  doc(docId: number): StoredDoc | undefined {
    return this.docs[docId];
  }

  source(docId: number): SourceDoc | undefined {
    return this.docs[docId]?.source;
  }

  /** Every text field's vocabulary merged — handy for dictionary demos. */
  vocabulary(fields: string[] = ["title", "body"]): string[] {
    const set = new Set<string>();
    for (const f of fields) for (const t of this.sortedTerms(f)) set.add(t);
    return [...set].sort();
  }

  /** Numeric value of a field for one document, for scripts and sorting. */
  numericValue(field: string, docId: number): number {
    const src = this.source(docId);
    if (!src) return 0;
    switch (field) {
      case "price": return src.price;
      case "rating": return src.rating;
      case "created_at": return dateToNumber(src.created_at);
      case "lat": return src.lat;
      case "lon": return src.lon;
      default: return 0;
    }
  }
}

export function buildIndex(
  sources: SourceDoc[],
  resolveAnalyzer: AnalyzerResolver,
): InvertedIndex {
  const index = new InvertedIndex(resolveAnalyzer);
  index.addAll(sources);
  return index;
}

/**
 * The chapter-4 index, verbatim: `term -> set(docID)`. Kept so the UI can show
 * both and so we can differential-test the real one against it (chapter 42).
 */
export function buildNaiveIndex(
  sources: SourceDoc[],
  field: "title" | "body",
  analyzer: AnalyzerConfig,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const doc of sources) {
    const text = field === "title" ? doc.title : doc.body;
    for (const term of analyzeToTerms(text, analyzer)) {
      let set = map.get(term);
      if (!set) {
        set = new Set();
        map.set(term, set);
      }
      set.add(doc.id);
    }
  }
  return map;
}

/** The thing an inverted index replaces: compare every document, every query. */
export function naiveScan(
  sources: SourceDoc[],
  field: "title" | "body",
  analyzer: AnalyzerConfig,
  queryTerm: string,
): { matches: string[]; comparisons: number } {
  const matches: string[] = [];
  let comparisons = 0;
  for (const doc of sources) {
    const text = field === "title" ? doc.title : doc.body;
    const terms = analyzeToTerms(text, analyzer);
    for (const term of terms) {
      comparisons++;
      if (term === queryTerm) {
        matches.push(doc.id);
        break;
      }
    }
  }
  return { matches, comparisons };
}
