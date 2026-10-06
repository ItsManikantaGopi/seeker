/**
 * Chapter 42's differential test, as a script: the brute-force DP table is the
 * oracle, the automaton is the optimisation. They must agree on every input.
 */
import { bruteForceFuzzy, levenshtein } from "../lib/kaus/edit-distance";
import { buildLevenshteinAutomaton, scanWithAutomaton } from "../lib/kaus/levenshtein-automaton";

const VOCAB = [
  "kubernetes", "kubernets", "kubernetes-deployment", "kubernetes-service",
  "docker", "redis", "kafka", "deployment", "deployments", "deploy",
  "service", "services", "cluster", "clusters", "guide", "kube", "kubelet",
  "terraform", "postgres", "lucene", "segment", "segments", "", "k", "ku",
  "kubernetees", "kuberentes", "ubernetes", "kubernete",
];

let failures = 0;
let checks = 0;

function check(query: string, maxEdits: number, transpositions: boolean) {
  const expected = bruteForceFuzzy(query, VOCAB, maxEdits, { transpositions });
  const automaton = buildLevenshteinAutomaton(query, maxEdits, { transpositions });
  const actual = scanWithAutomaton(automaton, VOCAB);
  const a = [...expected.terms].sort().join("|");
  const b = [...actual.terms].sort().join("|");
  checks++;
  if (a !== b) {
    failures++;
    console.log(`MISMATCH query=${JSON.stringify(query)} k=${maxEdits} transpositions=${transpositions}`);
    console.log(`  brute force: ${a}`);
    console.log(`  automaton:   ${b}`);
    const onlyBrute = expected.terms.filter((t) => !actual.terms.includes(t));
    const onlyAuto = actual.terms.filter((t) => !expected.terms.includes(t));
    for (const t of onlyBrute) console.log(`  missing "${t}" (distance ${levenshtein(query, t)})`);
    for (const t of onlyAuto) console.log(`  extra   "${t}" (distance ${levenshtein(query, t)})`);
  }
}

const QUERIES = ["kubernetes", "kubernets", "kube", "docker", "redis", "deploy", "", "k", "cluster", "sevice", "kuberentes"];
for (const q of QUERIES) {
  for (const k of [0, 1, 2]) {
    check(q, k, false);
  }
}
// Damerau: adjacent transposition costs 1 edit instead of 2.
for (const q of ["kuberentes", "sevrice", "dokcer"]) {
  for (const k of [1, 2]) check(q, k, true);
}

// A randomised sweep over generated strings, with a deterministic PRNG.
let seed = 20260813;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const ALPHA = "abcdek u";
for (let n = 0; n < 400; n++) {
  const len = 1 + Math.floor(rnd() * 7);
  let q = "";
  for (let i = 0; i < len; i++) q += ALPHA[Math.floor(rnd() * ALPHA.length)];
  const vocab: string[] = [];
  for (let v = 0; v < 12; v++) {
    const vlen = Math.floor(rnd() * 8);
    let s = "";
    for (let i = 0; i < vlen; i++) s += ALPHA[Math.floor(rnd() * ALPHA.length)];
    vocab.push(s);
  }
  for (const k of [1, 2]) {
    const expected = bruteForceFuzzy(q, vocab, k);
    const automaton = buildLevenshteinAutomaton(q, k);
    const actual = scanWithAutomaton(automaton, vocab);
    checks++;
    const a = [...new Set(expected.terms)].sort().join("|");
    const b = [...new Set(actual.terms)].sort().join("|");
    if (a !== b) {
      failures++;
      console.log(`RANDOM MISMATCH query=${JSON.stringify(q)} k=${k}`);
      console.log(`  vocab: ${JSON.stringify(vocab)}`);
      console.log(`  brute force: ${a}`);
      console.log(`  automaton:   ${b}`);
      if (failures > 5) break;
    }
  }
  if (failures > 5) break;
}

// Size story: how big does the DFA get?
for (const k of [1, 2]) {
  const a = buildLevenshteinAutomaton("kubernetes", k);
  console.log(`DFA for "kubernetes" k=${k}: ${a.size} states, alphabet ${a.alphabet.length}`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
