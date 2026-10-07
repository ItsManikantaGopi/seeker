/**
 * Chapter 42's testing strategy, as an executable script.
 *
 *   golden corpus         the book's own expected results, verbatim
 *   differential testing  slow reference vs fast implementation, same answers
 *
 * Reference implementations are kept deliberately naive: full scans, hash sets,
 * DP tables. They are the oracle, so they are allowed to be slow.
 */
import { analyzeToTerms, DEFAULT_ANALYZER, ENGLISH_ANALYZER } from "../lib/kaus/analyzer";
import { bm25, idf, LUCENE_DEFAULTS } from "../lib/kaus/bm25";
import { crc32, decodePostings, encodePostings, analyzeGaps, bitPack, bitUnpack, gapDecode, gapEncode } from "../lib/kaus/codec";
import { BM25_EXAMPLE_CORPUS, CORPUS, GOLDEN_CORPUS, analyzerFor } from "../lib/kaus/corpus";
import { buildIndex, naiveScan } from "../lib/kaus/inverted-index";
import { buildBkdTree, buildKdTree, bkdRangeSearch, kdRangeSearch, naiveRangeSearch, type Point2D } from "../lib/kaus/kdtree";
import { parseQueryString, EXAMPLE_QUERIES } from "../lib/kaus/parser";
import { naivePointRange, pointRange } from "../lib/kaus/points";
import { collectAll, makeSearchContext, search, type Query } from "../lib/kaus/query";
import { exhaustiveTopK, intersectWithTrace, intersectWithSkipping, wandTopK, type WandTerm } from "../lib/kaus/planner";
import { compileScript } from "../lib/kaus/script";
import { buildEngine, KausEngine, verifyFile } from "../lib/kaus/segments";
import { Cluster } from "../lib/kaus/cluster";
import { corrupt } from "../lib/kaus/codec";

