import Link from "next/link";
import { CHAPTERS, PARTS, QUESTION_TO_STRUCTURE, ROADMAP } from "@/lib/chapters";
import { CORPUS } from "@/lib/seeker/corpus";
import { HomePipelineViz } from "@/components/home-pipeline-viz";
import { Card, CardGrid } from "@/components/ui";

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII"];

function chapterHref(number: number): string {
  return `/ch/${CHAPTERS.find((c) => c.number === number)?.slug ?? ""}`;
}

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
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 lg:px-8 lg:py-12 space-y-8">
      {/* Hero */}
      <Card tone="raised" padding="lg">
        <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
          Technical manuscript · 2026 edition
        </div>
        <h1 className="max-w-[18ch] text-[34px] font-bold leading-[1.08] tracking-tight text-ink lg:text-[52px]">
          Building a search engine from first principles.
        </h1>
        <p className="mt-4 max-w-[62ch] text-[15px] leading-relaxed text-muted lg:text-[16.5px]">
          Every structure in this book is implemented here, in TypeScript, running in your browser — an
          inverted index over {CORPUS.length} real documents, BM25 with the arithmetic shown, Levenshtein
          automata, minimized automata, FSTs with outputs, BKD trees, a byte-level segment format with real
          checksums, and a cluster you can break.
        </p>
        <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-faint">
          Nothing on this site is a recorded screenshot. Every number is computed when you load the page, by
          the same engine the chapter is describing.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/ch/what-a-search-engine-does"
            className="rounded-lg border border-transparent bg-[var(--accent)] px-5 py-2.5 text-[13.5px] font-medium text-[var(--bg-raised)] shadow-sm transition-transform hover:-translate-y-0.5"
          >
            Start at chapter 1
          </Link>
          <Link
            href="/playground"
            className="rounded-lg border border-edge bg-raised px-5 py-2.5 text-[13.5px] font-medium text-ink shadow-sm transition-all hover:-translate-y-0.5 hover:border-edge-strong"
          >
            Open the search playground
          </Link>
          <Link
            href="/tests"
            className="rounded-lg border border-edge bg-raised px-5 py-2.5 text-[13.5px] font-medium text-muted shadow-sm transition-all hover:-translate-y-0.5 hover:text-ink"
          >
            Run the differential tests
          </Link>
        </div>
      </Card>

      {/* The method */}
      <Card tone="accent" padding="md">
        <div className="font-mono text-[13px] leading-relaxed text-accent-text text-center">
          Build the simple version → discover the bottleneck → replace one component → understand why the
          advanced structure exists.
        </div>
      </Card>

      {/* Animated pipeline visualization */}
      <Card tone="raised" padding="lg">
        <h2 className="mb-2 text-[22px] font-semibold tracking-tight text-ink">The two jobs</h2>
        <p className="mb-6 max-w-[62ch] text-[14px] leading-relaxed text-muted">
          A search engine builds structures that make retrieval fast, then uses those structures to find and
          rank documents. Click any stage to jump to its chapter — hover to see what it does.
        </p>
        <div className="rounded-xl border border-edge bg-sunken p-2 sm:p-6">
          {/* Client component handles the animated pipeline */}
          <HomePipelineViz chapters={CHAPTERS} />
        </div>
      </Card>

      {/* Question → structure — visual cards */}
      <Card tone="raised" padding="lg">
        <h2 className="mb-2 text-[22px] font-semibold tracking-tight text-ink">
          There is not one search data structure
        </h2>
        <p className="mb-6 max-w-[62ch] text-[14px] leading-relaxed text-muted">
          Different questions need different structures. This is the spine of the whole book.
        </p>

        <CardGrid cols={3} gap="md">
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
              neutral: "var(--bg-raised)",
            }[tone];
            const textColor = {
              index:   "var(--vis-index-text)",
              query:   "var(--vis-query-text)",
              neutral: "var(--text-muted)",
            }[tone];
            return (
              <Link
                key={row.question}
                href={chapterHref(row.chapter)}
                className="fade-in group rounded-xl border border-edge p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-edge-strong"
                style={{
                  borderTopColor: borderColor,
                  borderTopWidth: 4,
                  background: bgColor,
                  animationDelay: `${i * 40}ms`,
                }}
              >
                <div className="text-[13px] font-medium text-ink">{row.question}</div>
                <div className="mt-2 font-mono text-[12px] font-semibold" style={{ color: textColor }}>
                  {row.structure}
                </div>
                <div className="mt-1 font-mono text-[10px] opacity-60" style={{ color: textColor }}>
                  Chapter {row.chapter}
                </div>
              </Link>
            );
          })}
        </CardGrid>
      </Card>

      {/* Parts Grid */}
      <section>
        <h2 className="mb-6 text-[22px] font-semibold tracking-tight text-ink px-2">Thirteen parts, forty-three chapters</h2>
        <CardGrid cols={2} gap="lg">
          {PARTS.map((part) => {
            const chapters = CHAPTERS.filter((c) => c.partNumber === part.number);
            const accent = PART_ACCENT[part.number] ?? "var(--border-strong)";
            return (
              <Card key={part.number} tone="raised" padding="md" className="flex flex-col h-full" style={{ borderTopColor: accent, borderTopWidth: 4 }}>
                <div className="mb-2 flex flex-wrap items-baseline gap-2">
                  <span
                    className="font-mono text-[12px] font-bold"
                    style={{ color: accent === "var(--vis-index)" ? "var(--vis-index-text)" : accent === "var(--vis-query)" ? "var(--vis-query-text)" : "var(--text-faint)" }}
                  >
                    {ROMAN[part.number]}
                  </span>
                  <h3 className="text-[16px] font-semibold tracking-tight text-ink">{part.title}</h3>
                  <span className="ml-auto font-mono text-[11px] text-faint">
                    {chapters.length} chapter{chapters.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <p className="mb-4 text-[13px] leading-relaxed text-muted flex-1">{part.blurb}</p>
                <div className="space-y-1.5 mt-auto">
                  {chapters.map((chapter) => (
                    <Link
                      key={chapter.slug}
                      href={`/ch/${chapter.slug}`}
                      className="group flex items-baseline gap-2 rounded-lg border border-transparent bg-sunken px-3 py-2 transition-colors hover:border-edge-strong hover:bg-raised hover:shadow-sm"
                    >
                      <span className="font-mono text-[11px] tabular-nums text-faint shrink-0">{chapter.number}</span>
                      <span className="text-[13px] font-medium leading-snug text-ink truncate">{chapter.title}</span>
                    </Link>
                  ))}
                </div>
              </Card>
            );
          })}
        </CardGrid>
      </section>

      {/* Roadmap */}
      <Card tone="raised" padding="lg">
        <h2 className="mb-2 text-[22px] font-semibold tracking-tight text-ink">The build order</h2>
        <p className="mb-6 max-w-[62ch] text-[14px] leading-relaxed text-muted">
          Fifteen stages, each replacing exactly one component. Do not skip an intermediate structure merely
          because you already know the name of the final one — experience the problem first.
        </p>
        <div className="scroll-x rounded-xl border border-edge bg-sunken overflow-hidden">
          <table className="w-full min-w-max border-collapse">
            <thead>
              <tr className="border-b border-edge">
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-faint">Stage</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-faint">Build</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-faint">Replace later with</th>
                <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-faint">Chapter</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] bg-raised">
              {ROADMAP.map((row) => (
                <tr key={row.stage} className="transition-colors hover:bg-sunken">
                  <td className="px-4 py-2 font-mono text-[12.5px] text-faint">{row.stage}</td>
                  <td className="px-4 py-2 font-mono text-[13px] text-ink">{row.build}</td>
                  <td className="px-4 py-2 font-mono text-[13px]" style={{ color: "var(--vis-index-text)" }}>{row.replaceWith}</td>
                  <td className="px-4 py-2 text-right">
                    <Link href={chapterHref(row.chapter)} className="rounded-md px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:bg-sunken hover:text-ink">
                      ch {row.chapter} →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <footer className="border-t border-edge pt-6 text-[12.5px] leading-relaxed text-faint">
        <p className="mb-2">
          <strong className="text-muted">Seeker</strong> — building a search engine from first principles.
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
      </footer>
    </div>
  );
}
