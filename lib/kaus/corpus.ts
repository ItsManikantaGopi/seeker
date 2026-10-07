/**
 * The demo corpus and its mapping.
 *
 * Small enough that you can hold the whole thing in your head, varied enough to
 * demonstrate every structure in the book: repeated terms for TF saturation,
 * wildly different field lengths for length normalisation, a deliberate
 * misspelling in the vocabulary for fuzzy search, shared prefixes for the trie
 * and FST, prices for the point index, and coordinates for BKD.
 */

import { ENGLISH_ANALYZER, KEYWORD_ANALYZER, DEFAULT_ANALYZER } from "./analyzer";
import type { AnalyzerConfig } from "./analyzer";
import type { FieldMapping, SourceDoc } from "./types";

export const MAPPING: FieldMapping[] = [
  {
    name: "title",
    type: "text",
    analyzer: "standard",
    positions: true,
    description: "Analyzed into terms. Short field, so length normalisation bites hard.",
    fields: [
      {
        name: "keyword",
        type: "keyword",
        analyzer: "keyword",
        description: "The same string kept whole, for exact match, sorting and aggregation.",
      },
    ],
  },
  {
    name: "body",
    type: "text",
    analyzer: "standard",
    positions: true,
    description: "The long field. Where phrase queries and BM25 length normalisation matter.",
  },
  {
    name: "status",
    type: "keyword",
    analyzer: "keyword",
    description: "Not analyzed. `published` is one term, never `publish`.",
  },
  {
    name: "tags",
    type: "keyword",
    analyzer: "keyword",
    description: "Multi-valued keyword. Each value is its own term in the same field.",
  },
  {
    name: "author",
    type: "keyword",
    analyzer: "keyword",
    description: "Exact identity. Analyzing this would be a bug.",
  },
  { name: "price", type: "numeric", description: "Indexed as a point, not a term." },
  { name: "rating", type: "numeric", description: "Point index; also used by scripted scoring." },
  { name: "created_at", type: "date", description: "A date is a number wearing a costume." },
  { name: "location", type: "geo_point", description: "Two dimensions -> KD/BKD territory." },
];

export function analyzerFor(field: string, override?: Record<string, AnalyzerConfig>): AnalyzerConfig {
  if (override && override[field]) return override[field];
  switch (field) {
    case "title":
    case "body":
      return DEFAULT_ANALYZER;
    default:
      return KEYWORD_ANALYZER;
  }
}

export const ENGLISH = ENGLISH_ANALYZER;

/** The searchable text fields, in the order the UI should show them. */
export const TEXT_FIELDS = ["title", "body"] as const;
export const KEYWORD_FIELDS = ["status", "tags", "author", "title.keyword"] as const;
export const NUMERIC_FIELDS = ["price", "rating", "created_at"] as const;

