import Link from "next/link";
import type { CSSProperties } from "react";
import { CHAPTERS, PARTS, QUESTION_TO_STRUCTURE, ROADMAP } from "@/lib/chapters";
import { CORPUS } from "@/lib/kaus/corpus";
import { demoIndex } from "@/lib/demo";
import { HomePipelineViz } from "@/components/home-pipeline-viz";
import {
  BeamSweep,
  CorpusTicker,
  PointIndexRangeViz,
  PostingsIntersectViz,
  Reveal,
  SectionKicker,
  Spotlight,
  TokenStreamViz,
  TriePruningViz,
  ViewfinderTicks,
} from "@/components/cinema";

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII"];

function chapterHref(number: number): string {
  return `/ch/${CHAPTERS.find((c) => c.number === number)?.slug ?? ""}`;
}

const HEADLINE = ["Building", "a", "search", "engine", "from", "first", "principles."];

// Part color accent (used for left border of part cards)
const PART_ACCENT: Record<number, string> = {
  1: "var(--vis-index)",
  2: "var(--vis-index)",
  3: "var(--vis-query)",
  4: "var(--vis-query)",
  5: "var(--vis-query)",
  6: "var(--vis-index)",
  7: "var(--vis-index)",
  8: "var(--vis-neutral)",
  9: "var(--vis-neutral)",
  10: "var(--vis-neutral)",
  11: "var(--vis-neutral)",
  12: "var(--vis-neutral)",
  13: "var(--vis-neutral)",
};

