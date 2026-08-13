"use client";

import { useMemo, useState } from "react";
import {
  Cluster, compareShardedToGlobal, hashKey, routeToShard, ROUTING_STRATEGIES,
} from "@/lib/seeker/cluster";
import { buildEngine } from "@/lib/seeker/segments";
import { rescore } from "@/lib/seeker/planner";
import { CORPUS } from "@/lib/seeker/corpus";
import type { Query } from "@/lib/seeker/query";
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
  Segmented,
  Select,
  Slider,
  Stack,
  Stat,
  StatRow,
  Table,
  Td,
  TextInput,
  Tr,
  formatBytes,
  formatNumber,
  percent,
} from "@/components/ui";

const DEMO_QUERY: Query = { kind: "match", field: "title", text: "kubernetes deployment" };

function useCluster(shardCount: number, replicaCount: number, nodeCount: number, routingKey?: (i: number) => string) {
  return useMemo(() => {
    const cluster = new Cluster({ shardCount, replicaCount, nodeCount });
    CORPUS.forEach((doc, i) => cluster.index(doc, routingKey?.(i)));
    cluster.refreshAll();
    cluster.commitAll();
    return cluster;
  }, [shardCount, replicaCount, nodeCount, routingKey]);
}

// ===========================================================================
// Chapter 31 — shards
// ===========================================================================

