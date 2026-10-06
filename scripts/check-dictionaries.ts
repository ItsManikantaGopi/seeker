/**
 * Differential tests for the term-dictionary chapters.
 *
 * The sorted term list is the oracle. Trie, DAWG and FST must all agree with it,
 * and automaton intersection over each must agree with brute-force edit distance.
 */
import { CORPUS } from "../lib/kaus/corpus";
import { analyzeToTerms, DEFAULT_ANALYZER } from "../lib/kaus/analyzer";
import { Trie, minimize, dawgAccepts, dawgTerms } from "../lib/kaus/trie";
import { buildFst, buildOrdinalFst, intersectFstWithAutomaton } from "../lib/kaus/fst";
import { bruteForceFuzzy } from "../lib/kaus/edit-distance";
import { buildLevenshteinAutomaton } from "../lib/kaus/levenshtein-automaton";

let failures = 0;
function ok(name: string, condition: boolean, detail = "") {
  if (!condition) {
    failures++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// The book's own tiny examples
// ---------------------------------------------------------------------------
{
  const fst = buildFst([
    { key: "can", output: 300 },
    { key: "car", output: 100 },
    { key: "cat", output: 200 },
  ]);
  ok("fst car=100", fst.get("car") === 100, `got ${fst.get("car")}`);
  ok("fst cat=200", fst.get("cat") === 200, `got ${fst.get("cat")}`);
  ok("fst can=300", fst.get("can") === 300, `got ${fst.get("can")}`);
  ok("fst ca missing", fst.get("ca") === null);
  ok("fst cab missing", fst.get("cab") === null);
  console.log(`car/cat/can FST: ${fst.stats.states} states, ${fst.stats.arcs} arcs`);

  const shared = buildFst([
    { key: "bar", output: 200 },
    { key: "car", output: 100 },
  ]);
  ok("fst bar=200", shared.get("bar") === 200, `got ${shared.get("bar")}`);
  ok("fst car=100", shared.get("car") === 100, `got ${shared.get("car")}`);
  // "ar -> END" must be stored once: root, one state after b/c, then shared ar.
  console.log(`bar/car FST: ${shared.stats.states} states, ${shared.stats.arcs} arcs, ${shared.stats.statesReused} reused`);
  ok("bar/car shares the suffix", shared.stats.states <= 4, `${shared.stats.states} states`);
}

// ---------------------------------------------------------------------------
// Real vocabulary
// ---------------------------------------------------------------------------
const vocabSet = new Set<string>();
for (const doc of CORPUS) {
  for (const t of analyzeToTerms(doc.title, DEFAULT_ANALYZER)) vocabSet.add(t);
  for (const t of analyzeToTerms(doc.body, DEFAULT_ANALYZER)) vocabSet.add(t);
}
const vocabulary = [...vocabSet].sort();
console.log(`\nvocabulary: ${vocabulary.length} terms`);

const trie = Trie.from(vocabulary);
ok("trie term count", trie.termCount === vocabulary.length);
for (const t of vocabulary) ok(`trie contains ${t}`, trie.contains(t).found);
ok("trie rejects nonsense", !trie.contains("zzzznope").found);
ok(
  "trie enumerates every term in order",
  trie.collect(trie.root, "").join("|") === vocabulary.join("|"),
);

const min = minimize(trie);
console.log(
  `trie: ${min.trieNodeCount} nodes / ${min.trieEdgeCount} edges  ->  ` +
  `dawg: ${min.dawgNodeCount} nodes / ${min.dawgEdgeCount} edges  ` +
  `(${(100 - (min.dawgNodeCount / min.trieNodeCount) * 100).toFixed(1)}% fewer nodes)`,
);
ok("dawg accepts every term", vocabulary.every((t) => dawgAccepts(min, t)));
ok("dawg rejects nonsense", !dawgAccepts(min, "zzzznope"));
ok(
  "dawg enumerates the same language",
  dawgTerms(min).join("|") === vocabulary.join("|"),
);
ok("dawg is not larger than the trie", min.dawgNodeCount <= min.trieNodeCount);

const fst = buildOrdinalFst(vocabulary);
console.log(
  `fst: ${fst.stats.states} states, ${fst.stats.arcs} arcs, ` +
  `${fst.stats.statesReused} reuses, ~${fst.stats.estimatedBytes}B ` +
  `(trie estimate ~${trie.estimateBytes()}B)`,
);
let ordinalFailures = 0;
vocabulary.forEach((term, i) => {
  if (fst.get(term) !== i) {
    ordinalFailures++;
    if (ordinalFailures <= 5) console.log(`  ordinal mismatch ${term}: want ${i} got ${fst.get(term)}`);
  }
});
ok("fst returns the right ordinal for every term", ordinalFailures === 0, `${ordinalFailures} wrong`);
ok("fst rejects a non-term", fst.get("zzzznope") === null);
ok(
  "fst enumerates every key with the right output",
  fst.keys().map((k) => `${k.key}=${k.output}`).join("|") ===
    vocabulary.map((t, i) => `${t}=${i}`).join("|"),
);

// Prefix enumeration must agree between trie and FST.
for (const prefix of ["k", "ku", "kube", "de", "s", "z", ""]) {
  const fromTrie = trie.prefixSearch(prefix).terms;
  const fromFst = fst.prefixKeys(prefix).map((k) => k.key);
  ok(`prefix "${prefix}" agrees`, fromTrie.join("|") === fromFst.join("|"),
    `trie=${fromTrie.length} fst=${fromFst.length}`);
  const expected = vocabulary.filter((t) => t.startsWith(prefix));
  ok(`prefix "${prefix}" matches a filter`, fromTrie.join("|") === expected.join("|"));
}

// ---------------------------------------------------------------------------
// Fuzzy: brute force vs trie intersection vs FST intersection
// ---------------------------------------------------------------------------
const FUZZY_QUERIES = ["kubernetes", "kubernets", "deployment", "servic", "docker", "kafka", "clustr", "redis"];
for (const q of FUZZY_QUERIES) {
  for (const k of [1, 2]) {
    const expected = [...bruteForceFuzzy(q, vocabulary, k).terms].sort();
    const automaton = buildLevenshteinAutomaton(q, k);
    const viaTrie = [...trie.intersectAutomaton(automaton).terms].sort();
    const viaFst = [...intersectFstWithAutomaton(fst, automaton).terms.map((t) => t.term)].sort();
    ok(`fuzzy ${q}~${k} trie`, expected.join("|") === viaTrie.join("|"),
      `expected ${expected.join(",")} got ${viaTrie.join(",")}`);
    ok(`fuzzy ${q}~${k} fst`, expected.join("|") === viaFst.join("|"),
      `expected ${expected.join(",")} got ${viaFst.join(",")}`);
  }
}

// The work saved is the actual selling point, so print it once.
{
  const automaton = buildLevenshteinAutomaton("kubernets", 1);
  const brute = bruteForceFuzzy("kubernets", vocabulary, 1);
  const viaTrie = trie.intersectAutomaton(automaton);
  const viaFst = intersectFstWithAutomaton(fst, automaton);
  console.log(
    `\nkubernets~1 -> ${brute.terms.join(", ")}\n` +
    `  brute force: ${brute.comparisons} term comparisons (full DP table each)\n` +
    `  trie:        ${viaTrie.nodesVisited} nodes visited, ${viaTrie.subtreesPruned} subtrees pruned\n` +
    `  fst:         ${viaFst.arcsFollowed} arcs followed, ${viaFst.arcsPruned} arcs pruned`,
  );
}

console.log(failures === 0 ? "\nall dictionary checks passed" : `\n${failures} FAILURES`);
if (failures > 0) process.exit(1);
