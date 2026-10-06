"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

function Loading() {
  return (
    <div className="rounded-xl border border-edge bg-raised p-8 text-center">
      <div className="pulse font-mono text-[12.5px] text-faint">building the index…</div>
    </div>
  );
}

/**
 * Labs are client-only. Several of them report real timings and build real
 * indexes, so rendering them on the server would produce markup the browser
 * immediately disagrees with.
 *
 * `next/dynamic` requires its options to be an inline object literal — a shared
 * constant is rejected at build time — hence the repetition below.
 */
const REGISTRY: Record<string, ComponentType> = {
  // Part I — Foundations
  "what-a-search-engine-does": dynamic(() => import("./part01").then((m) => m.Ch01), { loading: Loading, ssr: false }),
  "documents-fields-types": dynamic(() => import("./part01").then((m) => m.Ch02), { loading: Loading, ssr: false }),
  "tokenization-normalization-stemming": dynamic(() => import("./part01").then((m) => m.Ch03), { loading: Loading, ssr: false }),

  // Part II — The First Search Engine
  "inverted-index": dynamic(() => import("./part02").then((m) => m.Ch04), { loading: Loading, ssr: false }),
  "postings-positions": dynamic(() => import("./part02").then((m) => m.Ch05), { loading: Loading, ssr: false }),
  "query-execution": dynamic(() => import("./part02").then((m) => m.Ch06), { loading: Loading, ssr: false }),

  // Part III — Relevance
  "ranking": dynamic(() => import("./part03").then((m) => m.Ch07), { loading: Loading, ssr: false }),
  "bm25": dynamic(() => import("./part03").then((m) => m.Ch08), { loading: Loading, ssr: false }),
  "unknown-words": dynamic(() => import("./part03").then((m) => m.Ch09), { loading: Loading, ssr: false }),

  // Part IV — Query Language
  "text-vs-keyword": dynamic(() => import("./part04").then((m) => m.Ch10), { loading: Loading, ssr: false }),
  "match-term-bool-range": dynamic(() => import("./part04").then((m) => m.Ch11), { loading: Loading, ssr: false }),
  "phrase-prefix-wildcard-regex": dynamic(() => import("./part04").then((m) => m.Ch12), { loading: Loading, ssr: false }),

  // Part V — Fuzzy Search
  "edit-distance": dynamic(() => import("./part05").then((m) => m.Ch13), { loading: Loading, ssr: false }),
  "levenshtein-automata": dynamic(() => import("./part05").then((m) => m.Ch14), { loading: Loading, ssr: false }),
  "candidate-terms-expansion": dynamic(() => import("./part05").then((m) => m.Ch15), { loading: Loading, ssr: false }),

  // Part VI — Term Dictionaries
  "tries": dynamic(() => import("./part06").then((m) => m.Ch16), { loading: Loading, ssr: false }),
  "finite-state-machines": dynamic(() => import("./part06").then((m) => m.Ch17), { loading: Loading, ssr: false }),
  "fsts": dynamic(() => import("./part06").then((m) => m.Ch18), { loading: Loading, ssr: false }),
  "blocktree": dynamic(() => import("./part06").then((m) => m.Ch19), { loading: Loading, ssr: false }),

  // Part VII — Numeric & Spatial Search
  "points-range-indexing": dynamic(() => import("./part07").then((m) => m.Ch20), { loading: Loading, ssr: false }),
  "kd-trees": dynamic(() => import("./part07").then((m) => m.Ch21), { loading: Loading, ssr: false }),
  "bkd-trees": dynamic(() => import("./part07").then((m) => m.Ch22), { loading: Loading, ssr: false }),

  // Part VIII — Storage Engine
  "segments": dynamic(() => import("./part08").then((m) => m.Ch23), { loading: Loading, ssr: false }),
  "byte-level-formats": dynamic(() => import("./part08").then((m) => m.Ch24), { loading: Loading, ssr: false }),
  "compression-checksums": dynamic(() => import("./part08").then((m) => m.Ch25), { loading: Loading, ssr: false }),
  "mmap-page-cache": dynamic(() => import("./part08").then((m) => m.Ch26), { loading: Loading, ssr: false }),

  // Part IX — Production Query Engine
  "query-planning": dynamic(() => import("./part09").then((m) => m.Ch27), { loading: Loading, ssr: false }),
  "caching": dynamic(() => import("./part09").then((m) => m.Ch28), { loading: Loading, ssr: false }),
  "concurrency": dynamic(() => import("./part09").then((m) => m.Ch29), { loading: Loading, ssr: false }),
  "scripted-scoring": dynamic(() => import("./part09").then((m) => m.Ch30), { loading: Loading, ssr: false }),

  // Part X — Distributed Search
  "shards": dynamic(() => import("./part10").then((m) => m.Ch31), { loading: Loading, ssr: false }),
  "replicas": dynamic(() => import("./part10").then((m) => m.Ch32), { loading: Loading, ssr: false }),
  "distributed-query-fetch": dynamic(() => import("./part10").then((m) => m.Ch33), { loading: Loading, ssr: false }),
  "routing-rescoring": dynamic(() => import("./part10").then((m) => m.Ch34), { loading: Loading, ssr: false }),

  // Part XI — Cluster & Operations
  "refresh-flush-commit": dynamic(() => import("./part11").then((m) => m.Ch35), { loading: Loading, ssr: false }),
  "recovery-replication": dynamic(() => import("./part11").then((m) => m.Ch36), { loading: Loading, ssr: false }),
  "cluster-management": dynamic(() => import("./part11").then((m) => m.Ch37), { loading: Loading, ssr: false }),

  // Part XII — Production Engineering
  "performance-engineering": dynamic(() => import("./part12").then((m) => m.Ch38), { loading: Loading, ssr: false }),
  "capacity-planning": dynamic(() => import("./part12").then((m) => m.Ch39), { loading: Loading, ssr: false }),
  "observability": dynamic(() => import("./part12").then((m) => m.Ch40), { loading: Loading, ssr: false }),

  // Part XIII — The Kaus Project
  "implementation-roadmap": dynamic(() => import("./part13").then((m) => m.Ch41), { loading: Loading, ssr: false }),
  "testing-strategy": dynamic(() => import("./part13").then((m) => m.Ch42), { loading: Loading, ssr: false }),
  "kaus-to-opensearch": dynamic(() => import("./part13").then((m) => m.Ch43), { loading: Loading, ssr: false }),
};

export function LabLoader({ slug }: { slug: string }) {
  const Lab = REGISTRY[slug];
  if (!Lab) {
    return (
      <div className="rounded-xl border border-dashed border-edge-strong p-8 text-center text-[13px] text-faint">
        No lab is registered for <code className="font-mono">{slug}</code>.
      </div>
    );
  }
  return <Lab />;
}
