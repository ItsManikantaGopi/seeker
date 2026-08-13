/**
 * Performance, capacity and observability (chapters 38, 39 and 40).
 *
 * Three related habits:
 *
 *   38  optimise in a fixed order, because the cheapest win is always higher up
 *   39  size a cluster from the data and the workload, not from the JSON size
 *   40  watch percentiles, not averages, and keep a reference implementation
 *
 * The percentile helpers exist because the single most common observability
 * mistake is reporting a mean latency, which is a number that no user has ever
 * experienced.
 */

// ---------------------------------------------------------------------------
// Percentiles
// ---------------------------------------------------------------------------

export interface LatencySummary {
  count: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  /** How much worse the tail is than the median. */
  tailRatio: number;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  // Nearest-rank: the smallest value at or above the requested rank.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export function summarise(values: number[]): LatencySummary {
  if (values.length === 0) {
    return { count: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0, tailRatio: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p50 = percentile(sorted, 50);
  const p99 = percentile(sorted, 99);
  return {
    count: sorted.length,
    mean,
    p50,
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99,
    max: sorted[sorted.length - 1],
    tailRatio: p50 === 0 ? 0 : p99 / p50,
  };
}

export interface HistogramBucket {
  from: number;
  to: number;
  count: number;
}

export function histogram(values: number[], bucketCount = 24): HistogramBucket[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = (max - min) / bucketCount || 1;
  const buckets: HistogramBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    from: min + i * width,
    to: min + (i + 1) * width,
    count: 0,
  }));
  for (const value of values) {
    const i = Math.min(bucketCount - 1, Math.floor((value - min) / width));
    buckets[i].count++;
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Chapter 38: the optimisation order
// ---------------------------------------------------------------------------

export const OPTIMISATION_ORDER = [
  {
    step: "Correctness",
    why: "A fast wrong answer is not a smaller problem than a slow wrong one.",
    example: "Keep the brute-force fuzzy matcher and differential-test against it.",
  },
  {
    step: "Algorithmic complexity",
    why: "The only change that keeps paying as the data grows.",
    example: "Replace scanning every document with a term lookup. Nothing below this line recovers that.",
  },
  {
    step: "Data structure",
    why: "Same complexity class, far better constants and far less memory.",
    example: "Trie to minimized automaton to FST: the same language, a fraction of the nodes.",
  },
  {
    step: "Memory layout",
    why: "Bytes next to each other are effectively free to read together.",
    example: "Block-packed postings and front-coded term blocks instead of pointer-chasing objects.",
  },
  {
    step: "CPU / cache behaviour",
    why: "A cache miss costs hundreds of cycles; a branch misprediction, tens.",
    example: "Bit-packed integers decoded in blocks rather than one object at a time.",
  },
  {
    step: "Disk I/O",
    why: "Still orders of magnitude slower than memory, even on NVMe.",
    example: "mmap plus locality, so the hot pages stay resident and cold data is never read.",
  },
  {
    step: "Concurrency",
    why: "Only helps once a single request is already efficient.",
    example: "Bounded pools and queues. Parallelising wasteful work just wastes more cores.",
  },
  {
    step: "Distributed coordination",
    why: "The most expensive place to solve anything, so it goes last.",
    example: "Shards and replicas. Adding nodes to fix a bad query buys time, not a fix.",
  },
];

export interface SymptomEntry {
  symptom: string;
  investigate: string[];
  firstCheck: string;
  redHerring: string;
}

export const SYMPTOM_TABLE: SymptomEntry[] = [
  {
    symptom: "High p99, healthy p50",
    investigate: ["queueing", "GC pauses", "a hot shard", "cold page cache after a merge"],
    firstCheck: "Compare per-shard latency. A single slow shard drags every fan-out request into the tail.",
    redHerring: "Average latency, which will look perfectly fine throughout.",
  },
  {
    symptom: "High CPU",
    investigate: ["scoring volume", "scripts", "wildcard and fuzzy expansions", "merge threads"],
    firstCheck: "Candidate count per query. Scoring a million documents to return ten is a query problem, not a capacity problem.",
    redHerring: "Adding nodes, which spreads the same waste more thinly.",
  },
  {
    symptom: "High disk I/O",
    investigate: ["poor locality", "cache cold after restart", "oversized segments", "merge pressure"],
    firstCheck: "Read amplification: bytes read from disk divided by bytes actually used.",
    redHerring: "Total index size. A large index with good locality reads very little.",
  },
  {
    symptom: "Memory pressure",
    investigate: ["caches sized by hope", "too many segments", "field data", "large working set"],
    firstCheck: "Cache eviction rate. A cache that evicts as fast as it inserts is pure overhead.",
    redHerring: "Cache hit rate on its own — it stays respectable while the cache thrashes.",
  },
  {
    symptom: "Uneven nodes",
    investigate: ["routing key skew", "shard count vs node count", "one oversized tenant"],
    firstCheck: "Documents per shard. If one shard holds most of the data, routing is the cause.",
    redHerring: "CPU graphs, which show the symptom on the busy node and nothing on the idle ones.",
  },
  {
    symptom: "Writes rejected",
    investigate: ["refresh interval too aggressive", "merge backlog", "bulk size", "translog pressure"],
    firstCheck: "Segment count over time. A count that climbs steadily means merging cannot keep up with indexing.",
    redHerring: "Indexing rate, which is the thing being throttled rather than the cause.",
  },
];

// ---------------------------------------------------------------------------
// Chapter 39: capacity planning
// ---------------------------------------------------------------------------

export interface CapacityInputs {
  documents: number;
  avgSourceBytes: number;
  /** Fraction of the source that ends up indexed as terms, postings and points. */
  indexOverheadRatio: number;
  replicaCount: number;
  /** Headroom multipliers. */
  mergeHeadroom: number;
  recoveryHeadroom: number;
  snapshotHeadroom: number;
  growthMonths: number;
  monthlyGrowthRate: number;
  queriesPerSecond: number;
  avgQueryCostMs: number;
  coresPerNode: number;
  targetCpuUtilisation: number;
  ramPerNodeGb: number;
  /** Fraction of the index you want resident in the page cache. */
  hotDataFraction: number;
}

export const DEFAULT_CAPACITY: CapacityInputs = {
  documents: 50_000_000,
  avgSourceBytes: 1200,
  indexOverheadRatio: 0.55,
  replicaCount: 1,
  mergeHeadroom: 1.2,
  recoveryHeadroom: 1.1,
  snapshotHeadroom: 1.15,
  growthMonths: 12,
  monthlyGrowthRate: 0.04,
  queriesPerSecond: 400,
  avgQueryCostMs: 12,
  coresPerNode: 8,
  targetCpuUtilisation: 0.6,
  ramPerNodeGb: 64,
  hotDataFraction: 0.3,
};

export interface CapacityResult {
  sourceBytes: number;
  logicalIndexBytes: number;
  withReplicas: number;
  withHeadroom: number;
  afterGrowth: number;
  /** Nodes needed to hold the data. */
  nodesForStorage: number;
  /** Nodes needed to serve the query load. */
  nodesForCpu: number;
  /** Nodes needed to keep the hot set in page cache. */
  nodesForRam: number;
  recommendedNodes: number;
  bindingConstraint: "storage" | "cpu" | "page cache";
  coreSecondsPerSecond: number;
  notes: string[];
}

const GB = 1024 ** 3;

export function planCapacity(
  input: CapacityInputs,
  diskPerNodeGb = 1000,
): CapacityResult {
  const sourceBytes = input.documents * input.avgSourceBytes;
  // The index is not the source. It is postings, term dictionaries, points,
  // norms and stored fields — and it is the number that matters.
  const logicalIndexBytes = sourceBytes * (1 + input.indexOverheadRatio);
  const withReplicas = logicalIndexBytes * (1 + input.replicaCount);
  const withHeadroom =
    withReplicas * input.mergeHeadroom * input.recoveryHeadroom * input.snapshotHeadroom;
  const growthFactor = (1 + input.monthlyGrowthRate) ** input.growthMonths;
  const afterGrowth = withHeadroom * growthFactor;

  const nodesForStorage = Math.ceil(afterGrowth / (diskPerNodeGb * GB));

  // Each query costs `avgQueryCostMs` of core time; a core supplies 1000ms of
  // core time per second, and we only want to use `targetCpuUtilisation` of it.
  const coreSecondsPerSecond = (input.queriesPerSecond * input.avgQueryCostMs) / 1000;
  const usableCoresPerNode = input.coresPerNode * input.targetCpuUtilisation;
  const nodesForCpu = Math.ceil(coreSecondsPerSecond / Math.max(0.001, usableCoresPerNode));

  const hotBytes = afterGrowth * input.hotDataFraction;
  // Roughly half of a node's RAM is available as page cache in practice.
  const cachePerNode = input.ramPerNodeGb * GB * 0.5;
  const nodesForRam = Math.ceil(hotBytes / Math.max(1, cachePerNode));

  const recommendedNodes = Math.max(1, nodesForStorage, nodesForCpu, nodesForRam);
  const bindingConstraint: CapacityResult["bindingConstraint"] =
    recommendedNodes === nodesForStorage ? "storage"
      : recommendedNodes === nodesForCpu ? "cpu"
        : "page cache";

  const notes: string[] = [];
  notes.push(
    `Replicas multiply storage: ${input.replicaCount} replica(s) means ${(1 + input.replicaCount)}x the data before any headroom.`,
  );
  if (input.hotDataFraction > 0.5) {
    notes.push("Wanting more than half the index resident is usually a sign the query pattern, not the hardware, needs work.");
  }
  if (input.targetCpuUtilisation > 0.75) {
    notes.push("Targeting above 75% CPU leaves no room for merges, GC or a traffic spike. The tail will find you.");
  }
  if (nodesForCpu > nodesForStorage * 2) {
    notes.push("This workload is CPU bound, not storage bound. Cheaper queries beat bigger disks here.");
  }
  if (nodesForStorage > nodesForCpu * 2) {
    notes.push("This workload is storage bound. Consider tiering older data rather than scaling the whole cluster.");
  }
  notes.push("Never size from raw source-document size alone — this calculator starts there and then never uses it again.");

  return {
    sourceBytes,
    logicalIndexBytes,
    withReplicas,
    withHeadroom,
    afterGrowth,
    nodesForStorage,
    nodesForCpu,
    nodesForRam,
    recommendedNodes,
    bindingConstraint,
    coreSecondsPerSecond,
    notes,
  };
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

// ---------------------------------------------------------------------------
// Chapter 40: metric catalogue
// ---------------------------------------------------------------------------

export interface MetricSpec {
  name: string;
  group: "indexing" | "search" | "storage" | "cluster";
  meaning: string;
  watchFor: string;
}

export const METRIC_CATALOGUE: MetricSpec[] = [
  { name: "documents indexed/sec", group: "indexing", meaning: "Write throughput reaching the buffer.", watchFor: "A drop with no drop in incoming traffic means rejection or backpressure upstream." },
  { name: "refresh latency", group: "indexing", meaning: "Time to make writes visible.", watchFor: "Rising refresh time means the buffer is too large or the disk is busy merging." },
  { name: "flush latency", group: "indexing", meaning: "Time to write segment files.", watchFor: "Spikes align with merge activity fighting for the same disk." },
  { name: "commit latency", group: "indexing", meaning: "Time to make state durable and reopenable.", watchFor: "Long commits stall recovery guarantees, not just writes." },
  { name: "merge throughput", group: "storage", meaning: "Bytes merged per second.", watchFor: "If it cannot keep up with indexing, segment count climbs without bound." },
  { name: "segment count", group: "storage", meaning: "Live segments per shard.", watchFor: "A steady climb is the earliest visible sign of merge starvation." },
  { name: "rejected writes", group: "indexing", meaning: "Writes refused by backpressure.", watchFor: "Non-zero is not automatically bad — it is honest overload signalling." },
  { name: "query latency p50/p95/p99", group: "search", meaning: "The distribution users actually experience.", watchFor: "A widening gap between p50 and p99 means queueing or skew, not slow code." },
  { name: "candidate count per query", group: "search", meaning: "Documents that reached the scorer.", watchFor: "The single best predictor of query CPU. Watch it before watching CPU." },
  { name: "cache hit rate", group: "search", meaning: "Fraction of lookups served from cache.", watchFor: "Read it next to eviction rate, or a thrashing cache looks healthy." },
  { name: "script latency", group: "search", meaning: "Time inside scripted scoring.", watchFor: "Multiply by candidate count before deciding it is small." },
  { name: "timeouts", group: "search", meaning: "Requests abandoned.", watchFor: "Timeouts that produce partial results are a correctness event, not just a latency one." },
  { name: "partial failures", group: "cluster", meaning: "Responses missing a shard.", watchFor: "Silently returning fewer results is worse than an error, unless you surface it." },
  { name: "shard fan-out", group: "cluster", meaning: "Shards touched per request.", watchFor: "High fan-out multiplies every other problem by the shard count." },
  { name: "shard skew", group: "cluster", meaning: "Spread of documents across shards.", watchFor: "Skew makes the busiest shard the latency of every request." },
  { name: "page faults", group: "storage", meaning: "Reads that had to go to disk.", watchFor: "A spike after restart or merge is normal; a sustained rate is a locality problem." },
];

/** Deterministic latency sample, so the lab renders the same picture every time. */
export function syntheticLatencies(
  count: number,
  options: { base?: number; tailFraction?: number; tailMultiplier?: number; seed?: number } = {},
): number[] {
  const base = options.base ?? 8;
  const tailFraction = options.tailFraction ?? 0.03;
  const tailMultiplier = options.tailMultiplier ?? 14;
  let state = (options.seed ?? 424242) >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return Array.from({ length: count }, () => {
    const r = random();
    // Log-normal-ish body, with an explicit slow tail bolted on.
    const body = base * Math.exp(random() * 0.7 - 0.2);
    return r < tailFraction ? body * (1 + random() * tailMultiplier) : body;
  });
}
