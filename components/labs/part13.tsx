"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CHAPTERS, PRODUCTION_CHECKLIST, ROADMAP, SEEKER_TO_LUCENE } from "@/lib/chapters";
import { runAllSuites, type TestRunResult } from "@/lib/seeker/testsuite";
import { demoContext, demoIndex } from "@/lib/demo";
import { parseQueryString } from "@/lib/seeker/parser";
import { search } from "@/lib/seeker/query";
import {
  Badge,
  Bar,
  Button,
  Callout,
  EmptyState,
  Grid,
  Panel,
  Stack,
  Stat,
  StatRow,
  Table,
  Td,
  TextInput,
  Toggle,
  Tr,
  formatNumber,
} from "@/components/ui";

function chapterHref(number: number): string {
  return `/ch/${CHAPTERS.find((c) => c.number === number)?.slug ?? ""}`;
}

// ===========================================================================
// Chapter 41 — implementation roadmap
// ===========================================================================

export function Ch41() {
  const [done, setDone] = useState<Set<number>>(new Set());

  const toggle = (stage: number) => {
    setDone((d) => {
      const next = new Set(d);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };

  return (
    <Stack gap={4}>
      <Panel
        title="Build the simple version, discover the bottleneck, replace one component"
        subtitle="Each stage is a working engine. The point of the intermediate structure is the problem it makes you feel."
      >
        <Stack gap={4}>
          <div className="flex items-center gap-3">
            <Bar value={done.size} max={ROADMAP.length} tone="accent" width={220}
              label={`${done.size} / ${ROADMAP.length}`} />
            <Button size="sm" onClick={() => setDone(new Set())}>reset</Button>
          </div>

          <div className="space-y-1.5">
            {ROADMAP.map((row) => {
              const complete = done.has(row.stage);
              return (
                <div
                  key={row.stage}
                  className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                    complete ? "border-transparent bg-ok-soft" : "border-edge bg-raised"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(row.stage)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border font-mono text-[11px] ${
                      complete ? "border-transparent bg-[var(--ok)] text-[var(--bg-raised)]" : "border-edge-strong text-faint"
                    }`}
                    aria-label={complete ? "mark incomplete" : "mark complete"}
                  >
                    {complete ? "✓" : row.stage}
                  </button>
                  <span className="min-w-[180px] flex-1 font-mono text-[12.5px] text-ink">{row.build}</span>
                  <span className="text-[11px] text-faint">replace later with</span>
                  <span className="min-w-[180px] flex-1 font-mono text-[12.5px] text-accent-text">{row.replaceWith}</span>
                  <Link
                    href={chapterHref(row.chapter)}
                    className="shrink-0 rounded border border-edge px-1.5 py-0.5 text-[11px] text-muted hover:text-ink"
                  >
                    ch {row.chapter}
                  </Link>
                </div>
              );
            })}
          </div>

          <Callout tone="accent" title="The important rule">
            Do not skip an intermediate structure merely because you already know the name of the final one.
            The trie is not a detour on the way to the FST — it is the thing that makes you notice suffixes are
            duplicated, which is the only reason the FST is worth building.
          </Callout>
        </Stack>
      </Panel>

      <Panel title="Production checklist" subtitle="Appendix E. Each item links to the chapter that explains why it is on the list." tone="sunken">
        <div className="grid gap-1.5 md:grid-cols-2">
          {PRODUCTION_CHECKLIST.map((item) => (
            <Link
              key={item.item}
              href={chapterHref(item.chapter)}
              className="flex items-baseline gap-2 rounded-lg border border-edge bg-raised px-3 py-1.5 transition-colors hover:border-edge-strong"
            >
              <span className="text-[12px] text-faint">☐</span>
              <span className="flex-1 text-[12.5px] text-muted">{item.item}</span>
              <span className="font-mono text-[10.5px] text-faint">ch {item.chapter}</span>
            </Link>
          ))}
        </div>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 42 — testing strategy
// ===========================================================================

export function Ch42() {
  const [result, setResult] = useState<TestRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [showPassing, setShowPassing] = useState(false);

  const run = () => {
    setRunning(true);
    // Let the browser paint the "running" state before the synchronous work.
    setTimeout(() => {
      setResult(runAllSuites());
      setRunning(false);
    }, 16);
  };

  return (
    <Stack gap={4}>
      <Panel
        title="A golden corpus and a slow oracle"
        subtitle="These are not recorded results. Press run and both implementations execute, right here, and get compared."
        actions={
          <div className="flex items-center gap-2">
            <Toggle label="show passing checks" checked={showPassing} onChange={setShowPassing} />
            <Button tone="primary" onClick={run} disabled={running}>
              {running ? "running…" : result ? "run again" : "run the suite"}
            </Button>
          </div>
        }
      >
        <Stack gap={4}>
          <Grid cols={2}>
            <div className="rounded-lg border border-edge bg-raised p-3">
              <div className="mb-2 text-[12.5px] font-semibold text-ink">Golden corpus</div>
              <pre className="rounded bg-code p-2 font-mono text-[11.5px] leading-relaxed text-muted">
{`D1 = "kubernetes deployment"
D2 = "docker deployment"
D3 = "kubernetes service"

kubernetes             → D1, D3
deployment             → D1, D2
kubernetes AND service → D3
"kubernetes deployment"→ D1`}
              </pre>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                Small enough to verify by eye. That is the requirement — a golden corpus you cannot check by
                hand is just another implementation.
              </p>
            </div>
            <div className="rounded-lg border border-edge bg-raised p-3">
              <div className="mb-2 text-[12.5px] font-semibold text-ink">Differential testing</div>
              <pre className="rounded bg-code p-2 font-mono text-[11.5px] leading-relaxed text-muted">
{`same query
    ├─→ reference engine  → expected
    └─→ optimised engine  → actual

           equal?
        yes → correct
        no  → investigate`}
              </pre>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                The reference is allowed to be slow. It is allowed to be embarrassing. It is not allowed to be
                deleted, because it is the only thing that can tell you the fast path is still right.
              </p>
            </div>
          </Grid>

          {!result && !running && (
            <EmptyState>Nothing has run yet. Press <strong>run the suite</strong>.</EmptyState>
          )}

          {running && (
            <div className="pulse rounded-lg border border-edge bg-raised p-6 text-center font-mono text-[12.5px] text-faint">
              building indexes, running both implementations…
            </div>
          )}

          {result && (
            <>
              <StatRow>
                <Stat label="checks" value={result.totalChecks} />
                <Stat label="passed" value={result.totalChecks - result.totalFailed} tone="ok" />
                <Stat label="failed" value={result.totalFailed} tone={result.totalFailed > 0 ? "bad" : "default"} />
                <Stat label="took" value={formatNumber(result.durationMs, 0)} unit="ms" />
              </StatRow>

              <Callout tone={result.totalFailed === 0 ? "ok" : "bad"}
                title={result.totalFailed === 0 ? "Every optimisation agrees with its oracle" : `${result.totalFailed} check(s) failed`}>
                {result.totalFailed === 0
                  ? "The automaton matches brute force, the FST matches the sorted array, the compressed postings decode to the originals, BKD matches a full scan, WAND matches exhaustive scoring, and sharding does not change which documents match."
                  : "A fast path disagrees with its reference implementation. That is exactly what this suite exists to catch."}
              </Callout>

              <div className="space-y-3">
                {result.suites.map((suite) => (
                  <div key={suite.name} className="rounded-lg border border-edge bg-raised">
                    <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
                      <Badge tone={suite.failed === 0 ? "ok" : "bad"}>
                        {suite.failed === 0 ? "pass" : `${suite.failed} failed`}
                      </Badge>
                      <span className="text-[13px] font-semibold text-ink">{suite.name}</span>
                      <span className="text-[11.5px] text-faint">
                        {suite.passed}/{suite.checks.length} · {formatNumber(suite.durationMs, 1)} ms
                      </span>
                    </div>
                    <div className="px-3 py-2">
                      <p className="text-[12px] leading-relaxed text-muted">{suite.description}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px]">
                        <Badge tone="neutral">oracle: {suite.oracle}</Badge>
                        <span className="text-faint">vs</span>
                        <Badge tone="accent">{suite.optimised}</Badge>
                      </div>

                      <div className="mt-2 space-y-0.5">
                        {suite.checks
                          .filter((c) => showPassing || !c.passed)
                          .map((c, i) => (
                            <div key={i} className="flex items-baseline gap-2 text-[11.5px]">
                              <span className={c.passed ? "text-ok" : "text-bad"}>{c.passed ? "✓" : "✗"}</span>
                              <span className="text-muted">{c.name}</span>
                              {!c.passed && (
                                <span className="font-mono text-[11px] text-bad">
                                  expected {c.expected} · got {c.actual}
                                </span>
                              )}
                              {c.note && <span className="text-[11px] text-faint">{c.note}</span>}
                            </div>
                          ))}
                        {!showPassing && suite.failed === 0 && (
                          <div className="text-[11.5px] text-faint">
                            all {suite.checks.length} checks passed
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Stack>
      </Panel>

      <Panel title="What differential testing is especially good at" tone="sunken">
        <Table head={["area", "reference", "optimised"]}>
          {[
            ["fuzzy search", "brute-force edit distance over every term", "Levenshtein automaton + trie/FST"],
            ["postings compression", "the in-memory objects", "gap + vint + bit-packed bytes"],
            ["term dictionary", "a sorted array", "trie → minimized automaton → FST"],
            ["range queries", "check every value", "binary search / BKD"],
            ["top-K", "score every candidate", "WAND with upper-bound pruning"],
            ["distribution", "one index", "shards, replicas and a global merge"],
          ].map(([area, ref, opt]) => (
            <Tr key={area}>
              <Td mono>{area}</Td>
              <Td tone="muted">{ref}</Td>
              <Td tone="accent">{opt}</Td>
            </Tr>
          ))}
        </Table>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 43 — from Seeker to OpenSearch
// ===========================================================================

const ARCHITECTURE: { id: string; label: string; lucene: string; chapter: number; note: string }[] = [
  { id: "document", label: "DOCUMENT", lucene: "Document", chapter: 2, note: "Named fields, each with a type that decides its structure." },
  { id: "analyzer", label: "ANALYZER", lucene: "Analyzer / analysis chain", chapter: 3, note: "Character filters, tokenizer, token filters." },
  { id: "terms", label: "TERMS", lucene: "Terms", chapter: 3, note: "The searchable values. A token is intermediate; a term is indexed." },
  { id: "textindex", label: "TEXT INDEX", lucene: "PostingsFormat", chapter: 4, note: "term → documents, with frequencies and positions." },
  { id: "fst", label: "FST / BlockTree", lucene: "FST + BlockTreeTermsReader", chapter: 19, note: "A compact index navigates to a block; the block stores the terms." },
  { id: "postings", label: "POSTINGS", lucene: "PostingsEnum", chapter: 5, note: "Document ids, gap encoded, with skip structures." },
  { id: "pointindex", label: "POINT INDEX", lucene: "PointValues", chapter: 20, note: "Numbers and dates are points, not terms." },
  { id: "bkd", label: "BKD", lucene: "BKDReader / BKDWriter", chapter: 22, note: "Block KD-tree over byte-encoded points." },
  { id: "query", label: "QUERY ENGINE", lucene: "Query → Weight → Scorer", chapter: 6, note: "An execution tree of iterators, never a materialised set." },
  { id: "filter", label: "FILTER", lucene: "BooleanClause.Occur.FILTER", chapter: 11, note: "Required, unscored, cacheable." },
  { id: "score", label: "BM25 / SCORING", lucene: "BM25Similarity", chapter: 8, note: "Frequency, rarity, length." },
  { id: "topk", label: "TOP K", lucene: "TopDocsCollector", chapter: 27, note: "A bounded heap, plus upper-bound pruning." },
  { id: "fetch", label: "FETCH", lucene: "StoredFields", chapter: 33, note: "Only the winners get their bodies read." },
  { id: "merge", label: "SHARD MERGE", lucene: "coordinating node", chapter: 33, note: "Per-shard top-K merged into a global top-K." },
  { id: "response", label: "FINAL RESPONSE", lucene: "SearchResponse", chapter: 33, note: "What the client actually receives." },
];

export function Ch43() {
  const index = demoIndex();
  const context = demoContext();
  const [queryText, setQueryText] = useState("kubernetes deployment");
  const [selected, setSelected] = useState("query");

  const result = useMemo(() => {
    const parsed = parseQueryString(queryText);
    return search(context, parsed.query, { topK: 5 });
  }, [queryText, context]);

  const stage = ARCHITECTURE.find((s) => s.id === selected)!;

  return (
    <Stack gap={4}>
      <Panel
        title="The complete architecture"
        subtitle="Click any stage for the Lucene name and the chapter that built it. The numbers are from your query, run just now."
      >
        <Stack gap={4}>
          <TextInput label="Query" value={queryText} onChange={setQueryText} />

          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <div className="space-y-1">
              {ARCHITECTURE.map((node, i) => (
                <div key={node.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(node.id)}
                    className={`w-full rounded-lg border px-3 py-1.5 text-left transition-colors ${
                      selected === node.id
                        ? "border-transparent bg-accent-soft text-accent-text"
                        : "border-edge bg-raised text-muted hover:border-edge-strong hover:text-ink"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[12px] font-medium">{node.label}</span>
                      <span className="text-[10.5px] text-faint">ch {node.chapter}</span>
                    </div>
                  </button>
                  {i < ARCHITECTURE.length - 1 && (
                    <div className="py-[1px] text-center font-mono text-[9px] text-faint">↓</div>
                  )}
                </div>
              ))}
            </div>

            <Stack gap={3}>
              <div className="rounded-lg border border-edge bg-raised p-3">
                <div className="text-[13px] font-semibold text-ink">{stage.label}</div>
                <div className="mt-1 font-mono text-[12px] text-accent-text">{stage.lucene}</div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{stage.note}</p>
                <Link
                  href={chapterHref(stage.chapter)}
                  className="mt-2 inline-block text-[12px] text-accent-text underline underline-offset-2"
                >
                  Chapter {stage.chapter} →
                </Link>
              </div>

              <StatRow>
                <Stat label="terms resolved" value={result.resolvedTerms.length} />
                <Stat label="candidates" value={result.totalCandidates} />
                <Stat label="documents scored" value={result.stats.docsScored} />
                <Stat label="returned" value={result.hits.length} />
              </StatRow>

              <Table head={["#", "score", "document"]} dense>
                {result.hits.map((hit, i) => (
                  <Tr key={hit.docId}>
                    <Td mono tone="muted">{i + 1}</Td>
                    <Td mono tone="accent">{formatNumber(hit.score, 3)}</Td>
                    <Td>{index.source(hit.docId)?.title}</Td>
                  </Tr>
                ))}
              </Table>
            </Stack>
          </div>
        </Stack>
      </Panel>

      <Panel title="The mental mapping" subtitle="Every structure in this book has a name in Lucene. That mapping is the point of the whole exercise." tone="sunken">
        <Table head={["Seeker", "Lucene / OpenSearch", ""]}>
          {SEEKER_TO_LUCENE.map((row) => (
            <Tr key={row.seeker}>
              <Td mono>{row.seeker}</Td>
              <Td mono tone="accent">{row.lucene}</Td>
              <Td align="right">
                <Link href={chapterHref(row.chapter)} className="text-[11.5px] text-muted underline underline-offset-2 hover:text-ink">
                  ch {row.chapter}
                </Link>
              </Td>
            </Tr>
          ))}
        </Table>
      </Panel>

      <Panel title="The Seeker Principle">
        <Stack gap={3}>
          <Callout tone="accent">
            When a search engine feels magical, find the question it is answering and identify the data
            structure responsible for that question.
          </Callout>
          <pre className="rounded-lg border border-edge bg-code p-3 font-mono text-[12px] leading-relaxed text-muted">
{`Terms          lead to  dictionaries
Documents      lead to  postings
Numeric values lead to  point indexes
Relevance      leads to scoring
Durability     leads to segments and files
Distribution   leads to shards and replicas

Build the simple version first.
Then make it fast.`}
          </pre>
          <div className="flex flex-wrap gap-2">
            <a
              href="https://lucene.apache.org/"
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-lg border border-edge bg-raised px-3 py-1.5 text-[12.5px] text-muted hover:text-ink"
            >
              Apache Lucene ↗
            </a>
            <a
              href="https://docs.opensearch.org/"
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-lg border border-edge bg-raised px-3 py-1.5 text-[12.5px] text-muted hover:text-ink"
            >
              OpenSearch documentation ↗
            </a>
          </div>
        </Stack>
      </Panel>
    </Stack>
  );
}
