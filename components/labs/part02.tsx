"use client";

import { useMemo, useState } from "react";
import { analyzeToTerms, DEFAULT_ANALYZER } from "@/lib/seeker/analyzer";
import { CORPUS } from "@/lib/seeker/corpus";
import { naiveScan } from "@/lib/seeker/inverted-index";
import { intersectWithSkipping, intersectWithTrace } from "@/lib/seeker/planner";
import { demoIndex, demoContext } from "@/lib/demo";
import { collectAll, search, type PlanNode } from "@/lib/seeker/query";
import { parseQueryString } from "@/lib/seeker/parser";
import { analyzeGaps } from "@/lib/seeker/codec";
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Grid,
  KeyValue,
  Mono,
  Panel,
  Segmented,
  Slider,
  Stack,
  Stat,
  StatRow,
  StepPlayer,
  Table,
  Td,
  TextInput,
  TokenChip,
  Tr,
  formatNumber,
  useSteps,
} from "@/components/ui";

// ===========================================================================
// Chapter 4 — the inverted index
// ===========================================================================

export function Ch04() {
  const [docCount, setDocCount] = useState(3);
  const [field, setField] = useState<"title" | "body">("title");
  const [queryTerm, setQueryTerm] = useState("kubernetes");

  // Build the chapter-4 index — term -> set(docID) — from scratch, live.
  const built = useMemo(() => {
    const map = new Map<string, string[]>();
    const order: { docKey: string; terms: string[] }[] = [];
    for (const doc of CORPUS.slice(0, docCount)) {
      const text = field === "title" ? doc.title : doc.body;
      const terms = analyzeToTerms(text, DEFAULT_ANALYZER);
      order.push({ docKey: doc.id, terms });
      for (const term of terms) {
        const list = map.get(term);
        if (list) {
          if (!list.includes(doc.id)) list.push(doc.id);
        } else {
          map.set(term, [doc.id]);
        }
      }
    }
    return { map, order };
  }, [docCount, field]);

  const sortedTerms = useMemo(() => [...built.map.keys()].sort(), [built]);
  const lookup = built.map.get(queryTerm.toLowerCase().trim()) ?? null;

  const race = useMemo(() => {
    const term = queryTerm.toLowerCase().trim();
    const scan = naiveScan(CORPUS.slice(0, docCount), field, DEFAULT_ANALYZER, term);
    const postings = built.map.get(term) ?? [];
    return { scan, postings, indexWork: 1 };
  }, [queryTerm, docCount, field, built]);

  return (
    <Stack gap={4}>
      <Panel
        title="Build the index one document at a time"
        subtitle="This is the chapter-4 index, exactly as written: term → set(docID). Nothing more."
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Slider
              label="Documents indexed"
              value={docCount}
              min={1}
              max={CORPUS.length}
              onChange={setDocCount}
              format={(v) => `${v} of ${CORPUS.length}`}
            />
            <Segmented
              label="Field"
              value={field}
              onChange={setField}
              options={[{ value: "title", label: "title" }, { value: "body", label: "body" }]}
            />
          </div>

          <div className="space-y-1.5">
            {built.order.map((entry) => (
              <div key={entry.docKey} className="flex flex-wrap items-baseline gap-2">
                <Badge tone="info">{entry.docKey}</Badge>
                {entry.terms.slice(0, 14).map((term, i) => (
                  <TokenChip key={i} text={term} tone={term === queryTerm.toLowerCase() ? "accent" : "default"} />
                ))}
                {entry.terms.length > 14 && (
                  <span className="text-[11px] text-faint">+{entry.terms.length - 14} more</span>
                )}
              </div>
            ))}
          </div>

          <StatRow>
            <Stat label="documents" value={docCount} />
            <Stat label="distinct terms" value={sortedTerms.length} />
            <Stat
              label="postings entries"
              value={[...built.map.values()].reduce((s, l) => s + l.length, 0)}
            />
            <Stat
              label="terms per document"
              value={formatNumber(
                built.order.reduce((s, o) => s + o.terms.length, 0) / Math.max(1, docCount), 1,
              )}
            />
          </StatRow>
        </Stack>
      </Panel>

      <Panel title="The index" subtitle="Sorted terms, each pointing at the documents that contain it." tone="sunken">
        <div className="max-h-[320px] overflow-y-auto">
          <Table head={["term", "→", "documents", "df"]} dense>
            {sortedTerms.map((term) => {
              const docs = built.map.get(term)!;
              return (
                <Tr key={term} highlight={term === queryTerm.toLowerCase().trim()}>
                  <Td mono>{term}</Td>
                  <Td tone="muted">└──</Td>
                  <Td mono tone="muted">{docs.join(", ")}</Td>
                  <Td mono align="right">{docs.length}</Td>
                </Tr>
              );
            })}
          </Table>
        </div>
      </Panel>

      <Panel
        title="Lookup vs scan"
        subtitle="The same question, answered two ways. The comparison count is the entire argument for the inverted index."
      >
        <Stack gap={4}>
          <TextInput label="Search for a term" value={queryTerm} onChange={setQueryTerm} />

          <Grid cols={2}>
            <div className="rounded-lg border border-edge bg-raised p-3">
              <div className="mb-2 flex items-center gap-2">
                <Badge tone="bad">naive</Badge>
                <span className="text-[12px] font-medium text-ink">Scan every document</span>
              </div>
              <pre className="mb-2 rounded bg-code p-2 font-mono text-[11px] text-muted">
{`for every document:
    tokenize
    compare`}
              </pre>
              <KeyValue
                items={[
                  { key: "term comparisons", value: race.scan.comparisons },
                  { key: "documents touched", value: docCount },
                  { key: "result", value: race.scan.matches.join(", ") || "—" },
                ]}
              />
            </div>

            <div className="rounded-lg border border-transparent bg-accent-soft p-3">
              <div className="mb-2 flex items-center gap-2">
                <Badge tone="accent">inverted index</Badge>
                <span className="text-[12px] font-medium text-accent-text">Look the term up</span>
              </div>
              <pre className="mb-2 rounded bg-code p-2 font-mono text-[11px] text-muted">
{`index["${queryTerm.toLowerCase().trim()}"]
        |
        v
     ${lookup ? lookup.join(", ") : "no postings"}`}
              </pre>
              <KeyValue
                items={[
                  { key: "term lookups", value: 1 },
                  { key: "documents touched", value: lookup?.length ?? 0 },
                  { key: "result", value: lookup?.join(", ") ?? "—" },
                ]}
              />
            </div>
          </Grid>

          {race.scan.matches.join(",") === (lookup ?? []).join(",") ? (
            <Callout tone="ok" title="Same answer, different cost">
              Both approaches returned the same documents. The scan needed {race.scan.comparisons} term
              comparisons; the index needed one lookup and then read only the {lookup?.length ?? 0} documents
              that actually matched.
            </Callout>
          ) : (
            <Callout tone="bad" title="Disagreement">
              Scan found <Mono>{race.scan.matches.join(", ") || "nothing"}</Mono>; the index found{" "}
              <Mono>{lookup?.join(", ") || "nothing"}</Mono>.
            </Callout>
          )}
        </Stack>
      </Panel>

      <BooleanOps map={built.map} />
    </Stack>
  );
}

