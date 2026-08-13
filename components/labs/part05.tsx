"use client";

import { useMemo, useState } from "react";
import { bruteForceFuzzy, levenshteinTable, type EditOp } from "@/lib/seeker/edit-distance";
import {
  ANY_OTHER, buildLevenshteinAutomaton, scanWithAutomaton,
} from "@/lib/seeker/levenshtein-automaton";
import { demoContext, demoDictionary, demoIndex } from "@/lib/demo";
import { search } from "@/lib/seeker/query";
import { autoFuzziness } from "@/lib/seeker/term-dictionary";
import {
  Badge,
  Bar,
  Button,
  Callout,
  EmptyState,
  Grid,
  KeyValue,
  Mono,
  Panel,
  Slider,
  Stack,
  Stat,
  StatRow,
  StepPlayer,
  Table,
  Td,
  TextInput,
  Toggle,
  TokenChip,
  Tr,
  formatNumber,
  percent,
  useSteps,
} from "@/components/ui";

// ===========================================================================
// Chapter 13 — edit distance
// ===========================================================================

/** A free match sits on the faintest fill; costlier operations get heavier ones. */
const OP_BACKGROUND: Record<EditOp, string> = {
  match: "bg-ok-soft",
  substitute: "bg-warn-soft",
  insert: "bg-info-soft",
  delete: "bg-bad-soft",
  transpose: "bg-accent-soft",
};

