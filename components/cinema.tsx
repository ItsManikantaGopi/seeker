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
import { analyze, DEFAULT_ANALYZER } from "@/lib/seeker/analyzer";
import { CORPUS } from "@/lib/seeker/corpus";
import { demoContext, demoDictionary, demoIndex } from "@/lib/demo";
import { search } from "@/lib/seeker/query";

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
// Vignette 1 — TokenRain: the analyzer caught mid-fall
// ---------------------------------------------------------------------------

const RAIN_TEXT =
  "Search is data structures all the way down: Kubernetes DEPLOYMENT, rolling updates, " +
  "cache-aside Redis, BKD point indexes; a fuzzy kubernets still finds the cluster.";

/** Analyzed tokens drifting through a frame — chapter 3 as weather. */
export function TokenRain() {
  const tokens = useMemo(() => analyze(RAIN_TEXT, DEFAULT_ANALYZER).tokens, []);

  const chips = useMemo(() => {
    const seen = new Set<string>();
    return tokens
      .filter((t) => {
        if (seen.has(t.text)) return false;
        seen.add(t.text);
        return true;
      })
      .slice(0, 16)
      .map((t, i) => ({
        text: t.text,
        kind: t.type,
        // Deterministic scatter: co-prime multipliers spread values evenly.
        left: 4 + ((i * 61) % 92),
        top: 8 + ((i * 37) % 74),
        amp: 5 + (i % 4) * 3,
        dur: 6 + (i % 5),
        delay: (i % 7) * 0.55,
        amber: i % 4 === 1,
      }));
  }, [tokens]);

  return (
    <div
      className="relative h-44 overflow-hidden rounded-xl border border-edge bg-sunken"
      aria-label="Tokens produced by analyzing a sentence"
      role="img"
    >
      <div aria-hidden="true" className="film-grain" />
      {chips.map((c, i) => (
        <span
          key={`${c.text}-${i}`}
          className={`absolute whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[11px] float-drift ${
            c.amber ? "border-transparent" : "border-edge bg-raised text-muted"
          }`}
          style={
            {
              left: `${c.left}%`,
              top: `${c.top}%`,
              "--drift-amp": `${c.amp}px`,
              "--drift-dur": `${c.dur}s`,
              "--drift-delay": `${c.delay}s`,
              ...(c.amber ? { background: "var(--vis-query-soft)", color: "var(--vis-query-text)" } : {}),
            } as CSSProperties
          }
        >
          {c.text}
          <span className="ml-1.5 text-[9px] opacity-60">{c.kind}</span>
        </span>
      ))}
      <div className="absolute bottom-2 left-3 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
        analyze(text) → tokens
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vignette 2 — ScoreRace: BM25 settling into rank order
// ---------------------------------------------------------------------------

const BAR_TONES = ["var(--bar-accent)", "var(--bar-warn)", "var(--bar-info)", "var(--bar-ok)", "var(--bar-muted)"];

/** A live `match(title, …)` against the demo corpus; bars grow into their
 *  BM25 ranks on mount. */
export function ScoreRace({ text = "kubernetes deployment" }: { text?: string }) {
  const hits = useMemo(
    () =>
      search(demoContext(), { kind: "match", field: "title", text }, { topK: 5, explain: false }).hits,
    [text],
  );

  // Bars start at zero and grow on mount. Under prefers-reduced-motion the
  // global stylesheet already flattens transitions, so we only need to arm.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      // Deferred one frame so the update is not synchronous inside the effect.
      const raf = window.requestAnimationFrame(() => setArmed(true));
      return () => window.cancelAnimationFrame(raf);
    }
    const id = window.setTimeout(() => setArmed(true), 60);
    return () => window.clearTimeout(id);
  }, []);

  const max = hits[0]?.score ?? 1;

  return (
    <div className="rounded-xl border border-edge bg-raised p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-faint">bm25 race</span>
        <code className="rounded border border-edge bg-code px-1.5 py-0.5 font-mono text-[11px] text-muted">
          match(title:&quot;{text}&quot;)
        </code>
      </div>
      <div className="space-y-2">
        {hits.map((hit, i) => {
          const title = demoIndex().source(hit.docId)?.title ?? `doc ${hit.docId}`;
          const pct = Math.max(4, Math.round((hit.score / max) * 100));
          return (
            <div key={hit.docId} className="flex items-center gap-2">
              <span className="w-4 shrink-0 text-right font-mono text-[10px] text-faint">{i + 1}</span>
              <div className="relative h-6 min-w-0 flex-1 overflow-hidden rounded-md bg-sunken">
                <div
                  className="h-full rounded-md"
                  style={{
                    width: armed ? `${pct}%` : "0%",
                    background: BAR_TONES[i % BAR_TONES.length],
                    transition: `width 0.95s var(--ease-cine) ${i * 110}ms`,
                  }}
                />
                {/* difference blend keeps the label legible over every bar tone
                    in both themes (light: black fill → white text, dark: white fill → black text) */}
                <span className="absolute inset-y-0 left-2 flex max-w-full items-center truncate pr-2 font-mono text-[10.5px] text-white mix-blend-difference">
                  {title}
                </span>
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted">
                {hit.score.toFixed(3)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
        top {hits.length} of {CORPUS.length} docs · live engine output
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vignette 3 — AutomatonOrbit: the dictionary as a starfield, fuzzy hits lit
// ---------------------------------------------------------------------------

// Canvas geometry for the orbit vignette (module constants keep the memo's
// dependency list free of derived values).
const ORBIT_W = 380;
const ORBIT_H = 250;
const ORBIT_CX = ORBIT_W / 2;
const ORBIT_CY = ORBIT_H / 2;
const ORBIT_RX = 158;
const ORBIT_RY = 96;

/** Quantize so SSR and client serialize identical attribute values — raw
 *  trig output differs in the last decimal across engines and breaks hydration. */
const quant = (n: number) => Math.round(n * 100) / 100;

/** The title vocabulary laid out as an elliptical starfield; terms accepted by
 *  the Levenshtein automaton light up and get labels. */
export function AutomatonOrbit({
  term = "kubernets",
  maxEdits = 2,
}: {
  term?: string;
  maxEdits?: number;
}) {

  // Vocabulary positions + automaton verdicts in one memo, so the dependency
  // list stays honest (the geometry constants live inside it).
  const { stars, accepted, states, pruned } = useMemo(() => {
    const dict = demoDictionary("title");
    const vocab = dict.sortedTerms;
    const fuzzy = dict.fuzzy(term, { maxEdits });
    const acceptedSet = new Set(fuzzy.terms);
    const stars = vocab.map((t, i) => {
      const angle = -Math.PI / 2 + (i / Math.max(1, vocab.length)) * Math.PI * 2;
      // Deterministic radial jitter keeps the field from looking mechanical.
      const jitter = (((i * 37) % 23) - 11) * 0.9;
      return {
        term: t,
        x: quant(ORBIT_CX + Math.cos(angle) * (ORBIT_RX + jitter)),
        y: quant(ORBIT_CY + Math.sin(angle) * (ORBIT_RY + jitter * 0.55)),
        hit: acceptedSet.has(t),
      };
    });
    return {
      stars,
      accepted: fuzzy.terms,
      states: fuzzy.automatonStates,
      pruned: fuzzy.subtreesPruned,
    };
  }, [term, maxEdits]);

  const labelled = stars.filter((s) => s.hit);

  return (
    <div className="rounded-xl border border-edge bg-sunken p-3">
      <svg
        viewBox={`0 0 ${ORBIT_W} ${ORBIT_H}`}
        className="block w-full"
        role="img"
        aria-label={`Levenshtein automaton for "${term}" intersected with the term dictionary`}
      >
        {/* orbit guide */}
        <ellipse cx={ORBIT_CX} cy={ORBIT_CY} rx={ORBIT_RX} ry={ORBIT_RY} fill="none" stroke="var(--border)" strokeDasharray="2 6" />
        {/* every term in the vocabulary */}
        {stars.map((s) =>
          s.hit ? null : (
            <circle key={s.term} cx={s.x} cy={s.y} r={2} fill="var(--text-faint)" opacity={0.55} />
          ),
        )}
        {/* accepted terms glow in the query accent */}
        {stars
          .filter((s) => s.hit)
          .map((s, i) => (
            <g key={s.term} className="node-pop" style={{ animationDelay: `${120 + i * 140}ms` }}>
              <circle cx={s.x} cy={s.y} r={9} fill="var(--vis-query)" opacity={0.16} className="signal-dot" style={{ "--signal-delay": `${i * 0.45}s` } as CSSProperties} />
              <circle cx={s.x} cy={s.y} r={3.5} fill="var(--vis-query)" />
            </g>
          ))}
        {/* labels for accepted terms only — the rest stay anonymous stars */}
        {labelled.map((s) => (
          <text
            key={`label-${s.term}`}
            x={s.x}
            y={s.y - 12}
            textAnchor="middle"
            fontSize={9.5}
            fontFamily="var(--font-mono)"
            fill="var(--vis-query-text)"
          >
            {s.term}
          </text>
        ))}
        {/* centre: the misspelled query */}
        <rect x={ORBIT_CX - 44} y={ORBIT_CY - 13} width={88} height={26} rx={13} fill="var(--bg-raised)" stroke="var(--border-strong)" />
        <text x={ORBIT_CX} y={ORBIT_CY + 4} textAnchor="middle" fontSize={11} fontFamily="var(--font-mono)" fill="var(--text)">
          {term}
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-1 pb-0.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
          fuzzy(&quot;{term}&quot;, ~{maxEdits})
        </span>
        <span className="font-mono text-[10px] text-muted">
          automaton states {states} · subtrees pruned {pruned} ·{" "}
          <span style={{ color: "var(--vis-query-text)" }}>{accepted.length} terms accepted</span>
        </span>
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
