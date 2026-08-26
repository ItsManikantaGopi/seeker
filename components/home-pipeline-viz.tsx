"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import type { Chapter } from "@/lib/chapters";

type StageId =
  | "documents" | "analysis" | "terms" | "dictionary" | "postings" | "points" | "segments"
  | "parse" | "retrieve" | "filter" | "score" | "topk" | "fetch";

interface Stage {
  id: StageId;
  label: string;
  question: string;
  side: "index" | "query";
  chapterSlug: string;
}

const INDEX_STAGES: Stage[] = [
  { id: "documents",  label: "Documents",     question: "What are we indexing?",          side: "index", chapterSlug: "documents-fields-types" },
  { id: "analysis",   label: "Analysis",      question: "What does the text become?",      side: "index", chapterSlug: "tokenization-normalization-stemming" },
  { id: "terms",      label: "Terms",         question: "What is actually searchable?",    side: "index", chapterSlug: "inverted-index" },
  { id: "dictionary", label: "Term dict.",    question: "Does this term exist?",           side: "index", chapterSlug: "tries" },
  { id: "postings",   label: "Inv. index",    question: "Which documents contain it?",     side: "index", chapterSlug: "inverted-index" },
  { id: "points",     label: "Point index",   question: "Which values are in range?",      side: "index", chapterSlug: "points-range-indexing" },
  { id: "segments",   label: "Segments",      question: "How is this persisted?",          side: "index", chapterSlug: "segments" },
];

const QUERY_STAGES: Stage[] = [
  { id: "parse",    label: "Parse & analyze", question: "What did the user ask for?",              side: "query", chapterSlug: "match-term-bool-range" },
  { id: "retrieve", label: "Candidates",      question: "Which documents could match?",            side: "query", chapterSlug: "query-execution" },
  { id: "filter",   label: "Filtering",       question: "Which of them are allowed?",              side: "query", chapterSlug: "query-execution" },
  { id: "score",    label: "BM25 score",      question: "How good is each match?",                 side: "query", chapterSlug: "bm25" },
  { id: "topk",     label: "Top K",           question: "Which few do we keep?",                   side: "query", chapterSlug: "ranking" },
  { id: "fetch",    label: "Fetch",           question: "What do we send back?",                   side: "query", chapterSlug: "query-execution" },
];

export function HomePipelineViz({ chapters }: { chapters: Chapter[] }) {
  const [hovered, setHovered] = useState<StageId | null>(null);

  const stageHref = (slug: string) => `/ch/${slug}`;

  function renderColumn(stages: Stage[], side: "index" | "query") {
    const color   = side === "index" ? "var(--vis-index)"      : "var(--vis-query)";
    const soft    = side === "index" ? "var(--vis-index-soft)"  : "var(--vis-query-soft)";
    const textClr = side === "index" ? "var(--vis-index-text)"  : "var(--vis-query-text)";
    const label   = side === "index"
      ? "Build — make retrieval fast"
      : "Query — find and rank";

    return (
      <div>
        {/* Column header: tone rail + live signal dot. */}
        <div className="mb-3 flex items-center gap-2">
          <span className="relative flex h-3.5 w-3.5 items-center justify-center">
            <span
              className="signal-dot absolute h-3.5 w-3.5 rounded-full"
              style={{ background: color, opacity: 0.25, "--signal-dur": "2.8s" } as CSSProperties}
            />
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          </span>
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">{label}</span>
        </div>
        <div className="space-y-1.5">
          {stages.map((stage, i) => {
            const isHov = hovered === stage.id;
            return (
              <div key={stage.id}>
                <Link
                  href={stageHref(stage.chapterSlug)}
                  className="block w-full rounded-xl border px-3 py-2.5 text-left transition-all"
                  style={{
                    borderLeftColor: color,
                    borderLeftWidth: 2,
                    borderColor: isHov ? color : "var(--border)",
                    background: isHov ? soft : "var(--bg-raised)",
                    boxShadow: isHov
                      ? `0 0 0 2px ${color}22, 0 2px 8px ${color}18`
                      : "var(--shadow)",
                  }}
                  onMouseEnter={() => setHovered(stage.id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <div
                    className="text-[12.5px] font-semibold transition-colors"
                    style={{ color: isHov ? textClr : "var(--text)" }}
                  >
                    {stage.label}
                  </div>
                  <div className="mt-0.5 text-[11px] opacity-70" style={{ color: isHov ? textClr : "var(--text-muted)" }}>
                    {stage.question}
                  </div>
                </Link>
                {i < stages.length - 1 && (
                  /* Connector wire: dashed line with marching dashes; when the
                     stage below or above is hovered the signal intensifies via
                     colour, otherwise it stays faint. */
                  <div className="flex items-center justify-center py-[3px]">
                    <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
                      <line
                        x1="5" y1="0" x2="5" y2="16"
                        stroke={isHov ? color : "var(--border-strong)"}
                        strokeWidth="1.5"
                        strokeDasharray="3 4"
                        className="flow-march"
                      />
                      <path d="M2 12 L5 15 L8 12" fill="none" stroke={isHov ? color : "var(--border-strong)"} strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const activeStage = hovered
    ? ([...INDEX_STAGES, ...QUERY_STAGES]).find((s) => s.id === hovered)
    : null;

  return (
    <div className="rounded-xl border border-edge bg-raised p-5 shadow-[var(--shadow)]">
      <div className="grid gap-6 lg:grid-cols-2">
        {renderColumn(INDEX_STAGES, "index")}
        {renderColumn(QUERY_STAGES, "query")}
      </div>

      {/* Active stage tooltip strip */}
      <div
        className="mt-4 h-[40px] overflow-hidden rounded-lg border border-edge bg-sunken px-3 transition-all"
        style={{ opacity: activeStage ? 1 : 0.4 }}
      >
        <div className="flex h-full items-center gap-3">
          {activeStage ? (
            <>
              <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                <span
                  className="signal-dot absolute h-2.5 w-2.5 rounded-full"
                  style={{
                    background: activeStage.side === "index" ? "var(--vis-index)" : "var(--vis-query)",
                    opacity: 0.3,
                  }}
                />
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: activeStage.side === "index" ? "var(--vis-index)" : "var(--vis-query)" }}
                />
              </span>
              <span className="font-semibold text-[12.5px] text-ink">{activeStage.label}</span>
              <span className="text-[12px] text-muted">{activeStage.question}</span>
              <span
                className="ml-auto text-[11.5px] underline underline-offset-2"
                style={{ color: activeStage.side === "index" ? "var(--vis-index-text)" : "var(--vis-query-text)" }}
              >
                → chapter
              </span>
            </>
          ) : (
            <span className="text-[12px] text-faint">Hover a stage to see what it does · click to jump to its chapter</span>
          )}
        </div>
      </div>
    </div>
  );
}
