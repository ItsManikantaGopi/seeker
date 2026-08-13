"use client";

import { useMemo, useState } from "react";
import { LUCENE_DEFAULTS, type Bm25Params } from "@/lib/seeker/bm25";
import { EXAMPLE_QUERIES, parseQueryString } from "@/lib/seeker/parser";
import { describeQuery, search, type PlanNode } from "@/lib/seeker/query";
import { demoContext, demoIndex } from "@/lib/demo";
import {
  Badge,
  Bar,
  Button,
  Callout,
  EmptyState,
  ExplainTree,
  KeyValue,
  Mono,
  Panel,
  Segmented,
  Slider,
  Stack,
  Stat,
  StatRow,
  Table,
  Tabs,
  TabPanel,
  Td,
  TextInput,
  Tr,
  formatNumber,
} from "@/components/ui";

function PlanTree({ node, depth = 0 }: { node: PlanNode; depth?: number }) {
  return (
    <div className={depth > 0 ? "ml-3 border-l border-edge pl-3" : ""}>
      <div className="flex flex-wrap items-center gap-2 py-[3px]">
        <span className="font-mono text-[12px] text-ink">{node.label}</span>
        <Badge tone="neutral" title="Estimated matches — what the planner orders clauses by">
          cost {node.cost}
        </Badge>
        {Number.isFinite(node.maxScore) && node.maxScore > 0 && (
          <Badge tone="info" title="Upper bound on this clause's contribution">
            max {formatNumber(node.maxScore, 2)}
          </Badge>
        )}
      </div>
      {node.children.map((child, i) => <PlanTree key={i} node={child} depth={depth + 1} />)}
    </div>
  );
}

