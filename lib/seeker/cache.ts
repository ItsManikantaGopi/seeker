/**
 * Caching (chapter 28).
 *
 * "A cache should be measured by hit rate, miss rate, eviction rate, memory
 * consumption and latency improvement." Hit rate alone is the metric that lets a
 * cache look great while quietly evicting everything useful, so this LRU reports
 * all of them.
 *
 * The other point the chapter makes indirectly: only *deterministic, reusable*
 * work is cacheable. A filter clause is cacheable because it does not depend on
 * scoring. A scripted score is not, because it can depend on anything.
 */

export interface CacheStats {
  lookups: number;
  hits: number;
  misses: number;
  evictions: number;
  inserts: number;
  /** Approximate bytes held, so "memory consumption" is visible too. */
  bytes: number;
}

export interface CacheEvent {
  key: string;
  kind: "hit" | "miss" | "insert" | "evict";
  /** Which key was evicted to make room, when relevant. */
  victim?: string;
}

export class LruCache<V> {
  private map = new Map<string, { value: V; bytes: number }>();
  readonly events: CacheEvent[] = [];
  readonly stats: CacheStats = {
    lookups: 0, hits: 0, misses: 0, evictions: 0, inserts: 0, bytes: 0,
  };

  constructor(public capacity: number, private readonly sizeOf: (value: V) => number = () => 1) {}

  get size(): number {
    return this.map.size;
  }

  get keys(): string[] {
    // Map preserves insertion order, and we re-insert on hit, so the last key is
    // the most recently used.
    return [...this.map.keys()];
  }

  get hitRate(): number {
    return this.stats.lookups === 0 ? 0 : this.stats.hits / this.stats.lookups;
  }

  get missRate(): number {
    return this.stats.lookups === 0 ? 0 : this.stats.misses / this.stats.lookups;
  }

  /** Evictions per insert. Above ~1 means the cache is churning, not caching. */
  get evictionRate(): number {
    return this.stats.inserts === 0 ? 0 : this.stats.evictions / this.stats.inserts;
  }

  get(key: string): V | undefined {
    this.stats.lookups++;
    const entry = this.map.get(key);
    if (!entry) {
      this.stats.misses++;
      this.events.push({ key, kind: "miss" });
      return undefined;
    }
    this.stats.hits++;
    // Re-insert to mark as most recently used.
    this.map.delete(key);
    this.map.set(key, entry);
    this.events.push({ key, kind: "hit" });
    return entry.value;
  }

  set(key: string, value: V): void {
    const bytes = this.sizeOf(value);
    const existing = this.map.get(key);
    if (existing) {
      this.stats.bytes -= existing.bytes;
      this.map.delete(key);
    }
    this.map.set(key, { value, bytes });
    this.stats.bytes += bytes;
    this.stats.inserts++;
    this.events.push({ key, kind: "insert" });

    while (this.map.size > this.capacity) {
      const victim = this.map.keys().next().value as string | undefined;
      if (victim === undefined) break;
      const evicted = this.map.get(victim);
      this.map.delete(victim);
      if (evicted) this.stats.bytes -= evicted.bytes;
      this.stats.evictions++;
      this.events.push({ key, kind: "evict", victim });
    }
  }

  /** The usual read-through helper. */
  getOrCompute(key: string, compute: () => V): { value: V; hit: boolean } {
    const cached = this.get(key);
    if (cached !== undefined) return { value: cached, hit: true };
    const value = compute();
    this.set(key, value);
    return { value, hit: false };
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
    this.events.length = 0;
    Object.assign(this.stats, {
      lookups: 0, hits: 0, misses: 0, evictions: 0, inserts: 0, bytes: 0,
    });
  }

  resize(capacity: number): void {
    this.capacity = capacity;
    while (this.map.size > this.capacity) {
      const victim = this.map.keys().next().value as string | undefined;
      if (victim === undefined) break;
      const evicted = this.map.get(victim);
      this.map.delete(victim);
      if (evicted) this.stats.bytes -= evicted.bytes;
      this.stats.evictions++;
    }
  }
}

/**
 * Which parts of a query are safe to cache.
 * A filter is deterministic and score-free, so its document set can be reused.
 * A scoring clause depends on collection statistics that change on every refresh.
 */
export interface CacheabilityVerdict {
  clause: string;
  cacheable: boolean;
  reason: string;
}

export function analyzeCacheability(kind: string, position: "filter" | "must" | "should" | "must_not"): CacheabilityVerdict {
  if (kind === "script_score") {
    return {
      clause: kind,
      cacheable: false,
      reason: "A script can read anything and return anything. There is no key that safely identifies its result.",
    };
  }
  if (position === "filter" || position === "must_not") {
    return {
      clause: `${kind} in ${position}`,
      cacheable: true,
      reason: "Required for matching but never scored, so the document set alone is the answer — reusable until the segment changes.",
    };
  }
  if (kind === "range" || kind === "term" || kind === "terms") {
    return {
      clause: `${kind} in ${position}`,
      cacheable: true,
      reason: "The matching set is stable per segment. Scores still have to be recomputed, so only the set is cached.",
    };
  }
  return {
    clause: `${kind} in ${position}`,
    cacheable: false,
    reason: "Scoring depends on collection statistics that shift with every refresh, so a cached score can be stale and wrong.",
  };
}

export const CACHE_LAYERS = [
  {
    name: "OS page cache",
    owner: "kernel",
    holds: "raw file pages of segment data",
    invalidatedBy: "the file changing — which immutable segments never do",
    note: "Free, shared, and the reason mmap works. You do not manage it; you make it easy to use by keeping locality.",
  },
  {
    name: "Query / filter cache",
    owner: "search engine",
    holds: "document sets for repeated non-scoring clauses",
    invalidatedBy: "a refresh producing new segments",
    note: "Highest leverage for dashboards, where the same filters repeat with different scoring clauses.",
  },
  {
    name: "Result cache",
    owner: "search engine or application",
    holds: "whole responses for identical requests",
    invalidatedBy: "any write, or a timer you chose",
    note: "Trades freshness for latency. Only safe once you have written down your freshness guarantee.",
  },
  {
    name: "Application cache",
    owner: "your service",
    holds: "rendered or joined output",
    invalidatedBy: "your own business events",
    note: "Cheapest hit of all, and the one most likely to serve something a user already deleted.",
  },
];