let failures = 0;
let checks = 0;
function ok(name: string, condition: boolean, detail = "") {
  checks++;
  if (!condition) {
    failures++;
    console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  ok(name, a === b, `expected ${b}\n      actual   ${a}`);
}

function section(title: string) {
  console.log(`\n--- ${title} ---`);
}

// ===========================================================================
section("Chapter 42: the golden corpus");
// ===========================================================================
{
  const index = buildIndex(GOLDEN_CORPUS, analyzerFor);
  const sc = makeSearchContext(index);
  const keys = (docIds: number[]) => docIds.map((d) => index.source(d)!.id).sort();

  eq("kubernetes -> D1, D3",
    keys(collectAll(sc, { kind: "match", field: "title", text: "kubernetes" })),
    ["D1", "D3"]);
  eq("deployment -> D1, D2",
    keys(collectAll(sc, { kind: "match", field: "title", text: "deployment" })),
    ["D1", "D2"]);
  eq("kubernetes AND service -> D3",
    keys(collectAll(sc, {
      kind: "bool",
      must: [
        { kind: "match", field: "title", text: "kubernetes" },
        { kind: "match", field: "title", text: "service" },
      ],
    })),
    ["D3"]);
  eq('phrase "kubernetes deployment" -> D1',
    keys(collectAll(sc, { kind: "phrase", field: "title", text: "kubernetes deployment" })),
    ["D1"]);
  eq("docker OR kubernetes -> D1, D2, D3",
    keys(collectAll(sc, {
      kind: "bool",
      should: [
        { kind: "match", field: "title", text: "docker" },
        { kind: "match", field: "title", text: "kubernetes" },
      ],
    })),
    ["D1", "D2", "D3"]);
  eq("terraform (not in dictionary) -> nothing",
    keys(collectAll(sc, { kind: "match", field: "title", text: "terraform" })),
    []);
  eq("terraform AND kubernetes -> nothing (chapter 9)",
    keys(collectAll(sc, {
      kind: "bool",
      must: [
        { kind: "match", field: "title", text: "terraform" },
        { kind: "match", field: "title", text: "kubernetes" },
      ],
    })),
    []);
}

// ===========================================================================
section("Appendix A: the worked BM25 example");
// ===========================================================================
{
  const index = buildIndex(BM25_EXAMPLE_CORPUS, analyzerFor);
  ok("N = 3", index.numDocs === 3, `got ${index.numDocs}`);
  ok("df(kubernetes) = 2", index.docFreq("title", "kubernetes") === 2,
    `got ${index.docFreq("title", "kubernetes")}`);
  const avgdl = index.avgFieldLength("title");
  ok("avgdl = 7/3", Math.abs(avgdl - 7 / 3) < 1e-9, `got ${avgdl}`);

  const expectedIdf = Math.log(1.6);
  const actualIdf = idf(3, 2);
  ok("idf = ln(1.6)", Math.abs(actualIdf - expectedIdf) < 1e-12,
    `got ${actualIdf}, want ${expectedIdf}`);

  // D1 has tf 2 and length 3; D2 has tf 1 and length 2; D3 has tf 0.
  const d1 = bm25({ tf: 2, fieldLength: 3, avgFieldLength: avgdl, numDocs: 3, docFreq: 2, params: LUCENE_DEFAULTS });
  const d2 = bm25({ tf: 1, fieldLength: 2, avgFieldLength: avgdl, numDocs: 3, docFreq: 2, params: LUCENE_DEFAULTS });
  ok("D1 outscores D2 on `kubernetes`", d1.score > d2.score,
    `D1 ${d1.score.toFixed(4)} vs D2 ${d2.score.toFixed(4)}`);
  ok("D3 gets no contribution", index.docFreq("title", "kubernetes") === 2 &&
    !(index.postings("title", "kubernetes") ?? []).some((p) => index.source(p.docId)!.id === "D3"));

  // TF saturation: doubling tf must not double the score.
  const tf1 = bm25({ tf: 1, fieldLength: 10, avgFieldLength: 10, numDocs: 100, docFreq: 10, params: LUCENE_DEFAULTS });
  const tf2 = bm25({ tf: 2, fieldLength: 10, avgFieldLength: 10, numDocs: 100, docFreq: 10, params: LUCENE_DEFAULTS });
  const tf10 = bm25({ tf: 10, fieldLength: 10, avgFieldLength: 10, numDocs: 100, docFreq: 10, params: LUCENE_DEFAULTS });
  ok("tf saturates", tf2.score < tf1.score * 2 && tf10.score < tf1.score * 10,
    `tf1=${tf1.score.toFixed(3)} tf2=${tf2.score.toFixed(3)} tf10=${tf10.score.toFixed(3)}`);
  ok("idf falls as df rises", idf(100, 1) > idf(100, 50) && idf(100, 50) > idf(100, 99));
  ok("idf stays finite at df = 0", Number.isFinite(idf(100, 0)));

  // b = 0 must remove length normalisation entirely.
  const short = bm25({ tf: 1, fieldLength: 2, avgFieldLength: 10, numDocs: 100, docFreq: 10, params: { k1: 1.2, b: 0 } });
  const long = bm25({ tf: 1, fieldLength: 50, avgFieldLength: 10, numDocs: 100, docFreq: 10, params: { k1: 1.2, b: 0 } });
  ok("b = 0 ignores length", Math.abs(short.score - long.score) < 1e-12);
  const shortB1 = bm25({ tf: 1, fieldLength: 2, avgFieldLength: 10, numDocs: 100, docFreq: 10, params: { k1: 1.2, b: 1 } });
  const longB1 = bm25({ tf: 1, fieldLength: 50, avgFieldLength: 10, numDocs: 100, docFreq: 10, params: { k1: 1.2, b: 1 } });
  ok("b = 1 punishes long fields", shortB1.score > longB1.score);
}

// ===========================================================================
section("Differential: inverted index vs full scan");
// ===========================================================================
{
  const index = buildIndex(CORPUS, analyzerFor);
  const sc = makeSearchContext(index);
  const vocabulary = index.sortedTerms("title");

  let mismatches = 0;
  for (const term of vocabulary) {
    const viaIndex = collectAll(sc, { kind: "term", field: "title", value: term })
      .map((d) => index.source(d)!.id).sort();
    const viaScan = naiveScan(CORPUS, "title", DEFAULT_ANALYZER, term).matches.sort();
    if (JSON.stringify(viaIndex) !== JSON.stringify(viaScan)) {
      mismatches++;
      if (mismatches <= 3) console.log(`  "${term}": index=${viaIndex} scan=${viaScan}`);
    }
  }
  ok(`every one of ${vocabulary.length} title terms agrees with a full scan`, mismatches === 0,
    `${mismatches} mismatches`);

  // Boolean algebra must hold: |A OR B| == |A| + |B| - |A AND B|
  const pairs: [string, string][] = [
    ["kubernetes", "deployment"], ["docker", "redis"], ["service", "cluster"],
    ["kubernetes", "service"], ["kafka", "deployment"],
  ];
  for (const [a, b] of pairs) {
    const A = new Set(collectAll(sc, { kind: "term", field: "title", value: a }));
    const B = new Set(collectAll(sc, { kind: "term", field: "title", value: b }));
    const or = collectAll(sc, { kind: "bool", should: [
      { kind: "term", field: "title", value: a }, { kind: "term", field: "title", value: b },
    ] });
    const and = collectAll(sc, { kind: "bool", must: [
      { kind: "term", field: "title", value: a }, { kind: "term", field: "title", value: b },
    ] });
    ok(`inclusion-exclusion for ${a}/${b}`,
      or.length === A.size + B.size - and.length,
      `|A|=${A.size} |B|=${B.size} |OR|=${or.length} |AND|=${and.length}`);
    ok(`AND is a subset of OR for ${a}/${b}`, and.every((d) => or.includes(d)));

    // must_not must be the exact complement of must, within the OR set.
    const notB = collectAll(sc, {
      kind: "bool",
      must: [{ kind: "term", field: "title", value: a }],
      must_not: [{ kind: "term", field: "title", value: b }],
    });
    ok(`must_not complements must for ${a}/${b}`,
      notB.length === A.size - and.length,
      `|A|=${A.size} |AND|=${and.length} |A NOT B|=${notB.length}`);
  }

  // Phrase results must be a subset of the AND of their terms.
  const phraseTerms = ["kubernetes deployment", "deployment guide", "kubernetes service"];
  for (const text of phraseTerms) {
    const phrase = collectAll(sc, { kind: "phrase", field: "title", text });
    const conjunction = collectAll(sc, {
      kind: "bool",
      must: analyzeToTerms(text, DEFAULT_ANALYZER).map((t) => ({ kind: "term" as const, field: "title", value: t })),
    });
    ok(`phrase "${text}" is a subset of its AND`,
      phrase.every((d) => conjunction.includes(d)),
      `phrase=${phrase} and=${conjunction}`);
  }

  // A phrase found in the title must really appear consecutively in the text.
  const phraseHits = collectAll(sc, { kind: "phrase", field: "title", text: "kubernetes deployment" });
  for (const docId of phraseHits) {
    const terms = analyzeToTerms(index.source(docId)!.title, DEFAULT_ANALYZER);
    let found = false;
    for (let i = 0; i + 1 < terms.length; i++) {
      if (terms[i] === "kubernetes" && terms[i + 1] === "deployment") found = true;
    }
    ok(`phrase match in ${index.source(docId)!.id} is genuinely adjacent`, found);
  }

  // Prefix expansion must equal a filter over the vocabulary.
  for (const prefix of ["kube", "de", "s", "z"]) {
    const viaPrefix = collectAll(sc, { kind: "prefix", field: "title", value: prefix }).sort((x, y) => x - y);
    const expected = new Set<number>();
    for (const term of vocabulary.filter((t) => t.startsWith(prefix))) {
      for (const p of index.postings("title", term) ?? []) expected.add(p.docId);
    }
    eq(`prefix "${prefix}" matches the vocabulary filter`, viaPrefix, [...expected].sort((x, y) => x - y));
  }

  // Fuzzy must find the deliberately misspelled document.
  const fuzzy = collectAll(sc, { kind: "fuzzy", field: "title", value: "kubernetes", maxEdits: 1 })
    .map((d) => index.source(d)!.id);
  ok("fuzzy kubernetes~1 reaches the misspelled doc-7", fuzzy.includes("doc-7"), `got ${fuzzy}`);
  const exact = collectAll(sc, { kind: "term", field: "title", value: "kubernetes" })
    .map((d) => index.source(d)!.id);
  ok("exact kubernetes does NOT reach doc-7", !exact.includes("doc-7"));

  // Scores must be sorted, and every hit must actually match.
  const result = search(sc, { kind: "match", field: "title", text: "kubernetes deployment" }, { topK: 5 });
  ok("hits come back sorted by score",
    result.hits.every((h, i) => i === 0 || result.hits[i - 1].score >= h.score));
  ok("every hit has an explanation", result.hits.every((h) => h.explanation !== undefined));
  for (const hit of result.hits) {
    ok(`explanation value equals score for doc ${hit.docId}`,
      Math.abs((hit.explanation?.value ?? 0) - hit.score) < 1e-9,
      `explain=${hit.explanation?.value} score=${hit.score}`);
  }

  // topK must be a prefix of the fully ranked list.
  const all = search(sc, { kind: "match", field: "title", text: "kubernetes deployment" }, { topK: 1000 });
  const top3 = search(sc, { kind: "match", field: "title", text: "kubernetes deployment" }, { topK: 3 });
  eq("top-3 is the prefix of the full ranking",
    top3.hits.map((h) => h.docId),
    all.hits.slice(0, 3).map((h) => h.docId));

  // Filter clauses must not change the ranking of what survives.
  const unfiltered = search(sc, { kind: "match", field: "title", text: "kubernetes" }, { topK: 20 });
  const filtered = search(sc, {
    kind: "bool",
    must: [{ kind: "match", field: "title", text: "kubernetes" }],
    filter: [{ kind: "term", field: "status", value: "published" }],
  }, { topK: 20 });
  const publishedOrder = unfiltered.hits
    .filter((h) => index.source(h.docId)!.status === "published")
    .map((h) => h.docId);
  eq("a filter clause changes membership but not order",
    filtered.hits.map((h) => h.docId), publishedOrder);
}

// ===========================================================================
section("Differential: point ranges and spatial trees");
// ===========================================================================
{
  const index = buildIndex(CORPUS, analyzerFor);
  const values = index.pointValues("price");
  const cases = [
    { gte: 100, lte: 200 }, { gte: 0, lte: 0 }, { gt: 0 }, { lt: 50 },
    { gte: 1000 }, { lte: -5 }, { gte: 29, lte: 29 }, {},
  ];
  for (const c of cases) {
    eq(`price range ${JSON.stringify(c)}`, pointRange(values, c).docIds, naivePointRange(values, c));
  }

  const points: Point2D[] = CORPUS.map((d, i) => ({ x: d.lat, y: d.lon, docId: i }));
  const kd = buildKdTree(points);
  const bkd = buildBkdTree(points, 4);
  const regions = [
    { minX: 30, maxX: 60, minY: -130, maxY: 30 },
    { minX: -90, maxX: 90, minY: -180, maxY: 180 },
    { minX: 0, maxX: 0, minY: 0, maxY: 0 },
    { minX: 45, maxX: 55, minY: 0, maxY: 40 },
    { minX: -40, maxX: -20, minY: 100, maxY: 160 },
  ];
  for (const region of regions) {
    const expected = naiveRangeSearch(points, region);
    eq(`kd range ${JSON.stringify(region)}`, kdRangeSearch(kd.root, region).docIds, expected);
    eq(`bkd range ${JSON.stringify(region)}`, bkdRangeSearch(bkd, region).docIds, expected);
  }

  const wide = bkdRangeSearch(bkd, { minX: 30, maxX: 60, minY: -130, maxY: 30 });
  console.log(
    `  bkd: ${bkd.leafCount} leaves, query skipped ${wide.subtreesSkipped} subtree(s), ` +
    `took ${wide.leafBlocksRead} leaf read(s) and ${wide.pointsChecked} point comparison(s) ` +
    `out of ${points.length} points`,
  );
  ok("bkd checks fewer points than a full scan", wide.pointsChecked < points.length);
}

// ===========================================================================
section("Differential: codec round-trips");
// ===========================================================================
{
  const index = buildIndex(CORPUS, analyzerFor);
  let roundTripFailures = 0;
  for (const field of ["title", "body"]) {
    for (const term of index.sortedTerms(field)) {
      const postings = index.postings(field, term)!;
      const encoded = encodePostings(term, postings, { positions: true });
      const decoded = decodePostings(encoded.bytes, true);
      if (JSON.stringify(decoded) !== JSON.stringify(postings)) {
        roundTripFailures++;
        if (roundTripFailures <= 2) {
          console.log(`  ${field}:${term} round trip failed`);
          console.log(`    in : ${JSON.stringify(postings)}`);
          console.log(`    out: ${JSON.stringify(decoded)}`);
        }
      }
    }
  }
  ok("every postings list survives encode/decode", roundTripFailures === 0, `${roundTripFailures} failures`);

  // The book's own gap example.
  eq("gap encoding of 100,105,110,250", gapEncode([100, 105, 110, 250]), [100, 5, 5, 140]);
  eq("gap decoding is the inverse", gapDecode([100, 5, 5, 140]), [100, 105, 110, 250]);

  const analysis = analyzeGaps([100, 105, 110, 250], 4);
  ok("gaps beat raw vints", analysis.vintGapBytes <= analysis.vintRawBytes,
    `gap=${analysis.vintGapBytes} raw=${analysis.vintRawBytes}`);
  ok("vints beat fixed width", analysis.vintGapBytes < analysis.fixedBytes,
    `vint=${analysis.vintGapBytes} fixed=${analysis.fixedBytes}`);

  // Bit packing must be lossless.
  for (const bits of [1, 3, 5, 8, 12]) {
    const values = Array.from({ length: 16 }, (_, i) => (i * 7 + 3) % (1 << bits));
    eq(`bit pack/unpack at ${bits} bits`, bitUnpack(bitPack(values, bits), bits, values.length), values);
  }

  // Checksums must actually detect corruption.
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  ok("crc32 is stable", crc32(bytes) === crc32(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])));
  ok("crc32 changes when a byte flips", crc32(bytes) !== crc32(corrupt(bytes, 3)));
}

