import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { CHAPTERS, chapterBySlug, neighbours, PARTS } from "@/lib/chapters";
import { LabLoader } from "@/components/labs/loader";
import { PartMindMapPanelLoader } from "@/components/labs/part-mind-map-loader";
import type { ConceptStep } from "@/components/part-mind-map";
import { BeamSweep, SectionKicker, ViewfinderTicks } from "@/components/cinema";

export function generateStaticParams() {
  return CHAPTERS.map((chapter) => ({ slug: chapter.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const chapter = chapterBySlug(slug);
  if (!chapter) return { title: "Not found" };
  return {
    title: `${chapter.number}. ${chapter.title}`,
    description: chapter.summary,
  };
}

/** Map a chapter to 3–4 concept steps for the flow strip */
function conceptSteps(partNumber: number): ConceptStep[] {
  if (partNumber === 1) return [
    { label: "Documents", sublabel: "raw input", tone: "index" },
    { label: "Analysis", sublabel: "char/token/stem", tone: "index" },
    { label: "Terms", sublabel: "what's indexed", tone: "index" },
    { label: "Retrieve", sublabel: "query hits", tone: "query" },
  ];
  if (partNumber === 2) return [
    { label: "Terms", tone: "index" },
    { label: "Inverted index", sublabel: "term→docs", tone: "index" },
    { label: "Postings", sublabel: "docId+freq+pos", tone: "index" },
    { label: "Query", tone: "query" },
  ];
  if (partNumber === 3) return [
    { label: "Candidates", tone: "query" },
    { label: "Scoring", sublabel: "BM25", tone: "query" },
    { label: "Top K", tone: "query" },
    { label: "Ranked results", tone: "query" },
  ];
  if (partNumber === 4) return [
    { label: "Field type", tone: "index" },
    { label: "Query type", tone: "query" },
    { label: "Match rules", tone: "query" },
  ];
  if (partNumber === 5) return [
    { label: "Edit distance", tone: "query" },
    { label: "Automaton", tone: "index" },
    { label: "Candidates", tone: "query" },
  ];
  if (partNumber === 6) return [
    { label: "Prefix trie", tone: "index" },
    { label: "FSM/FST", sublabel: "compressed", tone: "index" },
    { label: "Term lookup", tone: "query" },
  ];
  if (partNumber === 7) return [
    { label: "Numeric", tone: "index" },
    { label: "KD/BKD tree", sublabel: "spatial partition", tone: "index" },
    { label: "Range query", tone: "query" },
  ];
  if (partNumber === 8) return [
    { label: "Segment", sublabel: "immutable", tone: "index" },
    { label: "Byte format", tone: "index" },
    { label: "Page cache", tone: "neutral" },
  ];
  if (partNumber === 9) return [
    { label: "Query plan", tone: "query" },
    { label: "Cache", tone: "neutral" },
    { label: "Concurrency", tone: "neutral" },
  ];
  if (partNumber === 10) return [
    { label: "Shards", tone: "index" },
    { label: "Replicas", tone: "neutral" },
    { label: "Scatter-gather", tone: "query" },
  ];
  if (partNumber === 11) return [
    { label: "Refresh", tone: "index" },
    { label: "Flush", tone: "index" },
    { label: "Recovery", tone: "neutral" },
  ];
  if (partNumber === 12) return [
    { label: "Measure", tone: "neutral" },
    { label: "Capacity", tone: "neutral" },
    { label: "Observe", tone: "neutral" },
  ];
  return [
    { label: "Implement", tone: "index" },
    { label: "Test", tone: "neutral" },
    { label: "Ship", tone: "query" },
  ];
}

export default async function ChapterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const chapter = chapterBySlug(slug);
  if (!chapter) notFound();

  const part = PARTS.find((p) => p.number === chapter.partNumber)!;
  const { previous, next } = neighbours(slug);
  const steps = conceptSteps(chapter.partNumber);

  // Part-toned accents for the title card.
  const tone =
    chapter.partNumber <= 2 || (chapter.partNumber >= 6 && chapter.partNumber <= 7)
      ? "index"
      : chapter.partNumber <= 5
        ? "query"
        : "neutral";
  const accent = {
    index: "var(--vis-index)",
    query: "var(--vis-query)",
    neutral: "var(--vis-neutral)",
  }[tone];

  return (
    <article className="mx-auto max-w-[1180px] px-4 py-6 lg:px-8 lg:py-8">
      {/* ------------------------------------------- Title card — the slate */}
      <header className="relative mb-6 overflow-hidden rounded-xl border border-edge bg-raised shadow-[var(--shadow)]">
        {/* Ambient band: a part-toned wash across the top of the card. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-24"
          style={{
            background:
              `linear-gradient(180deg, color-mix(in srgb, ${accent} 10%, transparent), transparent)`,
          }}
        />
        <BeamSweep duration={9} />
        <ViewfinderTicks inset={8} />
        {/* Giant outlined chapter numeral, bleeding off the right edge. */}
        <div
          aria-hidden="true"
          className="watermark absolute -right-2 top-1/2 -translate-y-1/2 text-[150px] opacity-70 lg:text-[190px]"
        >
          {String(chapter.number).padStart(2, "0")}
        </div>

        <div className="relative p-5 lg:p-7">
          <SectionKicker tone={accent}>
            part {String(chapter.partNumber).padStart(2, "0")} · {part.title}
          </SectionKicker>
          <h1 className="mt-4 max-w-[24ch] text-[27px] font-bold leading-[1.1] tracking-tight text-ink cine-rise lg:text-[34px]" style={{ "--rise-delay": "60ms", "--rise-y": "14px" } as CSSProperties}>
            <span className="font-mono text-[0.62em] font-semibold text-faint">
              {String(chapter.number).padStart(2, "0")}{" · "}
            </span>
            {chapter.title}
          </h1>
          <p
            className="cine-rise mt-2.5 max-w-[72ch] text-[14.5px] leading-relaxed text-muted"
            style={{ "--rise-delay": "180ms", "--rise-y": "14px" } as CSSProperties}
          >
            {chapter.summary}
          </p>

          {/* The book's core pairing — the question and its structure — as one quiet line */}
          <div
            className="cine-rise mt-4 max-w-[76ch] rounded-r-lg border-l-[3px] bg-accent-soft px-3 py-2"
            style={{ borderLeftColor: accent, "--rise-delay": "300ms", "--rise-y": "14px" } as CSSProperties}
          >
            <p className="text-[12.5px] font-medium leading-relaxed text-accent-text">
              {chapter.question} Answered by{" "}
              <code className="font-mono">{chapter.structure}</code>.
            </p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-accent-text opacity-75">
              In this lab: {chapter.lab}
            </p>
          </div>
        </div>
      </header>

      {/* Concept overview — collapsed by default; opens into flow strip + mind map */}
      <PartMindMapPanelLoader slug={slug} steps={steps} />

      <div className="mt-6">
        <LabLoader slug={chapter.slug} />
      </div>

      <nav className="mt-10 flex flex-wrap items-stretch justify-between gap-3 border-t border-edge pt-5">
        {previous ? (
          <Link
            href={`/ch/${previous.slug}`}
            className="group max-w-[46%] rounded-lg border border-edge bg-raised px-3 py-2 transition-colors hover:border-edge-strong"
          >
            <div className="text-[10.5px] uppercase tracking-wider text-faint">
              ← Chapter {previous.number}
            </div>
            <div className="mt-0.5 text-[13px] font-medium text-ink">{previous.title}</div>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/ch/${next.slug}`}
            className="group max-w-[46%] rounded-lg border border-edge bg-raised px-3 py-2 text-right transition-colors hover:border-edge-strong"
          >
            <div className="text-[10.5px] uppercase tracking-wider text-faint">
              Chapter {next.number} →
            </div>
            <div className="mt-0.5 text-[13px] font-medium text-ink">{next.title}</div>
          </Link>
        ) : (
          <Link
            href="/tests"
            className="max-w-[46%] rounded-lg border border-edge bg-raised px-3 py-2 text-right transition-colors hover:border-edge-strong"
          >
            <div className="text-[10.5px] uppercase tracking-wider text-faint">Finish →</div>
            <div className="mt-0.5 text-[13px] font-medium text-ink">Run the differential tests</div>
          </Link>
        )}
      </nav>
    </article>
  );
}
