import Link from "next/link";
import { notFound } from "next/navigation";
import { CHAPTERS, chapterBySlug, neighbours, PARTS } from "@/lib/chapters";
import { LabLoader } from "@/components/labs/loader";

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

export default async function ChapterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const chapter = chapterBySlug(slug);
  if (!chapter) notFound();

  const part = PARTS.find((p) => p.number === chapter.partNumber)!;
  const { previous, next } = neighbours(slug);

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

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-edge bg-raised px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">
              The question
            </div>
            <div className="mt-1 text-[13px] leading-snug text-ink">{chapter.question}</div>
          </div>
          <div className="rounded-lg border border-edge bg-accent-soft px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-accent-text opacity-70">
              The structure responsible
            </div>
            <div className="mt-1 font-mono text-[13px] leading-snug text-accent-text">
              {chapter.structure}
            </div>
          </div>
        </div>

        <p className="mt-3 text-[12.5px] italic leading-relaxed text-faint">
          In this lab: {chapter.lab}
        </p>
      </header>

      <LabLoader slug={chapter.slug} />

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