export const CORPUS: SourceDoc[] = [
  {
    id: "doc-1",
    title: "Kubernetes Deployment Guide",
    body:
      "A deployment manages a replica set. The deployment controller reconciles desired state " +
      "with observed state. Rolling updates replace pods gradually so the service stays available.",
    status: "published",
    tags: ["kubernetes", "deployment", "guide"],
    author: "user_123",
    price: 149.99,
    rating: 4.7,
    created_at: "2026-01-14",
    lat: 37.77,
    lon: -122.42,
  },
  {
    id: "doc-2",
    title: "Docker Deployment Patterns",
    body:
      "Container images are immutable. A deployment pipeline builds an image once and promotes " +
      "the same artifact through environments. Docker layers are cached to keep builds fast.",
    status: "published",
    tags: ["docker", "deployment", "containers"],
    author: "user_204",
    price: 89.5,
    rating: 4.2,
    created_at: "2026-02-02",
    lat: 47.61,
    lon: -122.33,
  },
  {
    id: "doc-3",
    title: "Kubernetes Service Networking",
    body:
      "A service gives pods a stable virtual address. kube-proxy programs the data path. " +
      "Cluster DNS resolves service names. Headless services expose pod addresses directly.",
    status: "published",
    tags: ["kubernetes", "networking", "service"],
    author: "user_123",
    price: 129.0,
    rating: 4.9,
    created_at: "2026-01-28",
    lat: 37.79,
    lon: -122.4,
  },
  {
    id: "doc-4",
    title: "Kubernetes Kubernetes Kubernetes",
    body:
      "Kubernetes kubernetes kubernetes kubernetes kubernetes. This document exists to show " +
      "term frequency saturation: the tenth occurrence of a term is worth far less than the second.",
    status: "draft",
    tags: ["kubernetes", "test"],
    author: "user_999",
    price: 10.0,
    rating: 2.1,
    created_at: "2026-03-11",
    lat: 40.71,
    lon: -74.01,
  },
  {
    id: "doc-5",
    title: "Redis Caching Strategies",
    body:
      "Cache aside, write through and write behind. Eviction policies decide what leaves when " +
      "memory fills. Measure hit rate, miss rate and eviction rate, never just hit rate.",
    status: "published",
    tags: ["redis", "caching", "performance"],
    author: "user_311",
    price: 79.99,
    rating: 4.5,
    created_at: "2025-11-19",
    lat: 51.51,
    lon: -0.13,
  },
  {
    id: "doc-6",
    title: "Kafka Partitions and Ordering",
    body:
      "Kafka guarantees order inside a partition, not across partitions. The partition key " +
      "decides placement, which is the same idea as a routing key in a sharded search index.",
    status: "published",
    tags: ["kafka", "streaming", "partitions"],
    author: "user_204",
    price: 199.0,
    rating: 4.8,
    created_at: "2025-12-05",
    lat: 52.52,
    lon: 13.4,
  },
  {
    id: "doc-7",
    title: "Kubernets Cluster Setup",
    body:
      "This title is misspelled on purpose. Exact term lookup for kubernetes will not find it, " +
      "but a fuzzy query with one edit will. Vocabulary mistakes are normal in real corpora.",
    status: "draft",
    tags: ["kubernetes", "setup"],
    author: "user_555",
    price: 39.0,
    rating: 3.4,
    created_at: "2026-04-02",
    lat: 35.68,
    lon: 139.69,
  },
  {
    id: "doc-8",
    title: "Postgres Index Internals",
    body:
      "A B-tree index stores sorted keys in pages. Range scans walk leaf pages in order. " +
      "The planner picks an index only when it believes the selectivity justifies the random IO.",
    status: "published",
    tags: ["postgres", "indexing", "internals"],
    author: "user_311",
    price: 159.0,
    rating: 4.6,
    created_at: "2026-02-21",
    lat: 48.86,
    lon: 2.35,
  },
  {
    id: "doc-9",
    title: "Lucene Segment Merging",
    body:
      "Segments are immutable. Writes create new segments and deletes are recorded as tombstones. " +
      "A merge policy trades query speed against write amplification. Merging is never free.",
    status: "published",
    tags: ["lucene", "segments", "internals"],
    author: "user_123",
    price: 0,
    rating: 4.9,
    created_at: "2026-03-30",
    lat: 37.42,
    lon: -122.08,
  },
  {
    id: "doc-10",
    title: "Observability for Search Clusters",
    body:
      "Track p50, p95 and p99 separately. An average latency hides the queueing that actually " +
      "pages you at night. Watch segment count, merge pressure, shard skew and cache hit rate.",
    status: "published",
    tags: ["observability", "search", "operations"],
    author: "user_777",
    price: 249.0,
    rating: 4.4,
    created_at: "2026-05-08",
    lat: -33.87,
    lon: 151.21,
  },
  {
    id: "doc-11",
    title: "Terraform Module Layout",
    body:
      "Modules compose infrastructure. State is the source of truth and locking prevents two " +
      "applies from racing. Plan output is the review artifact, not the apply.",
    status: "published",
    tags: ["terraform", "infrastructure"],
    author: "user_555",
    price: 119.0,
    rating: 4.1,
    created_at: "2026-04-19",
    lat: 55.75,
    lon: 37.62,
  },
  {
    id: "doc-12",
    title: "Kubernetes Deployment Rollback",
    body:
      "A rollback moves the deployment back to a previous revision. Revision history is bounded. " +
      "Readiness probes decide whether a rolling update is allowed to continue.",
    status: "published",
    tags: ["kubernetes", "deployment", "operations"],
    author: "user_204",
    price: 99.0,
    rating: 4.3,
    created_at: "2026-06-01",
    lat: 19.08,
    lon: 72.88,
  },
  {
    id: "doc-13",
    title: "Elasticsearch Query DSL Notes",
    body:
      "match analyzes the query string, term does not. bool combines must, filter, should and " +
      "must_not. filter clauses skip scoring entirely, which makes them cacheable.",
    status: "published",
    tags: ["search", "query", "dsl"],
    author: "user_777",
    price: 0,
    rating: 4.0,
    created_at: "2026-05-22",
    lat: 52.37,
    lon: 4.9,
  },
  {
    id: "doc-14",
    title: "BM25 Tuning in Practice",
    body:
      "k1 controls how quickly term frequency saturates. b controls how strongly document length " +
      "is normalized. Tune them against judged queries, never against a single anecdote.",
    status: "published",
    tags: ["relevance", "bm25", "search"],
    author: "user_311",
    price: 0,
    rating: 4.8,
    created_at: "2026-06-14",
    lat: 59.33,
    lon: 18.07,
  },
  {
    id: "doc-15",
    title: "Docker Compose for Local Clusters",
    body:
      "Compose wires containers into one local network. It is a development convenience and not " +
      "a production scheduler. Resource limits still apply and still surprise people.",
    status: "archived",
    tags: ["docker", "local", "containers"],
    author: "user_999",
    price: 29.0,
    rating: 3.2,
    created_at: "2025-10-02",
    lat: 41.9,
    lon: 12.5,
  },
  {
    id: "doc-16",
    title: "Kubernetes Operators Explained",
    body:
      "An operator encodes operational knowledge as a controller. It watches custom resources and " +
      "drives the cluster toward the state the resource describes. Reconciliation loops forever.",
    status: "published",
    tags: ["kubernetes", "operators", "patterns"],
    author: "user_123",
    price: 179.0,
    rating: 4.7,
    created_at: "2026-07-03",
    lat: 1.35,
    lon: 103.82,
  },
  {
    id: "doc-17",
    title: "Redis Cluster Resharding",
    body:
      "Slots move between nodes while clients keep reading. Redirection tells the client where a " +
      "key now lives. Resharding is a data migration wearing an operations costume.",
    status: "published",
    tags: ["redis", "cluster", "operations"],
    author: "user_555",
    price: 139.0,
    rating: 4.2,
    created_at: "2026-07-21",
    lat: 22.32,
    lon: 114.17,
  },
  {
    id: "doc-18",
    title: "Kafka Consumer Rebalance Storms",
    body:
      "A rebalance stops consumption. Frequent rebalances cost more than slow processing. " +
      "Static membership and sane session timeouts calm the storm.",
    status: "published",
    tags: ["kafka", "streaming", "operations"],
    author: "user_204",
    price: 209.0,
    rating: 4.5,
    created_at: "2026-06-27",
    lat: -23.55,
    lon: -46.63,
  },
  {
    id: "doc-19",
    title: "Search Relevance Testing",
    body:
      "Keep a reference implementation. Compare the fast path against the slow path on the same " +
      "queries. Differential testing catches fuzzy search bugs that unit tests never see.",
    status: "published",
    tags: ["search", "testing", "relevance"],
    author: "user_777",
    price: 0,
    rating: 4.9,
    created_at: "2026-07-30",
    lat: 43.65,
    lon: -79.38,
  },
  {
    id: "doc-20",
    title: "Cloud Cost of Search Clusters",
    body:
      "Replicas multiply storage. Merges need headroom. Snapshots need headroom. Never size a " +
      "search cluster from raw source document size alone.",
    status: "published",
    tags: ["capacity", "search", "operations"],
    author: "user_311",
    price: 299.0,
    rating: 4.3,
    created_at: "2026-08-04",
    lat: 25.2,
    lon: 55.27,
  },
  {
    id: "doc-21",
    title: "Kubernetes Storage Classes",
    body:
      "A storage class describes how volumes get provisioned. Reclaim policy decides what happens " +
      "to data when a claim disappears. Getting this wrong deletes production data.",
    status: "published",
    tags: ["kubernetes", "storage"],
    author: "user_999",
    price: 109.0,
    rating: 4.0,
    created_at: "2026-05-30",
    lat: 12.97,
    lon: 77.59,
  },
  {
    id: "doc-22",
    title: "Deployment Deployment Deployment Deployment",
    body:
      "Deployment deployment deployment. A second saturation example, this time in the title, so " +
      "you can watch a very short field with a very high term frequency fight length normalisation.",
    status: "draft",
    tags: ["test", "deployment"],
    author: "user_999",
    price: 5.0,
    rating: 1.4,
    created_at: "2026-08-09",
    lat: 34.05,
    lon: -118.24,
  },
  {
    id: "doc-23",
    title: "Trie and FST Term Dictionaries",
    body:
      "A trie shares prefixes. A minimized automaton also shares suffixes. An FST adds outputs so " +
      "a term can map to a block pointer instead of merely being accepted or rejected.",
    status: "published",
    tags: ["internals", "search", "datastructures"],
    author: "user_123",
    price: 0,
    rating: 5.0,
    created_at: "2026-08-11",
    lat: 60.17,
    lon: 24.94,
  },
  {
    id: "doc-24",
    title: "BKD Trees for Numeric Ranges",
    body:
      "Sorted values plus binary search answers one dimension. Two dimensions need partitioning. " +
      "BKD partitions byte-encoded points into leaf blocks so whole subtrees can be skipped.",
    status: "published",
    tags: ["internals", "search", "datastructures"],
    author: "user_123",
    price: 0,
    rating: 5.0,
    created_at: "2026-08-12",
    lat: 37.56,
    lon: 126.98,
  },
  {
    id: "doc-25",
    title: "Kubernetes Deployment Service Mesh",
    body:
      "A mesh moves retries, timeouts and mutual TLS out of the application. The sidecar sees every " +
      "request, which is powerful and also a new failure domain to operate.",
    status: "published",
    tags: ["kubernetes", "deployment", "service", "mesh"],
    author: "user_204",
    price: 189.0,
    rating: 4.6,
    created_at: "2026-07-15",
    lat: 45.42,
    lon: -75.7,
  },
  {
    id: "doc-26",
    title: "Nginx Reverse Proxy Tuning",
    body:
      "Worker processes, connection limits and keepalive settings decide throughput. A proxy is a " +
      "queue, and every queue has a length you should have chosen deliberately.",
    status: "archived",
    tags: ["nginx", "performance"],
    author: "user_555",
    price: 59.0,
    rating: 3.8,
    created_at: "2025-09-14",
    lat: 50.11,
    lon: 8.68,
  },
  {
    id: "doc-27",
    title: "Kubernetes Autoscaling Deep Dive",
    body:
      "The horizontal pod autoscaler reacts to metrics. The cluster autoscaler reacts to pending " +
      "pods. They interact, and the interaction is where the interesting outages live.",
    status: "published",
    tags: ["kubernetes", "autoscaling", "operations"],
    author: "user_777",
    price: 169.0,
    rating: 4.4,
    created_at: "2026-08-01",
    lat: 32.08,
    lon: 34.78,
  },
  {
    id: "doc-28",
    title: "Immutable Infrastructure Notes",
    body:
      "Replace, do not patch. An immutable artifact makes rollback a routing change instead of a " +
      "repair. The same instinct produced immutable segments in search engines.",
    status: "published",
    tags: ["infrastructure", "patterns"],
    author: "user_311",
    price: 0,
    rating: 4.5,
    created_at: "2026-04-27",
    lat: 53.35,
    lon: -6.26,
  },
];

