"use client";

import { useMemo, useState } from "react";
import {
  ANALYZER_PRESETS, analyze, DEFAULT_ANALYZER, KEYWORD_ANALYZER,
  type AnalyzerConfig, type CharFilterName, type StemmerName, type TokenizerName,
} from "@/lib/seeker/analyzer";
import { MAPPING } from "@/lib/seeker/corpus";
import { CORPUS } from "@/lib/seeker/corpus";
import { demoContext, demoIndex } from "@/lib/demo";
import { parseQueryString } from "@/lib/seeker/parser";
import { search } from "@/lib/seeker/query";
import { CHAPTERS, QUESTION_TO_STRUCTURE } from "@/lib/chapters";
import {
  Badge, Bar, Button, Callout, EmptyState, Grid, KeyValue, Mono, Panel, Segmented,
  Select, Stack, Stat, StatRow, Table, Td, TextInput, Toggle, TokenChip, Tr,
  formatNumber,
} from "@/components/ui";
import Link from "next/link";

// ===========================================================================
// Chapter 1 — the pipeline, end to end
// ===========================================================================

type StageId =
  | "documents" | "analysis" | "terms" | "dictionary" | "postings" | "points"
  | "segments" | "parse" | "retrieve" | "filter" | "score" | "topk" | "fetch";

interface Stage {
  id: StageId;
  label: string;
  side: "index" | "query";
  question: string;
}

const STAGES: Stage[] = [
  { id: "documents", label: "Documents", side: "index", question: "What are we indexing?" },
  { id: "analysis", label: "Analysis", side: "index", question: "What does the text become?" },
  { id: "terms", label: "Terms", side: "index", question: "What is actually searchable?" },
  { id: "dictionary", label: "Term dictionary", side: "index", question: "Does this term exist?" },
  { id: "postings", label: "Inverted index", side: "index", question: "Which documents contain it?" },
  { id: "points", label: "Point index", side: "index", question: "Which values are in range?" },
  { id: "segments", label: "Segments", side: "index", question: "How is this persisted?" },
  { id: "parse", label: "Parse & analyze query", side: "query", question: "What did the user ask for?" },
  { id: "retrieve", label: "Candidate retrieval", side: "query", question: "Which documents could match?" },
  { id: "filter", label: "Filtering", side: "query", question: "Which of them are allowed?" },
  { id: "score", label: "BM25 scoring", side: "query", question: "How good is each match?" },
  { id: "topk", label: "Top K", side: "query", question: "Which few do we keep?" },
  { id: "fetch", label: "Fetch", side: "query", question: "What do we send back?" },
];