function BooleanOps({ map }: { map: Map<string, string[]> }) {
  const [a, setA] = useState("kubernetes");
  const [b, setB] = useState("love");

  const listA = map.get(a.toLowerCase().trim()) ?? [];
  const listB = map.get(b.toLowerCase().trim()) ?? [];
  const and = listA.filter((d) => listB.includes(d));
  const or = [...new Set([...listA, ...listB])].sort();

  return (
    <Panel title="Boolean operations" subtitle="AND intersects the postings. OR unions them. That is all a boolean query is.">
      <Stack gap={4}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="Term A" value={a} onChange={setA} />
          <TextInput label="Term B" value={b} onChange={setB} />
        </div>

        <Grid cols={3}>
          <div className="rounded-lg border border-edge bg-raised p-3">
            <div className="mb-1.5 font-mono text-[12px] text-muted">{a || "—"}</div>
            <div className="flex flex-wrap gap-1">
              {listA.length ? listA.map((d) => <Badge key={d} tone="info">{d}</Badge>) : <span className="text-[11.5px] text-muted">no postings</span>}
            </div>
          </div>
          <div className="rounded-lg border border-edge bg-raised p-3">
            <div className="mb-1.5 font-mono text-[12px] text-muted">{b || "—"}</div>
            <div className="flex flex-wrap gap-1">
              {listB.length ? listB.map((d) => <Badge key={d} tone="info">{d}</Badge>) : <span className="text-[11.5px] text-muted">no postings</span>}
            </div>
          </div>
          <div className="space-y-2">
            <div className="rounded-lg border border-transparent bg-accent-soft p-2.5">
              <div className="mb-1 font-mono text-[11.5px] text-accent-text">A AND B → intersection</div>
              <div className="flex flex-wrap gap-1">
                {and.length ? and.map((d) => <Badge key={d} tone="accent">{d}</Badge>) : <span className="text-[11.5px] text-muted">empty</span>}
              </div>
            </div>
            <div className="rounded-lg border border-transparent bg-ok-soft p-2.5">
              <div className="mb-1 font-mono text-[11.5px] text-ok">A OR B → union</div>
              <div className="flex flex-wrap gap-1">
                {or.length ? or.map((d) => <Badge key={d} tone="ok">{d}</Badge>) : <span className="text-[11.5px] text-muted">empty</span>}
              </div>
            </div>
          </div>
        </Grid>
      </Stack>
    </Panel>
  );
}

