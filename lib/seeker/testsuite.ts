/**
 * The differential test suite (chapter 42), runnable in the browser.
 *
 * Two ideas, and the second one is the valuable one:
 *
 *   golden corpus         the book's own expected results, written down
 *   differential testing   a slow, obviously-correct implementation is the
 *                          oracle for every fast one
 *
 * These run against the same engine the rest of the site uses. Nothing here is
 * a recorded result — every check computes both sides when you press run.
 */

import { analyzeToTerms, DEFAULT_ANALYZER, ENGLISH_ANALYZER } from "./analyzer";
import { bm25, idf, LUCENE_DEFAULTS } from "./bm25";
import {
  analyzeGaps, bitPack, bitUnpack, corrupt, crc32, decodePostings, encodePostings,
  gapDecode, gapEncode,
} from "./codec";
import { analyzerFor, BM25_EXAMPLE_CORPUS, CORPUS, GOLDEN_CORPUS } from "./corpus";
import { bruteForceFuzzy } from "./edit-distance";
import { buildOrdinalFst, intersectFstWithAutomaton } from "./fst";
import { buildIndex, naiveScan } from "./inverted-index";
import {
  bkdRangeSearch, buildBkdTree, buildKdTree, kdRangeSearch, naiveRangeSearch, type Point2D,
} from "./kdtree";
import { buildLevenshteinAutomaton, scanWithAutomaton } from "./levenshtein-automaton";
import { EXAMPLE_QUERIES, parseQueryString } from "./parser";
import { naivePointRange, pointRange } from "./points";
import { exhaustiveTopK, intersectWithSkipping, intersectWithTrace, wandTopK, type WandTerm } from "./planner";
import { collectAll, makeSearchContext, search, type Query } from "./query";
import { compileScript } from "./script";
import { buildEngine, SeekerEngine, verifyFile } from "./segments";
import { Cluster } from "./cluster";
import { minimize, Trie, dawgTerms } from "./trie";

export interface CheckResult {
  name: string;
  passed: boolean;
  /** What the oracle said, when it differs. */
  expected?: string;
  actual?: string;
  note?: string;
}

export interface SuiteResult {
  name: string;
  description: string;
  /** The slow implementation used as the oracle. */
  oracle: string;
  /** The fast implementation being tested. */
  optimised: string;
  checks: CheckResult[];
  passed: number;
  failed: number;
  durationMs: number;
}

export interface TestRunResult {
  suites: SuiteResult[];
  totalChecks: number;
  totalFailed: number;
  durationMs: number;
}

