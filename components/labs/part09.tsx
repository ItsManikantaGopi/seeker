"use client";

import { useMemo, useState } from "react";
import {
  compareJoinOrders, exhaustiveTopK, rescore, wandTermFromPostings, wandTopK, type WandTerm,
} from "@/lib/kaus/planner";
import { bm25, LUCENE_DEFAULTS } from "@/lib/kaus/bm25";
import { analyzeCacheability, CACHE_LAYERS, LruCache } from "@/lib/kaus/cache";
import {
  CONCURRENCY_TRADEOFFS, DEFAULT_POOL, makeRequestStream, simulatePool, type PoolConfig,
} from "@/lib/kaus/concurrency";
import { compileScript, SCRIPT_EXAMPLES, SCRIPT_FUNCTIONS, SCRIPT_VARIABLES } from "@/lib/kaus/script";
import { summarise } from "@/lib/kaus/observability";
import { pick, randomSequence } from "@/lib/kaus/random";
import { demoContext, demoIndex } from "@/lib/demo";
import { collectAll, search, type Query } from "@/lib/kaus/query";
import { analyzeToTerms, DEFAULT_ANALYZER } from "@/lib/kaus/analyzer";
import {
  Badge,
  Bar,
  Button,
  Callout,
  Grid,
  KeyValue,
  Panel,
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

// ===========================================================================
// Chapter 27 — query planning
// ===========================================================================

export function Ch27() {
  const index = demoIndex();
  const context = demoContext();
  const [queryText, setQueryText] = useState("kubernetes deployment service cluster");
  const [topK, setTopK] = useState(5);

  const clauses = useMemo(() => {
    const terms = analyzeToTerms(queryText, DEFAULT_ANALYZER);
    return terms
      .map((term) => ({
        label: term,
        docIds: (index.postings("body", term) ?? index.postings("title", term) ?? []).map((p) => p.docId),
      }))
      .filter((c) => c.docIds.length > 0);
  }, [queryText, index]);

  const orders = useMemo(
    () => (clauses.length >= 2 ? compareJoinOrders(clauses) : []),
    [clauses],
  );

  const wandTerms = useMemo<WandTerm[]>(() => {
    const terms = analyzeToTerms(queryText, DEFAULT_ANALYZER);
    const avgdl = index.avgFieldLength("body");
    return terms
      .map((term) => {
        const postings = index.postings("body", term) ?? [];
        const df = postings.length;
        return wandTermFromPostings(term, postings, (posting) =>
          bm25({
            tf: posting.freq,
            fieldLength: index.fieldLength("body", posting.docId),
            avgFieldLength: avgdl,
            numDocs: index.numDocs,
            docFreq: df,
            params: LUCENE_DEFAULTS,
          }).score,
        );
      })
      .filter((t) => t.entries.length > 0);
  }, [queryText, index]);

  const exhaustive = useMemo(() => exhaustiveTopK(wandTerms, topK), [wandTerms, topK]);
  const wand = useMemo(() => wandTopK(wandTerms, topK), [wandTerms, topK]);
  const identical = useMemo(
    () => exhaustive.hits.map((h) => `${h.docId}:${h.score.toFixed(9)}`).join("|") ===
      wand.hits.map((h) => `${h.docId}:${h.score.toFixed(9)}`).join("|"),
    [exhaustive, wand],
  );

  const executed = useMemo(
    () => search(context, { kind: "match", field: "body", text: queryText }, { topK }),
    [context, queryText, topK],
  );

  return (
    <Stack gap={4}>
      <Panel
        title="Drive from the cheapest clause"
        subtitle="A conjunction cannot match more often than its rarest term. Walking that term and probing the others is the entire plan."
      >
        <Stack gap={4}>
          <TextInput label="Query terms" value={queryText} onChange={setQueryText} />

          <Table head={["term", "postings", ""]} dense>
            {clauses.map((clause) => (
              <Tr key={clause.label}>
                <Td mono>{clause.label}</Td>
                <Td mono align="right">{clause.docIds.length}</Td>
                <Td>
                  <Bar
                    value={clause.docIds.length}
                    max={Math.max(...clauses.map((c) => c.docIds.length), 1)}
                    tone={clause.docIds.length === Math.min(...clauses.map((c) => c.docIds.length)) ? "ok" : "muted"}
                    width={160}
                  />
                </Td>
              </Tr>
            ))}
          </Table>

          {orders.length === 2 && (
            <Grid cols={2}>
              {orders.map((order, i) => (
                <div
                  key={i}
                  className={`rounded-lg border p-3 ${i === 0 ? "border-transparent bg-ok-soft" : "border-transparent bg-bad-soft"}`}
                >
                  <div className="mb-2 text-[12px] font-semibold text-ink">
                    {i === 0 ? "Cheapest first" : "Most expensive first"}
                  </div>
                  <div className="mb-2 font-mono text-[11.5px] text-muted">
                    {order.order.join(" → ")}
                  </div>
                  <KeyValue
                    items={[
                      { key: "postings touched", value: order.work },
                      { key: "advance calls", value: order.advances },
                      { key: "matches", value: order.matches },
                    ]}
                  />
                </div>
              ))}
            </Grid>
          )}

          {orders.length === 2 && orders[1].work > orders[0].work && (
            <Callout tone="accent">
              Both orderings return the same {orders[0].matches} document(s). The bad order does{" "}
              {formatNumber(orders[1].work / Math.max(1, orders[0].work), 2)}× the work. On a clause with a
              thousand matches and one with ten million, this is the whole query.
            </Callout>
          )}
        </Stack>
      </Panel>

      <Panel
        title="Do not score what cannot win"
        subtitle="Once the heap holds K documents, anything whose best possible score is below the threshold can be skipped without being scored. That is WAND."
        tone="sunken"
      >
        <Stack gap={4}>
          <Slider label="top K" value={topK} min={1} max={20} onChange={setTopK} />

          <Table head={["term", "postings", "max possible contribution"]} dense>
            {wandTerms.map((t) => (
              <Tr key={t.term}>
                <Td mono>{t.term}</Td>
                <Td mono align="right">{t.entries.length}</Td>
                <Td>
                  <Bar value={t.maxScore} max={Math.max(...wandTerms.map((x) => x.maxScore), 0.001)}
                    tone="accent" label={formatNumber(t.maxScore, 3)} width={140} />
                </Td>
              </Tr>
            ))}
          </Table>

          <Grid cols={2}>
            <div className="rounded-lg border border-transparent bg-bad-soft p-3">
              <div className="mb-2 text-[12px] font-semibold text-ink">Score everything</div>
              <KeyValue items={[
                { key: "documents scored", value: exhaustive.fullEvaluations },
                { key: "postings touched", value: exhaustive.postingsTouched },
              ]} />
            </div>
            <div className="rounded-lg border border-transparent bg-ok-soft p-3">
              <div className="mb-2 text-[12px] font-semibold text-ink">WAND</div>
              <KeyValue items={[
                { key: "documents scored", value: wand.fullEvaluations },
                { key: "skips taken", value: wand.skipped },
                { key: "postings touched", value: wand.postingsTouched },
              ]} />
            </div>
          </Grid>

          <StatRow>
            <Stat
              label="scoring avoided"
              value={percent(1 - wand.fullEvaluations / Math.max(1, exhaustive.fullEvaluations), 0)}
              tone="ok"
            />
            <Stat label="same top-K" value={identical ? "yes" : "NO"} tone={identical ? "ok" : "bad"} />
            <Stat label="final threshold" value={formatNumber(wand.thresholdHistory[wand.thresholdHistory.length - 1] ?? 0, 3)} />
            <Stat label="heap discards (real engine)" value={executed.heapStats.discarded} />
          </StatRow>

          <Callout tone={identical ? "ok" : "bad"} title={identical ? "Identical results" : "Results differ"}>
            {identical
              ? "Pruning is only legitimate if it cannot change the answer. Both methods returned the same documents with the same scores — the fast one simply never computed the losers."
              : "The pruned version returned different results, which would make the optimisation a bug."}
          </Callout>
        </Stack>
      </Panel>

      <Panel title="The bounded heap" subtitle="Do not sort a million results to show twenty.">
        <Stack gap={3}>
          <pre className="rounded-lg border border-edge bg-code p-3 font-mono text-[11.5px] leading-relaxed text-muted">
{`candidate
   ↓
heap has fewer than K?  →  push
   ↓ no
score > current minimum?  →  replace the minimum
   ↓ no
discard`}
          </pre>
          <StatRow>
            <Stat label="pushed" value={executed.heapStats.pushed} />
            <Stat label="replaced" value={executed.heapStats.replaced} tone="accent" />
            <Stat label="discarded" value={executed.heapStats.discarded} />
            <Stat label="candidates" value={executed.totalCandidates} />
          </StatRow>
        </Stack>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 28 — caching
// ===========================================================================

const CACHE_QUERIES: { label: string; query: Query; cacheable: boolean }[] = [
  { label: "filter status:published", query: { kind: "term", field: "status", value: "published" }, cacheable: true },
  { label: "filter status:draft", query: { kind: "term", field: "status", value: "draft" }, cacheable: true },
  { label: "filter tags:kubernetes", query: { kind: "term", field: "tags", value: "kubernetes" }, cacheable: true },
  { label: "filter price 100-200", query: { kind: "range", field: "price", gte: 100, lte: 200 }, cacheable: true },
  { label: "filter rating >= 4.5", query: { kind: "range", field: "rating", gte: 4.5 }, cacheable: true },
  { label: "filter author:user_123", query: { kind: "term", field: "author", value: "user_123" }, cacheable: true },
  { label: "match kubernetes (scoring)", query: { kind: "match", field: "title", text: "kubernetes" }, cacheable: false },
  { label: "match deployment (scoring)", query: { kind: "match", field: "title", text: "deployment" }, cacheable: false },
];

export function Ch28() {
  const context = demoContext();
  const [capacity, setCapacity] = useState(3);
  const [requests, setRequests] = useState(40);
  const [skew, setSkew] = useState(70);

  const cache = useMemo(() => {
    const lru = new LruCache<number[]>(capacity, (v) => v.length * 4);
    const cacheable = CACHE_QUERIES.filter((q) => q.cacheable);
    // Two draws per request: one to decide hot vs cold, one to pick the query.
    const draws = randomSequence(987654321, requests * 2);

    for (let i = 0; i < requests; i++) {
      // `skew` controls how often the request hits the small hot set.
      const hot = draws[i * 2] * 100 < skew;
      const pool = hot ? cacheable.slice(0, 2) : cacheable;
      const chosen = pick(pool, draws[i * 2 + 1]);
      lru.getOrCompute(chosen.label, () => collectAll(context, chosen.query));
    }
    return lru;
  }, [context, capacity, requests, skew]);

  return (
    <Stack gap={4}>
      <Panel
        title="Hit rate alone will lie to you"
        subtitle="A cache that evicts as fast as it inserts still reports a respectable hit rate. Watch all four numbers together."
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Slider label="cache capacity" value={capacity} min={1} max={8} onChange={setCapacity}
              format={(v) => `${v} entries`} />
            <Slider label="requests" value={requests} min={10} max={200} step={10} onChange={setRequests} />
            <Slider label="traffic skew" value={skew} min={0} max={100} step={5} onChange={setSkew}
              format={(v) => `${v}% to the hot set`} />
          </div>

          <StatRow>
            <Stat label="hit rate" value={percent(cache.hitRate, 1)} tone={cache.hitRate > 0.5 ? "ok" : "warn"} />
            <Stat label="miss rate" value={percent(cache.missRate, 1)} />
            <Stat label="eviction rate" value={formatNumber(cache.evictionRate, 2)}
              tone={cache.evictionRate > 0.5 ? "bad" : "ok"}
              hint="Evictions per insert. Approaching 1 means the cache is churning." />
            <Stat label="memory held" value={formatBytes(cache.stats.bytes)} />
          </StatRow>

          <StatRow>
            <Stat label="lookups" value={cache.stats.lookups} />
            <Stat label="hits" value={cache.stats.hits} tone="ok" />
            <Stat label="inserts" value={cache.stats.inserts} />
            <Stat label="evictions" value={cache.stats.evictions} tone={cache.stats.evictions > cache.stats.inserts / 2 ? "bad" : "default"} />
          </StatRow>

          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wider text-faint">
              Currently cached, least recent first
            </div>
            <div className="flex flex-wrap gap-1">
              {cache.keys.length === 0
                ? <span className="text-[12px] text-faint">empty</span>
                : cache.keys.map((key, i) => (
                  <Badge key={key} tone={i === cache.keys.length - 1 ? "accent" : "neutral"}>{key}</Badge>
                ))}
            </div>
          </div>

          {cache.evictionRate > 0.6 ? (
            <Callout tone="bad" title="This cache is thrashing">
              Nearly every insert evicts something. The working set is larger than the cache, so entries are
              being thrown away before they are reused. Raise the capacity, or narrow the traffic.
            </Callout>
          ) : cache.hitRate > 0.6 ? (
            <Callout tone="ok" title="This cache is doing its job">
              A high hit rate with a low eviction rate means the hot set fits. That is the only combination
              worth the memory.
            </Callout>
          ) : (
            <Callout tone="warn" title="Marginal">
              The hit rate is not high enough to justify the memory yet. Either the traffic is too uniform to
              cache, or the cache is too small for its working set.
            </Callout>
          )}
        </Stack>
      </Panel>

      <Panel title="Recent cache events" tone="sunken">
        <div className="max-h-[200px] overflow-y-auto rounded-lg border border-edge bg-code p-2">
          <ul className="space-y-0.5 font-mono text-[11px]">
            {cache.events.slice(-40).map((event, i) => (
              <li key={i} className="flex gap-2">
                <span className={`w-12 shrink-0 ${
                  event.kind === "hit" ? "text-ok"
                    : event.kind === "miss" ? "text-warn"
                      : event.kind === "evict" ? "text-bad" : "text-muted"
                }`}>{event.kind}</span>
                <span className="text-muted">{event.key}</span>
                {event.victim && <span className="text-bad">evicted {event.victim}</span>}
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      <Panel title="The four layers" subtitle="Each one caches a different thing and is invalidated by a different event.">
        <Table head={["layer", "owner", "holds", "invalidated by"]}>
          {CACHE_LAYERS.map((layer) => (
            <Tr key={layer.name}>
              <Td mono>{layer.name}</Td>
              <Td tone="muted">{layer.owner}</Td>
              <Td tone="muted">{layer.holds}</Td>
              <Td tone="muted">{layer.invalidatedBy}</Td>
            </Tr>
          ))}
        </Table>
        <Stack gap={2}>
          {CACHE_LAYERS.map((layer) => (
            <p key={layer.name} className="text-[12px] leading-relaxed text-muted">
              <span className="font-mono text-ink">{layer.name}</span> — {layer.note}
            </p>
          ))}
        </Stack>
      </Panel>

      <Panel title="What is safe to cache">
        <Table head={["clause", "cacheable", "why"]}>
          {CACHE_QUERIES.map((q) => {
            const verdict = analyzeCacheability(q.query.kind, q.cacheable ? "filter" : "must");
            return (
              <Tr key={q.label}>
                <Td mono>{q.label}</Td>
                <Td align="center" tone={verdict.cacheable ? "ok" : "bad"}>{verdict.cacheable ? "yes" : "no"}</Td>
                <Td tone="muted">{verdict.reason}</Td>
              </Tr>
            );
          })}
        </Table>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 29 — concurrency and thread pools
// ===========================================================================

export function Ch29() {
  const [config, setConfig] = useState<PoolConfig>({ ...DEFAULT_POOL });
  const [rate, setRate] = useState(60);
  const [segments, setSegments] = useState(6);
  const [segmentCost, setSegmentCost] = useState(12);

  const simulation = useMemo(() => {
    const stream = makeRequestStream(60, rate, Array.from({ length: segments }, () => segmentCost));
    return simulatePool(stream, config);
  }, [config, rate, segments, segmentCost]);

  const latencies = simulation.requests
    .map((r) => r.latency)
    .filter((l): l is number => l !== null);
  const summary = summarise(latencies);
  const ok = simulation.requests.filter((r) => r.status === "ok").length;
  const timedOut = simulation.requests.filter((r) => r.status === "timed-out").length;
  const rejected = simulation.requests.filter((r) => r.status === "rejected").length;

  return (
    <Stack gap={4}>
      <Panel
        title="Search over segments is parallel. Unbounded parallelism is not free."
        subtitle="One request becomes one task per segment. Every knob below trades one problem for another."
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Slider label="workers" value={config.workers} min={1} max={32}
              onChange={(v) => setConfig({ ...config, workers: v })} />
            <Slider label="queue capacity" value={config.queueCapacity} min={0} max={64}
              onChange={(v) => setConfig({ ...config, queueCapacity: v })} />
            <Slider label="timeout" value={config.timeoutMs} min={20} max={1000} step={10}
              onChange={(v) => setConfig({ ...config, timeoutMs: v })} format={(v) => `${v} ms`} />
            <Slider label="cores" value={config.coreCount} min={1} max={16}
              onChange={(v) => setConfig({ ...config, coreCount: v })}
              hint="Beyond this many busy workers, contention makes everything slower" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Slider label="request rate" value={rate} min={5} max={400} step={5} onChange={setRate}
              format={(v) => `${v}/s`} />
            <Slider label="segments per index" value={segments} min={1} max={20} onChange={setSegments}
              hint="Fan-out per request — this multiplies everything" />
            <Slider label="cost per segment" value={segmentCost} min={1} max={60} onChange={setSegmentCost}
              format={(v) => `${v} ms`} />
          </div>

          <StatRow>
            <Stat label="p50" value={formatNumber(summary.p50, 1)} unit="ms" />
            <Stat label="p95" value={formatNumber(summary.p95, 1)} unit="ms" tone="warn" />
            <Stat label="p99" value={formatNumber(summary.p99, 1)} unit="ms" tone="bad" />
            <Stat label="tail ratio p99/p50" value={formatNumber(summary.tailRatio, 1)} unit="×"
              tone={summary.tailRatio > 4 ? "bad" : "ok"} />
          </StatRow>

          <StatRow>
            <Stat label="completed" value={ok} tone="ok" />
            <Stat label="timed out" value={timedOut} tone={timedOut > 0 ? "bad" : "default"} />
            <Stat label="rejected" value={rejected} tone={rejected > 0 ? "warn" : "default"} />
            <Stat label="max queue depth" value={simulation.maxQueueDepth} />
          </StatRow>

          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wider text-faint">Worker utilisation</div>
            <div className="space-y-1">
              {simulation.workerBusy.map((busy, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 font-mono text-[11px] text-muted">worker {i}</span>
                  <Bar value={busy} max={1} tone={busy > 0.9 ? "bad" : busy > 0.7 ? "warn" : "ok"}
                    label={percent(busy, 0)} width={200} />
                </div>
              ))}
            </div>
          </div>

          {rejected > 0 && (
            <Callout tone="warn" title="Backpressure is working">
              {rejected} request(s) were refused because the queue was full. That is the honest behaviour:
              a refused request frees capacity for the ones you accepted. Growing the queue instead would
              convert these into slow successes and then into timeouts.
            </Callout>
          )}
          {timedOut > 0 && (
            <Callout tone="bad" title="Requests are timing out">
              Work is being done and then thrown away. Either the timeout is shorter than the honest service
              time, or the pool is oversubscribed and everything is waiting.
            </Callout>
          )}
          {config.workers > config.coreCount * 2 && (
            <Callout tone="warn" title="More workers than the machine can run">
              With {config.workers} workers on {config.coreCount} cores, every task is slowed by contention.
              Latency gets worse while the utilisation graph looks busier.
            </Callout>
          )}
        </Stack>
      </Panel>

      <Panel title="The trade-offs" tone="sunken">
        <Table head={["knob", "helps", "hurts"]}>
          {CONCURRENCY_TRADEOFFS.map((row) => (
            <Tr key={row.knob}>
              <Td mono>{row.knob}</Td>
              <Td tone="ok">{row.helps}</Td>
              <Td tone="bad">{row.hurts}</Td>
            </Tr>
          ))}
        </Table>
      </Panel>

      <Panel title="Task timeline" subtitle="First 60 tasks. Wide bars are service time; the gap before them is queue wait.">
        <div className="scroll-x">
          <div className="space-y-[2px]" style={{ minWidth: 520 }}>
            {simulation.scheduled.slice(0, 60).map((task) => {
              const scale = 520 / Math.max(1, simulation.makespan);
              return (
                <div key={task.id} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 truncate font-mono text-[10px] text-faint">{task.id}</span>
                  <div className="relative h-[9px] flex-1 rounded bg-sunken">
                    {task.queueWait > 0 && (
                      <div
                        className="absolute h-full rounded-l bg-[var(--bar-warn)] opacity-55"
                        style={{ left: task.queuedAt * scale, width: Math.max(1, task.queueWait * scale) }}
                      />
                    )}
                    <div
                      className="absolute h-full rounded bg-[var(--bar-accent)]"
                      style={{
                        left: task.startedAt * scale,
                        width: Math.max(1, (task.finishedAt - task.startedAt) * scale),
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 30 — Painless and scripted scoring
// ===========================================================================

export function Ch30() {
  const index = demoIndex();
  const context = demoContext();
  const [script, setScript] = useState("_score * (1 + rating / 5)");
  const [queryText, setQueryText] = useState("kubernetes");
  const [windowSize, setWindowSize] = useState(10);

  const compiled = useMemo(() => compileScript(script), [script]);

  const base = useMemo(
    () => search(context, { kind: "match", field: "title", text: queryText }, { topK: 50 }),
    [context, queryText],
  );

  const scripted = useMemo(
    () => search(context, {
      kind: "script_score",
      query: { kind: "match", field: "title", text: queryText },
      script,
    }, { topK: 10 }),
    [context, queryText, script],
  );

  const rescored = useMemo(() => {
    const candidates = base.hits.map((h) => ({ docId: h.docId, cheapScore: h.score }));
    return rescore(
      candidates,
      windowSize,
      (docId, cheapScore) => compiled.evaluate({
        _score: cheapScore,
        rating: index.numericValue("rating", docId),
        price: index.numericValue("price", docId),
        created_at: index.numericValue("created_at", docId),
        lat: index.numericValue("lat", docId),
        lon: index.numericValue("lon", docId),
      }),
      5,
    );
  }, [base, windowSize, compiled, index]);

  const baseRanks = new Map(base.hits.map((h, i) => [h.docId, i]));

  return (
    <Stack gap={4}>
      <Panel
        title="Business logic on top of relevance"
        subtitle="A restricted expression language over the base score and the document's stored values. Restricted on purpose."
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Query" value={queryText} onChange={setQueryText} />
            <TextInput label="Script" value={script} onChange={setScript} />
          </div>

          <div className="flex flex-wrap gap-1">
            {SCRIPT_EXAMPLES.map((example) => (
              <Button key={example.label} size="sm" onClick={() => setScript(example.script)} title={example.why}>
                {example.label}
              </Button>
            ))}
          </div>

          {compiled.error ? (
            <Callout tone="bad" title="Script did not compile">
              {compiled.error} — the base score is used unchanged rather than silently zeroing every document.
            </Callout>
          ) : (
            <Callout tone="ok" title="Parsed">
              <span className="font-mono text-[12px]">{compiled.describe()}</span>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {compiled.variables.map((v) => <Badge key={v} tone="accent">{v}</Badge>)}
              </div>
            </Callout>
          )}

          <Table head={["#", "document", "base score", "scripted", "rank change"]}>
            {scripted.hits.map((hit, i) => {
              const previous = baseRanks.get(hit.docId);
              const delta = previous === undefined ? 0 : previous - i;
              const baseScore = base.hits.find((h) => h.docId === hit.docId)?.score ?? 0;
              return (
                <Tr key={hit.docId}>
                  <Td mono tone="muted">{i + 1}</Td>
                  <Td>{index.source(hit.docId)?.title}</Td>
                  <Td mono align="right" tone="muted">{formatNumber(baseScore, 3)}</Td>
                  <Td mono align="right" tone="accent">{formatNumber(hit.score, 3)}</Td>
                  <Td mono align="right" tone={delta > 0 ? "ok" : delta < 0 ? "bad" : "muted"}>
                    {delta === 0 ? "—" : delta > 0 ? `↑${delta}` : `↓${-delta}`}
                  </Td>
                </Tr>
              );
            })}
          </Table>

          <Grid cols={2}>
            <div className="rounded-lg border border-edge bg-raised p-3">
              <div className="mb-1.5 text-[11px] uppercase tracking-wider text-faint">Available variables</div>
              <div className="flex flex-wrap gap-1">
                {SCRIPT_VARIABLES.map((v) => <Badge key={v}>{v}</Badge>)}
              </div>
            </div>
            <div className="rounded-lg border border-edge bg-raised p-3">
              <div className="mb-1.5 text-[11px] uppercase tracking-wider text-faint">Available functions</div>
              <div className="flex flex-wrap gap-1">
                {SCRIPT_FUNCTIONS.map((f) => <Badge key={f}>{f}()</Badge>)}
              </div>
            </div>
          </Grid>
        </Stack>
      </Panel>

      <Panel
        title="Cheap retrieval, small candidate set, expensive script"
        subtitle="The other order is how you build a slow query. Chapter 34's rescore window, applied to this script."
        tone="sunken"
      >
        <Stack gap={4}>
          <Slider
            label="rescore window"
            value={windowSize}
            min={1}
            max={Math.max(1, base.hits.length)}
            onChange={setWindowSize}
            format={(v) => `top ${v} of ${base.hits.length} candidates`}
          />

          <StatRow>
            <Stat label="candidates retrieved" value={base.totalCandidates} />
            <Stat label="script evaluations" value={rescored.expensiveEvaluations} tone="accent" />
            <Stat label="evaluations avoided" value={rescored.evaluationsAvoided} tone="ok" />
            <Stat
              label="documents missed"
              value={rescored.missedPromotions.length}
              tone={rescored.missedPromotions.length > 0 ? "bad" : "ok"}
              hint="Documents the script would have promoted, had it seen them"
            />
          </StatRow>

          {rescored.missedPromotions.length > 0 ? (
            <Callout tone="bad" title="The window has a cost">
              {rescored.missedPromotions.length} document(s) would have made the final top 5 if the script had
              seen every candidate, but they never entered the window. A rescore window is a bet that cheap
              retrieval ranked the <em>candidates</em> well enough — widen it and the bet gets safer and slower.
            </Callout>
          ) : (
            <Callout tone="ok" title="No promotions missed">
              At this window size the expensive scorer saw everything that could have changed the answer.
            </Callout>
          )}

          <pre className="rounded-lg border border-edge bg-code p-3 font-mono text-[11.5px] leading-relaxed text-muted">
{`good:                          bad:
cheap index retrieval          millions of candidates
        ↓                              ↓
small candidate set            expensive script
        ↓                              ↓
expensive script               slow query`}
          </pre>
        </Stack>
      </Panel>

      <Callout tone="warn" title="Why scripts disable pruning">
        WAND in chapter 27 works because BM25 has an upper bound. A script can return anything, so no upper
        bound exists, so no document can be skipped. Scripting does not just cost its own runtime — it costs
        you every optimisation that depended on knowing the maximum.
      </Callout>
    </Stack>
  );
}
