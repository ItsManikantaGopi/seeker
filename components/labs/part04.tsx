"use client";

import { useMemo, useState } from "react";
import { analyzeToTerms, DEFAULT_ANALYZER, KEYWORD_ANALYZER } from "@/lib/kaus/analyzer";

import { demoContext, demoDictionary, demoIndex } from "@/lib/demo";
import { collectAll, search, type Query } from "@/lib/kaus/query";
import { analyzeCacheability } from "@/lib/kaus/cache";
import {
  Badge,
  Bar,
  Button,
  Callout,
  EmptyState,
  Grid,
  Mono,
  Panel,
  Segmented,
  Select,
  Slider,
  Stack,
  Stat,
  StatRow,
  Table,
  Td,
  TextInput,
  TokenChip,
  Tr,
  formatNumber,
} from "@/components/ui";

// ===========================================================================
// Chapter 10 — text vs keyword
// ===========================================================================

export function Ch10() {
  const index = demoIndex();
  const context = demoContext();
  const [value, setValue] = useState("Kubernetes Deployment Guide");
  const [queryValue, setQueryValue] = useState("kubernetes");
  const [queryKind, setQueryKind] = useState<"match" | "term">("match");

  const textTerms = useMemo(() => analyzeToTerms(value, DEFAULT_ANALYZER), [value]);
  const keywordTerms = useMemo(() => analyzeToTerms(value, KEYWORD_ANALYZER), [value]);

  const results = useMemo(() => {
    const onText: Query = queryKind === "match"
      ? { kind: "match", field: "title", text: queryValue }
      : { kind: "term", field: "title", value: queryValue };
    const onKeyword: Query = queryKind === "match"
      ? { kind: "match", field: "title.keyword", text: queryValue }
      : { kind: "term", field: "title.keyword", value: queryValue };
    return {
      text: search(context, onText, { topK: 5 }),
      keyword: search(context, onKeyword, { topK: 5 }),
    };
  }, [context, queryValue, queryKind]);

  return (
    <Stack gap={4}>
      <Panel
        title="One string, two representations"
        subtitle="text is analyzed. keyword is not. Everything else follows from that single difference."
      >
        <Stack gap={4}>
          <TextInput label="Field value" value={value} onChange={setValue} mono={false} />
          <Grid cols={2}>
            <div className="rounded-lg border border-transparent bg-accent-soft p-3">
              <div className="mb-2 flex items-center gap-2">
                <Badge tone="accent">text</Badge>
                <span className="text-[12px] text-accent-text">analyzed → {textTerms.length} terms</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {textTerms.map((t, i) => <TokenChip key={i} text={t} position={i} tone="accent" />)}
              </div>
            </div>
            <div className="rounded-lg border border-transparent bg-info-soft p-3">
              <div className="mb-2 flex items-center gap-2">
                <Badge tone="info">keyword</Badge>
                <span className="text-[12px] text-info">not analyzed → 1 term</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {keywordTerms.map((t, i) => <TokenChip key={i} text={t} position={i} />)}
              </div>
            </div>
          </Grid>
        </Stack>
      </Panel>

      <Panel
        title="Field type is not query type"
        subtitle="`keyword` is a field type. `term` is a query type. They are related, and they are not the same concept."
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Search for" value={queryValue} onChange={setQueryValue} />
            <Segmented
              label="Query type"
              value={queryKind}
              onChange={setQueryKind}
              options={[
                { value: "match", label: "match (analyzes)", hint: "Runs the query text through the analyzer" },
                { value: "term", label: "term (exact)", hint: "Looks up the value verbatim" },
              ]}
            />
          </div>

          <Grid cols={2}>
            {([
              ["title", "text field", results.text],
              ["title.keyword", "keyword field", results.keyword],
            ] as const).map(([field, label, result]) => (
              <div key={field} className="rounded-lg border border-edge bg-raised p-3">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[12px] text-ink">{field}</span>
                  <span className="text-[11px] text-faint">{label}</span>
                </div>
                <div className="mb-2">
                  <Badge tone={result.hits.length > 0 ? "ok" : "bad"}>
                    {result.hits.length} result{result.hits.length === 1 ? "" : "s"}
                  </Badge>
                </div>
                {result.hits.length === 0 ? (
                  <p className="text-[12px] text-faint">
                    Nothing. {field === "title.keyword" && queryKind === "term"
                      ? "The keyword field holds whole titles, so only the exact full title matches."
                      : field === "title.keyword"
                        ? "match still analyzes the query, but the field's terms are whole titles."
                        : "No indexed term equals that value."}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {result.hits.map((hit) => (
                      <li key={hit.docId} className="text-[12px] text-muted">
                        <span className="font-mono text-[11.5px] text-accent-text">
                          {formatNumber(hit.score, 2)}
                        </span>{" "}
                        {index.source(hit.docId)?.title}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </Grid>

          <Callout tone="warn" title="The most common search bug there is">
            Searching one word against a keyword field returns nothing, and the document is plainly right
            there. Nothing is broken: the keyword field contains one term — the whole title — and one word
            is not equal to it. Try <Mono>{value}</Mono> as a <Mono>term</Mono> query against{" "}
            <Mono>title.keyword</Mono> and it appears.
          </Callout>
        </Stack>
      </Panel>

      <Panel title="Which fields in this corpus are which" tone="sunken">
        <Table head={["field", "type", "terms", "example term"]}>
          {["title", "body", "title.keyword", "status", "tags", "author"].map((field) => {
            const stats = index.fieldStats(field);
            const first = index.sortedTerms(field)[0];
            return (
              <Tr key={field}>
                <Td mono>{field}</Td>
                <Td>
                  <Badge tone={field === "title" || field === "body" ? "accent" : "info"}>
                    {field === "title" || field === "body" ? "text" : "keyword"}
                  </Badge>
                </Td>
                <Td mono align="right">{stats.vocabularySize}</Td>
                <Td mono tone="muted">{first}</Td>
              </Tr>
            );
          })}
        </Table>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 11 — match, term, bool, range
// ===========================================================================

type ClauseType = "must" | "filter" | "should" | "must_not";

interface Clause {
  id: number;
  type: ClauseType;
  query: Query;
  label: string;
}

const CLAUSE_INFO: Record<ClauseType, { title: string; meaning: string; scores: boolean; tone: "accent" | "info" | "ok" | "bad" }> = {
  must: { title: "must", meaning: "Required, and it contributes to the score.", scores: true, tone: "accent" },
  filter: { title: "filter", meaning: "Required, and it contributes nothing to the score — which is what makes it cacheable.", scores: false, tone: "info" },
  should: { title: "should", meaning: "Optional. Boosts documents that match, unless nothing else is required.", scores: true, tone: "ok" },
  must_not: { title: "must_not", meaning: "Exclusion. Documents matching it are removed, never scored.", scores: false, tone: "bad" },
};

const AVAILABLE: { label: string; query: Query }[] = [
  { label: "match title:kubernetes", query: { kind: "match", field: "title", text: "kubernetes" } },
  { label: "match title:deployment", query: { kind: "match", field: "title", text: "deployment" } },
  { label: "match body:cluster", query: { kind: "match", field: "body", text: "cluster" } },
  { label: "term status:published", query: { kind: "term", field: "status", value: "published" } },
  { label: "term status:draft", query: { kind: "term", field: "status", value: "draft" } },
  { label: "term tags:kubernetes", query: { kind: "term", field: "tags", value: "kubernetes" } },
  { label: "term author:user_123", query: { kind: "term", field: "author", value: "user_123" } },
  { label: "range price 100–200", query: { kind: "range", field: "price", gte: 100, lte: 200 } },
  { label: "range rating >= 4.5", query: { kind: "range", field: "rating", gte: 4.5 } },
];

export function Ch11() {
  const index = demoIndex();
  const context = demoContext();
  const [clauses, setClauses] = useState<Clause[]>([
    { id: 1, type: "must", query: AVAILABLE[0].query, label: AVAILABLE[0].label },
    { id: 2, type: "filter", query: AVAILABLE[3].query, label: AVAILABLE[3].label },
  ]);
  const [nextId, setNextId] = useState(3);
  const [minimumShouldMatch, setMinimumShouldMatch] = useState(0);

  const query = useMemo<Query>(() => ({
    kind: "bool",
    must: clauses.filter((c) => c.type === "must").map((c) => c.query),
    filter: clauses.filter((c) => c.type === "filter").map((c) => c.query),
    should: clauses.filter((c) => c.type === "should").map((c) => c.query),
    must_not: clauses.filter((c) => c.type === "must_not").map((c) => c.query),
    minimumShouldMatch,
  }), [clauses, minimumShouldMatch]);

  const result = useMemo(() => search(context, query, { topK: 10 }), [context, query]);

  // What each clause matches on its own, so membership is visible.
  const perClause = useMemo(
    () => clauses.map((c) => ({ ...c, matches: collectAll(context, c.query) })),
    [clauses, context],
  );

  const shouldCount = clauses.filter((c) => c.type === "should").length;

  return (
    <Stack gap={4}>
      <Panel
        title="Assemble a bool query"
        subtitle="Add clauses and move them between the four buckets. Matching and scoring change independently."
        actions={
          <Select
            value=""
            onChange={(v) => {
              const found = AVAILABLE.find((a) => a.label === v);
              if (!found) return;
              setClauses((cs) => [...cs, { id: nextId, type: "must", query: found.query, label: found.label }]);
              setNextId((n) => n + 1);
            }}
            options={[{ value: "", label: "+ add a clause…" }, ...AVAILABLE.map((a) => ({ value: a.label, label: a.label }))]}
          />
        }
      >
        <Stack gap={4}>
          {clauses.length === 0 ? (
            <EmptyState>No clauses. A bool query with nothing in it matches nothing.</EmptyState>
          ) : (
            <div className="space-y-2">
              {perClause.map((clause) => (
                <div key={clause.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-raised px-3 py-2">
                  <Segmented
                    value={clause.type}
                    onChange={(type) =>
                      setClauses((cs) => cs.map((c) => (c.id === clause.id ? { ...c, type } : c)))
                    }
                    options={[
                      { value: "must", label: "must" },
                      { value: "filter", label: "filter" },
                      { value: "should", label: "should" },
                      { value: "must_not", label: "must_not" },
                    ]}
                  />
                  <span className="font-mono text-[12px] text-ink">{clause.label}</span>
                  <Badge tone="neutral">{clause.matches.length} match{clause.matches.length === 1 ? "" : "es"}</Badge>
                  <Badge tone={CLAUSE_INFO[clause.type].scores ? "accent" : "neutral"}>
                    {CLAUSE_INFO[clause.type].scores ? "scores" : "no score"}
                  </Badge>
                  <Button
                    size="sm"
                    tone="ghost"
                    onClick={() => setClauses((cs) => cs.filter((c) => c.id !== clause.id))}
                  >
                    remove
                  </Button>
                </div>
              ))}
            </div>
          )}

          {shouldCount > 0 && (
            <Slider
              label="minimum_should_match"
              value={minimumShouldMatch}
              min={0}
              max={shouldCount}
              onChange={setMinimumShouldMatch}
              format={(v) => (v === 0 ? "0 — should clauses only boost" : `${v} of ${shouldCount} required`)}
            />
          )}

          <pre className="scroll-x rounded-lg border border-edge bg-code p-3 font-mono text-[11.5px] leading-relaxed text-muted">
            {JSON.stringify(query, null, 2)}
          </pre>
        </Stack>
      </Panel>

      <Grid cols={2}>
        <Panel title="What the four clause types mean" tone="sunken">
          <Stack gap={2}>
            {(Object.keys(CLAUSE_INFO) as ClauseType[]).map((type) => (
              <div key={type} className="rounded-lg border border-edge bg-raised px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge tone={CLAUSE_INFO[type].tone}>{CLAUSE_INFO[type].title}</Badge>
                  <span className="text-[11px] text-faint">
                    {clauses.filter((c) => c.type === type).length} in this query
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{CLAUSE_INFO[type].meaning}</p>
              </div>
            ))}
          </Stack>
        </Panel>

        <Panel title="Results" subtitle={`${result.totalCandidates} document(s) matched`}>
          {result.hits.length === 0 ? (
            <EmptyState>Nothing matched this combination of clauses.</EmptyState>
          ) : (
            <Table head={["score", "document", "status", "price"]} dense>
              {result.hits.map((hit) => {
                const source = index.source(hit.docId)!;
                return (
                  <Tr key={hit.docId}>
                    <Td mono tone="accent">{formatNumber(hit.score, 3)}</Td>
                    <Td>{source.title}</Td>
                    <Td mono tone="muted">{source.status}</Td>
                    <Td mono align="right" tone="muted">{source.price}</Td>
                  </Tr>
                );
              })}
            </Table>
          )}
        </Panel>
      </Grid>

      <Panel
        title="Why `filter` is the cacheable one"
        subtitle="A clause that never scores produces only a set of documents — and a set can be reused."
      >
        <Table head={["clause", "position", "cacheable", "why"]}>
          {perClause.map((clause) => {
            const verdict = analyzeCacheability(clause.query.kind, clause.type);
            return (
              <Tr key={clause.id}>
                <Td mono>{clause.label}</Td>
                <Td mono tone="muted">{clause.type}</Td>
                <Td align="center" tone={verdict.cacheable ? "ok" : "bad"}>
                  {verdict.cacheable ? "yes" : "no"}
                </Td>
                <Td tone="muted">{verdict.reason}</Td>
              </Tr>
            );
          })}
        </Table>
      </Panel>

      <Callout tone="accent" title="Move a clause from must to filter">
        The result set is identical. The scores change, because the clause stopped contributing. That is the
        whole trade, and it is why dashboards — same filters, different sort — get so much out of filter
        clauses.
      </Callout>
    </Stack>
  );
}

// ===========================================================================
// Chapter 12 — phrase, prefix, wildcard, regex
// ===========================================================================

type PatternKind = "phrase" | "prefix" | "wildcard" | "regexp";

export function Ch12() {
  const index = demoIndex();
  const context = demoContext();
  const dictionary = demoDictionary("title");

  const [kind, setKind] = useState<PatternKind>("prefix");
  const [input, setInput] = useState("kube");
  const [slop, setSlop] = useState(0);
  const [maxExpansions, setMaxExpansions] = useState(50);

  const query = useMemo<Query>(() => {
    switch (kind) {
      case "phrase": return { kind: "phrase", field: "title", text: input, slop };
      case "prefix": return { kind: "prefix", field: "title", value: input.toLowerCase(), maxExpansions };
      case "wildcard": return { kind: "wildcard", field: "title", pattern: input.toLowerCase(), maxExpansions };
      case "regexp": return { kind: "regexp", field: "title", pattern: input.toLowerCase(), maxExpansions };
    }
  }, [kind, input, slop, maxExpansions]);

  const result = useMemo(() => search(context, query, { topK: 10 }), [context, query]);

  // Compare the work each pattern type does against the same dictionary.
  const comparison = useMemo(() => [
    { kind: "prefix" as const, label: "kube*", expansion: dictionary.prefixRange("kube", maxExpansions) },
    { kind: "wildcard" as const, label: "kube*es", expansion: dictionary.wildcard("kube*es", maxExpansions) },
    { kind: "wildcard" as const, label: "*ment", expansion: dictionary.wildcard("*ment", maxExpansions) },
    { kind: "regexp" as const, label: "/.*deploy.*/", expansion: dictionary.regexp(".*deploy.*", maxExpansions) },
  ], [dictionary, maxExpansions]);

  const expansion = result.expansions[0];

  return (
    <Stack gap={4}>
      <Panel
        title="Different query types stress different structures"
        subtitle="Phrase needs positions. Prefix needs ordered vocabulary. Wildcard and regex need term expansion — and a limit."
      >
        <Stack gap={4}>
          <Segmented
            label="Pattern type"
            value={kind}
            onChange={(k) => {
              setKind(k);
              setInput(k === "phrase" ? "kubernetes deployment" : k === "prefix" ? "kube" : k === "wildcard" ? "deploy*ent" : ".*deploy.*");
            }}
            options={[
              { value: "phrase", label: "phrase", hint: "Needs positions" },
              { value: "prefix", label: "prefix", hint: "Needs vocabulary traversal" },
              { value: "wildcard", label: "wildcard", hint: "Term expansion" },
              { value: "regexp", label: "regex", hint: "Term expansion, unbounded" },
            ]}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label={kind === "phrase" ? "Phrase" : "Pattern"} value={input} onChange={setInput} />
            {kind === "phrase" ? (
              <Slider label="slop — how far apart the words may be" value={slop} min={0} max={6} onChange={setSlop} />
            ) : (
              <Slider
                label="max_expansions"
                value={maxExpansions}
                min={1}
                max={200}
                onChange={setMaxExpansions}
                hint="The cap that stops one query from turning into thousands of clauses"
              />
            )}
          </div>

          {expansion && (
            <div className="rounded-lg border border-edge bg-sunken p-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-faint">Terms this expanded to</span>
                <Badge tone={expansion.clipped ? "bad" : "neutral"}>
                  {expansion.terms.length}
                  {expansion.clipped && ` of ${expansion.totalBeforeClip} — clipped`}
                </Badge>
                <Badge tone="neutral">{expansion.work} units of work</Badge>
              </div>
              <div className="flex flex-wrap gap-1">
                {expansion.terms.length === 0
                  ? <span className="text-[12px] text-faint">no terms matched</span>
                  : expansion.terms.map((t) => <Badge key={t} tone="accent">{t}</Badge>)}
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-faint">{expansion.method}</p>
              {expansion.note && (
                <p className="mt-1 text-[11.5px] leading-relaxed text-warn">{expansion.note}</p>
              )}
            </div>
          )}

          <StatRow>
            <Stat label="matching documents" value={result.totalCandidates} />
            <Stat label="terms expanded" value={result.stats.termsExpanded} />
            <Stat label="clauses dropped by the cap" value={result.stats.expansionsClipped} tone={result.stats.expansionsClipped > 0 ? "warn" : "default"} />
            <Stat label="position checks" value={result.stats.positionChecks} hint="Only phrase queries do this work" />
          </StatRow>

          {result.hits.length === 0 ? (
            <EmptyState>Nothing matched.</EmptyState>
          ) : (
            <Table head={["score", "document", "matched terms"]} dense>
              {result.hits.map((hit) => (
                <Tr key={hit.docId}>
                  <Td mono tone="accent">{formatNumber(hit.score, 3)}</Td>
                  <Td>{index.source(hit.docId)?.title}</Td>
                  <Td mono tone="muted">{hit.matchedTerms?.slice(0, 5).join(", ")}</Td>
                </Tr>
              ))}
            </Table>
          )}

          {kind === "phrase" && (
            <Callout tone="info" title="A note on slop">
              Slop here means the words may sit further apart while staying in order. Lucene&apos;s sloppy
              phrase can also match transposed words at slop 2 or more; this implementation deliberately does
              not, and says so rather than pretending.
            </Callout>
          )}
        </Stack>
      </Panel>

      <Panel
        title="What each pattern costs against the same dictionary"
        subtitle={`${dictionary.size} terms in the title field. The literal prefix is what decides whether the sorted order helps.`}
        tone="sunken"
      >
        <Table head={["pattern", "terms matched", "dictionary work", "why"]}>
          {comparison.map((row) => (
            <Tr key={row.label}>
              <Td mono>{row.label}</Td>
              <Td mono align="right">{row.expansion.totalBeforeClip}</Td>
              <Td>
                <Bar
                  value={row.expansion.work}
                  max={dictionary.size}
                  tone={row.expansion.work > dictionary.size * 0.6 ? "bad" : "ok"}
                  label={`${row.expansion.work}`}
                  width={110}
                />
              </Td>
              <Td tone="muted">{row.expansion.method}</Td>
            </Tr>
          ))}
        </Table>
        <Callout tone="warn" title="Expansion must be bounded">
          A leading wildcard forfeits the sorted order and reads the whole vocabulary. A regex generally cannot
          use the order at all. Without <Mono>max_expansions</Mono> a single query becomes thousands of
          boolean clauses, which is how one user takes down a cluster.
        </Callout>
      </Panel>
    </Stack>
  );
}
