"use client";

import { useMemo, useState } from "react";
import {
  DEFAULT_CAPACITY, formatBytes as formatCapacityBytes, histogram, METRIC_CATALOGUE,
  OPTIMISATION_ORDER, planCapacity, summarise, SYMPTOM_TABLE, syntheticLatencies,
  type CapacityInputs,
} from "@/lib/seeker/observability";
import { demoContext } from "@/lib/demo";
import { search } from "@/lib/seeker/query";
import { parseQueryString } from "@/lib/seeker/parser";
import {
  Badge,
  Bar,
  Callout,
  Panel,
  Segmented,
  Slider,
  Stack,
  Stat,
  StatRow,
  Table,
  Td,
  Tr,
  formatNumber,
  percent,
} from "@/components/ui";

// ===========================================================================
// Chapter 38 — performance engineering
// ===========================================================================

const PROFILE_QUERIES = [
  { label: "one term", query: "kubernetes" },
  { label: "two terms (OR)", query: "kubernetes deployment" },
  { label: "conjunction", query: "kubernetes AND deployment" },
  { label: "phrase", query: '"kubernetes deployment"' },
  { label: "prefix", query: "kube*" },
  { label: "leading wildcard", query: "*ment" },
  { label: "fuzzy", query: "kubernets~2" },
  { label: "regex", query: "/.*deploy.*/" },
  { label: "filtered", query: "kubernetes AND status:published" },
  { label: "range", query: "price:[0 TO 200]" },
];

