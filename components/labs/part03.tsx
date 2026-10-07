"use client";

import { useMemo, useState } from "react";
import {
  bm25, bm25Explanation, idf, idfCurve, LUCENE_DEFAULTS, saturationCurve, type Bm25Params,
} from "@/lib/kaus/bm25";
import { BM25_EXAMPLE_CORPUS, analyzerFor } from "@/lib/kaus/corpus";
import { buildIndex } from "@/lib/kaus/inverted-index";
import { demoContext, demoIndex } from "@/lib/demo";
import { collectAll, makeSearchContext, search } from "@/lib/kaus/query";
import { analyzeToTerms, DEFAULT_ANALYZER } from "@/lib/kaus/analyzer";
import {
  Badge,
  Bar,
  Button,
  Callout,
  EmptyState,
  ExplainTree,
  Grid,
  KeyValue,
  Panel,
  Segmented,
  Slider,
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

// ===========================================================================
// Chapter 7 — ranking
// ===========================================================================

type Signal = "tf" | "idf" | "length" | "bm25";

const SIGNAL_LABELS: Record<Signal, { label: string; question: string; note: string }> = {
  tf: {
    label: "Term frequency only",
    question: "how often?",
    note: "Rewards repetition without limit. The document that says the word twenty times wins, whatever else it says.",
  },
  idf: {
    label: "Rarity only",
    question: "how rare?",
    note: "Every document containing the rare term ties. Rarity separates terms, not documents.",
  },
  length: {
    label: "Shortness only",
    question: "how long?",
    note: "Rewards brevity and nothing else. A two-word document about the wrong subject wins.",
  },
  bm25: {
    label: "BM25 — all three",
    question: "all three at once",
    note: "Frequency that saturates, weighted by rarity, normalised by length. Each signal corrects the others.",
  },
};

export function Ch07() {
  const index = demoIndex();
  const context = demoContext();
  const [queryText, setQueryText] = useState("kubernetes deployment");
  const [signal, setSignal] = useState<Signal>("bm25");

  const ranked = useMemo(() => {
    const terms = analyzeToTerms(queryText, DEFAULT_ANALYZER);
    if (terms.length === 0) return [];
    const candidates = collectAll(context, {
      kind: "bool",
      should: terms.map((t) => ({ kind: "term" as const, field: "title", value: t })),
      minimumShouldMatch: 1,
    });
    const avgdl = index.avgFieldLength("title");

    return candidates.map((docId) => {
      let tfTotal = 0;
      let idfTotal = 0;
      let bm25Total = 0;
      for (const term of terms) {
        const posting = (index.postings("title", term) ?? []).find((p) => p.docId === docId);
        const df = index.docFreq("title", term);
        if (!posting) continue;
        tfTotal += posting.freq;
        idfTotal += idf(index.numDocs, df);
        bm25Total += bm25({
          tf: posting.freq,
          fieldLength: index.fieldLength("title", docId),
          avgFieldLength: avgdl,
          numDocs: index.numDocs,
          docFreq: df,
          params: LUCENE_DEFAULTS,
        }).score;
      }
      const length = index.fieldLength("title", docId);
      return {
        docId,
        title: index.source(docId)!.title,
        tf: tfTotal,
        idfScore: idfTotal,
        length,
        lengthScore: length === 0 ? 0 : 10 / length,
        bm25: bm25Total,
      };
    });
  }, [queryText, index, context]);

  const sorted = useMemo(() => {
    const key = signal === "tf" ? "tf" : signal === "idf" ? "idfScore" : signal === "length" ? "lengthScore" : "bm25";
    return [...ranked].sort((a, b) => (b[key] as number) - (a[key] as number));
  }, [ranked, signal]);

  const info = SIGNAL_LABELS[signal];

  return (
    <Stack gap={4}>
      <Panel
        title="Retrieval decides membership. Ranking decides order."
        subtitle="The same matching documents, ranked by one signal at a time. Watch each single signal fail in its own way."
      >
        <Stack gap={4}>
          <TextInput label="Query" value={queryText} onChange={setQueryText} />
          <Segmented
            label="Rank by"
            value={signal}
            onChange={setSignal}
            options={[
              { value: "tf", label: "frequency" },
              { value: "idf", label: "rarity" },
              { value: "length", label: "shortness" },
              { value: "bm25", label: "BM25" },
            ]}
          />

          <Callout tone={signal === "bm25" ? "ok" : "warn"} title={`${info.label} — "${info.question}"`}>
            {info.note}
          </Callout>

          {sorted.length === 0 ? (
            <EmptyState>Nothing matched, so there is nothing to rank.</EmptyState>
          ) : (
            <Table head={["#", "document", "tf", "rarity", "length", "BM25", "score used"]}>
              {sorted.map((row, i) => {
                const used =
                  signal === "tf" ? row.tf
                    : signal === "idf" ? row.idfScore
                      : signal === "length" ? row.lengthScore : row.bm25;
                const max = Math.max(...sorted.map((r) =>
                  signal === "tf" ? r.tf : signal === "idf" ? r.idfScore : signal === "length" ? r.lengthScore : r.bm25));
                return (
                  <Tr key={row.docId} highlight={i === 0}>
                    <Td mono tone="muted">{i + 1}</Td>
                    <Td>{row.title}</Td>
                    <Td mono align="right" tone={signal === "tf" ? "accent" : "muted"}>{row.tf}</Td>
                    <Td mono align="right" tone={signal === "idf" ? "accent" : "muted"}>{formatNumber(row.idfScore, 2)}</Td>
                    <Td mono align="right" tone={signal === "length" ? "accent" : "muted"}>{row.length}</Td>
                    <Td mono align="right" tone={signal === "bm25" ? "accent" : "muted"}>{formatNumber(row.bm25, 3)}</Td>
                    <Td><Bar value={used} max={max} width={90} tone={signal === "bm25" ? "accent" : "warn"} /></Td>
                  </Tr>
                );
              })}
            </Table>
          )}
        </Stack>
      </Panel>

      <Panel title="The three questions" tone="sunken">
        <Grid cols={3}>
          {[
            { title: "Term frequency", q: "How often does the term appear here?", body: "More occurrences suggest relevance — but ten occurrences are not ten times better than one. BM25 saturates it." },
            { title: "Inverse document frequency", q: "How rare is this term overall?", body: "A term in almost every document tells you almost nothing. A term in three documents is a strong signal." },
            { title: "Field length", q: "How long is the field?", body: "A long document has more chances to contain any term by accident, so frequency is normalised by length." },
          ].map((card) => (
            <div key={card.title} className="rounded-lg border border-edge bg-raised p-3">
              <div className="text-[12.5px] font-semibold text-ink">{card.title}</div>
              <div className="mt-0.5 font-mono text-[11.5px] text-accent-text">{card.q}</div>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">{card.body}</p>
            </div>
          ))}
        </Grid>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 8 — BM25 from first principles
// ===========================================================================

function Curve({
  points, xLabel, yLabel, highlight, width = 320, height = 130,
}: {
  points: { x: number; y: number }[];
  xLabel: string;
  yLabel: string;
  highlight?: number;
  width?: number;
  height?: number;
}) {
  if (points.length === 0) return null;
  const maxX = Math.max(...points.map((p) => p.x), 1);
  const maxY = Math.max(...points.map((p) => p.y), 0.0001);
  const pad = 22;
  const sx = (x: number) => pad + (x / maxX) * (width - pad - 8);
  const sy = (y: number) => height - pad - (y / maxY) * (height - pad - 10);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const highlighted = highlight !== undefined ? points.find((p) => p.x === highlight) : undefined;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label={`${yLabel} against ${xLabel}`}
    >
      <line x1={pad} y1={height - pad} x2={width - 8} y2={height - pad} stroke="var(--border-strong)" strokeWidth="1" />
      <line x1={pad} y1={10} x2={pad} y2={height - pad} stroke="var(--border-strong)" strokeWidth="1" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      {highlighted && (
        <>
          <line
            x1={sx(highlighted.x)} y1={height - pad} x2={sx(highlighted.x)} y2={sy(highlighted.y)}
            stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6"
          />
          <circle cx={sx(highlighted.x)} cy={sy(highlighted.y)} r="3.5" fill="var(--accent)" />
        </>
      )}
      <text x={width - 8} y={height - 6} textAnchor="end" fontSize="9" fill="var(--text-faint)">{xLabel}</text>
      <text x={2} y={14} fontSize="9" fill="var(--text-faint)">{yLabel}</text>
    </svg>
  );
}

export function Ch08() {
  const index = demoIndex();
  const context = demoContext();
  const [params, setParams] = useState<Bm25Params>({ ...LUCENE_DEFAULTS });
  const [tf, setTf] = useState(3);
  const [fieldLength, setFieldLength] = useState(6);
  const [docFreq, setDocFreq] = useState(5);
  const [queryText, setQueryText] = useState("kubernetes deployment");

  const numDocs = index.numDocs;
  const avgdl = index.avgFieldLength("title");

  // Both of these are a handful of arithmetic operations, so they are computed
  // on every render rather than memoized.
  const breakdown = bm25({ tf, fieldLength, avgFieldLength: avgdl, numDocs, docFreq, params });
  const explanation = bm25Explanation("kubernetes", "title", {
    tf, fieldLength, avgFieldLength: avgdl, numDocs, docFreq, params,
  });

  const results = useMemo(
    () => search(context, { kind: "match", field: "title", text: queryText }, { topK: 8, params }),
    [context, queryText, params],
  );

  const worked = useMemo(() => {
    const workedIndex = buildIndex(BM25_EXAMPLE_CORPUS, analyzerFor);
    const workedContext = makeSearchContext(workedIndex);
    const result = search(workedContext, { kind: "match", field: "title", text: "kubernetes" }, { topK: 3, params });
    return { workedIndex, result };
  }, [params]);

  return (
    <Stack gap={4}>
      <Panel
        title="The formula, with every intermediate value"
        subtitle="Nothing here is hidden. Move a dial and watch each piece of the arithmetic respond."
      >
        <Stack gap={4}>
          <pre className="scroll-x rounded-lg border border-edge bg-code p-3 font-mono text-[12px] leading-relaxed text-muted">
{`score(t,d) = IDF(t) × [ TF(t,d) × (k1 + 1) ]
                     ────────────────────────────────────────
                     [ TF(t,d) + k1 × (1 − b + b × |d| / avgdl) ]`}
          </pre>

          <Grid cols={2}>
            <Stack gap={3}>
              <Slider label="k1 — TF saturation" value={params.k1} min={0} max={3} step={0.05}
                onChange={(v) => setParams({ ...params, k1: v })}
                hint="Higher k1 means term frequency keeps mattering for longer" />
              <Slider label="b — length normalisation" value={params.b} min={0} max={1} step={0.05}
                onChange={(v) => setParams({ ...params, b: v })}
                hint="b=0 ignores length entirely; b=1 normalises fully" />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setParams({ ...LUCENE_DEFAULTS })}>Lucene defaults (1.2, 0.75)</Button>
                <Button size="sm" onClick={() => setParams({ k1: 0, b: 0 })}>k1=0 (binary)</Button>
              </div>
            </Stack>
            <Stack gap={3}>
              <Slider label="tf — occurrences in this document" value={tf} min={0} max={20} onChange={setTf} />
              <Slider label="|d| — field length in terms" value={fieldLength} min={1} max={60} onChange={setFieldLength} />
              <Slider label="df — documents containing the term" value={docFreq} min={0} max={numDocs} onChange={setDocFreq} />
            </Stack>
          </Grid>

          <StatRow>
            <Stat label="IDF" value={formatNumber(breakdown.idf, 4)} tone="accent" hint="ln(1 + (N − df + 0.5)/(df + 0.5))" />
            <Stat label="length norm" value={formatNumber(breakdown.norm, 4)} hint="k1 × (1 − b + b × |d|/avgdl)" />
            <Stat label="TF component" value={formatNumber(breakdown.tfComponent, 4)} hint="tf(k1+1) / (tf + norm)" />
            <Stat label="score" value={formatNumber(breakdown.score, 4)} tone="ok" />
          </StatRow>

          <div className="rounded-lg border border-edge bg-sunken p-3 font-mono text-[12px] leading-relaxed text-muted">
            <div>
              {formatNumber(breakdown.idf, 4)} × ({tf} × ({params.k1} + 1)) / ({tf} + {formatNumber(breakdown.norm, 4)})
            </div>
            <div className="mt-1">
              = {formatNumber(breakdown.idf, 4)} × {formatNumber(breakdown.numerator, 4)} / {formatNumber(breakdown.denominator, 4)}
              {" "}= <span className="text-accent-text">{formatNumber(breakdown.score, 4)}</span>
            </div>
          </div>
        </Stack>
      </Panel>

      <Grid cols={2}>
        <Panel title="TF saturation" subtitle={`k1 = ${params.k1}. The curve flattens: more occurrences help less and less.`}>
          <Curve
            points={saturationCurve(params, fieldLength / (avgdl || 1), 20).map((p) => ({ x: p.tf, y: p.value }))}
            xLabel="term frequency"
            yLabel="contribution"
            highlight={tf}
          />
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            At k1 = 0 the curve is a step: the term either appears or it does not, and frequency is ignored
            entirely. As k1 grows, the curve straightens and repetition keeps paying.
          </p>
        </Panel>

        <Panel title="IDF" subtitle={`N = ${numDocs}. A term in every document carries almost no information.`}>
          <Curve
            points={idfCurve(numDocs).map((p) => ({ x: p.df, y: p.value }))}
            xLabel="document frequency"
            yLabel="idf"
            highlight={docFreq}
          />
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            The curve stays finite even at df = 0, which is why chapter 9 can say the formula is defined for an
            unknown term — while still producing no candidates to apply it to.
          </p>
        </Panel>
      </Grid>

      <Panel title="The explanation tree" subtitle="The same numbers, structured the way Lucene's `explain` presents them.">
        <ExplainTree node={explanation} />
      </Panel>

      <Panel
        title="Appendix A, computed live"
        subtitle="The book's worked example: D1 = 'kubernetes kubernetes deployment', D2 = 'kubernetes deployment', D3 = 'docker deployment'."
        tone="sunken"
      >
        <Stack gap={3}>
          <StatRow>
            <Stat label="N" value={worked.workedIndex.numDocs} />
            <Stat label="df(kubernetes)" value={worked.workedIndex.docFreq("title", "kubernetes")} />
            <Stat label="avgdl" value={formatNumber(worked.workedIndex.avgFieldLength("title"), 3)} hint="(3 + 2 + 2) / 3" />
            <Stat label="idf" value={formatNumber(idf(3, 2), 4)} hint="ln(1.6)" />
          </StatRow>
          <Table head={["document", "tf", "length", "score for `kubernetes`"]}>
            {["D1", "D2", "D3"].map((key) => {
              const hit = worked.result.hits.find((h) => worked.workedIndex.source(h.docId)?.id === key);
              const docId = BM25_EXAMPLE_CORPUS.findIndex((d) => d.id === key);
              const posting = (worked.workedIndex.postings("title", "kubernetes") ?? []).find((p) => p.docId === docId);
              return (
                <Tr key={key}>
                  <Td mono>{key}</Td>
                  <Td mono align="right">{posting?.freq ?? 0}</Td>
                  <Td mono align="right" tone="muted">{worked.workedIndex.fieldLength("title", docId)}</Td>
                  <Td mono align="right" tone={hit ? "accent" : "muted"}>
                    {hit ? formatNumber(hit.score, 4) : "no contribution — the term is not in this document"}
                  </Td>
                </Tr>
              );
            })}
          </Table>
          <Callout tone="info">
            D1 has the term twice and D2 once, but D1 is also longer. Push b towards 0 and D1&apos;s extra
            occurrence wins outright; push it towards 1 and D2&apos;s brevity closes the gap.
          </Callout>
        </Stack>
      </Panel>

      <Panel title="What the dials do to a real ranking" subtitle="Same query, same documents, only k1 and b changed.">
        <Stack gap={3}>
          <TextInput label="Query" value={queryText} onChange={setQueryText} />
          <Table head={["#", "score", "document", "length"]}>
            {results.hits.map((hit, i) => (
              <Tr key={hit.docId} highlight={i === 0}>
                <Td mono tone="muted">{i + 1}</Td>
                <Td mono tone="accent">{formatNumber(hit.score, 3)}</Td>
                <Td>{index.source(hit.docId)?.title}</Td>
                <Td mono align="right" tone="muted">{index.fieldLength("title", hit.docId)}</Td>
              </Tr>
            ))}
          </Table>
          {results.hits.length === 0 && <EmptyState>No matches for that query.</EmptyState>}
        </Stack>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 9 — unknown words, OOV terms, zero results
// ===========================================================================

export function Ch09() {
  const index = demoIndex();
  const context = demoContext();
  const [term, setTerm] = useState("terraform");
  const [rescue, setRescue] = useState(false);
  const [maxEdits, setMaxEdits] = useState(1);

  const clean = term.toLowerCase().trim();
  const exists = index.docFreq("title", clean) > 0;

  const exact = search(context, { kind: "term", field: "title", value: clean }, { topK: 5 });
  const fuzzy = search(context, { kind: "fuzzy", field: "title", value: clean, maxEdits }, { topK: 5 });

  const active = rescue ? fuzzy : exact;
  const df = index.docFreq("title", clean);

  return (
    <Stack gap={4}>
      <Panel
        title="Look up a term that is not there"
        subtitle="The dictionary lookup fails first. Everything downstream simply never happens."
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Term" value={term} onChange={setTerm} />
            <div>
              <div className="mb-1 text-[11.5px] font-medium text-muted">Try</div>
              <div className="flex flex-wrap gap-1">
                {["terraform", "kubernetes", "kubernets", "elasticsearch", "docker", "kuberentes"].map((t) => (
                  <Button key={t} size="sm" onClick={() => setTerm(t)}>{t}</Button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            {[
              { label: `Query: ${clean || "—"}`, ok: true, note: "the raw input" },
              { label: "Analyze", ok: true, note: "lowercase, tokenize" },
              { label: `Term: ${clean || "—"}`, ok: true, note: "what we look up" },
              { label: "Term dictionary", ok: true, note: `${index.sortedTerms("title").length} terms in the title field` },
              {
                label: exists ? "Found" : "NOT FOUND",
                ok: exists,
                note: exists ? `df = ${df}` : "no entry in the dictionary",
              },
              {
                label: exists ? "Read postings" : "No postings",
                ok: exists,
                note: exists ? `${df} document(s)` : "there is no list to read",
              },
              {
                label: exists ? "Score candidates" : "No candidate documents",
                ok: exists,
                note: exists ? `${exact.stats.docsScored} scored` : "nothing reaches the scorer",
              },
              {
                label: exists ? `${exact.hits.length} result(s)` : "No BM25 contribution",
                ok: exists,
                note: exists ? "" : "BM25 requires candidates; there are none",
              },
            ].map((row, i, arr) => (
              <div key={i}>
                <div
                  className={`flex flex-wrap items-baseline gap-2 rounded-lg border px-3 py-2 ${
                    row.ok ? "border-edge bg-raised" : "border-transparent bg-bad-soft"
                  }`}
                >
                  <span className={`font-mono text-[12.5px] font-medium ${row.ok ? "text-ink" : "text-bad"}`}>
                    {row.label}
                  </span>
                  {row.note && <span className="text-[11.5px] text-faint">{row.note}</span>}
                </div>
                {i < arr.length - 1 && <div className="py-0.5 text-center font-mono text-[10px] text-faint">↓</div>}
              </div>
            ))}
          </div>
        </Stack>
      </Panel>

      <Panel
        title="Does BM25 assign a score to an unknown term?"
        subtitle="The formula is defined. That is not the same as producing a result."
        tone="sunken"
      >
        <Grid cols={2}>
          <div className="rounded-lg border border-edge bg-raised p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
              The arithmetic at df = 0
            </div>
            <KeyValue
              items={[
                { key: "N", value: index.numDocs },
                { key: "df", value: 0 },
                { key: "IDF = ln(1 + (N − 0 + 0.5) / 0.5)", value: formatNumber(idf(index.numDocs, 0), 4) },
              ]}
            />
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Perfectly finite. You can substitute df = 0 and get a number.
            </p>
          </div>
          <div className="rounded-lg border border-transparent bg-bad-soft p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-bad">
              And yet
            </div>
            <pre className="font-mono text-[12px] leading-relaxed text-muted">
{`BM25 scoring
      ↓
requires candidate documents

No postings
      ↓
no candidates
      ↓
nothing to score`}
            </pre>
          </div>
        </Grid>
      </Panel>

      <Panel
        title="Fuzzy search can rescue an out-of-vocabulary term"
        subtitle="The term is still not in the dictionary. Fuzzy search finds terms that are."
        actions={
          <Toggle label="Use fuzzy" checked={rescue} onChange={setRescue} />
        }
      >
        <Stack gap={4}>
          {rescue && (
            <Slider label="max edits" value={maxEdits} min={0} max={2} onChange={setMaxEdits} />
          )}

          {rescue && fuzzy.expansions.length > 0 && (
            <div className="rounded-lg border border-edge bg-sunken p-3">
              <div className="mb-1.5 text-[11px] uppercase tracking-wider text-faint">
                Terms the automaton accepted
              </div>
              <div className="flex flex-wrap gap-1">
                {fuzzy.expansions[0].terms.length === 0
                  ? <span className="text-[12px] text-faint">none within {maxEdits} edit(s)</span>
                  : fuzzy.expansions[0].terms.map((t) => <Badge key={t} tone="accent">{t}</Badge>)}
              </div>
              <p className="mt-2 text-[11.5px] text-faint">{fuzzy.expansions[0].method}</p>
            </div>
          )}

          {active.hits.length === 0 ? (
            <EmptyState>
              {rescue
                ? `No indexed term is within ${maxEdits} edit(s) of "${clean}".`
                : `Zero results. "${clean}" is not in the dictionary.`}
            </EmptyState>
          ) : (
            <Table head={["score", "document", "matched terms"]}>
              {active.hits.map((hit) => (
                <Tr key={hit.docId}>
                  <Td mono tone="accent">{formatNumber(hit.score, 3)}</Td>
                  <Td>{index.source(hit.docId)?.title}</Td>
                  <Td mono tone="muted">{hit.matchedTerms?.join(", ")}</Td>
                </Tr>
              ))}
            </Table>
          )}

          <Callout tone={rescue ? "ok" : "warn"}>
            {rescue
              ? "The engine did not invent a posting for the misspelling. It found real indexed terms close enough to it, and read their postings instead."
              : "A zero-result query is not a bug in the ranker. It is the dictionary telling you honestly that nothing matches."}
          </Callout>
        </Stack>
      </Panel>
    </Stack>
  );
}
