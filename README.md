# Seeker

A working search engine, built from first principles, with an interactive lab for every chapter of
*[Seeker — Building a Search Engine from First Principles](docs/seeker-building-a-search-engine.md)*.

Inverted index, BM25, Levenshtein automata, FSTs, BKD trees, a byte-level segment format, and a cluster you
can break — all implemented in TypeScript, all running in the browser.

**Nothing on the site is a recorded result.** Every number is computed on load by the same engine the chapter
is describing. Change a slider and the arithmetic underneath it changes with you.

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # typecheck + the full differential test suite
```

---

## The idea

> Build the simple version → discover the bottleneck → replace one component → understand why the advanced
> structure exists.

The book's method is to never skip an intermediate structure. A trie is not a detour on the way to an FST —
it is the thing that makes you *notice* suffixes are being stored twice, which is the only reason an FST is
worth building. So this repo implements every step, keeps the slow versions, and lets you measure the
difference:

| | Naive | Optimised | What the lab shows |
|---|---|---|---|
| Find a term | scan every document | inverted index | comparison counts, side by side |
| Fuzzy match | DP table per term | Levenshtein automaton + trie | 462 comparisons → 57 nodes visited |
| Term dictionary | sorted array | trie → minimized automaton → FST | 1802 nodes → 776, ~155 KB → ~6 KB |
| Range query | check every value | binary search / BKD | subtrees rejected without being read |
| Top-K | score every candidate | WAND with upper bounds | ~50% of scoring avoided, identical results |

---

## What is actually implemented

`lib/seeker/` is a search engine with no dependency on React or the DOM. It is the same code that runs in the
Node test scripts and in your browser.

| Chapter | Implementation | File |
|---|---|---|
| 3 | Analysis chain: character filters, 5 tokenizers, lowercase, ASCII folding, stopwords, edge n-grams | `analyzer.ts` |
| 3 | Two stemmers — naive suffix rules, and the real Porter algorithm | `stemmer.ts` |
| 4–5 | Inverted index with frequencies, positions and per-field norms | `inverted-index.ts` |
| 6 | Iterator execution: leapfrog conjunction, disjunction, req/opt, exclusion, phrase with slop, galloping `advance` | `iterators.ts` |
| 7–8 | BM25 with `k1`/`b`, IDF, length normalisation and a full explanation tree | `bm25.ts` |
| 6–12 | Query AST, compiler, and a query-string parser (fields, phrases, fuzzy, prefix, wildcard, regex, ranges, boolean, boosts, grouping) | `query.ts`, `parser.ts` |
| 12–15 | Term expansion with real cost accounting and `max_expansions` | `term-dictionary.ts` |
| 13 | Levenshtein and Damerau distance with a traceable DP table | `edit-distance.ts` |
| 14 | Levenshtein automaton: an NFA over (position, edits) determinized to a DFA, with transpositions | `levenshtein-automaton.ts` |
| 16–17 | Trie, plus bottom-up minimization into a DAWG | `trie.ts` |
| 18 | FST — the direct incremental minimal construction, with min-sum output pushing | `fst.ts` |
| 19 | BlockTree-style dictionary: prefix index over block keys, front-coded term blocks | `blocktree.ts` |
| 20 | Sorted point index with traceable binary search on both bounds | `points.ts` |
| 21–22 | KD tree and BKD tree with leaf blocks, region rejection and byte accounting | `kdtree.ts` |
| 24–25 | Byte-level segment format, varints, zigzag, gap encoding, frame-of-reference bit packing, CRC32 | `codec.ts` |
| 23, 35–36 | Segments, tombstones, tiered merging, translog, refresh/flush/commit, crash and recovery | `segments.ts` |
| 26 | mmap page-cache simulation with LRU eviction and read amplification | `mmap.ts` |
| 27, 34 | Cost-based join ordering, bounded top-K heap, WAND pruning, rescore windows | `planner.ts` |
| 28 | LRU cache reporting hit, miss and eviction rates, plus cacheability analysis | `cache.ts` |
| 29 | Discrete-event thread-pool simulation with queueing, contention, timeouts and backpressure | `concurrency.ts` |
| 30 | A restricted expression language (hand-written Pratt parser, no `eval`) for scripted scoring | `script.ts` |
| 31–34, 37 | Shards, routing, replicas, allocation, promotion, query-then-fetch, cluster state | `cluster.ts` |
| 38–40 | Percentiles, histograms, the symptom table, and a capacity planner | `observability.ts` |
| 42 | The differential test suite, runnable in the browser | `testsuite.ts` |

---

## Pages

| Route | What it is |
|---|---|
| `/` | The two jobs of a search engine, the question→structure table, and the 15-stage build order |
| `/ch/[slug]` | All 43 chapters, each with its own interactive lab |
| `/playground` | The whole engine on one page: query → AST → execution plan → BM25 explanation, with every counter exposed |
| `/corpus` | Every document, field, mapping and term in the index the labs share |
| `/tests` | Chapter 42's differential suite, running live in your browser |

---

## Testing

Chapter 42's rule is the one this project actually follows:

> **An optimisation is only allowed to be faster. Never to change the answer.**

Every fast path has a slow, obviously-correct reference implementation, and they are compared on every run.
The references exist purely to be the oracle: `naiveScan`, `bruteForceFuzzy`, `naivePointRange`,
`naiveRangeSearch`, `intersectWithTrace`, `exhaustiveTopK`, `buildNaiveIndex`.

```bash
npm test                   # everything below, plus tsc