/** Chapter 42's golden corpus, verbatim, used by the differential test page. */
export const GOLDEN_CORPUS: SourceDoc[] = [
  {
    id: "D1", title: "kubernetes deployment", body: "", status: "published", tags: [],
    author: "a", price: 0, rating: 0, created_at: "2026-01-01", lat: 0, lon: 0,
  },
  {
    id: "D2", title: "docker deployment", body: "", status: "published", tags: [],
    author: "a", price: 0, rating: 0, created_at: "2026-01-01", lat: 0, lon: 0,
  },
  {
    id: "D3", title: "kubernetes service", body: "", status: "published", tags: [],
    author: "a", price: 0, rating: 0, created_at: "2026-01-01", lat: 0, lon: 0,
  },
];

/** Appendix A's worked BM25 example, verbatim. */
export const BM25_EXAMPLE_CORPUS: SourceDoc[] = [
  {
    id: "D1", title: "kubernetes kubernetes deployment", body: "", status: "published", tags: [],
    author: "a", price: 0, rating: 0, created_at: "2026-01-01", lat: 0, lon: 0,
  },
  {
    id: "D2", title: "kubernetes deployment", body: "", status: "published", tags: [],
    author: "a", price: 0, rating: 0, created_at: "2026-01-01", lat: 0, lon: 0,
  },
  {
    id: "D3", title: "docker deployment", body: "", status: "published", tags: [],
    author: "a", price: 0, rating: 0, created_at: "2026-01-01", lat: 0, lon: 0,
  },
];

export function docById(id: string): SourceDoc | undefined {
  return CORPUS.find((d) => d.id === id);
}