// ===========================================================================
section("Segments: refresh, flush, commit, merge, recover");
// ===========================================================================
{
  const engine = new KausEngine({ segmentsPerTier: 3, maxMergeAtOnce: 4 });
  engine.index(CORPUS[0]);
  engine.index(CORPUS[1]);
  ok("buffered writes are not searchable", engine.visibleDocCount === 0);
  ok("but they are in the translog", engine.translog.length === 2);

  engine.refresh();
  ok("refresh makes them searchable", engine.visibleDocCount === 2, `got ${engine.visibleDocCount}`);
  ok("refresh does not write files", engine.stats().diskBytes === 0);

  engine.flush();
  ok("flush writes files", engine.stats().diskBytes > 0);
  ok("translog survives a flush", engine.translog.length === 2);

  engine.commit();
  ok("commit truncates the translog", engine.translog.length === 0);
  ok("commit records a generation", engine.lastCommit?.generation === 1);

  // Every written file must verify.
  let verified = 0;
  for (const segment of engine.liveSegments) {
    for (const file of segment.files) {
      const v = verifyFile(file);
      ok(`${file.name} verifies`, v.valid,
        `magic=${v.magicOk} footer=${v.footerOk} stored=${v.storedChecksum} computed=${v.computedChecksum}`);
      verified++;
    }
  }
  ok("some files were actually verified", verified > 0);

  // Corrupting a byte must be caught.
  const victim = engine.liveSegments[0].files[0];
  const damaged = { ...victim, bytes: corrupt(victim.bytes, 40) };
  ok("a flipped byte fails verification", !verifyFile(damaged).valid);

  // Deletes are tombstones until a merge.
  const bigEngine = buildEngine(CORPUS, { docsPerSegment: 5 });
  const beforeSegments = bigEngine.segmentCount;
  ok("many segments exist", beforeSegments >= 5, `got ${beforeSegments}`);
  const sample = CORPUS[3].id;
  bigEngine.delete(sample);
  const afterDelete = bigEngine.search({ kind: "match_all" }, { topK: 100 });
  ok("a deleted document disappears from results",
    !afterDelete.hits.some((h) => h.docKey === sample));

  const beforeMergeDocs = bigEngine.visibleDocCount;
  bigEngine.mergeAll();
  ok("merging reduces the segment count", bigEngine.segmentCount < beforeSegments,
    `${beforeSegments} -> ${bigEngine.segmentCount}`);
  ok("merging preserves the live document count", bigEngine.visibleDocCount === beforeMergeDocs,
    `${beforeMergeDocs} -> ${bigEngine.visibleDocCount}`);
  ok("the merged index still cannot find the deleted document",
    !bigEngine.search({ kind: "match_all" }, { topK: 100 }).hits.some((h) => h.docKey === sample));

  // Search results must not depend on how documents were split into segments.
  const oneSegment = buildEngine(CORPUS, { docsPerSegment: CORPUS.length });
  const manySegments = buildEngine(CORPUS, { docsPerSegment: 3 });
  const q: Query = { kind: "match", field: "title", text: "kubernetes" };
  const a = new Set(oneSegment.search(q, { topK: 100 }).hits.map((h) => h.docKey));
  const b = new Set(manySegments.search(q, { topK: 100 }).hits.map((h) => h.docKey));
  eq("segment layout does not change which documents match", [...a].sort(), [...b].sort());

  // Crash and recovery.
  const crashy = new KausEngine();
  crashy.indexAll(CORPUS.slice(0, 6));
  crashy.refresh();
  crashy.commit();
  crashy.indexAll(CORPUS.slice(6, 10));
  crashy.refresh(); // searchable but never flushed
  const beforeCrash = crashy.visibleDocCount;
  ok("ten documents visible before the crash", beforeCrash === 10, `got ${beforeCrash}`);
  crashy.crash();
  ok("the unflushed segment is gone", crashy.visibleDocCount === 6, `got ${crashy.visibleDocCount}`);
  crashy.recover();
  ok("the translog restores them", crashy.visibleDocCount === 10, `got ${crashy.visibleDocCount}`);
}

