/**
 * Shards, replicas and distributed search (chapters 31 to 34, 36 and 37).
 *
 * A shard is not a special object. It is an entire search index that happens to
 * hold part of the data — the same `KausEngine` from chapter 23, several times
 * over. Everything genuinely new here is coordination:
 *
 *   routing        which shard owns a document
 *   fan-out        one request becomes N
 *   global merge   N answers become one
 *   query/fetch    score cheaply everywhere, fetch bodies only for winners
 *   allocation     which node holds which copy, and what happens when one dies
 *
 * Chapter 33's separation of query and fetch is modelled with real byte counts,
 * because "we did not fetch the `_source` for all of them" is the entire reason
 * the phase split exists.
 */

import { KausEngine, type EngineHit } from "./segments";
import type { Query, SearchOptions } from "./query";
import { mergeExecStats, newExecStats, type ExecStats, type SourceDoc } from "./types";

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** FNV-1a. Any decent hash works; what matters is that it is stable. */
export function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function routeToShard(key: string, shardCount: number): number {
  return hashKey(key) % shardCount;
}

// ---------------------------------------------------------------------------
// Cluster state (chapter 37)
// ---------------------------------------------------------------------------

export type NodeState = "up" | "down";
export type ShardState = "started" | "initializing" | "unassigned";

export interface ClusterNode {
  id: string;
  name: string;
  state: NodeState;
}

export interface ShardCopy {
  shard: number;
  /** null when the copy has nowhere to live. */
  nodeId: string | null;
  primary: boolean;
  state: ShardState;
}

export type ClusterHealth = "green" | "yellow" | "red";

export interface ClusterEvent {
  tick: number;
  kind: "allocate" | "promote" | "fail" | "join" | "leave" | "recover" | "note";
  message: string;
}

export interface DistributedHit extends EngineHit {
  shard: number;
  servedBy: string | null;
}

export interface ShardQueryResult {
  shard: number;
  servedBy: string | null;
  /** Top-K identifiers and scores only — no document bodies yet. */
  candidates: { docKey: string; score: number; localDocId: number }[];
  docCount: number;
  candidatesConsidered: number;
  stats: ExecStats;
  tookMicros: number;
  failed: boolean;
}

export interface DistributedSearchResult {
  hits: DistributedHit[];
  queryPhase: ShardQueryResult[];
  fetchPhase: { shard: number; docKeys: string[]; bytes: number }[];
  /** Bytes moved if we had fetched `_source` during the query phase instead. */
  bytesIfFetchedEverything: number;
  bytesActuallyFetched: number;
  queryPhaseBytes: number;
  shardsQueried: number;
  shardsFailed: number;
  partial: boolean;
  stats: ExecStats;
  tookMicros: number;
  health: ClusterHealth;
}

export interface ClusterConfig {
  shardCount: number;
  replicaCount: number;
  nodeCount: number;
}

/** Rough size of a document body, for the query/fetch byte comparison. */
function sourceBytes(source: SourceDoc): number {
  return JSON.stringify(source).length;
}

export class Cluster {
  readonly nodes: ClusterNode[] = [];
  readonly shards: KausEngine[] = [];
  copies: ShardCopy[] = [];
  readonly events: ClusterEvent[] = [];
  private tick = 0;
  /** Round-robin cursor per shard, so reads spread across copies. */
  private readCursor = new Map<number, number>();

  constructor(readonly config: ClusterConfig) {
    for (let i = 0; i < config.nodeCount; i++) {
      this.nodes.push({ id: `node-${i + 1}`, name: `node-${i + 1}`, state: "up" });
    }
    for (let s = 0; s < config.shardCount; s++) {
      this.shards.push(new KausEngine());
    }
    this.allocate();
  }

  private log(kind: ClusterEvent["kind"], message: string) {
    this.tick++;
    this.events.push({ tick: this.tick, kind, message });
  }

  get liveNodes(): ClusterNode[] {
    return this.nodes.filter((n) => n.state === "up");
  }

  // -------------------------------------------------------------------------
  // Allocation
  // -------------------------------------------------------------------------

