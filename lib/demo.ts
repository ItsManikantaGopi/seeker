/**
 * Lazily-built singletons shared by every lab.
 *
 * The labs all run against one real index over the real corpus, so a number you
 * see in chapter 8 is the same number chapter 27 is reasoning about. Everything
 * is built on first use and then cached for the life of the page.
 */

import { analyzerFor, CORPUS } from "./kaus/corpus";
import { buildIndex, type InvertedIndex } from "./kaus/inverted-index";
import { makeSearchContext, type SearchContext } from "./kaus/query";
import { buildEngine, type KausEngine } from "./kaus/segments";
import { TermDictionary } from "./kaus/term-dictionary";
import type { Point2D } from "./kaus/kdtree";

let indexCache: InvertedIndex | null = null;
let contextCache: SearchContext | null = null;
let engineCache: KausEngine | null = null;
const dictionaryCache = new Map<string, TermDictionary>();

export function demoIndex(): InvertedIndex {
  if (!indexCache) indexCache = buildIndex(CORPUS, analyzerFor);
  return indexCache;
}

export function demoContext(): SearchContext {
  if (!contextCache) contextCache = makeSearchContext(demoIndex());
  return contextCache;
}

/** A multi-segment engine, so segment-aware labs have something to look at. */
export function demoEngine(): KausEngine {
  if (!engineCache) engineCache = buildEngine(CORPUS, { docsPerSegment: 7 });
  return engineCache;
}

export function demoDictionary(field: string): TermDictionary {
  let dict = dictionaryCache.get(field);
  if (!dict) {
    dict = new TermDictionary(field, demoIndex().sortedTerms(field));
    dictionaryCache.set(field, dict);
  }
  return dict;
}

export function demoVocabulary(field = "title"): string[] {
  return demoIndex().sortedTerms(field);
}

/** Coordinates as points, for the KD and BKD labs. */
export function demoPoints(): Point2D[] {
  return CORPUS.map((doc, i) => ({
    x: Math.round(doc.lat * 10) / 10,
    y: Math.round(doc.lon * 10) / 10,
    docId: i,
    label: doc.id,
  }));
}

export function docLabel(docId: number): string {
  const source = demoIndex().source(docId);
  return source ? `${source.id} · ${source.title}` : `doc ${docId}`;
}

export function docTitle(docId: number): string {
  return demoIndex().source(docId)?.title ?? `doc ${docId}`;
}

export function docKey(docId: number): string {
  return demoIndex().source(docId)?.id ?? `doc-${docId}`;
}

/** A small, hand-picked term set for structure diagrams that must stay legible. */
export const TOY_TERMS = ["can", "car", "cat"];
export const TOY_SUFFIX_TERMS = ["bar", "car"];
export const TOY_DICTIONARY = [
  "kubernetes", "kubernetes-deployment", "kubernetes-service", "kubelet",
  "kube", "kafka", "docker", "redis", "deploy", "deployment", "service",
];