// ===========================================================================
section("Planner: intersection and WAND");
// ===========================================================================
{
  // The book's worked two-pointer example.
  const trace = intersectWithTrace([2, 5, 9, 20], [1, 5, 7, 9]);
  eq("A=[2,5,9,20] B=[1,5,7,9] gives [5,9]", trace.result, [5, 9]);
  eq("skipping finds the same intersection",
    intersectWithSkipping([2, 5, 9, 20], [1, 5, 7, 9]).result, [5, 9]);

  // Randomised: skipping must always agree with the two-pointer walk.
  let seed = 99;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let intersectionFailures = 0;
  for (let trial = 0; trial < 300; trial++) {
    const a = [...new Set(Array.from({ length: 1 + Math.floor(rnd() * 40) }, () => Math.floor(rnd() * 200)))].sort((x, y) => x - y);
    const b = [...new Set(Array.from({ length: 1 + Math.floor(rnd() * 40) }, () => Math.floor(rnd() * 200)))].sort((x, y) => x - y);
    const twoPointer = intersectWithTrace(a, b).result;
    const skipping = intersectWithSkipping(a, b).result;
    if (JSON.stringify(twoPointer) !== JSON.stringify([...skipping].sort((x, y) => x - y))) {
      intersectionFailures++;
    }
  }
  ok("skipping matches the two-pointer walk on 300 random pairs", intersectionFailures === 0,
    `${intersectionFailures} mismatches`);

  // WAND must return exactly the same top-K as scoring everything.
  const terms: WandTerm[] = [
    { term: "a", entries: [], maxScore: 0 },
    { term: "b", entries: [], maxScore: 0 },
    { term: "c", entries: [], maxScore: 0 },
  ];
  seed = 4242;
  for (const t of terms) {
    const entries: { docId: number; score: number }[] = [];
    for (let doc = 0; doc < 400; doc++) {
      if (rnd() < 0.25) entries.push({ docId: doc, score: rnd() * 5 });
    }
    t.entries = entries;
    t.maxScore = entries.reduce((m, e) => Math.max(m, e.score), 0);
  }
  for (const k of [1, 5, 10, 25]) {
    const slow = exhaustiveTopK(terms, k);
    const fast = wandTopK(terms, k);
    eq(`WAND top-${k} matches exhaustive top-${k}`,
      fast.hits.map((h) => `${h.docId}:${h.score.toFixed(6)}`),
      slow.hits.map((h) => `${h.docId}:${h.score.toFixed(6)}`));
    ok(`WAND scores fewer documents at k=${k}`,
      fast.fullEvaluations <= slow.fullEvaluations,
      `wand=${fast.fullEvaluations} exhaustive=${slow.fullEvaluations}`);
  }
  const slow10 = exhaustiveTopK(terms, 10);
  const fast10 = wandTopK(terms, 10);
  console.log(
    `  top-10 over ${slow10.fullEvaluations} matching documents: ` +
    `exhaustive scored ${slow10.fullEvaluations}, WAND scored ${fast10.fullEvaluations} ` +
    `(${Math.round((1 - fast10.fullEvaluations / slow10.fullEvaluations) * 100)}% avoided)`,
  );
}