  /**
   * Place every copy. Two rules: never put two copies of the same shard on one
   * node (that would make the replica pointless), and prefer the emptiest node.
   */
  allocate(): void {
    const live = this.liveNodes;
    const load = new Map<string, number>(live.map((n) => [n.id, 0]));
    for (const copy of this.copies) {
      if (copy.nodeId && load.has(copy.nodeId)) {
        load.set(copy.nodeId, (load.get(copy.nodeId) ?? 0) + 1);
      }
    }

    // Keep every copy that still sits on a live node; everything else is rebuilt.
    const liveIds = new Set(live.map((n) => n.id));
    const surviving = this.copies.filter((c) => c.nodeId !== null && liveIds.has(c.nodeId));

    const desired: ShardCopy[] = [];
    for (let shard = 0; shard < this.config.shardCount; shard++) {
      const own = surviving.filter((c) => c.shard === shard);
      const primary = own.find((c) => c.primary);
      const replicas = own.filter((c) => !c.primary);

      desired.push(primary ?? { shard, nodeId: null, primary: true, state: "unassigned" });
      for (let r = 0; r < this.config.replicaCount; r++) {
        desired.push(replicas[r] ?? { shard, nodeId: null, primary: false, state: "unassigned" });
      }
    }

    for (const copy of desired) {
      if (copy.nodeId) continue;

      // A copy cannot be conjured onto a fresh node. Either the shard is still
      // empty (a new cluster), or some surviving copy exists to recover from.
      // Losing the last copy of a shard loses the shard — that is the whole
      // reason replicas are worth their cost.
      const hasData =
        this.shards[copy.shard].visibleDocCount > 0 ||
        this.shards[copy.shard].pendingWrites > 0;
      const recoverySource = desired.some(
        (c) => c.shard === copy.shard && c.nodeId !== null && c.state === "started",
      );
      if (hasData && !recoverySource) {
        copy.state = "unassigned";
        continue;
      }

      const taken = new Set(
        desired.filter((c) => c.shard === copy.shard && c.nodeId).map((c) => c.nodeId!),
      );
      const candidates = live
        .filter((n) => !taken.has(n.id))
        .sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.id.localeCompare(b.id));
      if (candidates.length === 0) {
        copy.state = "unassigned";
        continue;
      }
      copy.nodeId = candidates[0].id;
      copy.state = "started";
      load.set(copy.nodeId, (load.get(copy.nodeId) ?? 0) + 1);
    }