export default function Home() {
  const vocabularySize = demoIndex().vocabulary(["title", "body"]).length;

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-8 lg:px-8 lg:py-12">
      {/* ------------------------------------------------ Hero — the trailer */}
      <header className="relative mb-14">
        {/* Ambient set dressing: a soft ink halo behind the title. */}
        {/* Clipped: an unclipped halo widens the document on narrow viewports. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute -top-28 right-[-12%] h-[420px] w-[560px]"
            style={{
              background:
                "radial-gradient(closest-side, color-mix(in srgb, var(--text) 5%, transparent), transparent)",
            }}
          />
        </div>

        <div className="relative">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-faint">
            Kaus · a technical manuscript in motion{" "}
            <span className="caret-blink" aria-hidden="true">
              ▍
            </span>
          </div>

          {/* Word-by-word rise-and-focus entrance, pure CSS, staggered per word. */}
          <h1 className="max-w-[20ch] text-[36px] font-bold leading-[1.06] tracking-tight text-ink lg:text-[56px]">
            {HEADLINE.map((word, i) => (
              <span
                key={`${word}-${i}`}
                className="cine-rise inline-block"
                style={{ "--rise-delay": `${140 + i * 75}ms`, "--rise-y": "20px" } as CSSProperties}
              >
                {word}
                {i < HEADLINE.length - 1 ? "\u00A0" : ""}
              </span>
            ))}
          </h1>

          <p
            className="cine-rise mt-5 max-w-[64ch] text-[15px] leading-relaxed text-muted lg:text-[16.5px]"
            style={{ "--rise-delay": "760ms" } as CSSProperties}
          >
            Every structure in this book is implemented here, in TypeScript, running in your browser — an
            inverted index over {CORPUS.length} real documents, BM25 with the arithmetic shown, Levenshtein
            automata, minimized automata, FSTs with outputs, BKD trees, a byte-level segment format with real
            checksums, and a cluster you can break.
          </p>
          <p
            className="cine-rise mt-3 max-w-[64ch] text-[14px] leading-relaxed text-faint"
            style={{ "--rise-delay": "880ms" } as CSSProperties}
          >
            Nothing on this site is a recorded screenshot. Every number you are about to see was computed when
            this page loaded, by the same engine the chapters describe.
          </p>

          <div
            className="cine-rise mt-7 flex flex-wrap gap-2"
            style={{ "--rise-delay": "1000ms" } as CSSProperties}
          >
            <Link
              href="/ch/what-a-search-engine-does"
              className="rounded-lg border border-transparent bg-[var(--accent)] px-4 py-2 text-[13.5px] font-medium text-[var(--bg-raised)] transition-opacity hover:opacity-90"
            >
              Start at chapter 1
            </Link>
            <Link
              href="/playground"
              className="rounded-lg border border-edge bg-raised px-4 py-2 text-[13.5px] font-medium text-ink transition-colors hover:border-edge-strong"
            >
              Open the search playground
            </Link>
            <Link
              href="/tests"
              className="rounded-lg border border-edge bg-raised px-4 py-2 text-[13.5px] font-medium text-muted transition-colors hover:text-ink"
            >
              Run the differential tests
            </Link>
          </div>

          {/* Slate line: what got built, counted live from the engine. */}
          <div
            className="cine-rise mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-faint"
            style={{ "--rise-delay": "1120ms" } as CSSProperties}
          >
            <span>{String(CORPUS.length).padStart(2, "0")} documents</span>
            <span aria-hidden="true">·</span>
            <span>{vocabularySize} terms indexed</span>
            <span aria-hidden="true">·</span>
            <span>{CHAPTERS.length} chapters</span>
            <span aria-hidden="true">·</span>
            <span>{PARTS.length} parts</span>
            <span aria-hidden="true">·</span>
            <span>0 UI dependencies</span>
          </div>
        </div>

        {/* Credits roll: the whole corpus sliding past, marquee-style. */}
        <div className="relative mt-9 overflow-hidden border-y border-edge bg-sunken/60 py-2.5">
          <BeamSweep duration={9} />
          <div className="flex items-center gap-4">
            <span className="shrink-0 pl-1 font-mono text-[10px] uppercase tracking-[0.22em] text-faint">
              In the can
            </span>
            <div className="min-w-0 flex-1">
              <CorpusTicker />
            </div>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------ The method */}
      <Reveal className="mb-14">
        <section className="relative overflow-hidden rounded-xl border border-edge bg-accent-soft px-5 py-4">
          <BeamSweep duration={7} delay={1.2} />
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-faint">
            Director&apos;s note
          </div>
          <div className="font-mono text-[13px] leading-relaxed text-accent-text">
            Build the simple version → discover the bottleneck → replace one component → understand why the
            advanced structure exists.
          </div>
        </section>
      </Reveal>

      {/* ------------------------------------------------ The two jobs */}
      <section className="mb-14">
        <Reveal>
          <SectionKicker>scene 01 · the two jobs</SectionKicker>
          <h2 className="mt-2 mb-1 text-[19px] font-semibold tracking-tight text-ink">
            Build fast structures. Then use them.
          </h2>
          <p className="mb-5 max-w-[62ch] text-[13.5px] leading-relaxed text-muted">
            A search engine builds structures that make retrieval fast, then uses those structures to find and
            rank documents. Click any stage to jump to its chapter — hover to see what it does.
          </p>
        </Reveal>
        <HomePipelineViz chapters={CHAPTERS} />
      </section>

      {/* -------------------------------------------- NOW SHOWING — vignettes */}
      <section className="mb-14">
        <Reveal>
          <SectionKicker tone="var(--vis-query-text)">now showing · four animated concept breakdowns</SectionKicker>
          <h2 className="mt-2 mb-1 text-[19px] font-semibold tracking-tight text-ink">
            How a search engine actually works under the hood
          </h2>
          <p className="mb-5 max-w-[68ch] text-[13.5px] leading-relaxed text-muted">
            Live animated step-throughs of core algorithms and structures. Watch how raw unstructured text
            is parsed, how postings lists intersect, how automata prune tries, and how range queries work.
          </p>
        </Reveal>

        <div className="grid gap-4 md:grid-cols-2">
          <Reveal delay={0}>
            <Spotlight className="h-full rounded-xl">
              <figure className="flex h-full flex-col">
                <figcaption className="mb-2 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
                  <span>take 01 · analysis pipeline</span>
                  <span>ch 03</span>
                </figcaption>
                <div className="flex-1">
                  <TokenStreamViz />
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  <strong>Text to Terms:</strong> Step-by-step tokenization, delimiter expansion, case folding,
                  and stemming before tokens reach inverted index postings.
                </p>
              </figure>
            </Spotlight>
          </Reveal>

          <Reveal delay={100}>
            <Spotlight className="h-full rounded-xl" color="var(--vis-index)">
              <figure className="flex h-full flex-col">
                <figcaption className="mb-2 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
                  <span>take 02 · postings intersection & bm25</span>
                  <span>ch 04 · ch 08</span>
                </figcaption>
                <div className="flex-1">
                  <PostingsIntersectViz />
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  <strong>DocId Lockstep & Scoring:</strong> Multi-term AND queries advance iterators across sorted
                  posting lists and calculate live BM25 saturation scores.
                </p>
              </figure>
            </Spotlight>
          </Reveal>

          <Reveal delay={180}>
            <Spotlight className="h-full rounded-xl" color="var(--vis-query)">
              <figure className="flex h-full flex-col">
                <figcaption className="mb-2 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
                  <span>take 03 · levenshtein trie pruning</span>
                  <span>ch 14 · ch 15</span>
                </figcaption>
                <div className="flex-1">
                  <TriePruningViz />
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  <strong>Fuzzy Search Without Scanning:</strong> The Levenshtein DFA walks the trie and prunes entire
                  subtrees the moment edit distance exceeds the max threshold (d &gt; 2).
                </p>
              </figure>
            </Spotlight>
          </Reveal>

          <Reveal delay={260}>
            <Spotlight className="h-full rounded-xl" color="var(--vis-neutral)">
              <figure className="flex h-full flex-col">
                <figcaption className="mb-2 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
                  <span>take 04 · point index & bkd range</span>
                  <span>ch 20 · ch 22</span>
                </figcaption>
                <div className="flex-1">
                  <PointIndexRangeViz />
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  <strong>Fast Numeric Retrieval:</strong> Numbers and dates use 1D/2D spatial trees instead of text
                  terms, isolating target doc ranges in O(log N) time.
                </p>
              </figure>
            </Spotlight>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------- Question → structure cards */}
      <section className="mb-14">
        <Reveal>
          <SectionKicker>scene 02 · the spine</SectionKicker>
          <h2 className="mt-2 mb-1 text-[19px] font-semibold tracking-tight text-ink">
            There is not one search data structure
          </h2>
          <p className="mb-5 max-w-[62ch] text-[13.5px] leading-relaxed text-muted">
            Different questions need different structures. This is the spine of the whole book.
          </p>
        </Reveal>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {QUESTION_TO_STRUCTURE.map((row, i) => {
            // Assign tone based on chapter range
            const tone =
              row.chapter <= 7
                ? "index"
                : row.chapter <= 15
                  ? "query"
                  : "neutral";
            const borderColor = {
              index:   "var(--vis-index)",
              query:   "var(--vis-query)",
              neutral: "var(--border-strong)",
            }[tone];
            const bgColor = {
              index:   "var(--vis-index-soft)",
              query:   "var(--vis-query-soft)",
              neutral: "var(--bg-sunken)",
            }[tone];
            const textColor = {
              index:   "var(--vis-index-text)",
              query:   "var(--vis-query-text)",
              neutral: "var(--text-muted)",
            }[tone];
            return (
              <Spotlight key={row.question} className="rounded-r-xl" color={borderColor}>
                <Link
                  href={chapterHref(row.chapter)}
                  className="fade-in group block h-full rounded-r-xl border border-edge py-3 pl-4 pr-3 transition-colors hover:border-edge-strong"
                  style={{
                    borderLeftColor: borderColor,
                    borderLeftWidth: 3,
                    background: bgColor,
                    animationDelay: `${i * 40}ms`,
                  }}
                >
                  <div className="text-[12.5px] text-ink">{row.question}</div>
                  <div className="mt-1 font-mono text-[11.5px] font-semibold" style={{ color: textColor }}>
                    {row.structure}
                  </div>
                  <div className="mt-1 font-mono text-[10.5px] opacity-60" style={{ color: textColor }}>
                    ch {row.chapter}
                  </div>
                </Link>
              </Spotlight>
            );
          })}
        </div>

        <Reveal className="mt-4" y={12}>
          <p className="rounded-lg border-l-[3px] border-l-[var(--accent)] border-edge bg-accent-soft px-3 py-2 text-[13px] leading-relaxed text-accent-text">
            FST is not postings. BKD is not a text dictionary. BM25 does not find documents; it scores candidates.
          </p>
        </Reveal>
      </section>

      {/* ------------------------------------------------ Parts */}
      <section className="mb-14">
        <Reveal>
          <SectionKicker>scene 03 · the manuscript</SectionKicker>
          <h2 className="mt-2 mb-5 text-[19px] font-semibold tracking-tight text-ink">
            Thirteen parts, forty-three chapters
          </h2>
        </Reveal>
        <div className="space-y-5">
          {PARTS.map((part) => {
            const chapters = CHAPTERS.filter((c) => c.partNumber === part.number);
            const accent = PART_ACCENT[part.number] ?? "var(--border-strong)";
            return (
              <Reveal key={part.number} y={16}>
                <div
                  className="relative overflow-hidden rounded-xl border border-edge bg-raised p-4"
                  style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
                >
                <BeamSweep duration={8} delay={(part.number % 5) * 1.1} />
                <div className="relative">
                <div className="mb-1 flex flex-wrap items-baseline gap-2">
                  <span
                    className="font-mono text-[12px] font-bold"
                    style={{ color: accent === "var(--vis-index)" ? "var(--vis-index-text)" : accent === "var(--vis-query)" ? "var(--vis-query-text)" : "var(--text-faint)" }}
                  >
                    {ROMAN[part.number]}
                  </span>
                  <h3 className="text-[15px] font-semibold tracking-tight text-ink">{part.title}</h3>
                  <span className="ml-auto font-mono text-[11px] text-faint">
                    {chapters.length} chapter{chapters.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <p className="mb-3 max-w-[76ch] text-[12.5px] leading-relaxed text-muted">{part.blurb}</p>
                <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                  {chapters.map((chapter) => (
                    <Link
                      key={chapter.slug}
                      href={`/ch/${chapter.slug}`}
                      className="group rounded-lg border border-edge bg-bg px-3 py-2 transition-colors hover:border-edge-strong"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[11px] tabular-nums text-faint">{chapter.number}</span>
                        <span className="text-[12.5px] font-medium leading-snug text-ink">{chapter.title}</span>
                      </div>
                      <div className="mt-0.5 pl-6 font-mono text-[11px] leading-snug" style={{ color: accent, opacity: 0.8 }}>
                        {chapter.structure}
                      </div>
                        </Link>
                      ))}
                    </div>
                </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------ Roadmap */}
      <section className="mb-14">
        <Reveal>
          <SectionKicker>final scene · the build order</SectionKicker>
          <h2 className="mt-2 mb-1 text-[19px] font-semibold tracking-tight text-ink">
            Fifteen stages, one replacement each
          </h2>
          <p className="mb-5 max-w-[62ch] text-[13.5px] leading-relaxed text-muted">
            Do not skip an intermediate structure merely because you already know the name of the final one —
            experience the problem first.
          </p>
        </Reveal>
        <Reveal y={14}>
        <div className="scroll-x relative rounded-xl border border-edge">
          <table className="w-full min-w-max border-collapse">
            <thead>
              <tr className="border-b border-edge bg-sunken">
                <th className="px-3 py-2 text-left text-[10.5px] font-medium uppercase tracking-wider text-faint">Stage</th>
                <th className="px-3 py-2 text-left text-[10.5px] font-medium uppercase tracking-wider text-faint">Build</th>
                <th className="px-3 py-2 text-left text-[10.5px] font-medium uppercase tracking-wider text-faint">Replace later with</th>
                <th className="px-3 py-2 text-right text-[10.5px] font-medium uppercase tracking-wider text-faint">Chapter</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {ROADMAP.map((row) => (
                <tr key={row.stage} className="hover:bg-sunken/60">
                  <td className="px-3 py-1.5 font-mono text-[12px] text-faint">{row.stage}</td>
                  <td className="px-3 py-1.5 font-mono text-[12.5px] text-ink">{row.build}</td>
                  <td className="px-3 py-1.5 font-mono text-[12.5px]" style={{ color: "var(--vis-index-text)" }}>{row.replaceWith}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Link href={chapterHref(row.chapter)} className="text-[12px] text-muted underline underline-offset-2 hover:text-ink">
                      {row.chapter}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </Reveal>
      </section>

      <footer className="relative border-t border-edge pt-6 text-[12.5px] leading-relaxed text-faint">
        <p className="mb-2">
          <strong className="text-muted">Kaus</strong> — building a search engine from first principles.
          The goal is not to reproduce Lucene line for line; it is to make Lucene and OpenSearch
          understandable.
        </p>
        <p>
          Reference documentation:{" "}
          <a href="https://lucene.apache.org/" target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-ink">
            lucene.apache.org
          </a>{" "}
          ·{" "}
          <a href="https://docs.opensearch.org/" target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-ink">
          docs.opensearch.org
          </a>
        </p>
        <ViewfinderTicks inset={-2} />
      </footer>
    </div>
  );
}