// ===========================================================================
section("Cluster: shards, replicas, query then fetch");
// ===========================================================================
{
  const cluster = new Cluster({ shardCount: 3, replicaCount: 1, nodeCount: 3 });
  cluster.indexAll(CORPUS);
  cluster.commitAll();

  ok("cluster is green", cluster.health() === "green", `got ${cluster.health()}`);
  const distributed = cluster.distribution();
  eq("every document landed on exactly one shard",
    distributed.reduce((sum, d) => sum + d.documents, 0), CORPUS.length);

  const single = buildEngine(CORPUS);
  const q: Query = { kind: "match", field: "title", text: "kubernetes" };
  const shardedHits = cluster.search(q, { topK: 50 });
  const globalHits = single.search(q, { topK: 50 });
  eq("sharding does not change which documents match",
    shardedHits.hits.map((h) => h.docKey).sort(),
    globalHits.hits.map((h) => h.docKey).sort());

  ok("the fetch phase moves less data than fetching everything",
    shardedHits.bytesActuallyFetched <= shardedHits.bytesIfFetchedEverything,
    `fetched=${shardedHits.bytesActuallyFetched} everything=${shardedHits.bytesIfFetchedEverything}`);
  // With a small top-K the phase split earns its keep: every shard proposes K
  // candidates, but only the global winners get their bodies fetched.
  const narrow = cluster.search(q, { topK: 3 });
  ok("a small top-K fetches strictly less than every candidate",
    narrow.bytesActuallyFetched < narrow.bytesIfFetchedEverything,
    `fetched=${narrow.bytesActuallyFetched} everything=${narrow.bytesIfFetchedEverything}`);
  console.log(
    `  top-3 over ${cluster.config.shardCount} shards: query phase moved ${narrow.queryPhaseBytes}B of ids+scores, ` +
    `fetch moved ${narrow.bytesActuallyFetched}B for the winners ` +
    `(fetching every candidate up front would have moved ${narrow.bytesIfFetchedEverything}B)`,
  );

  // Losing one node of three, with one replica each, must stay searchable.
  cluster.failNode("node-1");
  ok("cluster is not red after losing one node with replicas",
    cluster.health() !== "red", `got ${cluster.health()}`);
  const afterFailure = cluster.search(q, { topK: 50 });
  ok("results survive a node failure", !afterFailure.partial,
    `failed shards: ${afterFailure.shardsFailed}`);
  eq("and are the same documents",
    afterFailure.hits.map((h) => h.docKey).sort(),
    globalHits.hits.map((h) => h.docKey).sort());

  // With no replicas, the same failure must lose a shard.
  const fragile = new Cluster({ shardCount: 3, replicaCount: 0, nodeCount: 3 });
  fragile.indexAll(CORPUS);
  fragile.failNode("node-2");
  const partial = fragile.search(q, { topK: 50 });
  ok("no replicas means partial results", partial.partial && fragile.health() === "red",
    `partial=${partial.partial} health=${fragile.health()}`);

  // Routing everything to a constant key must produce a hot shard.
  const hot = new Cluster({ shardCount: 4, replicaCount: 0, nodeCount: 4 });
  hot.indexAll(CORPUS, () => "same-key");
  const hotDistribution = hot.distribution();
  ok("a constant routing key puts everything on one shard",
    hotDistribution.filter((d) => d.documents > 0).length === 1,
    JSON.stringify(hotDistribution));
  ok("and the skew metric notices", hot.skew() > cluster.skew());
}