// ===========================================================================
// Chapter 5 — postings and positions
// ===========================================================================

export function Ch05() {
  const index = demoIndex();
  const [field, setField] = useState<"title" | "body">("title");
  const [term, setTerm] = useState("kubernetes");
  const [phrase, setPhrase] = useState("kubernetes deployment");

  const postings = index.postings(field, term.toLowerCase().trim()) ?? [];
  const context = demoContext();

  const phraseAnalysis = useMemo(() => {
    const terms = analyzeToTerms(phrase, DEFAULT_ANALYZER);
    if (terms.length < 2) return null;
    const conjunction = collectAll(context, {
      kind: "bool",
      must: terms.map((t) => ({ kind: "term" as const, field, value: t })),
    });
    const phraseHits = collectAll(context, { kind: "phrase", field, text: phrase });
    return { terms, conjunction, phraseHits };
  }, [phrase, field, context]);

  const gaps = analyzeGaps(postings.map((p) => p.docId), 4);

  return (
    <Stack gap={4}>
      <Panel
        title="What a postings list really carries"
        subtitle="Not just document ids: a frequency, and the positions where the term occurs."
        actions={
          <Segmented
            value={field}
            onChange={setField}
            options={[{ value: "title", label: "title" }, { value: "body", label: "body" }]}
          />
        }
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Term" value={term} onChange={setTerm} />
            <div>
              <div className="mb-1 text-[11.5px] font-medium text-muted">Common terms</div>
              <div className="flex flex-wrap gap-1">
                {index.termStats(field)
                  .sort((a, b) => b.docFreq - a.docFreq)
                  .slice(0, 8)
                  .map((t) => (
                    <Button key={t.term} size="sm" onClick={() => setTerm(t.term)}>
                      {t.term} <span className="text-faint">({t.docFreq})</span>
                    </Button>
                  ))}
              </div>
            </div>
          </div>

          {postings.length === 0 ? (
            <EmptyState>
              <Mono>{field}:{term}</Mono> is not in the dictionary — so there are no postings, and no candidates.
            </EmptyState>
          ) : (
            <>
              <StatRow>
                <Stat label="docFreq" value={postings.length} hint="Documents containing the term" />
                <Stat label="totalTermFreq" value={postings.reduce((s, p) => s + p.freq, 0)} hint="Total occurrences" />
                <Stat label="positions stored" value={postings.reduce((s, p) => s + p.positions.length, 0)} />
                <Stat label="avg freq per doc" value={formatNumber(postings.reduce((s, p) => s + p.freq, 0) / postings.length, 2)} />
              </StatRow>

              <Table head={["docId", "document", "freq", "positions", "field length"]}>
                {postings.map((p) => (
                  <Tr key={p.docId}>
                    <Td mono>{p.docId}</Td>
                    <Td>{index.source(p.docId)?.title}</Td>
                    <Td mono align="right" tone={p.freq > 1 ? "accent" : undefined}>{p.freq}</Td>
                    <Td mono tone="muted">[{p.positions.join(", ")}]</Td>
                    <Td mono align="right" tone="muted">{index.fieldLength(field, p.docId)}</Td>
                  </Tr>
                ))}
              </Table>
            </>
          )}
        </Stack>
      </Panel>

      <Panel
        title="Why positions matter"
        subtitle="Two documents can contain exactly the same terms and still answer a phrase query differently."
        tone="sunken"
      >
        <Stack gap={4}>
          <TextInput label="Phrase" value={phrase} onChange={setPhrase} />

          {!phraseAnalysis ? (
            <EmptyState>Type at least two words to make this a phrase.</EmptyState>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                <span>Analyzed to</span>
                {phraseAnalysis.terms.map((t, i) => (
                  <TokenChip key={i} text={t} position={i} tone="accent" />
                ))}
              </div>

              <Table head={["document", "contains all terms", "positions", "phrase match"]}>
                {phraseAnalysis.conjunction.map((docId) => {
                  const isPhrase = phraseAnalysis.phraseHits.includes(docId);
                  const positionsPerTerm = phraseAnalysis.terms.map((t) => {
                    const p = (index.postings(field, t) ?? []).find((x) => x.docId === docId);
                    return { term: t, positions: p?.positions ?? [] };
                  });
                  return (
                    <Tr key={docId} highlight={isPhrase}>
                      <Td>{index.source(docId)?.title}</Td>
                      <Td align="center" tone="ok">yes</Td>
                      <Td mono tone="muted">
                        {positionsPerTerm.map((p) => `${p.term}@${p.positions.join("/")}`).join("  ")}
                      </Td>
                      <Td align="center" tone={isPhrase ? "ok" : "bad"}>
                        {isPhrase ? "yes — adjacent" : "no — not adjacent"}
                      </Td>
                    </Tr>
                  );
                })}
              </Table>

              <Callout tone="info">
                {phraseAnalysis.conjunction.length} document(s) contain every term.{" "}
                {phraseAnalysis.phraseHits.length} of them have those terms in the right order and next to
                each other. Membership was never enough — the positions decided it.
              </Callout>
            </>
          )}
        </Stack>
      </Panel>

      {postings.length > 1 && (
        <Panel
          title="Postings compression, previewed"
          subtitle="Sorted document ids become gaps. The gaps are much smaller, and small numbers cost fewer bytes."
        >
          <Stack gap={3}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-faint">document ids</div>
                <div className="flex flex-wrap gap-1">
                  {gaps.original.map((id) => <Badge key={id} tone="info">{id}</Badge>)}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-faint">gaps</div>
                <div className="flex flex-wrap gap-1">
                  {gaps.gaps.map((g, i) => <Badge key={i} tone="accent">{g}</Badge>)}
                </div>
              </div>
            </div>
            <StatRow>
              <Stat label="fixed 4-byte" value={gaps.fixedBytes} unit="B" />
              <Stat label="vint over ids" value={gaps.vintRawBytes} unit="B" />
              <Stat label="vint over gaps" value={gaps.vintGapBytes} unit="B" tone="ok" />
              <Stat label="bit-packed blocks" value={gaps.packedBytes} unit="B" tone="accent" />
            </StatRow>
            <p className="text-[12px] text-muted">
              Chapter 25 does this properly. The point here is only that the gaps are smaller than the ids —
              and that this is only possible because the postings are sorted.
            </p>
          </Stack>
        </Panel>
      )}
    </Stack>
  );
}