export function Ch13() {
  const [a, setA] = useState("piza");
  const [b, setB] = useState("pizza");
  const [transpositions, setTranspositions] = useState(false);

  const result = useMemo(() => levenshteinTable(a, b, transpositions), [a, b, transpositions]);
  const [step, setStep] = useSteps(result.steps.length);
  const pathSet = useMemo(
    () => new Set(result.path.slice(0, step + 2).map(([i, j]) => `${i}:${j}`)),
    [result.path, step],
  );

  return (
    <Stack gap={4}>
      <Panel
        title="The dynamic-programming table"
        subtitle="dp[i][j] is the minimum number of edits that turns the first i characters of A into the first j characters of B."
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextInput label="A (query)" value={a} onChange={(v) => setA(v.slice(0, 14))} />
            <TextInput label="B (indexed term)" value={b} onChange={(v) => setB(v.slice(0, 14))} />
            <div className="flex items-end pb-1">
              <Toggle
                label="Damerau (allow transpositions)"
                checked={transpositions}
                onChange={setTranspositions}
                hint="Treat a swap of two adjacent characters as one edit instead of two"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {["piza/pizza", "kubernets/kubernetes", "sevrice/service", "docker/dokcer", "cat/dog"].map((pair) => {
              const [x, y] = pair.split("/");
              return (
                <Button key={pair} size="sm" onClick={() => { setA(x); setB(y); }}>
                  {x} → {y}
                </Button>
              );
            })}
          </div>

          <div className="scroll-x">
            <table className="border-collapse font-mono text-[11.5px] tabular-nums">
              <thead>
                <tr>
                  <th className="h-7 w-7" />
                  <th className="h-7 w-7 text-faint">ε</th>
                  {[...b].map((ch, j) => (
                    <th key={j} className="h-7 w-7 text-center text-accent-text">{ch}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.table.map((row, i) => (
                  <tr key={i}>
                    <th className="h-7 w-7 text-center text-accent-text">{i === 0 ? "ε" : a[i - 1]}</th>
                    {row.map((value, j) => {
                      const onPath = pathSet.has(`${i}:${j}`);
                      const isEnd = i === result.table.length - 1 && j === row.length - 1;
                      return (
                        <td
                          key={j}
                          className={`h-7 w-7 border text-center transition-colors ${
                            isEnd
                              ? "border-transparent bg-accent-soft font-bold text-accent-text"
                              : onPath
                                ? "border-transparent bg-ok-soft text-ok"
                                : "border-edge text-muted"
                          }`}
                        >
                          {value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <StatRow>
            <Stat label="edit distance" value={result.distance} tone="accent" />
            <Stat label="table cells filled" value={result.table.length * (result.table[0]?.length ?? 0)} />
            <Stat label="operations in the path" value={result.steps.length} />
            <Stat label="A length × B length" value={`${a.length} × ${b.length}`} />
          </StatRow>
        </Stack>
      </Panel>

      <Panel title="The traceback" subtitle="Walk the path from the bottom right corner back to the start and read off the edits.">
        <Stack gap={3}>
          <StepPlayer total={result.steps.length} index={step} onChange={setStep} label="edit" />
          <div className="flex flex-wrap gap-1.5">
            {result.steps.map((s, i) => (
              <span
                key={i}
                className={`inline-flex flex-col items-center rounded-md border border-transparent px-2 py-1 transition-opacity ${
                  i <= step ? "opacity-100" : "opacity-25"
                } ${OP_BACKGROUND[s.op]}`}
              >
                <span className="font-mono text-[12px] text-ink">
                  {s.op === "insert" ? `+${s.b}` : s.op === "delete" ? `−${s.a}` : s.op === "match" ? s.a : `${s.a}→${s.b}`}
                </span>
                <span className="mt-0.5 text-[9.5px] text-muted">{s.op}</span>
              </span>
            ))}
          </div>
          <KeyValue
            items={[
              { key: "free matches", value: result.steps.filter((s) => s.op === "match").length },
              { key: "substitutions", value: result.steps.filter((s) => s.op === "substitute").length },
              { key: "insertions", value: result.steps.filter((s) => s.op === "insert").length },
              { key: "deletions", value: result.steps.filter((s) => s.op === "delete").length },
              ...(transpositions
                ? [{ key: "transpositions", value: result.steps.filter((s) => s.op === "transpose").length }]
                : []),
            ]}
          />
        </Stack>
      </Panel>

      <Ch13BruteForce />
    </Stack>
  );
}

function Ch13BruteForce() {
  const dictionary = demoDictionary("title");
  const [query, setQuery] = useState("kubernets");
  const [maxEdits, setMaxEdits] = useState(1);

  const result = useMemo(
    () => bruteForceFuzzy(query.toLowerCase(), dictionary.sortedTerms, maxEdits),
    [query, dictionary, maxEdits],
  );

  return (
    <Panel
      title="The first fuzzy implementation"
      subtitle="Compare the query against every term in the vocabulary. Slow — and precious, because it is the oracle everything faster gets tested against."
      tone="sunken"
    >
      <Stack gap={4}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="Query" value={query} onChange={setQuery} />
          <Slider label="max edits" value={maxEdits} min={0} max={3} onChange={setMaxEdits} />
        </div>

        <pre className="rounded-lg border border-edge bg-code p-3 font-mono text-[11.5px] leading-relaxed text-muted">
{`for every indexed term:
    distance = levenshtein(query, term)
    if distance <= ${maxEdits}:
        expansion.add(term)`}
        </pre>

        <StatRow>
          <Stat label="terms compared" value={result.comparisons} tone="bad" hint="Every single term in the vocabulary" />
          <Stat label="tables built" value={result.comparisons} tone="bad" hint="One full DP table per term" />
          <Stat label="terms accepted" value={result.terms.length} tone="ok" />
          <Stat label="hit rate" value={percent(result.terms.length / Math.max(1, result.comparisons), 2)} />
        </StatRow>

        <div className="flex flex-wrap gap-1">
          {result.terms.length === 0
            ? <span className="text-[12px] text-faint">nothing within {maxEdits} edit(s)</span>
            : result.terms.map((t) => (
              <Badge key={t} tone="accent">{t} <span className="opacity-60">·{result.distances.get(t)}</span></Badge>
            ))}
        </div>

        <Callout tone="warn" title="This does not scale, and that is the point">
          {result.comparisons} comparisons for a vocabulary of {dictionary.size} terms. A real index has
          millions. Chapter 14 changes the question being asked so the vocabulary stops being the unit of work.
        </Callout>
      </Stack>
    </Panel>
  );
}

// ===========================================================================
// Chapter 14 — Levenshtein automata
// ===========================================================================

export function Ch14() {
  const dictionary = demoDictionary("title");
  const [query, setQuery] = useState("kube");
  const [maxEdits, setMaxEdits] = useState(1);
  const [transpositions, setTranspositions] = useState(false);
  const [candidate, setCandidate] = useState("kubelet");

  const automaton = useMemo(
    () => buildLevenshteinAutomaton(query.toLowerCase(), maxEdits, { transpositions }),
    [query, maxEdits, transpositions],
  );

  const trail = useMemo(() => automaton.trace(candidate.toLowerCase()), [automaton, candidate]);
  const [step, setStep] = useSteps(trail.length + 1);

  const accepted = automaton.accepts(candidate.toLowerCase());
  const currentState = step === 0 ? automaton.start : (trail[step - 1]?.to ?? -1);

  const comparison = useMemo(() => {
    const brute = bruteForceFuzzy(query.toLowerCase(), dictionary.sortedTerms, maxEdits, { transpositions });
    const scanned = scanWithAutomaton(automaton, dictionary.sortedTerms);
    const agree = [...brute.terms].sort().join("|") === [...scanned.terms].sort().join("|");
    return { brute, scanned, agree };
  }, [automaton, dictionary, query, maxEdits, transpositions]);

  return (
    <Stack gap={4}>
      <Panel
        title="Build a recognizer, not a comparator"
        subtitle="Instead of asking the distance between two known strings, build an automaton that accepts every string within N edits — then run the dictionary through it."
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextInput label="Query" value={query} onChange={(v) => setQuery(v.slice(0, 12))} />
            <Slider label="max edits" value={maxEdits} min={0} max={2} onChange={setMaxEdits} />
            <div className="flex items-end pb-1">
              <Toggle label="transpositions" checked={transpositions} onChange={setTranspositions} />
            </div>
          </div>

          <StatRow>
            <Stat label="DFA states" value={automaton.size} tone="accent" />
            <Stat label="alphabet symbols" value={automaton.alphabet.length} hint="Query characters, plus one sentinel for everything else" />
            <Stat label="transitions" value={automaton.states.reduce((s, st) => s + st.transitions.size, 0)} />
            <Stat label="accepting states" value={automaton.states.filter((s) => s.accepting).length} tone="ok" />
          </StatRow>

          <Callout tone="info" title="Why the alphabet is so small">
            Every character that does not appear in the query behaves identically — it can only be a
            substitution or an insertion. So the automaton needs one transition per query character plus a
            single catch-all, no matter how large the real alphabet is.
          </Callout>
        </Stack>
      </Panel>

      <Panel
        title="Feed it a term, one character at a time"
        subtitle="A state is a set of (position in query, edits used) pairs. When the set empties, the term is dead and the walk stops."
        tone="sunken"
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Candidate term" value={candidate} onChange={setCandidate} />
            <div>
              <div className="mb-1 text-[11.5px] font-medium text-muted">Try a vocabulary term</div>
              <div className="flex flex-wrap gap-1">
                {["kubelet", "kube", "kubernetes", "kafka", "docker", "cube"].map((t) => (
                  <Button key={t} size="sm" onClick={() => setCandidate(t)}>{t}</Button>
                ))}
              </div>
            </div>
          </div>

          <StepPlayer total={trail.length + 1} index={step} onChange={setStep} label="char" />

          <div className="flex flex-wrap items-center gap-1.5">
            {[...candidate.toLowerCase()].map((ch, i) => (
              <TokenChip
                key={i}
                text={ch}
                tone={
                  i < step ? (trail[i]?.to === -1 ? "removed" : "ok")
                    : i === step ? "accent" : "default"
                }
                subtitle={i < step ? (trail[i]?.to === -1 ? "dead" : `s${trail[i]?.to}`) : undefined}
              />
            ))}
            {candidate === "" && <span className="text-[12px] text-faint">empty string</span>}
          </div>

          <div className="rounded-lg border border-edge bg-raised p-3">
            <div className="mb-1 text-[11px] uppercase tracking-wider text-faint">
              Current state {currentState === -1 ? "— dead" : `s${currentState}`}
            </div>
            {currentState === -1 ? (
              <p className="text-[12.5px] text-bad">
                No live (position, edits) pair remains. Every continuation of this prefix is rejected — which
                is exactly what makes the trie intersection in chapter 15 so cheap.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {automaton.states[currentState].nfa.map((s, i) => (
                    <Badge key={i} tone={s.kind === "t" ? "warn" : "neutral"}>
                      {s.kind === "t" ? "T" : ""}pos {s.i}, edits {s.e}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 text-[12px] text-muted">
                  {automaton.states[currentState].accepting
                    ? "This state is accepting: if the term ended here, it would be within the edit budget."
                    : "Not accepting yet — the rest of the query cannot be covered by the remaining budget."}
                </p>
              </>
            )}
          </div>

          <Callout tone={accepted ? "ok" : "bad"}>
            <Mono>{candidate}</Mono> is {accepted ? "accepted" : "rejected"}: the true edit distance is{" "}
            {levenshteinTable(query.toLowerCase(), candidate.toLowerCase(), transpositions).distance}, and the
            budget is {maxEdits}.
          </Callout>
        </Stack>
      </Panel>

      <Panel title="The whole transition table" subtitle="Small enough to read, which is the point of keeping the alphabet tiny.">
        <div className="max-h-[300px] overflow-y-auto">
          <Table head={["state", "(pos, edits)", "accepting", ...automaton.alphabet.map((a) => (a === ANY_OTHER ? "other" : a))]} dense>
            {automaton.states.map((state) => (
              <Tr key={state.id} highlight={state.id === currentState}>
                <Td mono>s{state.id}</Td>
                <Td mono tone="muted">{state.label}</Td>
                <Td align="center" tone={state.accepting ? "ok" : "muted"}>{state.accepting ? "yes" : "—"}</Td>
                {automaton.alphabet.map((symbol) => {
                  const dest = state.transitions.get(symbol);
                  return (
                    <Td key={symbol} mono align="center" tone={dest === undefined ? "muted" : "accent"}>
                      {dest === undefined ? "×" : `s${dest}`}
                    </Td>
                  );
                })}
              </Tr>
            ))}
          </Table>
        </div>
      </Panel>

      <Panel
        title="Does it agree with the oracle?"
        subtitle="Chapter 42's rule, applied here: the automaton must accept exactly the terms brute force accepts."
      >
        <Stack gap={3}>
          <StatRow>
            <Stat label="brute force accepted" value={comparison.brute.terms.length} />
            <Stat label="automaton accepted" value={comparison.scanned.terms.length} />
            <Stat label="terms abandoned early" value={comparison.scanned.earlyExits} tone="ok" hint="Died on a dead state before the last character" />
            <Stat label="agree" value={comparison.agree ? "yes" : "NO"} tone={comparison.agree ? "ok" : "bad"} />
          </StatRow>
          {comparison.agree ? (
            <Callout tone="ok" title="Identical results">
              Both methods accepted the same {comparison.brute.terms.length} term(s). The automaton did it
              without building a single distance table.
            </Callout>
          ) : (
            <Callout tone="bad" title="Mismatch">
              brute force: {comparison.brute.terms.join(", ")} — automaton: {comparison.scanned.terms.join(", ")}
            </Callout>
          )}
          <Callout tone="warn" title="Still linear in the vocabulary">
            Running every term through the automaton is faster per term, but it is still every term. Chapters
            16 to 19 fix that by giving the automaton a structure to walk instead of a list.
          </Callout>
        </Stack>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 15 — candidate terms and expansion
// ===========================================================================

export function Ch15() {
  const index = demoIndex();
  const context = demoContext();
  const dictionary = demoDictionary("title");

  const [query, setQuery] = useState("kubernets");
  const [maxEdits, setMaxEdits] = useState(1);
  const [prefixLength, setPrefixLength] = useState(0);
  const [maxExpansions, setMaxExpansions] = useState(50);

  const expansion = useMemo(
    () => dictionary.fuzzy(query.toLowerCase(), { maxEdits, prefixLength, maxExpansions }),
    [dictionary, query, maxEdits, prefixLength, maxExpansions],
  );

  const brute = useMemo(
    () => bruteForceFuzzy(query.toLowerCase(), dictionary.sortedTerms, maxEdits, { prefixLength }),
    [dictionary, query, maxEdits, prefixLength],
  );

  const result = useMemo(
    () => search(context, {
      kind: "fuzzy", field: "title", value: query.toLowerCase(),
      maxEdits, prefixLength, maxExpansions,
    }, { topK: 10 }),
    [context, query, maxEdits, prefixLength, maxExpansions],
  );

  const auto = autoFuzziness(query);

  return (
    <Stack gap={4}>
      <Panel
        title="From query to candidate terms to documents"
        subtitle="The automaton recognizes candidate strings. The dictionary supplies the terms that actually exist. Postings turn those into documents."
      >
        <Stack gap={4}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <TextInput label="Fuzzy query" value={query} onChange={setQuery} />
            <Slider label="max edits" value={maxEdits} min={0} max={2} onChange={setMaxEdits}
              format={(v) => `${v}${v === auto ? " (AUTO)" : ""}`} />
            <Slider label="prefix_length" value={prefixLength} min={0} max={Math.min(6, query.length)} onChange={setPrefixLength}
              hint="Characters that must match exactly, removing most of the search space" />
            <Slider label="max_expansions" value={maxExpansions} min={1} max={100} onChange={setMaxExpansions} />
          </div>

          <div className="space-y-1">
            {[
              { label: `${query}~${maxEdits}`, note: "the query" },
              { label: "Build fuzzy automaton", note: `${expansion.automatonStates} states` },
              { label: "Traverse term dictionary", note: `${expansion.work} trie nodes visited, ${expansion.subtreesPruned} subtrees pruned` },
              { label: "Accepted expansion", note: `${expansion.terms.length} term(s)` },
              { label: "Postings", note: `${result.totalCandidates} candidate document(s)` },
              { label: "Score and rank", note: `${result.hits.length} returned` },
            ].map((row, i, arr) => (
              <div key={i}>
                <div className="flex flex-wrap items-baseline gap-2 rounded-lg border border-edge bg-raised px-3 py-2">
                  <span className="font-mono text-[12.5px] font-medium text-ink">{row.label}</span>
                  <span className="text-[11.5px] text-faint">{row.note}</span>
                </div>
                {i < arr.length - 1 && <div className="py-0.5 text-center font-mono text-[10px] text-faint">↓</div>}
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-edge bg-sunken p-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-faint">Accepted terms</span>
              {expansion.clipped && (
                <Badge tone="bad">clipped: {expansion.totalBeforeClip} matched, {expansion.terms.length} kept</Badge>
              )}
              {prefixLength > 0 && (
                <Badge tone="info">&ldquo;{query.slice(0, prefixLength)}&rdquo; held fixed</Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {expansion.terms.length === 0
                ? <span className="text-[12px] text-faint">nothing accepted</span>
                : expansion.terms.map((t) => (
                  <Badge key={t} tone="accent">
                    {t} <span className="opacity-60">·{brute.distances.get(t) ?? "?"}</span>
                  </Badge>
                ))}
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-faint">{expansion.method}</p>
          </div>
        </Stack>
      </Panel>

      <Grid cols={2}>
        <Panel title="What prefix_length buys" subtitle="Holding the first characters fixed removes whole regions of the dictionary before the automaton runs.">
          <Table head={["prefix_length", "terms accepted", "trie nodes visited"]} dense>
            {Array.from({ length: Math.min(5, query.length + 1) }, (_, p) => {
              const e = dictionary.fuzzy(query.toLowerCase(), { maxEdits, prefixLength: p, maxExpansions: 1000 });
              return (
                <Tr key={p} highlight={p === prefixLength}>
                  <Td mono>{p}</Td>
                  <Td mono align="right">{e.totalBeforeClip}</Td>
                  <Td>
                    <Bar value={e.work} max={dictionary.size} tone={p === prefixLength ? "accent" : "muted"} label={String(e.work)} width={90} />
                  </Td>
                </Tr>
              );
            })}
          </Table>
          <Callout tone="warn" title="It is a trade, not a free win">
            A fixed prefix cannot correct a typo inside it. <Mono>kbuernetes</Mono> with prefix_length 3 will
            never reach <Mono>kubernetes</Mono>, because the error is in the frozen part.
          </Callout>
        </Panel>

        <Panel title="What max_expansions prevents" subtitle="Each accepted term becomes a clause. Without a cap, one query becomes thousands.">
          <Stack gap={3}>
            <StatRow>
              <Stat label="terms matched" value={expansion.totalBeforeClip} />
              <Stat label="clauses built" value={expansion.terms.length} tone={expansion.clipped ? "warn" : "default"} />
              <Stat label="postings read" value={result.stats.postingsRead} />
              <Stat label="documents scored" value={result.stats.docsScored} />
            </StatRow>
            <pre className="rounded-lg border border-edge bg-code p-3 font-mono text-[11.5px] leading-relaxed text-muted">
{`fuzzy query
   ↓
${expansion.totalBeforeClip} matching terms
   ↓
boolean expansion
   ↓
${expansion.clipped ? `capped at ${maxExpansions}` : "affordable"}`}
            </pre>
          </Stack>
        </Panel>
      </Grid>

      <Panel title="Documents this reached" subtitle="Including the deliberately misspelled one, which exact search can never find.">
        {result.hits.length === 0 ? (
          <EmptyState>No documents matched.</EmptyState>
        ) : (
          <Table head={["score", "document", "matched terms"]}>
            {result.hits.map((hit) => (
              <Tr key={hit.docId}>
                <Td mono tone="accent">{formatNumber(hit.score, 3)}</Td>
                <Td>{index.source(hit.docId)?.title}</Td>
                <Td mono tone="muted">{hit.matchedTerms?.join(", ")}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>
    </Stack>
  );
}