    this.copies = desired;
  }

  health(): ClusterHealth {
    const shardsWithPrimary = new Set(
      this.copies.filter((c) => c.primary && c.state === "started").map((c) => c.shard),
    );
    if (shardsWithPrimary.size < this.config.shardCount) return "red";
    const unassigned = this.copies.some((c) => c.state === "unassigned");
    return unassigned ? "yellow" : "green";
  }

  /** Which node serves a read for this shard, spreading load across copies. */
  private pickCopy(shard: number): ShardCopy | null {
    const available = this.copies.filter(
      (c) => c.shard === shard && c.state === "started" && c.nodeId &&
        this.nodes.find((n) => n.id === c.nodeId)?.state === "up",
    );
    if (available.length === 0) return null;
    const cursor = this.readCursor.get(shard) ?? 0;
    this.readCursor.set(shard, cursor + 1);
    return available[cursor % available.length];
  }

  // -------------------------------------------------------------------------
  // Failure and recovery (chapter 36)
  // -------------------------------------------------------------------------

  failNode(nodeId: string): void {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node || node.state === "down") return;
    node.state = "down";
    const lost = this.copies.filter((c) => c.nodeId === nodeId);
    for (const copy of lost) {
      copy.nodeId = null;
      copy.state = "unassigned";
    }
    this.log("fail", `${nodeId} left the cluster, taking ${lost.length} shard copy/copies with it`);

    // Promote a replica wherever a primary was lost.
    for (const copy of lost.filter((c) => c.primary)) {
      const replica = this.copies.find(
        (c) => c.shard === copy.shard && !c.primary && c.state === "started",
      );
      if (replica) {
        replica.primary = true;
        copy.primary = false;
        this.log("promote", `promoted a replica of shard ${copy.shard} to primary`);
      } else {
        this.log("note", `shard ${copy.shard} has no surviving copy — searches over it will return partial results`);
      }
    }
    this.allocate();
  }

  reviveNode(nodeId: string): void {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node || node.state === "up") return;
    node.state = "up";
    this.log("recover", `${nodeId} rejoined; unassigned copies can be allocated again`);
    this.allocate();
  }

  addNode(): ClusterNode {
    const node: ClusterNode = {
      id: `node-${this.nodes.length + 1}`,
      name: `node-${this.nodes.length + 1}`,
      state: "up",
    };
    this.nodes.push(node);
    this.log("join", `${node.id} joined the cluster`);
    this.allocate();
    return node;
  }

  // -------------------------------------------------------------------------
  // Indexing
  // -------------------------------------------------------------------------

  index(source: SourceDoc, routingKey?: string): number {
    const shard = routeToShard(routingKey ?? source.id, this.config.shardCount);
    this.shards[shard].index(source);
    return shard;
  }

  indexAll(sources: SourceDoc[], routingKeyOf?: (doc: SourceDoc) => string): void {
    for (const source of sources) this.index(source, routingKeyOf?.(source));
    this.refreshAll();
  }

  refreshAll(): void {
    for (const shard of this.shards) shard.refresh();
  }

  commitAll(): void {
    for (const shard of this.shards) shard.commit();
  }

  /** Documents per shard — the number that reveals a hot shard. */
  distribution(): { shard: number; documents: number }[] {
    return this.shards.map((engine, shard) => ({ shard, documents: engine.visibleDocCount }));
  }

  /** Coefficient of variation of shard sizes. Zero is perfectly even. */
  skew(): number {
    const counts = this.distribution().map((d) => d.documents);
    if (counts.length === 0) return 0;
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    if (mean === 0) return 0;
    const variance = counts.reduce((sum, c) => sum + (c - mean) ** 2, 0) / counts.length;
    return Math.sqrt(variance) / mean;
  }

  // -------------------------------------------------------------------------
  // Chapter 33: query then fetch
  // -------------------------------------------------------------------------

  search(
    query: Query,
    options: SearchOptions & { topK?: number; routing?: string } = {},
  ): DistributedSearchResult {
    const topK = options.topK ?? 10;
    const started = performance.now();

    // Routing can restrict the fan-out to a single shard. That is the entire
    // benefit, and the entire risk (chapter 34).
    const targetShards = options.routing !== undefined
      ? [routeToShard(options.routing, this.config.shardCount)]
      : this.shards.map((_, i) => i);

    const queryPhase: ShardQueryResult[] = [];
    let stats = newExecStats();

    for (const shard of targetShards) {
      const copy = this.pickCopy(shard);
      if (!copy) {
        queryPhase.push({
          shard, servedBy: null, candidates: [], docCount: 0,
          candidatesConsidered: 0, stats: newExecStats(), tookMicros: 0, failed: true,
        });
        continue;
      }
      const engine = this.shards[shard];
      const result = engine.search(query, { ...options, topK });
      stats = mergeExecStats(stats, result.stats);
      queryPhase.push({
        shard,
        servedBy: copy.nodeId,
        // The query phase returns identifiers and scores. Nothing else.
        candidates: result.hits.map((h) => ({
          docKey: h.docKey, score: h.score, localDocId: h.localDocId,
        })),
        docCount: engine.visibleDocCount,
        candidatesConsidered: result.totalCandidates,
        stats: result.stats,
        tookMicros: result.tookMicros,
        failed: false,
      });
    }

    // Global merge on the coordinator.
    const merged = queryPhase
      .flatMap((r) => r.candidates.map((c) => ({ ...c, shard: r.shard, servedBy: r.servedBy })))
      .sort((a, b) => b.score - a.score || a.docKey.localeCompare(b.docKey))
      .slice(0, topK);

    // Fetch phase: ask only the shards that actually own a winner.
    const byShard = new Map<number, string[]>();
    for (const hit of merged) {
      const list = byShard.get(hit.shard);
      if (list) list.push(hit.docKey);
      else byShard.set(hit.shard, [hit.docKey]);
    }

    const hits: DistributedHit[] = [];
    const fetchPhase: DistributedSearchResult["fetchPhase"] = [];
    let bytesActuallyFetched = 0;

    for (const [shard, docKeys] of byShard) {
      const engine = this.shards[shard];
      let bytes = 0;
      for (const docKey of docKeys) {
        const candidate = merged.find((m) => m.docKey === docKey && m.shard === shard)!;
        const segment = engine.liveSegments.find((s) => s.docKeys.includes(docKey));
        const source = segment?.index.source(segment.docKeys.indexOf(docKey));
        if (!source) continue;
        bytes += sourceBytes(source);
        hits.push({
          docKey,
          source,
          score: candidate.score,
          segmentId: segment!.id,
          localDocId: candidate.localDocId,
          shard,
          servedBy: candidate.servedBy,
        });
      }
      bytesActuallyFetched += bytes;
      fetchPhase.push({ shard, docKeys, bytes });
    }

    hits.sort((a, b) => b.score - a.score || a.docKey.localeCompare(b.docKey));

    // What the naive "fetch everything during the query phase" would have cost.
    let bytesIfFetchedEverything = 0;
    for (const result of queryPhase) {
      const engine = this.shards[result.shard];
      for (const candidate of result.candidates) {
        const segment = engine.liveSegments.find((s) => s.docKeys.includes(candidate.docKey));
        const source = segment?.index.source(segment.docKeys.indexOf(candidate.docKey));
        if (source) bytesIfFetchedEverything += sourceBytes(source);
      }
    }

    // A query-phase response is an id and a float per candidate.
    const queryPhaseBytes = queryPhase.reduce(
      (sum, r) => sum + r.candidates.reduce((s, c) => s + c.docKey.length + 8, 0),
      0,
    );

    const failed = queryPhase.filter((r) => r.failed).length;
    return {
      hits,
      queryPhase,
      fetchPhase,
      bytesIfFetchedEverything,
      bytesActuallyFetched,
      queryPhaseBytes,
      shardsQueried: targetShards.length,
      shardsFailed: failed,
      partial: failed > 0,
      stats,
      tookMicros: (performance.now() - started) * 1000,
      health: this.health(),
    };
  }

  clusterState() {
    return {
      health: this.health(),
      nodes: this.nodes.map((n) => ({
        ...n,
        copies: this.copies.filter((c) => c.nodeId === n.id).length,
      })),
      shards: Array.from({ length: this.config.shardCount }, (_, shard) => ({
        shard,
        documents: this.shards[shard].visibleDocCount,
        segments: this.shards[shard].segmentCount,
        copies: this.copies.filter((c) => c.shard === shard),
      })),
      config: this.config,
      unassigned: this.copies.filter((c) => c.state === "unassigned").length,
    };
  }
}