// ===========================================================================
// Chapter 6 — query execution
// ===========================================================================

export function Ch06() {
  const index = demoIndex();
  const context = demoContext();
  const [mode, setMode] = useState<"book" | "real">("book");
  const [termA, setTermA] = useState("kubernetes");
  const [termB, setTermB] = useState("deployment");
  const [queryText, setQueryText] = useState("kubernetes AND deployment");

  const lists = useMemo(() => {
    if (mode === "book") {
      return { a: [2, 5, 9, 20], b: [1, 5, 7, 9], labelA: "A", labelB: "B" };
    }
    const a = (index.postings("title", termA.toLowerCase().trim()) ?? []).map((p) => p.docId);
    const b = (index.postings("title", termB.toLowerCase().trim()) ?? []).map((p) => p.docId);
    return { a, b, labelA: termA, labelB: termB };
  }, [mode, termA, termB, index]);

  const trace = useMemo(() => intersectWithTrace(lists.a, lists.b), [lists]);
  const skipping = useMemo(() => intersectWithSkipping(lists.a, lists.b), [lists]);
  const [step, setStep] = useSteps(trace.steps.length);
  const current = trace.steps[step];

  const executed = useMemo(() => {
    const parsed = parseQuery(queryText);
    return search(context, parsed, { topK: 5 });
  }, [queryText, context]);

  return (
    <Stack gap={4}>
      <Panel
        title="Sorted postings intersection"
        subtitle="Two pointers, one comparison at a time. Because both lists are sorted, whichever is behind can move forward without missing anything."
        actions={
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "book", label: "book example" },
              { value: "real", label: "real postings" },
            ]}
          />
        }
      >
        <Stack gap={4}>
          {mode === "real" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Term A" value={termA} onChange={setTermA} />
              <TextInput label="Term B" value={termB} onChange={setTermB} />
            </div>
          )}

          <div className="space-y-3">
            {([["a", lists.labelA, lists.a], ["b", lists.labelB, lists.b]] as const).map(([key, label, list]) => (
              <div key={key} className="flex flex-wrap items-center gap-2">
                <span className="w-[92px] shrink-0 truncate font-mono text-[12px] text-muted" title={label}>
                  {label}
                </span>
                <div className="flex flex-wrap gap-1">
                  {list.length === 0 && <span className="text-[11.5px] text-muted">empty</span>}
                  {list.map((value, i) => {
                    const pointer = key === "a" ? current?.i : current?.j;
                    const isCursor = i === pointer;
                    const emitted = trace.steps
                      .slice(0, step + 1)
                      .some((s) => s.action === "emit" && (key === "a" ? s.a : s.b) === value);
                    return (
                      <span
                        key={i}
                        className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 font-mono text-[12px] tabular-nums transition-all ${
                          isCursor
                            ? "border-[var(--accent)] bg-accent-soft text-accent-text ring-2 ring-[var(--accent)]/25"
                            : emitted
                              ? "border-transparent bg-ok-soft text-ok"
                              : "border-edge bg-raised text-muted"
                        }`}
                      >
                        {value}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-2">
              <span className="w-[92px] shrink-0 font-mono text-[12px] text-accent-text">result</span>
              <div className="flex flex-wrap gap-1">
                {trace.steps.slice(0, step + 1).filter((s) => s.action === "emit").map((s, i) => (
                  <Badge key={i} tone="ok">{s.a}</Badge>
                ))}
                {trace.steps.slice(0, step + 1).every((s) => s.action !== "emit") && (
                  <span className="text-[11.5px] text-muted">nothing yet</span>
                )}
              </div>
            </div>
          </div>

          <StepPlayer total={trace.steps.length} index={step} onChange={setStep} label="step" />

          {current && (
            <Callout tone={current.action === "emit" ? "ok" : current.action === "done" ? "info" : "accent"}>
              <span className="font-mono text-[12px]">{current.note}</span>
            </Callout>
          )}

          <StatRow>
            <Stat label="comparisons (stepping)" value={trace.comparisons} />
            <Stat label="comparisons (skipping)" value={skipping.comparisons} tone="ok" />
            <Stat label="advance calls" value={skipping.advances} hint="Each one is a galloping search" />
            <Stat label="matches" value={trace.result.length} tone="accent" />
          </StatRow>

          <Callout tone="info" title="Stepping vs skipping">
            Walking both lists one element at a time costs {trace.comparisons} comparisons. Driving from the
            shorter list and <em>skipping</em> through the longer one costs {skipping.comparisons}. On lists
            of a thousand and ten million, that difference is the entire query.
          </Callout>
        </Stack>
      </Panel>

      <Panel
        title="A query becomes an execution tree"
        subtitle="The same shape the book draws — and it is the actual tree the engine built for this query."
      >
        <Stack gap={4}>
          <div className="flex flex-wrap gap-2">
            {["kubernetes AND deployment", "redis OR kafka", "title:kubernetes AND status:published",
              '"kubernetes deployment"', "(redis OR kafka) AND status:published"].map((q) => (
              <Button key={q} size="sm" onClick={() => setQueryText(q)}>{q}</Button>
            ))}
          </div>
          <TextInput label="Query" value={queryText} onChange={setQueryText} />

          <PlanTree node={executed.plan} />

          <StatRow>
            <Stat label="candidates" value={executed.totalCandidates} />
            <Stat label="postings read" value={executed.stats.postingsRead} />
            <Stat label="advance calls" value={executed.stats.advanceCalls} />
            <Stat label="documents skipped" value={executed.stats.docsSkipped} />
          </StatRow>

          <Callout tone="accent" title="Iterators, not sets">
            None of this materialised a list of matching documents. Each node in the tree exposes only
            <Mono>docId()</Mono>, <Mono>nextDoc()</Mono> and <Mono>advance(target)</Mono>, so an AND of an OR
            of a phrase composes without anyone allocating the intermediate results.
          </Callout>
        </Stack>
      </Panel>
    </Stack>
  );
}

function PlanTree({ node, depth = 0 }: { node: PlanNode; depth?: number }) {
  return (
    <div className={depth > 0 ? "ml-4 border-l border-edge pl-3" : ""}>
      <div className="flex flex-wrap items-center gap-2 py-1">
        <span className="font-mono text-[12px] text-ink">{node.label}</span>
        <Badge tone="neutral" title="Estimated number of matches — what the planner sorts on">
          cost {node.cost}
        </Badge>
        {node.maxScore > 0 && Number.isFinite(node.maxScore) && (
          <Badge tone="info" title="Upper bound on this clause's score contribution">
            max {formatNumber(node.maxScore, 2)}
          </Badge>
        )}
      </div>
      {node.children.map((child, i) => (
        <PlanTree key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function parseQuery(text: string) {
  return parseQueryString(text).query;
}