npm run test:automaton     # 839 checks — brute-force DP table vs the Levenshtein automaton,
                           #   including a randomised sweep and Damerau transpositions
npm run test:dictionaries  # sorted array vs trie vs DAWG vs FST: same language, same outputs
npm run test:engine        # 180 checks — golden corpus, appendix A, boolean algebra,
                           #   codec round-trips, KD/BKD vs full scan, WAND vs exhaustive,
                           #   segment-layout independence, crash recovery, sharding
npm run test:labs          # renders all 43 labs, catching runtime errors that a client-only
                           #   component would otherwise hide behind a 200 response
```

A further 237 checks run in the browser at `/tests`.

### Three bugs these tests caught

1. **The Levenshtein automaton silently lost terms.** Subsumption pruning was discarding epsilon-successors
   that later transitions needed, so `"ubernetes"` was rejected at edit distance 1. The pruning is gone: the
   DFA is larger (41 states rather than 31 at k=1) and correct. A fuzzy matcher that quietly drops results is
   worse than a slightly bigger automaton.
2. **Shard allocation invented data.** After a node died, allocation happily re-placed the lost shard on a
   healthy node — conjuring a replica that had never existed. Now a shard with no surviving copy stays
   unassigned and the cluster goes red, which is what makes the replica argument real rather than asserted.
3. **A hydration mismatch in the playground**, which server-rendered a live timing value.

---

## Layout

```
app/
  page.tsx              overview
  ch/[slug]/page.tsx    all 43 chapters, statically generated
  playground/           the flagship search UI
  corpus/               documents, fields and terms
  tests/                the differential suite
components/
  labs/part01…part13    one lab per chapter, grouped by part, lazily loaded
  ui.tsx                shared primitives
lib/
  seeker/               the engine — no React, no DOM, independently testable
  chapters.ts           the table of contents as data
docs/                   the reference manuscript this is built from
scripts/                the Node test suites
```

---

## Notes

- **Pure black and white.** There is no hue anywhere in the stylesheet. State is signalled by fill weight,
  contrast and the words the components already render (`pass`/`fail`, `✓`/`✗`, `skipped`/`matched`) rather
  than by colour. Charts use a separate grey ramp, because the state colours are all near-black by design and
  would otherwise make every bar look identical. Light and dark are the same ramp, inverted.
- **The corpus is deliberately constructed.** 28 documents with repeated terms (TF saturation), wildly varying
  field lengths (length normalisation), a misspelled title — `doc-7` — that only fuzzy search can reach,
  shared prefixes (trie and FST), prices (point index) and coordinates (BKD).
- **Simulations are deterministic.** Every PRNG is seeded, so a number only moves when you move a control.
- **Two honest simplifications**, both flagged in the UI where they matter: sloppy phrase matching finds
  in-order matches only, where Lucene can also match transposed words at slop ≥ 2; and the Levenshtein
  automaton skips subsumption pruning, for the reason above.

## Reference

- [Apache Lucene](https://lucene.apache.org/)
- [OpenSearch documentation](https://docs.opensearch.org/)