// ---------------------------------------------------------------------------
// Chapter 33's footnote that bites in production: per-shard statistics
// ---------------------------------------------------------------------------

export interface ScoreSkewRow {
  docKey: string;
  shardedScore: number;
  shardedRank: number;
  globalScore: number;
  globalRank: number;
  rankDelta: number;
  shard: number;
}

/**
 * Each shard computes IDF from *its own* document count and document frequency.
 * With enough documents the shards look alike and nobody notices. With few
 * documents, or a skewed routing key, the same document can rank differently
 * depending only on which shard it landed in.
 *
 * Compare a sharded search against the same corpus in a single shard to see it.
 */
export function compareShardedToGlobal(
  sharded: DistributedHit[],
  global: EngineHit[],
): { rows: ScoreSkewRow[]; rankChanges: number; maxDelta: number } {
  const globalRanks = new Map(global.map((h, i) => [h.docKey, { rank: i, score: h.score }]));
  const rows: ScoreSkewRow[] = sharded.map((hit, i) => {
    const g = globalRanks.get(hit.docKey);
    return {
      docKey: hit.docKey,
      shardedScore: hit.score,
      shardedRank: i,
      globalScore: g?.score ?? 0,
      globalRank: g?.rank ?? -1,
      rankDelta: g ? i - g.rank : 0,
      shard: hit.shard,
    };
  });
  return {
    rows,
    rankChanges: rows.filter((r) => r.rankDelta !== 0).length,
    maxDelta: rows.reduce((m, r) => Math.max(m, Math.abs(r.rankDelta)), 0),
  };
}

export const ROUTING_STRATEGIES = [
  {
    name: "document id",
    describe: "Hash the document's own id.",
    good: "Spreads evenly by construction. The default for a reason.",
    bad: "A query for one tenant still has to ask every shard.",
  },
  {
    name: "tenant / customer id",
    describe: "Hash a field that groups related documents.",
    good: "One tenant lives on one shard, so their queries touch one shard instead of all of them.",
    bad: "One large tenant becomes a hot shard, and no amount of adding nodes fixes it.",
  },
  {
    name: "constant",
    describe: "Everything routes to the same value.",
    good: "Nothing. This is the failure mode, shown so you can recognise it.",
    bad: "One shard holds the entire index while the rest idle.",
  },
];