export function Playground() {
  const index = demoIndex();
  const context = demoContext();

  const [queryText, setQueryText] = useState("kubernetes AND deployment");
  const [topK, setTopK] = useState(10);
  const [params, setParams] = useState<Bm25Params>({ ...LUCENE_DEFAULTS });
  const [maxClauses, setMaxClauses] = useState(64);
  const [defaultOperator, setDefaultOperator] = useState<"or" | "and">("or");
  const [defaultFields, setDefaultFields] = useState<"both" | "title" | "body">("both");
  const [expanded, setExpanded] = useState<number | null>(null);

  const parsed = useMemo(
    () => parseQueryString(queryText, {
      defaultFields: defaultFields === "both" ? ["title", "body"] : [defaultFields],
      defaultOperator,
    }),
    [queryText, defaultFields, defaultOperator],
  );

  const result = useMemo(
    () => search(context, parsed.query, { topK, params, maxClauses }),
    [context, parsed.query, topK, params, maxClauses],
  );

  return (
    <Stack gap={4}>
      <Panel
        title="Search playground"
        subtitle="The whole engine on one page. Every number below was computed by this query, just now."
      >
        <Stack gap={4}>
          <TextInput
            label="Query string"
            value={queryText}
            onChange={setQueryText}
            placeholder="title:kubernetes AND status:published"
          />

          <div className="flex flex-wrap gap-1">
            {EXAMPLE_QUERIES.map((example) => (
              <Button
                key={example.query}
                size="sm"
                title={example.teaches}
                onClick={() => setQueryText(example.query)}
              >
                {example.label}
              </Button>
            ))}
          </div>

          {parsed.errors.length > 0 && (
            <Callout tone="bad" title="Parse errors">
              <ul className="space-y-0.5">
                {parsed.errors.map((error, i) => (
                  <li key={i} className="font-mono text-[12px]">
                    at {error.position}: {error.message}
                  </li>
                ))}
              </ul>
            </Callout>
          )}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Slider label="top K" value={topK} min={1} max={28} onChange={setTopK} />
            <Slider label="k1 — TF saturation" value={params.k1} min={0} max={3} step={0.05}
              onChange={(v) => setParams({ ...params, k1: v })} />
            <Slider label="b — length normalisation" value={params.b} min={0} max={1} step={0.05}
              onChange={(v) => setParams({ ...params, b: v })} />
            <Slider label="max clauses per expansion" value={maxClauses} min={1} max={256}
              onChange={setMaxClauses} />
            <Segmented label="default operator" value={defaultOperator} onChange={setDefaultOperator}
              options={[{ value: "or", label: "OR" }, { value: "and", label: "AND" }]} />
            <Segmented label="bare terms search" value={defaultFields} onChange={setDefaultFields}
              options={[
                { value: "both", label: "title + body" },
                { value: "title", label: "title" },
                { value: "body", label: "body" },
              ]} />
          </div>

          <StatRow>
            <Stat label="hits" value={result.hits.length} tone="accent" />
            <Stat label="candidates" value={result.totalCandidates} />
            <Stat label="took" value={formatNumber(result.tookMicros / 1000, 2)} unit="ms" />
            <Stat label="corpus" value={index.numDocs} unit="docs" />
          </StatRow>
        </Stack>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Panel title="Results" subtitle={`${result.hits.length} of ${result.totalCandidates} matching document(s)`}>
          {result.hits.length === 0 ? (
            <EmptyState>
              No documents matched. If the term is not in the dictionary there are no postings — and with no
              postings there are no candidates to score.
            </EmptyState>
          ) : (
            <div className="space-y-2">
              {result.hits.map((hit, i) => {
                const source = index.source(hit.docId)!;
                const isOpen = expanded === hit.docId;
                return (
                  <div key={hit.docId} className="rounded-lg border border-edge bg-raised">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : hit.docId)}
                      className="w-full px-3 py-2 text-left"
                    >
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-mono text-[11px] tabular-nums text-faint">{i + 1}</span>
                        <span className="font-mono text-[12.5px] font-semibold tabular-nums text-accent-text">
                          {formatNumber(hit.score, 4)}
                        </span>
                        <span className="text-[13px] font-medium text-ink">{source.title}</span>
                        <Badge tone={source.status === "published" ? "ok" : source.status === "draft" ? "warn" : "neutral"}>
                          {source.status}
                        </Badge>
                        <span className="ml-auto font-mono text-[10.5px] text-faint">
                          {isOpen ? "▾ hide explain" : "▸ explain"}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted">{source.body}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {hit.matchedTerms?.slice(0, 8).map((t) => (
                          <Badge key={t} tone="accent">{t}</Badge>
                        ))}
                        {source.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
                      </div>
                    </button>
                    {isOpen && hit.explanation && (
                      <div className="border-t border-edge bg-sunken px-3 py-2">
                        <ExplainTree node={hit.explanation} />
                        <div className="mt-2">
                          <KeyValue
                            items={[
                              { key: "docId", value: hit.docId },
                              { key: "title length", value: index.fieldLength("title", hit.docId) },
                              { key: "body length", value: index.fieldLength("body", hit.docId) },
                              { key: "price", value: source.price },
                              { key: "rating", value: source.rating },
                            ]}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Stack gap={4}>
          <Panel title="Under the hood" dense>
            <Tabs
              tabs={[
                { id: "plan", label: "Plan" },
                { id: "ast", label: "AST" },
                { id: "terms", label: "Terms" },
                { id: "stats", label: "Work" },
              ]}
            >
              <TabPanel id="plan">
                <p className="mb-2 text-[12px] leading-relaxed text-muted">
                  The scorer tree the query compiled to. Clause order inside an AND is by cost — cheapest
                  drives.
                </p>
                <PlanTree node={result.plan} />
              </TabPanel>

              <TabPanel id="ast">
                <p className="mb-2 font-mono text-[12px] text-accent-text">{describeQuery(parsed.query)}</p>
                <pre className="scroll-x rounded-lg border border-edge bg-code p-2.5 font-mono text-[11px] leading-relaxed text-muted">
                  {JSON.stringify(parsed.query, null, 2)}
                </pre>
              </TabPanel>

              <TabPanel id="terms">
                {result.resolvedTerms.length === 0 ? (
                  <EmptyState>No terms were resolved.</EmptyState>
                ) : (
                  <Table head={["field", "term", "df"]} dense>
                    {result.resolvedTerms.map((t) => (
                      <Tr key={`${t.field}:${t.term}`}>
                        <Td mono tone="muted">{t.field}</Td>
                        <Td mono>{t.term}</Td>
                        <Td mono align="right" tone={t.docFreq === 0 ? "bad" : undefined}>
                          {t.docFreq === 0 ? "not in dictionary" : t.docFreq}
                        </Td>
                      </Tr>
                    ))}
                  </Table>
                )}
                {result.expansions.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {result.expansions.map((expansion, i) => (
                      <div key={i} className="rounded-lg border border-edge bg-sunken p-2.5">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <Mono>{expansion.query}</Mono>
                          <Badge tone={expansion.clipped ? "bad" : "neutral"}>
                            {expansion.terms.length}
                            {expansion.clipped && ` of ${expansion.totalBeforeClip}`}
                          </Badge>
                          <Badge tone="neutral">{expansion.work} work</Badge>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {expansion.terms.slice(0, 20).map((t) => <Badge key={t} tone="accent">{t}</Badge>)}
                        </div>
                        <p className="mt-1.5 text-[11px] leading-relaxed text-faint">{expansion.method}</p>
                        {expansion.note && (
                          <p className="mt-1 text-[11px] leading-relaxed text-warn">{expansion.note}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </TabPanel>

              <TabPanel id="stats">
                <KeyValue
                  items={[
                    { key: "term lookups", value: result.stats.termLookups },
                    { key: "postings entries read", value: result.stats.postingsRead },
                    { key: "advance (skip) calls", value: result.stats.advanceCalls },
                    { key: "documents visited", value: result.stats.docsVisited },
                    { key: "documents scored", value: result.stats.docsScored },
                    { key: "documents skipped", value: result.stats.docsSkipped },
                    { key: "position checks", value: result.stats.positionChecks },
                    { key: "terms expanded", value: result.stats.termsExpanded },
                    { key: "clauses dropped by the cap", value: result.stats.expansionsClipped },
                    { key: "point comparisons", value: result.stats.pointNodesVisited },
                    { key: "heap: pushed", value: result.heapStats.pushed },
                    { key: "heap: replaced", value: result.heapStats.replaced },
                    { key: "heap: discarded", value: result.heapStats.discarded },
                  ]}
                />
                <div className="mt-3">
                  <div className="mb-1 text-[11px] uppercase tracking-wider text-faint">
                    Documents scored vs corpus
                  </div>
                  <Bar
                    value={result.stats.docsScored}
                    max={index.numDocs}
                    tone={result.stats.docsScored > index.numDocs * 0.7 ? "warn" : "ok"}
                    label={`${result.stats.docsScored} / ${index.numDocs}`}
                    width={200}
                  />
                </div>
              </TabPanel>
            </Tabs>
          </Panel>

          <Panel title="Query syntax" dense tone="sunken">
            <div className="space-y-1 font-mono text-[11.5px] leading-relaxed">
              {[
                ["term", "bare term against the default fields"],
                ["field:term", "restrict to one field"],
                ['"a b"', "phrase — needs positions"],
                ['"a b"~2', "sloppy phrase"],
                ["term~", "fuzzy, AUTO edits"],
                ["term~1", "fuzzy, exactly one edit"],
                ["pre*", "prefix"],
                ["te?m", "wildcard"],
                ["/reg.*ex/", "regular expression"],
                ["price:[100 TO 200]", "inclusive range"],
                ["price:{100 TO 200}", "exclusive range"],
                ["rating:>=4.5", "open-ended range"],
                ["a AND b", "both required"],
                ["a OR b", "either"],
                ["-b", "exclude"],
                ["+a", "require"],
                ["term^3", "boost"],
                ["(a OR b) AND c", "grouping"],
              ].map(([syntax, meaning]) => (
                <div key={syntax} className="flex gap-2">
                  <code className="w-[150px] shrink-0 text-accent-text">{syntax}</code>
                  <span className="text-faint">{meaning}</span>
                </div>
              ))}
            </div>
          </Panel>
        </Stack>
      </div>

      <Panel title="What each example teaches" tone="sunken">
        <Table head={["query", "what to watch"]}>
          {EXAMPLE_QUERIES.map((example) => (
            <Tr key={example.query} highlight={example.query === queryText}>
              <Td mono>
                <button type="button" onClick={() => setQueryText(example.query)} className="text-accent-text hover:underline">
                  {example.query}
                </button>
              </Td>
              <Td tone="muted">{example.teaches}</Td>
            </Tr>
          ))}
        </Table>
      </Panel>
    </Stack>
  );
}