export function Ch01() {
  const [queryText, setQueryText] = useState("kubernetes deployment");
  const [active, setActive] = useState<StageId>("retrieve");

  const index = demoIndex();
  const context = demoContext();

  const run = useMemo(() => {
    const parsed = parseQueryString(queryText);
    const result = search(context, parsed.query, { topK: 5 });
    return { parsed, result };
  }, [queryText, context]);

  const stage = STAGES.find((s) => s.id === active)!;

  const detail = () => {
    const { parsed, result } = run;
    switch (active) {
      case "documents":
        return (
          <Stack gap={3}>
            <p className="text-[12.5px] text-muted">
              {CORPUS.length} documents, each a record of named fields. Nothing here is searchable yet.
            </p>
            <Table head={["id", "title", "status", "price"]} dense>
              {CORPUS.slice(0, 6).map((doc) => (
                <Tr key={doc.id}>
                  <Td mono tone="muted">{doc.id}</Td>
                  <Td>{doc.title}</Td>
                  <Td mono>{doc.status}</Td>
                  <Td mono align="right">{doc.price}</Td>
                </Tr>
              ))}
            </Table>
            <Link href="/corpus" className="text-[12px] text-accent-text underline underline-offset-2">
              See all {CORPUS.length} documents →
            </Link>
          </Stack>
        );
      case "analysis": {
        const sample = CORPUS[0];
        const analysed = analyze(sample.title, DEFAULT_ANALYZER);
        return (
          <Stack gap={3}>
            <p className="text-[12.5px] text-muted">
              Text fields run through the analysis chain. <Mono>{sample.title}</Mono> becomes:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {analysed.tokens.map((token, i) => (
                <TokenChip key={i} text={token.text} position={token.position} tone="accent" />
              ))}
            </div>
            <Callout tone="warn">
              Keyword fields skip this entirely. <Mono>{sample.status}</Mono> stays one term.
            </Callout>
          </Stack>
        );
      }
      case "terms":
        return (
          <StatRow>
            <Stat label="title vocabulary" value={index.sortedTerms("title").length} />
            <Stat label="body vocabulary" value={index.sortedTerms("body").length} />
            <Stat label="status vocabulary" value={index.sortedTerms("status").length} hint="Keyword fields have tiny vocabularies" />
            <Stat label="tags vocabulary" value={index.sortedTerms("tags").length} />
          </StatRow>
        );
      case "dictionary": {
        const terms = index.sortedTerms("title").slice(0, 24);
        return (
          <Stack gap={3}>
            <p className="text-[12.5px] text-muted">
              Sorted terms. Chapters 16 to 19 replace this array with a trie, then an automaton, then an FST.
            </p>
            <div className="flex flex-wrap gap-1">
              {terms.map((term) => (
                <Badge key={term}>{term}</Badge>
              ))}
              <Badge tone="neutral">… {index.sortedTerms("title").length - terms.length} more</Badge>
            </div>
          </Stack>
        );
      }
      case "postings": {
        const term = run.result.resolvedTerms[0]?.term ?? "kubernetes";
        const postings = index.postings("title", term) ?? [];
        return (
          <Stack gap={3}>
            <p className="text-[12.5px] text-muted">
              <Mono>title:{term}</Mono> → {postings.length} document(s), each with a frequency and positions.
            </p>
            <Table head={["docId", "document", "freq", "positions"]} dense>
              {postings.slice(0, 8).map((p) => (
                <Tr key={p.docId}>
                  <Td mono>{p.docId}</Td>
                  <Td>{index.source(p.docId)?.title}</Td>
                  <Td mono align="right">{p.freq}</Td>
                  <Td mono tone="muted">[{p.positions.join(", ")}]</Td>
                </Tr>
              ))}
            </Table>
          </Stack>
        );
      }
      case "points": {
        const values = index.pointValues("price");
        return (
          <Stack gap={3}>
            <p className="text-[12.5px] text-muted">
              Numeric fields are not terms. They are sorted values, so a range is an interval.
            </p>
            <div className="scroll-x">
              <div className="flex gap-1">
                {values.map((v) => (
                  <Badge key={`${v.docId}-${v.value}`} tone="info">{v.value}</Badge>
                ))}
              </div>
            </div>
          </Stack>
        );
      }
      case "segments":
        return (
          <Callout tone="accent" title="Immutability is the whole trick">
            Writes create new segments; deletes are tombstones. Nothing is edited in place, which is why
            readers, caches and the page cache can all trust what they are holding.
          </Callout>
        );
      case "parse":
        return (
          <Stack gap={3}>
            <div className="flex flex-wrap gap-1.5">
              {parsed.tokens.map((token, i) => (
                <TokenChip key={i} text={token.text} subtitle={token.type} tone="accent" />
              ))}
            </div>
            <KeyValue
              items={[
                { key: "resolved terms", value: parsed.errors.length ? "—" : run.result.resolvedTerms.length },
                { key: "parse errors", value: parsed.errors.length },
              ]}
            />
            {run.result.resolvedTerms.length > 0 && (
              <Table head={["field", "term", "docFreq"]} dense>
                {run.result.resolvedTerms.map((t) => (
                  <Tr key={`${t.field}:${t.term}`}>
                    <Td mono tone="muted">{t.field}</Td>
                    <Td mono>{t.term}</Td>
                    <Td mono align="right" tone={t.docFreq === 0 ? "bad" : undefined}>{t.docFreq}</Td>
                  </Tr>
                ))}
              </Table>
            )}
          </Stack>
        );
      case "retrieve":
        return (
          <StatRow>
            <Stat label="candidates" value={result.totalCandidates} hint="Documents the iterators produced" />
            <Stat label="postings read" value={result.stats.postingsRead} />
            <Stat label="term lookups" value={result.stats.termLookups} />
            <Stat label="corpus size" value={index.numDocs} hint="What a full scan would have touched" />
          </StatRow>
        );
      case "filter":
        return (
          <Callout tone="info" title="Nothing is filtered in this query">
            Add a filter clause — try <Mono>{queryText} AND status:published</Mono> — and the candidate
            count drops before any scoring happens. Filters cost matching work, never scoring work.
          </Callout>
        );
      case "score":
        return (
          <Stack gap={3}>
            <StatRow>
              <Stat label="documents scored" value={result.stats.docsScored} />
              <Stat label="heap replacements" value={result.heapStats.replaced} />
              <Stat label="discarded" value={result.heapStats.discarded} hint="Could not beat the worst kept score" />
            </StatRow>
            <p className="text-[12.5px] text-muted">
              BM25 does not find documents. It scores the candidates retrieval already produced.
            </p>
          </Stack>
        );
      case "topk":
        return result.hits.length === 0 ? (
          <EmptyState>No documents matched, so there is nothing to rank.</EmptyState>
        ) : (
          <Table head={["#", "score", "document"]} dense>
            {result.hits.map((hit, i) => (
              <Tr key={hit.docId}>
                <Td mono tone="muted">{i + 1}</Td>
                <Td mono tone="accent">{formatNumber(hit.score, 3)}</Td>
                <Td>{index.source(hit.docId)?.title}</Td>
              </Tr>
            ))}
          </Table>
        );
      case "fetch":
        return result.hits[0] ? (
          <pre className="scroll-x rounded-lg border border-edge bg-code p-3 font-mono text-[11.5px] leading-relaxed text-muted">
            {JSON.stringify(index.source(result.hits[0].docId), null, 2)}
          </pre>
        ) : (
          <EmptyState>Nothing to fetch.</EmptyState>
        );
    }
  };

  return (
    <Stack gap={4}>
      <Panel
        title="One query, every stage"
        subtitle="Type a query and click any stage to see what it really produced."
      >
        <Stack gap={4}>
          <TextInput label="Query" value={queryText} onChange={setQueryText} placeholder="kubernetes deployment" />

          <div className="grid gap-4 lg:grid-cols-2">
            {(["index", "query"] as const).map((side) => (
              <div key={side}>
                <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
                  {side === "index" ? "Build structures that make retrieval fast" : "Use them to find and rank"}
                </div>
                <div className="space-y-1">
                  {STAGES.filter((s) => s.side === side).map((s, i, arr) => (
                    <div key={s.id}>
                      <button
                        type="button"
                        onClick={() => setActive(s.id)}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                          active === s.id
                            ? "border-transparent bg-accent-soft text-accent-text"
                            : "border-edge bg-raised text-muted hover:border-edge-strong hover:text-ink"
                        }`}
                      >
                        <div className="text-[12.5px] font-medium">{s.label}</div>
                        <div className="text-[11px] opacity-70">{s.question}</div>
                      </button>
                      {i < arr.length - 1 && (
                        <div className="py-0.5 text-center font-mono text-[10px] text-faint">↓</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Stack>
      </Panel>

      <Panel title={`Stage: ${stage.label}`} subtitle={stage.question} tone="sunken">
        {detail()}
      </Panel>

      <Panel
        title="There is not one search data structure"
        subtitle="Every question in the book has a different structure responsible for answering it."
      >
        <Table head={["Question", "Structure", ""]}>
          {QUESTION_TO_STRUCTURE.map((row) => (
            <Tr key={row.question}>
              <Td>{row.question}</Td>
              <Td mono tone="accent">{row.structure}</Td>
              <Td align="right">
                <Link
                  href={`/ch/${CHAPTERS.find((c) => c.number === row.chapter)?.slug ?? ""}`}
                  className="text-[11.5px] text-muted underline underline-offset-2 hover:text-ink"
                >
                  ch {row.chapter}
                </Link>
              </Td>
            </Tr>
          ))}
        </Table>
      </Panel>

      <Callout tone="accent" title="The one sentence to keep">
        FST is not postings. BKD is not a text dictionary. BM25 does not find documents; it scores candidates.
      </Callout>
    </Stack>
  );
}

// ===========================================================================
// Chapter 2 — documents, fields and data types
// ===========================================================================

export function Ch02() {
  const [docIndex, setDocIndex] = useState(0);
  const [titleAsKeyword, setTitleAsKeyword] = useState(false);
  const doc = CORPUS[docIndex];

  const analysed = useMemo(
    () => analyze(doc.title, titleAsKeyword ? KEYWORD_ANALYZER : DEFAULT_ANALYZER),
    [doc.title, titleAsKeyword],
  );

  const index = demoIndex();

  return (
    <Stack gap={4}>
      <Panel
        title="A document is a record. A field is a named value inside it."
        subtitle="The field's type decides which structure it lands in — and therefore which questions it can answer."
        actions={
          <Select
            value={String(docIndex)}
            onChange={(v) => setDocIndex(Number(v))}
            options={CORPUS.map((d, i) => ({ value: String(i), label: `${d.id} — ${d.title}` }))}
          />
        }
      >
        <pre className="scroll-x rounded-lg border border-edge bg-code p-3 font-mono text-[11.5px] leading-relaxed text-muted">
          {JSON.stringify(doc, null, 2)}
        </pre>
      </Panel>

      <Panel title="Field types in this mapping">
        <Table head={["field", "type", "what it becomes", "answers"]}>
          {MAPPING.map((field) => (
            <Tr key={field.name}>
              <Td mono>{field.name}</Td>
              <Td>
                <Badge
                  tone={
                    field.type === "text" ? "accent"
                      : field.type === "keyword" ? "info"
                        : field.type === "geo_point" ? "ok" : "warn"
                  }
                >
                  {field.type}
                </Badge>
              </Td>
              <Td tone="muted">{field.description}</Td>
              <Td mono tone="muted">
                {field.type === "text" ? "match, phrase, prefix, fuzzy"
                  : field.type === "keyword" ? "term, exact filters, sorting"
                    : field.type === "geo_point" ? "region queries (BKD)" : "range queries (points)"}
              </Td>
            </Tr>
          ))}
        </Table>
      </Panel>

      <Panel
        title="The multi-field pattern"
        subtitle="One logical field, two representations, two sets of questions it can answer."
      >
        <Stack gap={4}>
          <Toggle
            label={<>Index <Mono>title</Mono> as <Mono>keyword</Mono> instead of <Mono>text</Mono></>}
            checked={titleAsKeyword}
            onChange={setTitleAsKeyword}
          />

          <Grid cols={2}>
            <div className="rounded-lg border border-edge bg-raised p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
                {titleAsKeyword ? "keyword — not analyzed" : "text — analyzed"}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {analysed.tokens.map((token, i) => (
                  <TokenChip
                    key={i}
                    text={token.text}
                    position={token.position}
                    tone={titleAsKeyword ? "default" : "accent"}
                  />
                ))}
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-muted">
                {titleAsKeyword
                  ? "One term, kept exactly as written. You can filter, sort and aggregate on it — and you can no longer search for a word inside it."
                  : `${analysed.tokens.length} terms. You can search for any of these words, in any order, and ask for them as a phrase.`}
              </p>
            </div>

            <div className="rounded-lg border border-edge bg-raised p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
                What each representation can answer
              </div>
              <Table head={["query", "text", "keyword"]} dense>
                {[
                  { q: `match "${doc.title.split(" ")[0]}"`, text: true, keyword: false },
                  { q: `term "${doc.title}"`, text: false, keyword: true },
                  { q: "phrase query", text: true, keyword: false },
                  { q: "prefix on the whole value", text: false, keyword: true },
                  { q: "sort alphabetically", text: false, keyword: true },
                ].map((row) => (
                  <Tr key={row.q}>
                    <Td mono>{row.q}</Td>
                    <Td align="center" tone={row.text ? "ok" : "bad"}>{row.text ? "yes" : "no"}</Td>
                    <Td align="center" tone={row.keyword ? "ok" : "bad"}>{row.keyword ? "yes" : "no"}</Td>
                  </Tr>
                ))}
              </Table>
              <p className="mt-3 text-[12px] leading-relaxed text-muted">
                This is why the mapping keeps both. <Mono>title</Mono> is analyzed;{" "}
                <Mono>title.keyword</Mono> is not.
              </p>
            </div>
          </Grid>

          <Callout tone="warn" title="Reindexing is a data migration">
            Changing a field&apos;s type does not change the terms already in the index. The old segments
            still hold the old representation until every document is written again.
          </Callout>
        </Stack>
      </Panel>

      <Panel title="Vocabulary size, by field" subtitle="Analysis is what makes a text field expensive and a keyword field cheap.">
        <Stack gap={2}>
          {["title", "body", "title.keyword", "status", "tags", "author"].map((field) => {
            const stats = index.fieldStats(field);
            const max = index.fieldStats("body").vocabularySize;
            return (
              <div key={field} className="flex items-center gap-3">
                <span className="w-[110px] shrink-0 font-mono text-[12px] text-muted">{field}</span>
                <Bar value={stats.vocabularySize} max={max} width={220} />
                <span className="font-mono text-[11.5px] tabular-nums text-ink">
                  {stats.vocabularySize} terms
                </span>
                <span className="font-mono text-[11px] text-faint">
                  {stats.postingsEntries} postings
                </span>
              </div>
            );
          })}
        </Stack>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 3 — tokenization, normalization, stemming
// ===========================================================================

const SAMPLE_TEXTS = [
  "Running Kubernetes, quickly!",
  "The deployments are failing again",
  "<p>Kubernetes &amp; Docker</p>",
  "kubernetes-deployment kubernetes_service",
  "Café RÉSUMÉ naïve",
  "Kubernetes Deployment Guide",
];

export function Ch03() {
  const [text, setText] = useState(SAMPLE_TEXTS[0]);
  const [config, setConfig] = useState<AnalyzerConfig>({ ...DEFAULT_ANALYZER });
  const [queryText, setQueryText] = useState("running");
  const [queryConfig, setQueryConfig] = useState<AnalyzerConfig>({ ...DEFAULT_ANALYZER });

  const result = useMemo(() => analyze(text, config), [text, config]);
  const indexTerms = useMemo(() => analyze("Running Kubernetes deployments", config).terms, [config]);
  const queryTerms = useMemo(() => analyze(queryText, queryConfig).terms, [queryText, queryConfig]);
  const overlap = queryTerms.filter((t) => indexTerms.includes(t));

  const update = (patch: Partial<AnalyzerConfig>) => setConfig((c) => ({ ...c, ...patch }));

  return (
    <Stack gap={4}>
      <Panel
        title="Build the analysis chain"
        subtitle="Character filters, then a tokenizer, then token filters. Each stage below is the real output of the real analyzer."
        actions={
          <Select
            label=""
            value="custom"
            onChange={(v) => {
              if (v !== "custom") setConfig({ ...ANALYZER_PRESETS[v] });
            }}
            options={[
              { value: "custom", label: "presets…" },
              ...Object.keys(ANALYZER_PRESETS).map((k) => ({ value: k, label: k })),
            ]}
          />
        }
      >
        <Stack gap={4}>
          <div className="grid gap-3 lg:grid-cols-2">
            <TextInput label="Input text" value={text} onChange={setText} mono={false} />
            <div>
              <div className="mb-1 text-[11.5px] font-medium text-muted">Try</div>
              <div className="flex flex-wrap gap-1">
                {SAMPLE_TEXTS.map((sample) => (
                  <Button key={sample} size="sm" onClick={() => setText(sample)}>
                    {sample.length > 24 ? `${sample.slice(0, 24)}…` : sample}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Select
              label="tokenizer"
              value={config.tokenizer}
              onChange={(v) => update({ tokenizer: v as TokenizerName })}
              options={[
                { value: "standard", label: "standard" },
                { value: "whitespace", label: "whitespace" },
                { value: "letter", label: "letter" },
                { value: "keyword", label: "keyword (no split)" },
                { value: "path", label: "path" },
              ]}
            />
            <Select
              label="stemmer"
              value={config.stemmer}
              onChange={(v) => update({ stemmer: v as StemmerName })}
              options={[
                { value: "none", label: "none" },
                { value: "light", label: "light (naive rules)" },
                { value: "porter", label: "porter (real algorithm)" },
              ]}
            />
            <div className="space-y-1.5">
              <Toggle label="lowercase" checked={config.lowercase} onChange={(v) => update({ lowercase: v })} />
              <Toggle label="asciifolding" checked={config.asciiFolding} onChange={(v) => update({ asciiFolding: v })} />
            </div>
            <div className="space-y-1.5">
              <Toggle label="stopwords" checked={config.stopwords} onChange={(v) => update({ stopwords: v })} />
              <Toggle
                label="split on - _ ."
                checked={config.splitOnDelimiters}
                onChange={(v) => update({ splitOnDelimiters: v })}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(["html_strip", "map_symbols", "strip_punctuation"] as CharFilterName[]).map((filter) => (
              <Toggle
                key={filter}
                label={<Mono>{filter}</Mono>}
                checked={config.charFilters.includes(filter)}
                onChange={(on) =>
                  update({
                    charFilters: on
                      ? [...config.charFilters, filter]
                      : config.charFilters.filter((f) => f !== filter),
                  })
                }
              />
            ))}
            <Toggle
              label={<Mono>edge_ngram</Mono>}
              checked={config.edgeNgram.enabled}
              onChange={(on) => update({ edgeNgram: { ...config.edgeNgram, enabled: on } })}
            />
          </div>
        </Stack>
      </Panel>

      <Panel title="Every stage, in order" tone="sunken">
        <Stack gap={2}>
          {result.stages.map((stage, i) => (
            <div
              key={i}
              className={`rounded-lg border px-3 py-2.5 ${
                stage.skipped ? "border-dashed border-edge opacity-60" : "border-edge bg-raised"
              }`}
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Badge tone={stage.kind === "tokenizer" ? "accent" : stage.kind === "char_filter" ? "info" : "neutral"}>
                  {stage.kind.replace("_", " ")}
                </Badge>
                <span className="font-mono text-[12px] font-medium text-ink">{stage.name}</span>
                {stage.skipped && <span className="text-[11px] text-faint">no effect</span>}
              </div>

              {stage.text !== undefined ? (
                <div className="font-mono text-[12px] text-muted">
                  &ldquo;{stage.text}&rdquo;
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {stage.tokens.map((token, j) => (
                    <TokenChip
                      key={j}
                      text={token.text}
                      position={token.removed ? undefined : token.position}
                      subtitle={token.removed ? "dropped" : undefined}
                      tone={token.removed ? "removed" : "default"}
                      title={`offsets ${token.start}–${token.end}, type ${token.type}`}
                    />
                  ))}
                  {stage.tokens.length === 0 && <span className="text-[12px] text-faint">no tokens</span>}
                </div>
              )}

              <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{stage.note}</p>
            </div>
          ))}

          <div className="rounded-lg border border-transparent bg-accent-soft px-3 py-2.5">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent-text opacity-70">
              Indexed terms
            </div>
            <div className="flex flex-wrap gap-1.5">
              {result.terms.map((term, i) => (
                <TokenChip key={i} text={term} position={i} tone="accent" />
              ))}
              {result.terms.length === 0 && <span className="text-[12px] text-faint">nothing survived</span>}
            </div>
          </div>
        </Stack>
      </Panel>

      <Panel
        title="Token vs term"
        subtitle="A token is intermediate and carries position and offsets. A term is the value that reaches the index."
      >
        <Table head={["token", "position", "start", "end", "type"]} dense>
          {result.tokens.map((token, i) => (
            <Tr key={i}>
              <Td mono>{token.text}</Td>
              <Td mono align="right">{token.position}</Td>
              <Td mono align="right" tone="muted">{token.start}</Td>
              <Td mono align="right" tone="muted">{token.end}</Td>
              <Td mono tone="muted">{token.type}</Td>
            </Tr>
          ))}
        </Table>
      </Panel>

      <Panel
        title="Index-time and query-time analysis must agree"
        subtitle="This is the quiet bug: the index holds one representation and the query asks for another."
        tone="sunken"
      >
        <Stack gap={4}>
          <Grid cols={2}>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
                Index side — &ldquo;Running Kubernetes deployments&rdquo;
              </div>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {indexTerms.map((t, i) => (
                  <TokenChip key={i} text={t} tone="default" />
                ))}
              </div>
              <p className="text-[11.5px] text-faint">Uses the analyzer configured above.</p>
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
                Query side
              </div>
              <div className="mb-2 space-y-2">
                <TextInput value={queryText} onChange={setQueryText} />
                <Segmented
                  value={queryConfig.stemmer}
                  onChange={(v) => setQueryConfig({ ...queryConfig, stemmer: v as StemmerName })}
                  options={[
                    { value: "none", label: "no stemmer" },
                    { value: "light", label: "light" },
                    { value: "porter", label: "porter" },
                  ]}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {queryTerms.map((t, i) => (
                  <TokenChip key={i} text={t} tone={indexTerms.includes(t) ? "ok" : "removed"} />
                ))}
              </div>
            </div>
          </Grid>

          {overlap.length > 0 ? (
            <Callout tone="ok" title="These will match">
              The query produced {overlap.map((t) => <Mono key={t}>{t}</Mono>)}, which the index also contains.
            </Callout>
          ) : (
            <Callout tone="bad" title="Nothing will match">
              The query analyzed to{" "}
              {queryTerms.length ? queryTerms.map((t) => <Mono key={t}>{t}</Mono>) : "nothing"}, and the index
              holds {indexTerms.map((t) => <Mono key={t}>{t}</Mono>)}. The document is there. The query simply
              cannot reach it. Match the two analyzers and it appears.
            </Callout>
          )}
        </Stack>
      </Panel>
    </Stack>
  );
}