// ===========================================================================
section("Parser and scripts");
// ===========================================================================
{
  for (const example of EXAMPLE_QUERIES) {
    const parsed = parseQueryString(example.query);
    ok(`parses: ${example.query}`, parsed.errors.length === 0,
      parsed.errors.map((e) => e.message).join("; "));
  }

  const index = buildIndex(CORPUS, analyzerFor);
  const sc = makeSearchContext(index);
  for (const example of EXAMPLE_QUERIES) {
    const parsed = parseQueryString(example.query);
    const result = search(sc, parsed.query, { topK: 5 });
    ok(`executes: ${example.query}`, Array.isArray(result.hits));
  }

  // `AND` really must be narrower than `OR`.
  const or = collectAll(sc, parseQueryString("kubernetes deployment").query);
  const and = collectAll(sc, parseQueryString("kubernetes AND deployment").query);
  ok("AND is narrower than OR", and.length <= or.length, `and=${and.length} or=${or.length}`);
  ok("AND is a subset of OR", and.every((d) => or.includes(d)));

  // Scripts.
  const s1 = compileScript("_score * (1 + rating / 5)");
  ok("script parses", s1.error === null, s1.error ?? "");
  ok("script evaluates", Math.abs(s1.evaluate({ _score: 2, rating: 5, price: 0, created_at: 0, lat: 0, lon: 0 }) - 4) < 1e-9);
  const s2 = compileScript("price == 0 ? _score * 2 : _score");
  ok("ternary works when true", s2.evaluate({ _score: 3, price: 0, rating: 0, created_at: 0, lat: 0, lon: 0 }) === 6);
  ok("ternary works when false", s2.evaluate({ _score: 3, price: 10, rating: 0, created_at: 0, lat: 0, lon: 0 }) === 3);
  const s3 = compileScript("this is not valid ((");
  ok("a broken script reports an error", s3.error !== null);
  ok("a broken script falls back to the base score",
    s3.evaluate({ _score: 7, price: 0, rating: 0, created_at: 0, lat: 0, lon: 0 }) === 7);
  ok("division by zero does not produce NaN",
    Number.isFinite(compileScript("_score / 0").evaluate({ _score: 1, price: 0, rating: 0, created_at: 0, lat: 0, lon: 0 })));
  ok("precedence is respected", compileScript("2 + 3 * 4").evaluate({ _score: 0, price: 0, rating: 0, created_at: 0, lat: 0, lon: 0 }) === 14);
  ok("parentheses override precedence", compileScript("(2 + 3) * 4").evaluate({ _score: 0, price: 0, rating: 0, created_at: 0, lat: 0, lon: 0 }) === 20);

  // A script_score query must reorder results.
  const plain = search(sc, { kind: "match", field: "title", text: "kubernetes" }, { topK: 10 });
  const scripted = search(sc, {
    kind: "script_score",
    query: { kind: "match", field: "title", text: "kubernetes" },
    script: "rating",
  }, { topK: 10 });
  ok("script_score matches the same documents",
    new Set(plain.hits.map((h) => h.docId)).size === new Set(scripted.hits.map((h) => h.docId)).size);
  ok("scripted scores equal the rating",
    scripted.hits.every((h) => Math.abs(h.score - index.numericValue("rating", h.docId)) < 1e-9));
}

// ===========================================================================
section("Analysis");
// ===========================================================================
{
  eq("standard analyzer lowercases and splits",
    analyzeToTerms("Running Kubernetes, quickly!", DEFAULT_ANALYZER),
    ["running", "kubernetes", "quickly"]);
  eq("english analyzer stems and drops stopwords",
    analyzeToTerms("The running deployments are failing", ENGLISH_ANALYZER),
    ["run", "deploy", "fail"]);
  ok("index-time and query-time analysis must agree",
    JSON.stringify(analyzeToTerms("Running", ENGLISH_ANALYZER)) ===
    JSON.stringify(analyzeToTerms("running", ENGLISH_ANALYZER)));
  eq("keyword analysis keeps the whole value",
    analyzeToTerms("Kubernetes Deployment Guide", { ...DEFAULT_ANALYZER, tokenizer: "keyword", lowercase: false }),
    ["Kubernetes Deployment Guide"]);
}

console.log(
  failures === 0
    ? `\n${checks} checks passed`
    : `\n${failures} of ${checks} checks FAILED`,
);
if (failures > 0) process.exit(1);
