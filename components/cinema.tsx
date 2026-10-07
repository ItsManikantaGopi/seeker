"use client";

/**
 * Cinematic primitives — the motion layer for the site.
 *
 * Everything here obeys two rules:
 *
 *   1. The spectacle is real. Chips come from the actual analyzer, scores from
 *      the actual BM25 runner, orbits from the actual Levenshtein automaton
 *      walked over the actual term dictionary. Nothing is hardcoded decoration.
 *   2. Motion is deterministic. Every "random-looking" position is derived from
 *      indices with integer math, so server render and hydration agree.
 *
 * Hues stay confined to the --vis-* accents; everything else rides the
 * monochrome ramp from globals.css.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { CORPUS } from "@/lib/kaus/corpus";

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

/** Scroll-triggered entrance. Hidden until it enters the viewport, then the
 *  .reveal transition plays (stagger via `delay`). */
export function Reveal({
  children,
  delay = 0,
  y = 20,
  className = "",
}: {
  children: ReactNode;
  /** Stagger in milliseconds. */
  delay?: number;
  /** Rise distance in pixels. */
  y?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // If motion is off, the CSS already forces .reveal visible — but add the
    // class anyway so intermediate states never flash.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.classList.add("is-visible");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add("is-visible");
            io.disconnect();
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -32px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${className}`}
      style={{ "--reveal-delay": `${delay}ms`, "--reveal-y": `${y}px` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/** Card whose surface catches a cursor-tracked pool of light (.spot-card). */
export function Spotlight({
  children,
  className = "",
  color,
}: {
  children: ReactNode;
  className?: string;
  /** Any CSS colour; defaults to ink at low alpha. */
  color?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      className={`spot-card ${className}`}
      style={color ? ({ "--spot-color": color } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

/** Seamless marquee. Children are rendered twice; the track slides exactly one
 *  half per loop, so the seam is invisible. */
export function Ticker({
  children,
  duration = 36,
  className = "",
}: {
  children: ReactNode;
  /** Seconds per full loop. */
  duration?: number;
  className?: string;
}) {
  return (
    <div className={`ticker-mask ${className}`}>
      <div className="ticker-track" style={{ "--ticker-dur": `${duration}s` } as CSSProperties}>
        <div className="flex shrink-0 items-center">{children}</div>
        <div className="flex shrink-0 items-center" aria-hidden="true">
          {children}
        </div>
      </div>
    </div>
  );
}

/** A soft stripe of light sweeping across the parent (parent must be relative). */
export function BeamSweep({
  delay = 0,
  duration = 5.5,
  className = "",
}: {
  delay?: number;
  duration?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`beam-sweep ${className}`}
      style={{ "--beam-delay": `${delay}s`, "--beam-dur": `${duration}s` } as CSSProperties}
    />
  );
}

/** Viewfinder corner brackets — frames a section like a camera shot. */
export function ViewfinderTicks({ inset = 10 }: { inset?: number }) {
  const base: CSSProperties = {
    position: "absolute",
    width: 14,
    height: 14,
    borderColor: "var(--border-strong)",
    pointerEvents: "none",
  };
  return (
    <div aria-hidden="true">
      <span style={{ ...base, top: inset, left: inset, borderTop: "1px solid", borderLeft: "1px solid" }} />
      <span style={{ ...base, top: inset, right: inset, borderTop: "1px solid", borderRight: "1px solid" }} />
      <span style={{ ...base, bottom: inset, left: inset, borderBottom: "1px solid", borderLeft: "1px solid" }} />
      <span style={{ ...base, bottom: inset, right: inset, borderBottom: "1px solid", borderRight: "1px solid" }} />
    </div>
  );
}

/** Editorial kicker label: rule — small caps — fading rule. */
export function SectionKicker({
  children,
  tone,
}: {
  children: ReactNode;
  /** Optional accent colour for the text (a --vis-* hue). */
  tone?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="h-px w-8 shrink-0" style={{ background: "var(--border-strong)" }} />
      <span
        className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em]"
        style={tone ? { color: tone } : { color: "var(--text-muted)" }}
      >
        {children}
      </span>
      <span
        aria-hidden="true"
        className="h-px flex-1"
        style={{ background: "linear-gradient(90deg, var(--border), transparent)" }}
      />
    </div>
  );
}

/** Wraps a section in film language: grain plate + light beam + optional
 *  viewfinder ticks. Content stays above the overlays. */
export function CinemaFrame({
  children,
  className = "",
  grain = true,
  beam = true,
  ticks = false,
}: {
  children: ReactNode;
  className?: string;
  grain?: boolean;
  beam?: boolean;
  ticks?: boolean;
}) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {grain && <div aria-hidden="true" className="film-grain" />}
      {beam && <BeamSweep />}
      {ticks && <ViewfinderTicks />}
      <div className="relative">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vignette 1 — TokenStreamViz: Step-by-step animated analyzer pipeline
// ---------------------------------------------------------------------------

const RAW_SAMPLE = "Kubernetes DEPLOYMENTS & pods running on redis-cluster_v2!";

/** An animated step-through of how raw text turns into indexed terms */
export function TokenStreamViz() {
  const [step, setStep] = useState(0);

  // 4 clear pipeline stages
  const stages = useMemo(() => [
    {
      id: "raw",
      name: "01 · Raw Input",
      desc: "Source document text arrives with mixed case, punctuation, and delimiters",
      items: ["Kubernetes", "DEPLOYMENTS", "&", "pods", "running", "on", "redis-cluster_v2!"],
      highlight: [0, 1, 6],
    },
    {
      id: "split",
      name: "02 · Tokenizer & Word Delimiters",
      desc: "Standard tokenizer splits on whitespace/punctuation, expands 'redis-cluster_v2' into sub-words",
      items: ["Kubernetes", "DEPLOYMENTS", "pods", "running", "on", "redis", "cluster", "v2"],
      highlight: [5, 6, 7],
    },
    {
      id: "filter",
      name: "03 · Lowercase & Stopwords",
      desc: "Case normalized; English stopwords ('on') filtered out so only searchable terms continue",
      items: ["kubernetes", "deployments", "pods", "running", "redis", "cluster", "v2"],
      highlight: [0, 1],
    },
    {
      id: "stem",
      name: "04 · Porter Stemmer → Final Terms",
      desc: "Suffixes stripped ('deployments' → 'deploy', 'running' → 'run') so morphological variants match",
      items: ["kubernet", "deploy", "pod", "run", "redi", "cluster", "v2"],
      highlight: [0, 1, 2, 3],
    },
  ], []);

  useEffect(() => {
    const id = setInterval(() => {
      setStep((s) => (s + 1) % 4);
    }, 2800);
    return () => clearInterval(id);
  }, []);

  const current = stages[step];

  return (
    <div className="rounded-xl border border-edge bg-raised p-3.5 flex flex-col justify-between h-[230px]">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">
            analysis chain · stage {step + 1}/4
          </span>
          <div className="flex gap-1">
            {stages.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setStep(i)}
                aria-label={`Go to stage ${i + 1}`}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  step === i ? "w-5 bg-[var(--vis-index)]" : "w-1.5 bg-edge hover:bg-muted"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="font-mono text-[12px] font-semibold text-ink mb-1">
          {current.name}
        </div>
        <p className="text-[11.5px] text-muted leading-tight mb-3 min-h-[30px]">
          {current.desc}
        </p>
      </div>

      {/* Animated token stream visual */}
      <div className="rounded-lg border border-edge bg-sunken p-2.5 min-h-[72px] flex items-center">
        <div className="flex flex-wrap gap-1.5 w-full">
          {current.items.map((token, i) => {
            const isHigh = current.highlight.includes(i);
            return (
              <span
                key={`${step}-${token}-${i}`}
                className="node-pop inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] transition-all"
                style={{
                  animationDelay: `${i * 45}ms`,
                  borderColor: isHigh ? "var(--vis-index)" : "var(--border)",
                  backgroundColor: isHigh ? "var(--vis-index-soft)" : "var(--bg-raised)",
                  color: isHigh ? "var(--vis-index-text)" : "var(--text)",
                }}
              >
                {token}
              </span>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-faint border-t border-edge pt-1.5">
        <span>input: &quot;{RAW_SAMPLE.slice(0, 32)}...&quot;</span>
        <span className="text-[var(--vis-index-text)] font-semibold">{current.items.length} tokens</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vignette 2 — PostingsIntersectViz: Step-by-step postings merge & BM25 rank
// ---------------------------------------------------------------------------

/** Visualizes how posting lists for multiple query terms intersect & compute scores */
export function PostingsIntersectViz() {
  const [activeIdx, setActiveIdx] = useState(0);

  // Real matching data from Kaus demo
  const sampleDocs = useMemo(() => [
    { docId: 0, title: "Kubernetes Deployment Guide", term1: true, term2: true, tf1: 3, tf2: 2, score: 3.103 },
    { docId: 1, title: "Kubernetes Deployment Rollback", term1: true, term2: true, tf1: 2, tf2: 2, score: 3.103 },
    { docId: 2, title: "Kubernetes Deployment Service Mesh", term1: true, term2: true, tf1: 1, tf2: 1, score: 2.767 },
    { docId: 7, title: "Redis Cache Clusters in Prod", term1: false, term2: false, tf1: 0, tf2: 0, score: 0 },
    { docId: 15, title: "Docker Compose for Local Clusters", term1: false, term2: false, tf1: 0, tf2: 0, score: 0 },
  ], []);

  useEffect(() => {
    const id = setInterval(() => {
      setActiveIdx((i) => (i + 1) % sampleDocs.length);
    }, 2200);
    return () => clearInterval(id);
  }, [sampleDocs.length]);

  const activeDoc = sampleDocs[activeIdx];
  const isMatch = activeDoc.term1 && activeDoc.term2;

  return (
    <div className="rounded-xl border border-edge bg-raised p-3.5 flex flex-col justify-between h-[230px]">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">
            postings intersection · AND query
          </span>
          <code className="rounded border border-edge bg-code px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
            &quot;kubernetes&quot; AND &quot;deployment&quot;
          </code>
        </div>
        <p className="text-[11.5px] text-muted leading-tight mb-2.5">
          Iterators step in docId lockstep. Both posting lists must contain the doc for an AND match.
        </p>
      </div>

      {/* Posting rows */}
      <div className="space-y-1.5 rounded-lg border border-edge bg-sunken p-2 font-mono text-[11px]">
        <div className="flex items-center gap-2">
          <span className="w-20 text-[10px] text-faint uppercase tracking-wider">kubernetes:</span>
          <div className="flex gap-1">
            {[0, 1, 2, 4, 5].map((d) => (
              <span
                key={d}
                className={`rounded px-1.5 py-0.5 text-[10px] transition-all ${
                  activeDoc.docId === d
                    ? "bg-[var(--vis-index)] text-white font-bold scale-110"
                    : "bg-raised border border-edge text-muted"
                }`}
              >
                doc:{d}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-20 text-[10px] text-faint uppercase tracking-wider">deployment:</span>
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4].map((d) => (
              <span
                key={d}
                className={`rounded px-1.5 py-0.5 text-[10px] transition-all ${
                  activeDoc.docId === d
                    ? "bg-[var(--vis-index)] text-white font-bold scale-110"
                    : "bg-raised border border-edge text-muted"
                }`}
              >
                doc:{d}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Live evaluation panel */}
      <div className="mt-2 flex items-center justify-between rounded-md border border-edge bg-raised px-2.5 py-1.5 font-mono text-[11px]">
        <div className="flex items-center gap-2 truncate">
          <span className={`h-2 w-2 rounded-full ${isMatch ? "bg-emerald-500 animate-pulse" : "bg-zinc-400"}`} />
          <span className="truncate text-ink">doc {activeDoc.docId} · {activeDoc.title}</span>
        </div>
        <div className="shrink-0 text-[10.5px]">
          {isMatch ? (
            <span className="font-semibold" style={{ color: "var(--vis-index-text)" }}>
              BM25: {activeDoc.score.toFixed(3)}
            </span>
          ) : (
            <span className="text-faint">skipped</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vignette 3 — TriePruningViz: Levenshtein Automaton Trie Walk & Pruning
// ---------------------------------------------------------------------------

/** Visualizes how a fuzzy search intersects an automaton with a trie and prunes dead branches */
export function TriePruningViz() {
  const [step, setStep] = useState(0);

  const explorationSteps = useMemo(() => [
    {
      prefix: "k",
      nodeLabel: "k",
      state: "d=0 (exact)",
      pruned: false,
      accepted: false,
      desc: "Step 1: 'k' matches query root. Edit distance remains 0.",
      subtrees: ["ku...", "ka... (kafka)"],
    },
    {
      prefix: "ku",
      nodeLabel: "ku",
      state: "d=0 (exact)",
      pruned: false,
      accepted: false,
      desc: "Step 2: Walk 'ku'. Active candidate prefix for 'kubernetes'.",
      subtrees: ["kube...", "kubernets..."],
    },
    {
      prefix: "ka",
      nodeLabel: "ka (kafka)",
      state: "d=2 (threshold)",
      pruned: true,
      accepted: false,
      desc: "Step 3: 'kafka' branch hits distance limit (d > 2) → Subtree PRUNED immediately!",
      subtrees: ["✕ pruned 12 terms"],
    },
    {
      prefix: "kubernetes",
      nodeLabel: "kubernetes",
      state: "d=1 (accepting)",
      pruned: false,
      accepted: true,
      desc: "Step 4: 'kubernetes' reached with 1 edit (transposition) → MATCH ACCEPTED!",
      subtrees: ["✓ matched doc 0, 1, 2"],
    },
  ], []);

  useEffect(() => {
    const id = setInterval(() => {
      setStep((s) => (s + 1) % 4);
    }, 2600);
    return () => clearInterval(id);
  }, []);

  const cur = explorationSteps[step];

  return (
    <div className="rounded-xl border border-edge bg-raised p-3.5 flex flex-col justify-between h-[230px]">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">
            automaton trie walk · fuzzy(~2)
          </span>
          <code className="rounded border border-edge bg-code px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
            fuzzy(&quot;kubernets&quot;)
          </code>
        </div>
        <p className="text-[11.5px] text-muted leading-tight mb-2">
          Shared trie prefixes allow the automaton to eliminate thousands of non-matching terms in one step.
        </p>
      </div>

      {/* Trie traversal step diagram */}
      <div className="rounded-lg border border-edge bg-sunken p-2.5 font-mono text-[11px]">
        <div className="flex items-center justify-between mb-1">
          <span className="text-faint text-[10px]">CURRENT TRIE NODE:</span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
              cur.pruned
                ? "bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/40"
                : cur.accepted
                ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/40"
                : "bg-[var(--vis-query-soft)] text-[var(--vis-query-text)] border border-[var(--vis-query)]"
            }`}
          >
            {cur.state}
          </span>
        </div>

        <div className="flex items-center gap-2 my-1.5">
          <div className="px-2 py-1 rounded border border-edge bg-raised font-bold text-ink text-[12px]">
            /{cur.prefix}
          </div>
          <span className="text-faint text-[11px]">→</span>
          <div className="flex-1 text-[11px] truncate text-muted">
            {cur.subtrees.join(" · ")}
          </div>
        </div>
      </div>

      {/* Explanation caption */}
      <div className="mt-2 rounded-md border border-edge bg-raised px-2.5 py-1.5 text-[11px] leading-tight text-ink">
        <span className="font-semibold text-[var(--vis-query-text)]">Action: </span>
        {cur.desc}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vignette 4 — PointIndexRangeViz: 1D / 2D Range & BKD Tree Query Animation
// ---------------------------------------------------------------------------

/** Visualizes numeric/spatial range searches splitting space instead of full scanning */
export function PointIndexRangeViz() {
  const [activeRange, setActiveRange] = useState(0);

  const ranges = useMemo(() => [
    { label: "price: [100 TO 200]", count: 4, docs: ["doc-1", "doc-8", "doc-16", "doc-22"], pctMin: 25, pctMax: 50 },
    { label: "price: [200 TO 400]", count: 7, docs: ["doc-3", "doc-5", "doc-11", "doc-14", "+3 more"], pctMin: 50, pctMax: 80 },
    { label: "price: [0 TO 50]", count: 3, docs: ["doc-0", "doc-9", "doc-15"], pctMin: 0, pctMax: 20 },
  ], []);

  useEffect(() => {
    const id = setInterval(() => {
      setActiveRange((r) => (r + 1) % ranges.length);
    }, 2600);
    return () => clearInterval(id);
  }, [ranges.length]);

  const cur = ranges[activeRange];

  return (
    <div className="rounded-xl border border-edge bg-raised p-3.5 flex flex-col justify-between h-[230px]">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">
            point index · numeric bkd
          </span>
          <code className="rounded border border-edge bg-code px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
            {cur.label}
          </code>
        </div>
        <p className="text-[11.5px] text-muted leading-tight mb-2">
          Numeric ranges don&apos;t scan text. Sorted point leaves isolate matching documents in O(log N) time.
        </p>
      </div>

      {/* Interactive 1D range slider visualizer */}
      <div className="rounded-lg border border-edge bg-sunken p-2.5">
        <div className="relative h-4 w-full rounded-full bg-raised border border-edge overflow-hidden mb-2">
          <div
            className="absolute top-0 bottom-0 bg-[var(--vis-neutral)] opacity-40 transition-all duration-500 rounded"
            style={{
              left: `${cur.pctMin}%`,
              width: `${cur.pctMax - cur.pctMin}%`,
            }}
          />
        </div>
        <div className="flex justify-between text-[9.5px] font-mono text-faint">
          <span>$0.00</span>
          <span>$100.00</span>
          <span>$200.00</span>
          <span>$300.00</span>
          <span>$500.00</span>
        </div>
      </div>

      {/* Result feedback */}
      <div className="mt-2 flex items-center justify-between border-t border-edge pt-1.5 text-[10.5px] font-mono">
        <span className="text-muted">Matched: {cur.docs.join(", ")}</span>
        <span className="font-bold text-ink">{cur.count} documents</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vignette 4 — CorpusTicker: real documents sliding past like credits
// ---------------------------------------------------------------------------

export function CorpusTicker() {
  const rows = useMemo(
    () =>
      CORPUS.map((d) => ({
        id: d.id,
        title: d.title,
        status: d.status,
        price: d.price,
      })),
    [],
  );

  return (
    <Ticker duration={46}>
      <span className="flex shrink-0 items-center">
        {rows.map((r) => (
          <span key={r.id} className="mx-5 inline-flex items-baseline gap-2 whitespace-nowrap">
            <span className="font-mono text-[10.5px] text-faint">{r.id}</span>
            <span className="text-[12.5px] font-medium text-ink">{r.title}</span>
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-faint">· {r.status}</span>
            <span className="font-mono text-[10.5px]" style={{ color: "var(--vis-index-text)" }}>
              ${r.price.toFixed(2)}
            </span>
          </span>
        ))}
      </span>
    </Ticker>
  );
}