export function Ch38() {
  const context = demoContext();
  const [symptom, setSymptom] = useState(SYMPTOM_TABLE[0].symptom);

  const profile = useMemo(
    () => PROFILE_QUERIES.map((entry) => {
      const parsed = parseQueryString(entry.query);
      const result = search(context, parsed.query, { topK: 10 });
      return {
        ...entry,
        candidates: result.totalCandidates,
        postingsRead: result.stats.postingsRead,
        termsExpanded: result.stats.termsExpanded,
        positionChecks: result.stats.positionChecks,
        docsScored: result.stats.docsScored,
        dictionaryWork: result.expansions.reduce((s, e) => s + e.work, 0),
        micros: result.tookMicros,
      };
    }),
    [context],
  );

  const maxWork = Math.max(...profile.map((p) => p.postingsRead + p.dictionaryWork), 1);
  const active = SYMPTOM_TABLE.find((s) => s.symptom === symptom)!;

  return (
    <Stack gap={4}>
      <Panel
        title="Optimise in this order"
        subtitle="Not because it is tidy, but because a win higher up makes everything below it cheaper — and a win lower down cannot recover a bad choice above."
      >
        <div className="space-y-1">
          {OPTIMISATION_ORDER.map((step, i, arr) => (
            <div key={step.step}>
              <div className="rounded-lg border border-edge bg-raised px-3 py-2.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[11px] text-faint">{i + 1}</span>
                  <span className="text-[12.5px] font-semibold text-ink">{step.step}</span>
                </div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{step.why}</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-accent-text">{step.example}</p>
              </div>
              {i < arr.length - 1 && <div className="py-0.5 text-center font-mono text-[10px] text-faint">↓</div>}
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Profile the real thing"
        subtitle="Ten query shapes against the same index. The candidate count is the best predictor of cost, which is why it is the first thing to measure."
        tone="sunken"
      >
        <Table head={["query", "candidates", "postings read", "dictionary work", "position checks", "work"]}>
          {profile.map((row) => (
            <Tr key={row.label}>
              <Td>
                <span className="text-[12px]">{row.label}</span>
                <div className="font-mono text-[11px] text-faint">{row.query}</div>
              </Td>
              <Td mono align="right">{row.candidates}</Td>
              <Td mono align="right">{row.postingsRead}</Td>
              <Td mono align="right" tone={row.dictionaryWork > 300 ? "bad" : "muted"}>{row.dictionaryWork}</Td>
              <Td mono align="right" tone="muted">{row.positionChecks}</Td>
              <Td>
                <Bar
                  value={row.postingsRead + row.dictionaryWork}
                  max={maxWork}
                  tone={row.postingsRead + row.dictionaryWork > maxWork * 0.6 ? "bad" : "ok"}
                  width={110}
                />
              </Td>
            </Tr>
          ))}
        </Table>
        <Callout tone="info" title="Read the dictionary-work column">
          The prefix query narrows by its literal prefix. The leading wildcard and the regex cannot, so they
          walk the whole vocabulary — the same result set for a completely different price.
        </Callout>
      </Panel>

      <Panel
        title="Symptom table"
        subtitle="Every symptom has a first thing to check, and a graph that will comfortably mislead you."
        actions={
          <Segmented
            value={symptom}
            onChange={setSymptom}
            options={SYMPTOM_TABLE.map((s) => ({ value: s.symptom, label: s.symptom.split(",")[0] }))}
          />
        }
      >
        <Stack gap={3}>
          <div className="rounded-lg border border-edge bg-raised p-3">
            <div className="text-[13px] font-semibold text-ink">{active.symptom}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {active.investigate.map((x) => <Badge key={x} tone="neutral">{x}</Badge>)}
            </div>
          </div>
          <Callout tone="ok" title="Check this first">{active.firstCheck}</Callout>
          <Callout tone="bad" title="The graph that will mislead you">{active.redHerring}</Callout>
        </Stack>
      </Panel>

      <Panel title="The full table">
        <Table head={["symptom", "investigate", "first check"]}>
          {SYMPTOM_TABLE.map((row) => (
            <Tr key={row.symptom} highlight={row.symptom === symptom}>
              <Td mono>{row.symptom}</Td>
              <Td tone="muted">{row.investigate.join(", ")}</Td>
              <Td tone="muted">{row.firstCheck}</Td>
            </Tr>
          ))}
        </Table>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 39 — capacity planning
// ===========================================================================

export function Ch39() {
  const [input, setInput] = useState<CapacityInputs>({ ...DEFAULT_CAPACITY });
  const [diskPerNode, setDiskPerNode] = useState(1000);

  const plan = useMemo(() => planCapacity(input, diskPerNode), [input, diskPerNode]);
  const set = (patch: Partial<CapacityInputs>) => setInput((i) => ({ ...i, ...patch }));

  const constraints = [
    { name: "storage", nodes: plan.nodesForStorage, tone: "info" as const },
    { name: "cpu", nodes: plan.nodesForCpu, tone: "accent" as const },
    { name: "page cache", nodes: plan.nodesForRam, tone: "warn" as const },
  ];

  return (
    <Stack gap={4}>
      <Panel title="Start with the data" subtitle="Documents, size, and how much of that becomes index rather than source.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Slider label="documents" value={input.documents} min={1_000_000} max={500_000_000} step={1_000_000}
            onChange={(v) => set({ documents: v })} format={(v) => `${(v / 1_000_000).toFixed(0)}M`} />
          <Slider label="average source bytes" value={input.avgSourceBytes} min={100} max={10000} step={100}
            onChange={(v) => set({ avgSourceBytes: v })} format={(v) => `${v} B`} />
          <Slider label="index overhead" value={input.indexOverheadRatio} min={0.1} max={2} step={0.05}
            onChange={(v) => set({ indexOverheadRatio: v })} format={(v) => `${(v * 100).toFixed(0)}% of source`}
            hint="Postings, term dictionaries, points, norms, stored fields" />
          <Slider label="replicas" value={input.replicaCount} min={0} max={3}
            onChange={(v) => set({ replicaCount: v })} />
          <Slider label="growth" value={input.monthlyGrowthRate} min={0} max={0.2} step={0.005}
            onChange={(v) => set({ monthlyGrowthRate: v })} format={(v) => `${(v * 100).toFixed(1)}%/month`} />
          <Slider label="horizon" value={input.growthMonths} min={0} max={36}
            onChange={(v) => set({ growthMonths: v })} format={(v) => `${v} months`} />
        </div>
      </Panel>

      <Panel title="Then the workload" tone="sunken">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Slider label="queries per second" value={input.queriesPerSecond} min={10} max={5000} step={10}
            onChange={(v) => set({ queriesPerSecond: v })} />
          <Slider label="average query cost" value={input.avgQueryCostMs} min={1} max={200}
            onChange={(v) => set({ avgQueryCostMs: v })} format={(v) => `${v} ms of core time`} />
          <Slider label="cores per node" value={input.coresPerNode} min={2} max={64} step={2}
            onChange={(v) => set({ coresPerNode: v })} />
          <Slider label="target CPU utilisation" value={input.targetCpuUtilisation} min={0.2} max={0.95} step={0.05}
            onChange={(v) => set({ targetCpuUtilisation: v })} format={(v) => percent(v, 0)} />
          <Slider label="RAM per node" value={input.ramPerNodeGb} min={8} max={512} step={8}
            onChange={(v) => set({ ramPerNodeGb: v })} format={(v) => `${v} GB`} />
          <Slider label="hot data fraction" value={input.hotDataFraction} min={0.05} max={1} step={0.05}
            onChange={(v) => set({ hotDataFraction: v })} format={(v) => percent(v, 0)}
            hint="How much of the index you want resident in the page cache" />
          <Slider label="disk per node" value={diskPerNode} min={100} max={8000} step={100}
            onChange={setDiskPerNode} format={(v) => `${v} GB`} />
        </div>
      </Panel>

      <Panel title="Where the storage goes">
        <Stack gap={3}>
          <Table head={["step", "size", ""]}>
            {[
              { label: "raw source documents", value: plan.sourceBytes, note: "the number you should never size from" },
              { label: "logical index size", value: plan.logicalIndexBytes, note: `source + ${percent(input.indexOverheadRatio, 0)} index overhead` },
              { label: `× ${1 + input.replicaCount} for replicas`, value: plan.withReplicas, note: "replication copies everything" },
              { label: "+ merge, recovery, snapshot headroom", value: plan.withHeadroom, note: "merges need somewhere to write" },
              { label: `after ${input.growthMonths} months of growth`, value: plan.afterGrowth, note: "what you actually have to buy" },
            ].map((row) => (
              <Tr key={row.label}>
                <Td>{row.label}<div className="text-[11px] text-faint">{row.note}</div></Td>
                <Td mono align="right" tone="accent">{formatCapacityBytes(row.value)}</Td>
                <Td><Bar value={row.value} max={plan.afterGrowth} tone="accent" width={160} /></Td>
              </Tr>
            ))}
          </Table>
        </Stack>
      </Panel>

      <Panel title="What binds first" subtitle="Three independent budgets. You need the largest of the three, and knowing which one it is tells you what to fix.">
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-3">
            {constraints.map((c) => (
              <div
                key={c.name}
                className={`rounded-lg border p-3 ${
                  plan.bindingConstraint === c.name
                    ? "border-transparent bg-accent-soft"
                    : "border-edge bg-raised"
                }`}
              >
                <div className="text-[10.5px] uppercase tracking-wider text-faint">{c.name}</div>
                <div className={`mt-1 font-mono text-[22px] font-bold ${
                  plan.bindingConstraint === c.name ? "text-accent-text" : "text-ink"
                }`}>{c.nodes}</div>
                <div className="text-[11px] text-faint">nodes needed</div>
                {plan.bindingConstraint === c.name && (
                  <Badge tone="accent">binding constraint</Badge>
                )}
              </div>
            ))}
          </div>

          <StatRow>
            <Stat label="recommended nodes" value={plan.recommendedNodes} tone="accent" />
            <Stat label="core-seconds per second" value={formatNumber(plan.coreSecondsPerSecond, 1)}
              hint="QPS × cost per query. This is the real CPU demand." />
            <Stat label="cluster storage" value={formatCapacityBytes(plan.afterGrowth)} />
            <Stat label="per node" value={formatCapacityBytes(plan.afterGrowth / plan.recommendedNodes)} />
          </StatRow>

          <Stack gap={2}>
            {plan.notes.map((note, i) => (
              <Callout key={i} tone={i === plan.notes.length - 1 ? "accent" : "info"}>{note}</Callout>
            ))}
          </Stack>
        </Stack>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 40 — observability and failure modes
// ===========================================================================

export function Ch40() {
  const [tailFraction, setTailFraction] = useState(0.03);
  const [tailMultiplier, setTailMultiplier] = useState(14);
  const [sampleSize, setSampleSize] = useState(2000);
  const [group, setGroup] = useState<"all" | "indexing" | "search" | "storage" | "cluster">("all");

  const latencies = useMemo(
    () => syntheticLatencies(sampleSize, { tailFraction, tailMultiplier }),
    [sampleSize, tailFraction, tailMultiplier],
  );
  const summary = useMemo(() => summarise(latencies), [latencies]);
  const buckets = useMemo(() => histogram(latencies, 40), [latencies]);
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);

  const metrics = group === "all" ? METRIC_CATALOGUE : METRIC_CATALOGUE.filter((m) => m.group === group);

  return (
    <Stack gap={4}>
      <Panel
        title="Percentiles, not averages"
        subtitle="The mean is a number no user has ever experienced. Move the tail and watch which statistic notices."
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Slider label="slow requests" value={tailFraction} min={0} max={0.15} step={0.005}
              onChange={setTailFraction} format={(v) => percent(v, 1)} />
            <Slider label="how much slower" value={tailMultiplier} min={1} max={40}
              onChange={setTailMultiplier} format={(v) => `up to ${v}×`} />
            <Slider label="sample size" value={sampleSize} min={200} max={5000} step={100} onChange={setSampleSize} />
          </div>

          <StatRow>
            <Stat label="mean" value={formatNumber(summary.mean, 1)} unit="ms"
              hint="Looks fine, and hides everything" />
            <Stat label="p50" value={formatNumber(summary.p50, 1)} unit="ms" />
            <Stat label="p95" value={formatNumber(summary.p95, 1)} unit="ms" tone="warn" />
            <Stat label="p99" value={formatNumber(summary.p99, 1)} unit="ms" tone="bad" />
          </StatRow>
          <StatRow>
            <Stat label="max" value={formatNumber(summary.max, 1)} unit="ms" tone="bad" />
            <Stat label="p99 / p50" value={formatNumber(summary.tailRatio, 1)} unit="×"
              tone={summary.tailRatio > 4 ? "bad" : "ok"} />
            <Stat label="requests above the mean"
              value={percent(latencies.filter((l) => l > summary.mean).length / latencies.length, 1)}
              hint="If this is well under 50%, the distribution is skewed and the mean is meaningless" />
            <Stat label="requests" value={summary.count} />
          </StatRow>

          {/* Histogram */}
          <div className="rounded-lg border border-edge bg-raised p-3">
            <div className="flex h-[130px] items-end gap-[2px]">
              {buckets.map((bucket, i) => {
                const isTail = bucket.from >= summary.p99;
                const isP50 = bucket.from <= summary.p50 && bucket.to > summary.p50;
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-t transition-all"
                    style={{
                      height: `${Math.max(1, (bucket.count / maxCount) * 100)}%`,
                      // Three distinct weights: the bulk of the distribution is
                      // faint, the median bucket is solid, the tail sits between
                      // them so it reads as separate from both.
                      background: isP50
                        ? "var(--bar-accent)"
                        : isTail ? "var(--bar-warn)" : "var(--bar-muted)",
                    }}
                    title={`${bucket.from.toFixed(1)}–${bucket.to.toFixed(1)} ms: ${bucket.count} requests`}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10.5px] text-faint">
              <span>{formatNumber(buckets[0]?.from ?? 0, 1)} ms</span>
              <span className="text-accent-text">p50 {formatNumber(summary.p50, 1)}</span>
              <span className="text-bad">p99 {formatNumber(summary.p99, 1)}</span>
              <span>{formatNumber(buckets[buckets.length - 1]?.to ?? 0, 1)} ms</span>
            </div>
          </div>

          <Callout tone={summary.tailRatio > 4 ? "bad" : "ok"} title={`p99 is ${formatNumber(summary.tailRatio, 1)}× p50`}>
            {summary.tailRatio > 4
              ? "A wide gap between the median and the tail means queueing, garbage collection or skew — not slow code. Slow code makes everything slower evenly."
              : "The distribution is tight. Median and tail agree, so there is no queueing hiding in here."}
            {" "}Meanwhile the mean sits at {formatNumber(summary.mean, 1)} ms and moves barely at all.
          </Callout>
        </Stack>
      </Panel>

      <Panel
        title="The metric catalogue"
        subtitle="For each one: what it means, and what specifically to watch for."
        actions={
          <Segmented
            value={group}
            onChange={setGroup}
            options={[
              { value: "all", label: "all" },
              { value: "indexing", label: "indexing" },
              { value: "search", label: "search" },
              { value: "storage", label: "storage" },
              { value: "cluster", label: "cluster" },
            ]}
          />
        }
        tone="sunken"
      >
        <Table head={["metric", "group", "meaning", "watch for"]}>
          {metrics.map((metric) => (
            <Tr key={metric.name}>
              <Td mono>{metric.name}</Td>
              <Td><Badge tone={
                metric.group === "search" ? "accent"
                  : metric.group === "indexing" ? "info"
                    : metric.group === "storage" ? "warn" : "ok"
              }>{metric.group}</Badge></Td>
              <Td tone="muted">{metric.meaning}</Td>
              <Td tone="muted">{metric.watchFor}</Td>
            </Tr>
          ))}
        </Table>
      </Panel>

      <Callout tone="accent" title="The most valuable test you will write">
        Keep a reference implementation. Run the same query through the slow, obviously-correct path and the
        fast one, and compare. It is how you catch the fuzzy-search bug, the postings-compression bug and the
        BKD bug that no unit test was ever going to find. Chapter 42 does exactly this, live.
      </Callout>
    </Stack>
  );
}
