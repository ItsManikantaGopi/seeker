import Link from "next/link";
import { notFound } from "next/navigation";
import { CHAPTERS, chapterBySlug, neighbours, PARTS } from "@/lib/chapters";
import { LabLoader } from "@/components/labs/loader";
import { PartMindMapPanelLoader } from "@/components/labs/part-mind-map-loader";
import type { ConceptStep } from "@/components/part-mind-map";

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

  return (
    <article className="mx-auto max-w-[1180px] px-4 py-6 lg:px-8 lg:py-8">
      <header className="mb-5">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
          <span>Part {chapter.partNumber} · {part.title}</span>
          <span aria-hidden>·</span>
          <span>Chapter {chapter.number}</span>
        </div>
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink lg:text-[32px]">
          {chapter.title}
        </h1>
        <p className="mt-2 max-w-[70ch] text-[14.5px] leading-relaxed text-muted">
          {chapter.summary}
        </p>

        {/* The book's core pairing — the question and its structure — as one quiet line */}
        <div className="mt-3 max-w-[76ch] rounded-r-lg border-l-[3px] border-l-[var(--accent)] bg-accent-soft px-3 py-2">
          <p className="text-[12.5px] font-medium leading-relaxed text-accent-text">
            {chapter.question} Answered by{" "}
            <code className="font-mono">{chapter.structure}</code>.
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-accent-text opacity-75">
            In this lab: {chapter.lab}
          </p>
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
