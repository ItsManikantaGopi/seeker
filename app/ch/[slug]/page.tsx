import Link from "next/link";
import { notFound } from "next/navigation";
import { CHAPTERS, chapterBySlug, neighbours, PARTS } from "@/lib/chapters";
import { LabLoader } from "@/components/labs/loader";
import { PartMindMapPanelLoader } from "@/components/labs/part-mind-map-loader";

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
function conceptSteps(partNumber: number): { label: string; sublabel?: string; tone?: "index" | "query" | "neutral" }[] {
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
      <header className="mb-6">
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

        {/* Concept flow strip */}
        <div className="mt-4">
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
            Concept flow
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {steps.map((step, i) => {
              const toneStyles = {
                index: { border: "var(--vis-index)", bg: "var(--vis-index-soft)", text: "var(--vis-index-text)" },
                query: { border: "var(--vis-query)", bg: "var(--vis-query-soft)", text: "var(--vis-query-text)" },
                neutral: { border: "var(--border-strong)", bg: "var(--bg-sunken)", text: "var(--text-muted)" },
              }[step.tone ?? "neutral"];
              return (
                <div key={i} className="flex items-center gap-1.5">
                  <div
                    className="strip-slide rounded-lg border px-2.5 py-1.5"
                    style={{
                      borderColor: toneStyles.border,
                      background: toneStyles.bg,
                      animationDelay: `${i * 60}ms`,
                    }}
                  >
                    <div className="text-[12px] font-semibold leading-tight" style={{ color: toneStyles.text }}>
                      {step.label}
                    </div>
                    {step.sublabel && (
                      <div className="mt-0.5 font-mono text-[10px] opacity-70" style={{ color: toneStyles.text }}>
                        {step.sublabel}
                      </div>
                    )}
                  </div>
                  {i < steps.length - 1 && (
                    <span className="font-mono text-[11px] text-faint">→</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-edge bg-raised px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">
              The question
            </div>
            <div className="mt-1 text-[13px] leading-snug text-ink">{chapter.question}</div>
          </div>
          <div
            className="rounded-lg border px-3 py-2.5"
            style={{ borderColor: "var(--vis-index)", background: "var(--vis-index-soft)" }}
          >
            <div
              className="text-[10px] font-semibold uppercase tracking-wider opacity-70"
              style={{ color: "var(--vis-index-text)" }}
            >
              The structure responsible
            </div>
            <div
              className="mt-1 font-mono text-[13px] leading-snug"
              style={{ color: "var(--vis-index-text)" }}
            >
              {chapter.structure}
            </div>
          </div>
        </div>

        <p className="mt-3 text-[12.5px] italic leading-relaxed text-faint">
          In this lab: {chapter.lab}
        </p>
      </header>

      {/* Interactive mind map panel (client-rendered) */}
      <PartMindMapPanelLoader slug={slug} />

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