function runSuite(
  name: string,
  description: string,
  oracle: string,
  optimised: string,
  body: (check: (name: string, passed: boolean, expected?: unknown, actual?: unknown, note?: string) => void) => void,
): SuiteResult {
  const checks: CheckResult[] = [];
  const started = performance.now();
  const check = (
    checkName: string, passed: boolean, expected?: unknown, actual?: unknown, note?: string,
  ) => {
    checks.push({
      name: checkName,
      passed,
      expected: passed ? undefined : JSON.stringify(expected),
      actual: passed ? undefined : JSON.stringify(actual),
      note,
    });
  };

  try {
    body(check);
  } catch (error) {
    checks.push({
      name: "suite threw",
      passed: false,
      actual: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    name,
    description,
    oracle,
    optimised,
    checks,
    passed: checks.filter((c) => c.passed).length,
    failed: checks.filter((c) => !c.passed).length,
    durationMs: performance.now() - started,
  };
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function runAllSuites(): TestRunResult {
  const started = performance.now();
  const suites: SuiteResult[] = [];

  // -------------------------------------------------------------------------
  suites.push(runSuite(
    "Golden corpus",
    "The book's own expected results for three documents, written down and asserted.",
    "the book, chapter 42",
    "the full query engine",
    (check) => {
      const index = buildIndex(GOLDEN_CORPUS, analyzerFor);
      const sc = makeSearchContext(index);
      const keys = (q: Query) => collectAll(sc, q).map((d) => index.source(d)!.id).sort();
      const match = (text: string): Query => ({ kind: "match", field: "title", text });

      check("kubernetes → D1, D3", eq(keys(match("kubernetes")), ["D1", "D3"]),
        ["D1", "D3"], keys(match("kubernetes")));
      check("deployment → D1, D2", eq(keys(match("deployment")), ["D1", "D2"]),
        ["D1", "D2"], keys(match("deployment")));
      const and: Query = { kind: "bool", must: [match("kubernetes"), match("service")] };
      check("kubernetes AND service → D3", eq(keys(and), ["D3"]), ["D3"], keys(and));
      const phrase: Query = { kind: "phrase", field: "title", text: "kubernetes deployment" };
      check('"kubernetes deployment" → D1', eq(keys(phrase), ["D1"]), ["D1"], keys(phrase));
      check("a term not in the dictionary returns nothing",
        eq(keys(match("terraform")), []), [], keys(match("terraform")));
      const impossible: Query = { kind: "bool", must: [match("terraform"), match("kubernetes")] };
      check("one empty clause empties the whole AND (chapter 9)",
        eq(keys(impossible), []), [], keys(impossible));
    },
  ));

  // -------------------------------------------------------------------------
  suites.push(runSuite(
    "BM25, appendix A",
    "The worked example, recomputed. Also the invariants the formula must satisfy.",
    "the arithmetic in the book",
    "the BM25 implementation",
    (check) => {
      const index = buildIndex(BM25_EXAMPLE_CORPUS, analyzerFor);
      check("N = 3", index.numDocs === 3, 3, index.numDocs);
      check("df(kubernetes) = 2", index.docFreq("title", "kubernetes") === 2, 2, index.docFreq("title", "kubernetes"));
      const avgdl = index.avgFieldLength("title");
      check("avgdl = 7/3", Math.abs(avgdl - 7 / 3) < 1e-9, 7 / 3, avgdl);
      check("idf = ln(1.6)", Math.abs(idf(3, 2) - Math.log(1.6)) < 1e-12, Math.log(1.6), idf(3, 2));

      const at = (tf: number, len: number) =>
        bm25({ tf, fieldLength: len, avgFieldLength: avgdl, numDocs: 3, docFreq: 2, params: LUCENE_DEFAULTS }).score;
      check("D1 (tf 2, len 3) outscores D2 (tf 1, len 2)", at(2, 3) > at(1, 2),
        "D1 > D2", `${at(2, 3).toFixed(4)} vs ${at(1, 2).toFixed(4)}`);

      const p = LUCENE_DEFAULTS;
      const score = (tf: number) => bm25({ tf, fieldLength: 10, avgFieldLength: 10, numDocs: 100, docFreq: 10, params: p }).score;
      check("term frequency saturates", score(2) < score(1) * 2 && score(10) < score(1) * 10,
        "sublinear", `tf1=${score(1).toFixed(3)} tf2=${score(2).toFixed(3)} tf10=${score(10).toFixed(3)}`);
      check("idf falls as df rises", idf(100, 1) > idf(100, 50) && idf(100, 50) > idf(100, 99));
      check("idf is finite at df = 0", Number.isFinite(idf(100, 0)), "finite", idf(100, 0));

      const b0 = (len: number) => bm25({ tf: 1, fieldLength: len, avgFieldLength: 10, numDocs: 100, docFreq: 10, params: { k1: 1.2, b: 0 } }).score;
      check("b = 0 ignores field length", Math.abs(b0(2) - b0(50)) < 1e-12);
      const b1 = (len: number) => bm25({ tf: 1, fieldLength: len, avgFieldLength: 10, numDocs: 100, docFreq: 10, params: { k1: 1.2, b: 1 } }).score;
      check("b = 1 penalises long fields", b1(2) > b1(50));
    },
  ));

  // -------------------------------------------------------------------------
  suites.push(runSuite(
    "Inverted index vs full scan",
    "Every term in the vocabulary, looked up both ways.",
    "tokenize and compare every document",
    "one dictionary lookup",
    (check) => {
      const index = buildIndex(CORPUS, analyzerFor);
      const sc = makeSearchContext(index);
      const vocabulary = index.sortedTerms("title");
      let mismatches = 0;
      let firstBad = "";
      for (const term of vocabulary) {
        const viaIndex = collectAll(sc, { kind: "term", field: "title", value: term })
          .map((d) => index.source(d)!.id).sort();
        const viaScan = naiveScan(CORPUS, "title", DEFAULT_ANALYZER, term).matches.sort();
        if (!eq(viaIndex, viaScan)) {
          mismatches++;
          if (!firstBad) firstBad = term;
        }
      }
      check(`all ${vocabulary.length} title terms agree with a full scan`, mismatches === 0,
        0, mismatches, mismatches ? `first mismatch: ${firstBad}` : undefined);

      // Boolean algebra must hold.
      const pairs: [string, string][] = [
        ["kubernetes", "deployment"], ["docker", "redis"], ["service", "cluster"], ["kafka", "deployment"],
      ];
      for (const [a, b] of pairs) {
        const A = collectAll(sc, { kind: "term", field: "title", value: a });
        const B = collectAll(sc, { kind: "term", field: "title", value: b });
        const or = collectAll(sc, { kind: "bool", should: [
          { kind: "term", field: "title", value: a }, { kind: "term", field: "title", value: b },
        ] });
        const and = collectAll(sc, { kind: "bool", must: [
          { kind: "term", field: "title", value: a }, { kind: "term", field: "title", value: b },
        ] });
        check(`|A∪B| = |A| + |B| − |A∩B| for ${a}/${b}`,
          or.length === A.length + B.length - and.length,
          A.length + B.length - and.length, or.length);
        check(`A∩B ⊆ A∪B for ${a}/${b}`, and.every((d) => or.includes(d)));
        const notB = collectAll(sc, {
          kind: "bool",
          must: [{ kind: "term", field: "title", value: a }],
          must_not: [{ kind: "term", field: "title", value: b }],
        });
        check(`must_not complements must for ${a}/${b}`, notB.length === A.length - and.length,
          A.length - and.length, notB.length);
      }

      // Phrase must be a subset of the conjunction of its terms.
      for (const text of ["kubernetes deployment", "kubernetes service", "deployment guide"]) {
        const phrase = collectAll(sc, { kind: "phrase", field: "title", text });
        const conj = collectAll(sc, {
          kind: "bool",
          must: analyzeToTerms(text, DEFAULT_ANALYZER).map((t) => ({ kind: "term" as const, field: "title", value: t })),
        });
        check(`phrase "${text}" ⊆ AND of its terms`, phrase.every((d) => conj.includes(d)));
        // And every phrase hit must genuinely be adjacent in the source text.
        const terms = analyzeToTerms(text, DEFAULT_ANALYZER);
        const allAdjacent = phrase.every((docId) => {
          const docTerms = analyzeToTerms(index.source(docId)!.title, DEFAULT_ANALYZER);
          for (let i = 0; i + terms.length <= docTerms.length; i++) {
            if (terms.every((t, k) => docTerms[i + k] === t)) return true;
          }
          return false;
        });
        check(`every "${text}" hit is genuinely adjacent`, allAdjacent);
      }

      // Prefix expansion must equal a filter over the vocabulary.
      for (const prefix of ["kube", "de", "s", "z"]) {
        const viaPrefix = collectAll(sc, { kind: "prefix", field: "title", value: prefix }).sort((x, y) => x - y);
        const expected = new Set<number>();
        for (const term of vocabulary.filter((t) => t.startsWith(prefix))) {
          for (const p of index.postings("title", term) ?? []) expected.add(p.docId);
        }
        check(`prefix "${prefix}" matches a vocabulary filter`,
          eq(viaPrefix, [...expected].sort((x, y) => x - y)),
          [...expected].sort((x, y) => x - y), viaPrefix);
      }

      // Ranking invariants.
      const ranked = search(sc, { kind: "match", field: "title", text: "kubernetes deployment" }, { topK: 100 });
      check("hits are sorted by descending score",
        ranked.hits.every((h, i) => i === 0 || ranked.hits[i - 1].score >= h.score));
      check("every explanation equals its score",
        ranked.hits.every((h) => Math.abs((h.explanation?.value ?? 0) - h.score) < 1e-9));
      const top3 = search(sc, { kind: "match", field: "title", text: "kubernetes deployment" }, { topK: 3 });
      check("top-3 is a prefix of the full ranking",
        eq(top3.hits.map((h) => h.docId), ranked.hits.slice(0, 3).map((h) => h.docId)),
        ranked.hits.slice(0, 3).map((h) => h.docId), top3.hits.map((h) => h.docId));
    },
  ));

  // -------------------------------------------------------------------------
  suites.push(runSuite(
    "Fuzzy search",
    "The brute-force distance table against the automaton, the trie and the FST.",
    "brute-force Levenshtein table over every term",
    "Levenshtein automaton intersected with trie / FST",
    (check) => {
      const index = buildIndex(CORPUS, analyzerFor);
      const vocabulary = index.sortedTerms("title");
      const trie = Trie.from(vocabulary);
      const fst = buildOrdinalFst(vocabulary);

      for (const q of ["kubernetes", "kubernets", "deployment", "servic", "docker", "clustr", "kafka"]) {
        for (const k of [1, 2]) {
          const expected = [...bruteForceFuzzy(q, vocabulary, k).terms].sort();
          const automaton = buildLevenshteinAutomaton(q, k);
          const viaScan = [...scanWithAutomaton(automaton, vocabulary).terms].sort();
          const viaTrie = [...trie.intersectAutomaton(automaton).terms].sort();
          const viaFst = [...intersectFstWithAutomaton(fst, automaton).terms.map((t) => t.term)].sort();
          check(`${q}~${k}: automaton scan`, eq(expected, viaScan), expected, viaScan);
          check(`${q}~${k}: trie intersection`, eq(expected, viaTrie), expected, viaTrie);
          check(`${q}~${k}: FST intersection`, eq(expected, viaFst), expected, viaFst);
        }
      }

      // Damerau: a transposition must cost one edit, not two.
      for (const q of ["kuberentes", "sevrice", "dokcer"]) {
        const expected = [...bruteForceFuzzy(q, vocabulary, 1, { transpositions: true }).terms].sort();
        const automaton = buildLevenshteinAutomaton(q, 1, { transpositions: true });
        const actual = [...scanWithAutomaton(automaton, vocabulary).terms].sort();
        check(`${q}~1 with transpositions`, eq(expected, actual), expected, actual);
      }

      // A randomised sweep, deterministically seeded.
      let seed = 20260813;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      const ALPHA = "abcdek u";
      let randomMismatches = 0;
      for (let n = 0; n < 150; n++) {
        const len = 1 + Math.floor(rnd() * 6);
        let q = "";
        for (let i = 0; i < len; i++) q += ALPHA[Math.floor(rnd() * ALPHA.length)];
        const vocab: string[] = [];
        for (let v = 0; v < 10; v++) {
          const vlen = Math.floor(rnd() * 7);
          let s = "";
          for (let i = 0; i < vlen; i++) s += ALPHA[Math.floor(rnd() * ALPHA.length)];
          vocab.push(s);
        }
        for (const k of [1, 2]) {
          const expected = [...new Set(bruteForceFuzzy(q, vocab, k).terms)].sort();
          const actual = [...new Set(scanWithAutomaton(buildLevenshteinAutomaton(q, k), vocab).terms)].sort();
          if (!eq(expected, actual)) randomMismatches++;
        }
      }
      check("300 randomised query/vocabulary pairs agree", randomMismatches === 0, 0, randomMismatches);
    },
  ));

  // -------------------------------------------------------------------------
  suites.push(runSuite(
    "Term dictionaries",
    "Trie, minimized automaton and FST must all describe exactly the sorted term list.",
    "the sorted array of terms",
    "trie, DAWG and FST",
    (check) => {
      const index = buildIndex(CORPUS, analyzerFor);
      const vocabulary = index.sortedTerms("title");
      const trie = Trie.from(vocabulary);
      const min = minimize(trie);
      const fst = buildOrdinalFst(vocabulary);

      check("trie contains every term", vocabulary.every((t) => trie.contains(t).found));
      check("trie rejects a non-term", !trie.contains("zzzznope").found);
      check("trie enumerates in sorted order", eq(trie.collect(trie.root, ""), vocabulary));
      check("minimization preserves the language", eq(dawgTerms(min), vocabulary));
      check("minimization does not grow the structure", min.dawgNodeCount <= min.trieNodeCount,
        `<= ${min.trieNodeCount}`, min.dawgNodeCount);
      check("FST returns the right ordinal for every term",
        vocabulary.every((t, i) => fst.get(t) === i));
      check("FST rejects a non-term", fst.get("zzzznope") === null);
      check("FST enumerates every key with its output",
        eq(fst.keys().map((k) => k.key), vocabulary));
      check("FST has the same state count as the minimized automaton",
        fst.stats.states === min.dawgNodeCount, min.dawgNodeCount, fst.stats.states,
        "An FST is the minimized automaton with outputs attached.");

      for (const prefix of ["k", "ku", "kube", "de", "z", ""]) {
        const expected = vocabulary.filter((t) => t.startsWith(prefix));
        check(`prefix "${prefix}": trie`, eq(trie.prefixSearch(prefix).terms, expected));
        check(`prefix "${prefix}": FST`, eq(fst.prefixKeys(prefix).map((k) => k.key), expected));
      }
    },
  ));

  // -------------------------------------------------------------------------
  suites.push(runSuite(
    "Points, KD and BKD",
    "Range queries answered by structure, checked against looking at every value.",
    "check every value / every point",
    "binary search, KD tree, BKD tree",
    (check) => {
      const index = buildIndex(CORPUS, analyzerFor);
      for (const field of ["price", "rating", "created_at"] as const) {
        const values = index.pointValues(field);
        const cases = [
          { gte: 100, lte: 200 }, { gte: 0, lte: 0 }, { gt: 0 }, { lt: 50 },
          { gte: 1000 }, { lte: -5 }, {},
        ];
        for (const c of cases) {
          const fast = pointRange(values, c).docIds;
          const slow = naivePointRange(values, c);
          check(`${field} range ${JSON.stringify(c)}`, eq(fast, slow), slow, fast);
        }
      }

      const points: Point2D[] = CORPUS.map((d, i) => ({ x: d.lat, y: d.lon, docId: i }));
      const kd = buildKdTree(points);
      for (const leafSize of [1, 2, 4, 8]) {
        const bkd = buildBkdTree(points, leafSize);
        const regions = [
          { minX: 30, maxX: 60, minY: -130, maxY: 30 },
          { minX: -90, maxX: 90, minY: -180, maxY: 180 },
          { minX: 0, maxX: 0, minY: 0, maxY: 0 },
          { minX: 45, maxX: 55, minY: 0, maxY: 40 },
          { minX: -40, maxX: -20, minY: 100, maxY: 160 },
        ];
        for (const region of regions) {
          const expected = naiveRangeSearch(points, region);
          if (leafSize === 4) {
            check(`kd ${JSON.stringify(region)}`, eq(kdRangeSearch(kd.root, region).docIds, expected),
              expected, kdRangeSearch(kd.root, region).docIds);
          }
          check(`bkd leaf=${leafSize} ${JSON.stringify(region)}`,
            eq(bkdRangeSearch(bkd, region).docIds, expected),
            expected, bkdRangeSearch(bkd, region).docIds);
        }
      }
    },
  ));

  // -------------------------------------------------------------------------
  suites.push(runSuite(
    "Codec and checksums",
    "Compression must be lossless, and corruption must be caught.",
    "the in-memory postings objects",
    "gap + vint + bit-packed bytes",
    (check) => {
      const index = buildIndex(CORPUS, analyzerFor);
      let failures = 0;
      let firstBad = "";
      for (const field of ["title", "body"]) {
        for (const term of index.sortedTerms(field)) {
          const postings = index.postings(field, term)!;
          const decoded = decodePostings(encodePostings(term, postings, { positions: true }).bytes, true);
          if (!eq(decoded, postings)) {
            failures++;
            if (!firstBad) firstBad = `${field}:${term}`;
          }
        }
      }
      check("every postings list survives encode → decode", failures === 0, 0, failures,
        failures ? `first failure: ${firstBad}` : undefined);

      check("gap encoding of 100,105,110,250", eq(gapEncode([100, 105, 110, 250]), [100, 5, 5, 140]),
        [100, 5, 5, 140], gapEncode([100, 105, 110, 250]));
      check("gap decoding is the inverse", eq(gapDecode([100, 5, 5, 140]), [100, 105, 110, 250]));

      const analysis = analyzeGaps([100, 105, 110, 250], 4);
      check("gaps are no larger than raw vints", analysis.vintGapBytes <= analysis.vintRawBytes,
        `<= ${analysis.vintRawBytes}`, analysis.vintGapBytes);
      check("vints beat fixed width", analysis.vintGapBytes < analysis.fixedBytes,
        `< ${analysis.fixedBytes}`, analysis.vintGapBytes);

      for (const bits of [1, 3, 5, 8, 12]) {
        const values = Array.from({ length: 16 }, (_, i) => (i * 7 + 3) % (1 << bits));
        check(`bit packing at ${bits} bits is lossless`,
          eq(bitUnpack(bitPack(values, bits), bits, values.length), values));
      }

      const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      check("CRC32 is deterministic", crc32(bytes) === crc32(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])));
      check("CRC32 changes when a byte flips", crc32(bytes) !== crc32(corrupt(bytes, 3)));

      const engine = new SeekerEngine();
      engine.indexAll(CORPUS.slice(0, 4));
      engine.refresh();
      engine.commit();
      const files = engine.liveSegments.flatMap((s) => s.files);
      check("every written segment file verifies", files.every((f) => verifyFile(f).valid),
        true, files.map((f) => verifyFile(f).valid));
      check("a corrupted file fails verification",
        files.length > 0 && !verifyFile({ ...files[0], bytes: corrupt(files[0].bytes, 40) }).valid);
    },
  ));

  // -------------------------------------------------------------------------
  suites.push(runSuite(
    "Segments and recovery",
    "How documents are split into segments must not change what a query returns.",
    "one segment holding everything",
    "many segments, merges, tombstones and translog replay",
    (check) => {
      const one = buildEngine(CORPUS, { docsPerSegment: CORPUS.length });
      const many = buildEngine(CORPUS, { docsPerSegment: 3 });
      const q: Query = { kind: "match", field: "title", text: "kubernetes" };
      const a = one.search(q, { topK: 100 }).hits.map((h) => h.docKey).sort();
      const b = many.search(q, { topK: 100 }).hits.map((h) => h.docKey).sort();
      check("segment layout does not change which documents match", eq(a, b), a, b);

      const engine = buildEngine(CORPUS, { docsPerSegment: 5 });
      const victim = CORPUS[3].id;
      const beforeCount = engine.visibleDocCount;
      const beforeSegments = engine.segmentCount;
      engine.delete(victim);
      check("a deleted document disappears from results",
        !engine.search({ kind: "match_all" }, { topK: 100 }).hits.some((h) => h.docKey === victim));
      engine.mergeAll();
      check("merging reduces the segment count", engine.segmentCount < beforeSegments,
        `< ${beforeSegments}`, engine.segmentCount);
      check("merging preserves the live document count", engine.visibleDocCount === beforeCount - 1,
        beforeCount - 1, engine.visibleDocCount);
      check("the merged index still cannot find the deleted document",
        !engine.search({ kind: "match_all" }, { topK: 100 }).hits.some((h) => h.docKey === victim));

      const crashy = new SeekerEngine();
      crashy.indexAll(CORPUS.slice(0, 6));
      crashy.refresh();
      crashy.commit();
      crashy.indexAll(CORPUS.slice(6, 10));
      crashy.refresh();
      check("ten documents visible before the crash", crashy.visibleDocCount === 10, 10, crashy.visibleDocCount);
      crashy.crash();
      check("the unflushed segment does not survive", crashy.visibleDocCount === 6, 6, crashy.visibleDocCount);
      crashy.recover();
      check("translog replay restores them", crashy.visibleDocCount === 10, 10, crashy.visibleDocCount);
    },
  ));

  // -------------------------------------------------------------------------
  suites.push(runSuite(
    "Query planning",
    "Skipping and pruning are only legitimate if they cannot change the answer.",
    "two-pointer walk, score every candidate",
    "galloping search, WAND",
    (check) => {
      check("A=[2,5,9,20] B=[1,5,7,9] → [5,9]",
        eq(intersectWithTrace([2, 5, 9, 20], [1, 5, 7, 9]).result, [5, 9]),
        [5, 9], intersectWithTrace([2, 5, 9, 20], [1, 5, 7, 9]).result);

      let seed = 99;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      let mismatches = 0;
      for (let trial = 0; trial < 200; trial++) {
        const make = () => [...new Set(Array.from(
          { length: 1 + Math.floor(rnd() * 40) }, () => Math.floor(rnd() * 200),
        ))].sort((x, y) => x - y);
        const a = make();
        const b = make();
        const slow = intersectWithTrace(a, b).result;
        const fast = [...intersectWithSkipping(a, b).result].sort((x, y) => x - y);
        if (!eq(slow, fast)) mismatches++;
      }
      check("200 random pairs: skipping matches the two-pointer walk", mismatches === 0, 0, mismatches);

      const terms: WandTerm[] = ["a", "b", "c"].map((term) => {
        const entries: { docId: number; score: number }[] = [];
        for (let doc = 0; doc < 400; doc++) {
          if (rnd() < 0.25) entries.push({ docId: doc, score: rnd() * 5 });
        }
        return { term, entries, maxScore: entries.reduce((m, e) => Math.max(m, e.score), 0) };
      });
      for (const k of [1, 5, 10, 25]) {
        const slow = exhaustiveTopK(terms, k);
        const fast = wandTopK(terms, k);
        check(`WAND top-${k} equals exhaustive top-${k}`,
          eq(fast.hits.map((h) => `${h.docId}:${h.score.toFixed(6)}`),
            slow.hits.map((h) => `${h.docId}:${h.score.toFixed(6)}`)),
          slow.hits.map((h) => h.docId), fast.hits.map((h) => h.docId));
        check(`WAND scores no more documents than exhaustive at k=${k}`,
          fast.fullEvaluations <= slow.fullEvaluations,
          `<= ${slow.fullEvaluations}`, fast.fullEvaluations);
      }
    },
  ));

  // -------------------------------------------------------------------------
  suites.push(runSuite(
    "Distribution",
    "Splitting the corpus across shards must not change which documents match.",
    "a single-shard index",
    "a sharded, replicated cluster",
    (check) => {
      const cluster = new Cluster({ shardCount: 3, replicaCount: 1, nodeCount: 3 });
      cluster.indexAll(CORPUS);
      cluster.commitAll();
      const single = buildEngine(CORPUS);
      const q: Query = { kind: "match", field: "title", text: "kubernetes" };

      check("cluster is green", cluster.health() === "green", "green", cluster.health());
      check("every document landed on exactly one shard",
        cluster.distribution().reduce((s, d) => s + d.documents, 0) === CORPUS.length,
        CORPUS.length, cluster.distribution().reduce((s, d) => s + d.documents, 0));

      const sharded = cluster.search(q, { topK: 50 }).hits.map((h) => h.docKey).sort();
      const global = single.search(q, { topK: 50 }).hits.map((h) => h.docKey).sort();
      check("sharding does not change which documents match", eq(sharded, global), global, sharded);

      cluster.failNode("node-1");
      check("losing one node of three with replicas is survivable",
        cluster.health() !== "red", "not red", cluster.health());
      const afterFailure = cluster.search(q, { topK: 50 });
      check("results survive the failure", !afterFailure.partial, false, afterFailure.partial);
      check("and are the same documents",
        eq(afterFailure.hits.map((h) => h.docKey).sort(), global),
        global, afterFailure.hits.map((h) => h.docKey).sort());

      const fragile = new Cluster({ shardCount: 3, replicaCount: 0, nodeCount: 3 });
      fragile.indexAll(CORPUS);
      fragile.failNode("node-2");
      check("with no replicas, the same failure loses a shard",
        fragile.search(q, { topK: 50 }).partial && fragile.health() === "red",
        "partial and red", `${fragile.search(q, { topK: 50 }).partial} / ${fragile.health()}`);

      const hot = new Cluster({ shardCount: 4, replicaCount: 0, nodeCount: 4 });
      hot.indexAll(CORPUS, () => "same-key");
      check("a constant routing key puts everything on one shard",
        hot.distribution().filter((d) => d.documents > 0).length === 1,
        1, hot.distribution().filter((d) => d.documents > 0).length);
    },
  ));

  // -------------------------------------------------------------------------
  suites.push(runSuite(
    "Parser, analysis and scripts",
    "Every documented example must parse, execute, and behave the way the chapter says.",
    "the documented behaviour",
    "the parser, analyzer and script evaluator",
    (check) => {
      const index = buildIndex(CORPUS, analyzerFor);
      const sc = makeSearchContext(index);

      for (const example of EXAMPLE_QUERIES) {
        const parsed = parseQueryString(example.query);
        check(`parses: ${example.query}`, parsed.errors.length === 0,
          [], parsed.errors.map((e) => e.message));
        check(`executes: ${example.query}`, Array.isArray(search(sc, parsed.query, { topK: 5 }).hits));
      }

      const or = collectAll(sc, parseQueryString("kubernetes deployment").query);
      const and = collectAll(sc, parseQueryString("kubernetes AND deployment").query);
      check("AND is no wider than OR", and.length <= or.length, `<= ${or.length}`, and.length);
      check("AND is a subset of OR", and.every((d) => or.includes(d)));

      check("standard analyzer lowercases and splits",
        eq(analyzeToTerms("Running Kubernetes, quickly!", DEFAULT_ANALYZER),
          ["running", "kubernetes", "quickly"]),
        ["running", "kubernetes", "quickly"],
        analyzeToTerms("Running Kubernetes, quickly!", DEFAULT_ANALYZER));
      check("english analyzer stems and drops stopwords",
        eq(analyzeToTerms("The running deployments are failing", ENGLISH_ANALYZER), ["run", "deploy", "fail"]),
        ["run", "deploy", "fail"],
        analyzeToTerms("The running deployments are failing", ENGLISH_ANALYZER));
      check("index-time and query-time analysis agree on case",
        eq(analyzeToTerms("Running", ENGLISH_ANALYZER), analyzeToTerms("running", ENGLISH_ANALYZER)));

      const vars = { _score: 2, rating: 5, price: 0, created_at: 0, lat: 0, lon: 0 };
      check("script arithmetic", Math.abs(compileScript("_score * (1 + rating / 5)").evaluate(vars) - 4) < 1e-9,
        4, compileScript("_score * (1 + rating / 5)").evaluate(vars));
      check("operator precedence", compileScript("2 + 3 * 4").evaluate(vars) === 14, 14,
        compileScript("2 + 3 * 4").evaluate(vars));
      check("parentheses override precedence", compileScript("(2 + 3) * 4").evaluate(vars) === 20);
      check("ternary, true branch",
        compileScript("price == 0 ? _score * 2 : _score").evaluate(vars) === 4);
      check("ternary, false branch",
        compileScript("price == 0 ? _score * 2 : _score").evaluate({ ...vars, price: 10 }) === 2);
      const broken = compileScript("this is not valid ((");
      check("a broken script reports an error", broken.error !== null);
      check("a broken script falls back to the base score", broken.evaluate(vars) === 2, 2, broken.evaluate(vars));
      check("division by zero does not produce NaN",
        Number.isFinite(compileScript("_score / 0").evaluate(vars)));

      const scripted = search(sc, {
        kind: "script_score",
        query: { kind: "match", field: "title", text: "kubernetes" },
        script: "rating",
      }, { topK: 10 });
      check("script_score scores equal the script's value",
        scripted.hits.every((h) => Math.abs(h.score - index.numericValue("rating", h.docId)) < 1e-9));
    },
  ));

  const totalChecks = suites.reduce((s, x) => s + x.checks.length, 0);
  const totalFailed = suites.reduce((s, x) => s + x.failed, 0);
  return { suites, totalChecks, totalFailed, durationMs: performance.now() - started };
}