export function Ch31() {
  const [shardCount, setShardCount] = useState(3);
  const [queryText, setQueryText] = useState("kubernetes deployment");

  const cluster = useCluster(shardCount, 0, Math.max(shardCount, 3));
  const single = useMemo(() => buildEngine(CORPUS), []);

  const query: Query = useMemo(
    () => ({ kind: "match", field: "title", text: queryText }),
    [queryText],
  );

  const distributed = useMemo(() => cluster.search(query, { topK: 10 }), [cluster, query]);
  const global = useMemo(() => single.search(query, { topK: 10 }), [single, query]);
  const skew = useMemo(
    () => compareShardedToGlobal(distributed.hits, global.hits),
    [distributed, global],
  );

  const distribution = cluster.distribution();

  return (
    <Stack gap={4}>
      <Panel
        title="Each shard is a complete search index over part of the data"
        subtitle="Nothing new is invented. The same engine runs several times, and coordination becomes the hard part."
        actions={<Slider label="shards" value={shardCount} min={1} max={8} onChange={setShardCount} />}
      >
        <Stack gap={4}>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {distribution.map((shard) => (
              <div key={shard.shard} className="rounded-lg border border-edge bg-raised p-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[12.5px] font-semibold text-ink">shard {shard.shard}</span>
                  <span className="font-mono text-[11px] text-faint">
                    {cluster.shards[shard.shard].segmentCount} segment(s)
                  </span>
                </div>
                <div className="mt-1">
                  <Bar
                    value={shard.documents}
                    max={Math.max(...distribution.map((d) => d.documents), 1)}
                    tone="accent"
                    label={`${shard.documents} docs`}
                    width={140}
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-0.5">
                  {CORPUS.filter((doc) => routeToShard(doc.id, shardCount) === shard.shard)
                    .slice(0, 12)
                    .map((doc) => (
                      <span key={doc.id} className="rounded bg-sunken px-1 py-0.5 font-mono text-[9.5px] text-muted">
                        {doc.id}
                      </span>
                    ))}
                </div>
              </div>
            ))}
          </div>

          <StatRow>
            <Stat label="documents" value={CORPUS.length} />
            <Stat label="shards queried per request" value={distributed.shardsQueried} tone="accent"
              hint="Fan-out: every shard must answer before the coordinator can merge" />
            <Stat label="shard skew" value={formatNumber(cluster.skew(), 3)}
              tone={cluster.skew() > 0.3 ? "warn" : "ok"}
              hint="Coefficient of variation across shard sizes. Zero is perfectly even." />
            <Stat label="segments across the cluster"
              value={cluster.shards.reduce((s, e) => s + e.segmentCount, 0)} />
          </StatRow>
        </Stack>
      </Panel>

      <Panel title="What sharding gives, and what it charges" tone="sunken">
        <Grid cols={2}>
          <div className="rounded-lg border border-transparent bg-ok-soft p-3">
            <div className="mb-2 text-[12px] font-semibold text-ink">Gives</div>
            <ul className="space-y-1 text-[12px] text-muted">
              {["more total storage than one machine", "parallel indexing", "parallel search", "failure isolation"].map((x) => (
                <li key={x} className="flex gap-2"><span className="text-ok">+</span>{x}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-transparent bg-bad-soft p-3">
            <div className="mb-2 text-[12px] font-semibold text-ink">Charges</div>
            <ul className="space-y-1 text-[12px] text-muted">
              {["fan-out on every request", "coordination and a global merge", "more caches, each colder", "more segment sets to merge", "more cluster metadata"].map((x) => (
                <li key={x} className="flex gap-2"><span className="text-bad">−</span>{x}</li>
              ))}
            </ul>
          </div>
        </Grid>
      </Panel>

      <Panel
        title="Each shard scores with its own statistics"
        subtitle="IDF depends on N and df. Split the corpus and every shard has different ones — so the same document can rank differently."
      >
        <Stack gap={3}>
          <TextInput label="Query" value={queryText} onChange={setQueryText} />

          <StatRow>
            <Stat label="rank changes vs one shard" value={skew.rankChanges}
              tone={skew.rankChanges > 0 ? "warn" : "ok"} />
            <Stat label="largest rank move" value={skew.maxDelta} tone={skew.maxDelta > 1 ? "warn" : "ok"} />
            <Stat label="documents compared" value={skew.rows.length} />
            <Stat label="shards" value={shardCount} />
          </StatRow>

          {skew.rows.length === 0 ? (
            <EmptyState>No matches to compare.</EmptyState>
          ) : (
            <Table head={["document", "shard", "sharded score", "sharded rank", "single-shard score", "rank"]}>
              {skew.rows.map((row) => (
                <Tr key={row.docKey} highlight={row.rankDelta !== 0}>
                  <Td mono>{row.docKey}</Td>
                  <Td mono tone="muted">{row.shard}</Td>
                  <Td mono align="right" tone="accent">{formatNumber(row.shardedScore, 4)}</Td>
                  <Td mono align="right">{row.shardedRank + 1}</Td>
                  <Td mono align="right" tone="muted">{formatNumber(row.globalScore, 4)}</Td>
                  <Td mono align="right" tone={row.rankDelta !== 0 ? "warn" : "muted"}>
                    {row.globalRank + 1}{row.rankDelta !== 0 && ` (${row.rankDelta > 0 ? "+" : ""}${row.rankDelta})`}
                  </Td>
                </Tr>
              ))}
            </Table>
          )}

          <Callout tone={skew.rankChanges > 0 ? "warn" : "info"} title="Why this happens">
            A shard computes <Mono>idf = ln(1 + (N − df + 0.5)/(df + 0.5))</Mono> from{" "}
            <em>its own</em> N and df. With {CORPUS.length} documents across {shardCount} shards, those numbers
            differ enough to move results. At millions of documents the shards look statistically alike and
            nobody notices — which is exactly why this bites on small indexes and test environments.
          </Callout>
        </Stack>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 32 — replicas
// ===========================================================================

export function Ch32() {
  const [replicaCount, setReplicaCount] = useState(1);
  const [shardCount] = useState(3);
  const [nodeCount] = useState(4);
  const [, force] = useState(0);

  const cluster = useCluster(shardCount, replicaCount, nodeCount);
  const state = cluster.clusterState();
  const result = cluster.search(DEMO_QUERY, { topK: 10 });

  const rerender = () => force((n) => n + 1);

  return (
    <Stack gap={4}>
      <Panel
        title="Sharding splits data. Replication copies it."
        subtitle="Different problems, different costs. Kill a node and watch which one you needed."
        actions={
          <div className="flex flex-wrap gap-2">
            <Slider label="replicas per shard" value={replicaCount} min={0} max={2} onChange={setReplicaCount} />
          </div>
        }
      >
        <Stack gap={4}>
          <StatRow>
            <Stat label="cluster health" value={state.health}
              tone={state.health === "green" ? "ok" : state.health === "yellow" ? "warn" : "bad"} />
            <Stat label="shard copies" value={cluster.copies.length} />
            <Stat label="unassigned" value={state.unassigned} tone={state.unassigned > 0 ? "warn" : "ok"} />
            <Stat label="storage multiplier" value={`${1 + replicaCount}×`}
              tone={replicaCount > 1 ? "warn" : "default"} />
          </StatRow>

          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {cluster.nodes.map((node) => (
              <div
                key={node.id}
                className={`rounded-lg border p-3 ${
                  node.state === "up" ? "border-edge bg-raised" : "border-transparent bg-bad-soft opacity-70"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[12.5px] font-semibold text-ink">{node.id}</span>
                  <Badge tone={node.state === "up" ? "ok" : "bad"}>{node.state}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {cluster.copies.filter((c) => c.nodeId === node.id).map((copy, i) => (
                    <Badge key={i} tone={copy.primary ? "accent" : "info"}>
                      {copy.primary ? "P" : "R"}{copy.shard}
                    </Badge>
                  ))}
                  {cluster.copies.filter((c) => c.nodeId === node.id).length === 0 && (
                    <span className="text-[11px] text-faint">no copies</span>
                  )}
                </div>
                <div className="mt-2">
                  <Button
                    size="sm"
                    tone={node.state === "up" ? "danger" : "default"}
                    onClick={() => {
                      if (node.state === "up") cluster.failNode(node.id);
                      else cluster.reviveNode(node.id);
                      rerender();
                    }}
                  >
                    {node.state === "up" ? "kill node" : "bring back"}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wider text-faint">Shards</div>
            <Table head={["shard", "documents", "copies", "searchable"]} dense>
              {state.shards.map((shard) => {
                const started = shard.copies.filter((c) => c.state === "started");
                return (
                  <Tr key={shard.shard}>
                    <Td mono>{shard.shard}</Td>
                    <Td mono align="right">{shard.documents}</Td>
                    <Td>
                      <div className="flex gap-1">
                        {shard.copies.map((copy, i) => (
                          <Badge key={i} tone={copy.state === "started" ? (copy.primary ? "accent" : "info") : "bad"}>
                            {copy.primary ? "primary" : "replica"} {copy.nodeId ?? "unassigned"}
                          </Badge>
                        ))}
                      </div>
                    </Td>
                    <Td align="center" tone={started.length > 0 ? "ok" : "bad"}>
                      {started.length > 0 ? "yes" : "no — results will be partial"}
                    </Td>
                  </Tr>
                );
              })}
            </Table>
          </div>

          {result.partial ? (
            <Callout tone="bad" title={`${result.shardsFailed} shard(s) could not answer`}>
              The response is incomplete. This is the failure mode worth surfacing loudly: a search that
              silently returns fewer results looks like a relevance problem and is actually an availability one.
            </Callout>
          ) : (
            <Callout tone="ok" title="Every shard answered">
              {replicaCount === 0
                ? "With no replicas this only holds while every node is alive. Kill one and see."
                : `Each shard has ${replicaCount + 1} copies, so the cluster survives losing a node.`}
            </Callout>
          )}
        </Stack>
      </Panel>

      <Panel title="What replicas are for" tone="sunken">
        <Grid cols={2}>
          <div className="rounded-lg border border-transparent bg-ok-soft p-3">
            <div className="mb-2 text-[12px] font-semibold text-ink">Benefits</div>
            <ul className="space-y-1 text-[12px] text-muted">
              {["failure tolerance — a copy survives", "read capacity — any copy can serve a search", "maintenance without downtime"].map((x) => (
                <li key={x} className="flex gap-2"><span className="text-ok">+</span>{x}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-transparent bg-bad-soft p-3">
            <div className="mb-2 text-[12px] font-semibold text-ink">Costs</div>
            <ul className="space-y-1 text-[12px] text-muted">
              {[`disk — ${1 + replicaCount}× the data`, "replication traffic on every write", "indexing work repeated per copy", "more cluster state to agree on"].map((x) => (
                <li key={x} className="flex gap-2"><span className="text-bad">−</span>{x}</li>
              ))}
            </ul>
          </div>
        </Grid>
      </Panel>

      <Panel title="Cluster events">
        <div className="max-h-[200px] overflow-y-auto rounded-lg border border-edge bg-code p-2">
          {cluster.events.length === 0 ? (
            <p className="p-2 text-[12px] text-faint">Nothing has happened. Kill a node.</p>
          ) : (
            <ul className="space-y-0.5 font-mono text-[11px]">
              {cluster.events.map((event, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-8 shrink-0 text-right text-faint">{event.tick}</span>
                  <span className={`w-14 shrink-0 ${event.kind === "fail" ? "text-bad" : event.kind === "promote" ? "text-ok" : "text-muted"}`}>
                    {event.kind}
                  </span>
                  <span className="text-muted">{event.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 33 — distributed query and fetch
// ===========================================================================

export function Ch33() {
  const [shardCount, setShardCount] = useState(3);
  const [topK, setTopK] = useState(3);
  const [queryText, setQueryText] = useState("kubernetes deployment");

  const cluster = useCluster(shardCount, 1, Math.max(3, shardCount));
  const query: Query = useMemo(() => ({ kind: "match", field: "title", text: queryText }), [queryText]);
  const result = useMemo(() => cluster.search(query, { topK }), [cluster, query, topK]);

  return (
    <Stack gap={4}>
      <Panel
        title="Two phases, on purpose"
        subtitle="Scoring thousands of candidates does not require fetching thousands of documents."
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextInput label="Query" value={queryText} onChange={setQueryText} />
            <Slider label="shards" value={shardCount} min={1} max={6} onChange={setShardCount} />
            <Slider label="top K" value={topK} min={1} max={10} onChange={setTopK} />
          </div>

          {/* Phase 1 */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge tone="accent">phase 1</Badge>
              <span className="text-[12.5px] font-semibold text-ink">Query — every shard returns ids and scores only</span>
            </div>
            <Table head={["shard", "served by", "documents", "candidates considered", `top ${topK} returned`]} dense>
              {result.queryPhase.map((shard) => (
                <Tr key={shard.shard}>
                  <Td mono>{shard.shard}</Td>
                  <Td mono tone="muted">{shard.servedBy ?? "—"}</Td>
                  <Td mono align="right" tone="muted">{shard.docCount}</Td>
                  <Td mono align="right">{shard.candidatesConsidered}</Td>
                  <Td mono tone="accent">
                    {shard.failed ? "failed" : shard.candidates.map((c) => `${c.docKey}:${formatNumber(c.score, 2)}`).join("  ") || "—"}
                  </Td>
                </Tr>
              ))}
            </Table>
          </div>

          <div className="text-center font-mono text-[11px] text-faint">
            ↓ coordinator merges {result.queryPhase.reduce((s, r) => s + r.candidates.length, 0)} candidates into {topK}
          </div>

          {/* Phase 2 */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge tone="ok">phase 2</Badge>
              <span className="text-[12.5px] font-semibold text-ink">Fetch — only the winners, only from the shards that own them</span>
            </div>
            {result.fetchPhase.length === 0 ? (
              <EmptyState>Nothing to fetch.</EmptyState>
            ) : (
              <Table head={["shard", "documents fetched", "bytes"]} dense>
                {result.fetchPhase.map((f) => (
                  <Tr key={f.shard}>
                    <Td mono>{f.shard}</Td>
                    <Td mono tone="accent">{f.docKeys.join(", ")}</Td>
                    <Td mono align="right">{formatBytes(f.bytes)}</Td>
                  </Tr>
                ))}
              </Table>
            )}
            <p className="mt-2 text-[12px] text-faint">
              Shards that proposed candidates but won nothing are never asked for a document body at all.
            </p>
          </div>

          <StatRow>
            <Stat label="query phase bytes" value={formatBytes(result.queryPhaseBytes)} tone="ok"
              hint="An id and a float per candidate" />
            <Stat label="fetch phase bytes" value={formatBytes(result.bytesActuallyFetched)} tone="accent" />
            <Stat label="if we fetched every candidate" value={formatBytes(result.bytesIfFetchedEverything)} tone="bad" />
            <Stat
              label="saved"
              value={percent(1 - result.bytesActuallyFetched / Math.max(1, result.bytesIfFetchedEverything), 0)}
              tone="ok"
            />
          </StatRow>

          <Callout tone="accent" title="Why not one round trip?">
            Because every shard has to propose K candidates for the merge to be correct, but only K documents
            survive across the whole cluster. Fetching bodies during the query phase means moving{" "}
            {formatBytes(result.bytesIfFetchedEverything)} to return{" "}
            {formatBytes(result.bytesActuallyFetched)}. The second round trip costs latency and saves bandwidth,
            and bandwidth is what runs out first when documents are large.
          </Callout>
        </Stack>
      </Panel>

      <Panel title="Final results" tone="sunken">
        {result.hits.length === 0 ? (
          <EmptyState>No matches.</EmptyState>
        ) : (
          <Table head={["#", "score", "document", "shard", "served by"]}>
            {result.hits.map((hit, i) => (
              <Tr key={hit.docKey}>
                <Td mono tone="muted">{i + 1}</Td>
                <Td mono tone="accent">{formatNumber(hit.score, 4)}</Td>
                <Td>{hit.source.title}</Td>
                <Td mono tone="muted">{hit.shard}</Td>
                <Td mono tone="muted">{hit.servedBy}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 34 — routing and rescoring
// ===========================================================================

type RoutingMode = "docid" | "author" | "constant";

export function Ch34() {
  const [mode, setMode] = useState<RoutingMode>("docid");
  const [shardCount, setShardCount] = useState(4);
  const [routeTo, setRouteTo] = useState<string>("");
  const [windowSize, setWindowSize] = useState(8);

  const routingKey = useMemo(() => {
    if (mode === "docid") return undefined;
    if (mode === "author") return (i: number) => CORPUS[i].author;
    return () => "same-key";
  }, [mode]);

  const cluster = useCluster(shardCount, 0, Math.max(3, shardCount), routingKey);
  const distribution = cluster.distribution();

  const unrouted = useMemo(() => cluster.search(DEMO_QUERY, { topK: 5 }), [cluster]);
  const routed = useMemo(
    () => (routeTo ? cluster.search(DEMO_QUERY, { topK: 5, routing: routeTo }) : null),
    [cluster, routeTo],
  );

  // Rescoring: cheap BM25 first, expensive "rating-aware" scorer second.
  const single = useMemo(() => buildEngine(CORPUS), []);
  const rescoreDemo = useMemo(() => {
    const base = single.search(DEMO_QUERY, { topK: 100 });
    const candidates = base.hits.map((h, i) => ({ docId: i, cheapScore: h.score, key: h.docKey }));
    const keyOf = new Map(candidates.map((c) => [c.docId, c.key]));
    const result = rescore(
      candidates,
      windowSize,
      (docId, cheapScore) => {
        const key = keyOf.get(docId);
        const doc = CORPUS.find((d) => d.id === key);
        return cheapScore * (1 + (doc?.rating ?? 0) / 3);
      },
      5,
    );
    return { result, keyOf, total: candidates.length };
  }, [single, windowSize]);

  return (
    <Stack gap={4}>
      <Panel
        title="Routing decides fan-out"
        subtitle="Hash a key, pick a shard. Choose the key well and one query touches one shard; choose it badly and one shard holds everything."
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Segmented
              label="Routing key"
              value={mode}
              onChange={(m) => { setMode(m); setRouteTo(""); }}
              options={[
                { value: "docid", label: "document id" },
                { value: "author", label: "author" },
                { value: "constant", label: "constant" },
              ]}
            />
            <Slider label="shards" value={shardCount} min={2} max={8} onChange={setShardCount} />
          </div>

          <div className="flex flex-wrap items-end gap-2">
            {distribution.map((shard) => (
              <div key={shard.shard} className="flex flex-col items-center gap-1">
                <div
                  className="w-14 rounded-t bg-[var(--accent)] transition-all"
                  style={{
                    height: Math.max(4, (shard.documents / Math.max(1, CORPUS.length)) * 140),
                    opacity: shard.documents === 0 ? 0.2 : 1,
                  }}
                />
                <span className="font-mono text-[11px] text-muted">s{shard.shard}</span>
                <span className="font-mono text-[10.5px] text-faint">{shard.documents}</span>
              </div>
            ))}
          </div>

          <StatRow>
            <Stat label="shard skew" value={formatNumber(cluster.skew(), 3)}
              tone={cluster.skew() > 0.5 ? "bad" : cluster.skew() > 0.2 ? "warn" : "ok"} />
            <Stat label="empty shards" value={distribution.filter((d) => d.documents === 0).length}
              tone={distribution.some((d) => d.documents === 0) ? "bad" : "ok"} />
            <Stat label="largest shard" value={Math.max(...distribution.map((d) => d.documents))} />
            <Stat label="smallest shard" value={Math.min(...distribution.map((d) => d.documents))} />
          </StatRow>

          {mode === "constant" && (
            <Callout tone="bad" title="This is the hot-shard failure mode">
              Every document hashed to the same value, so one shard holds the entire index while the rest idle.
              Adding nodes does nothing: the data has nowhere to spread to.
            </Callout>
          )}

          {mode === "author" && (
            <Stack gap={3}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Route a query to one author's shard"
                  value={routeTo}
                  onChange={setRouteTo}
                  options={[
                    { value: "", label: "no routing — ask every shard" },
                    ...[...new Set(CORPUS.map((d) => d.author))].map((a) => ({
                      value: a, label: `${a} → shard ${routeToShard(a, shardCount)}`,
                    })),
                  ]}
                />
                <KeyValue
                  items={[
                    { key: "shards queried without routing", value: unrouted.shardsQueried },
                    { key: "shards queried with routing", value: routed?.shardsQueried ?? "—" },
                    { key: "hash", value: routeTo ? hashKey(routeTo) : "—" },
                  ]}
                />
              </div>
              {routed && (
                <Callout tone="ok" title={`Fan-out dropped from ${unrouted.shardsQueried} to ${routed.shardsQueried}`}>
                  A routed query reaches only the shard that can possibly hold the answer. It also returns only
                  that shard&apos;s documents — routing is a correctness decision, not just a performance one.
                </Callout>
              )}
            </Stack>
          )}

          <Table head={["strategy", "good", "bad"]}>
            {ROUTING_STRATEGIES.map((row) => (
              <Tr key={row.name} highlight={
                (mode === "docid" && row.name === "document id") ||
                (mode === "author" && row.name.startsWith("tenant")) ||
                (mode === "constant" && row.name === "constant")
              }>
                <Td mono>{row.name}</Td>
                <Td tone="ok">{row.good}</Td>
                <Td tone="bad">{row.bad}</Td>
              </Tr>
            ))}
          </Table>
        </Stack>
      </Panel>

      <Panel
        title="Rescoring — expensive logic, only where it can change the answer"
        subtitle="Cheap retrieval produces a window. The expensive scorer runs inside it. What it never sees, it cannot promote."
        tone="sunken"
      >
        <Stack gap={4}>
          <Slider
            label="rescore window"
            value={windowSize}
            min={1}
            max={Math.max(1, rescoreDemo.total)}
            onChange={setWindowSize}
            format={(v) => `top ${v} of ${rescoreDemo.total}`}
          />

          <pre className="rounded-lg border border-edge bg-code p-3 font-mono text-[11.5px] leading-relaxed text-muted">
{`cheap retrieval  →  top ${windowSize}  →  expensive scorer  →  top 5`}
          </pre>

          <StatRow>
            <Stat label="candidates" value={rescoreDemo.total} />
            <Stat label="expensive evaluations" value={rescoreDemo.result.expensiveEvaluations} tone="accent" />
            <Stat label="evaluations avoided" value={rescoreDemo.result.evaluationsAvoided} tone="ok" />
            <Stat label="promotions missed" value={rescoreDemo.result.missedPromotions.length}
              tone={rescoreDemo.result.missedPromotions.length > 0 ? "bad" : "ok"} />
          </StatRow>

          <Table head={["#", "document", "cheap score", "rescored"]}>
            {rescoreDemo.result.secondPass.map((row, i) => (
              <Tr key={row.docId}>
                <Td mono tone="muted">{i + 1}</Td>
                <Td>{CORPUS.find((d) => d.id === rescoreDemo.keyOf.get(row.docId))?.title}</Td>
                <Td mono align="right" tone="muted">{formatNumber(row.cheapScore, 3)}</Td>
                <Td mono align="right" tone="accent">{formatNumber(row.score, 3)}</Td>
              </Tr>
            ))}
          </Table>

          {rescoreDemo.result.missedPromotions.length > 0 && (
            <Callout tone="bad" title="What the window cost">
              {rescoreDemo.result.missedPromotions.length} document(s) belonged in the final top 5 and never
              entered the window. Widen the window and they appear — along with the extra work.
            </Callout>
          )}
        </Stack>
      </Panel>
    </Stack>
  );
}
