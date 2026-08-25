"use client";

/**
 * Part-level mind map panel — placed at the top of every chapter lab.
 * Shows the chapter's position within its part, its central structure,
 * and neighboring concept branches.
 */

import { useState } from "react";
import { MindMap, type MindMapData, type MindMapTone } from "@/components/mind-map";
import type { Chapter } from "@/lib/chapters";
import { Card } from "@/components/ui";

interface PartMindMapProps {
  chapter: Chapter;
  /** All chapters in the same part (used to show neighbors) */
  partChapters: Chapter[];
}

/**
 * Map a chapter's partNumber to a tone.
 * Parts 1–4 (Foundations → Query Language) → index
 * Parts 5–7 (Fuzzy, Dictionaries, Numeric) → query
 * Parts 8–13 (Storage, Production, Distributed, etc.) → neutral
 */
function partTone(partNumber: number): MindMapTone {
  if (partNumber <= 4) return "index";
  if (partNumber <= 7) return "query";
  return "neutral";
}

export function PartMindMapPanel({ chapter, partChapters }: PartMindMapProps) {
  const [open, setOpen] = useState(false);
  const tone = partTone(chapter.partNumber);

  // Build mind map data from part chapters
  const siblingLeaves = partChapters
    .filter((c) => c.slug !== chapter.slug)
    .slice(0, 6)                          // cap at 6 siblings for readability
    .map((c) => ({
      id: c.slug,
      label: c.title.length > 14 ? c.title.slice(0, 13) + "…" : c.title,
      sublabel: c.structure.length > 12 ? c.structure.slice(0, 11) + "…" : c.structure,
      tone,
    }));

  // Key concepts related to this chapter's structure
  const structureBranch = {
    id: "structure",
    label: "Structure",
    tone: "index" as MindMapTone,
    leaves: [
      { id: "s-question", label: chapter.question.length > 16 ? chapter.question.slice(0, 15) + "…" : chapter.question, tone: "index" as MindMapTone },
      { id: "s-struct",   label: chapter.structure, tone: "index" as MindMapTone },
    ],
  };

  const siblingBranch = {
    id: "part-chapters",
    label: "This Part",
    tone,
    leaves: siblingLeaves.slice(0, 4),
  };

  const data: MindMapData = {
    center: chapter.title.length > 16 ? chapter.title.slice(0, 15) + "…" : chapter.title,
    sublabel: `ch ${chapter.number}`,
    branches: [
      structureBranch,
      ...(siblingLeaves.length > 0 ? [siblingBranch] : []),
    ],
  };

  return (
    <Card tone="raised" padding="md" className="border-dashed">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <div>
          <div className="text-[13px] font-semibold text-ink">Concept mind map</div>
          <div className="mt-0.5 text-[11.5px] text-muted">
            {open
              ? "Click any node to explore — click again to close"
              : `See where ${chapter.structure} fits in the big picture`}
          </div>
        </div>
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-edge text-[12px] text-faint transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
          aria-hidden
        >
          ▾
        </div>
      </button>

      {open && (
        <div className="border-t border-edge px-4 pb-4 pt-3 fade-in">
          <div className="mb-3 flex flex-wrap gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]"
              style={{
                borderColor: "var(--vis-index)",
                background: "var(--vis-index-soft)",
                color: "var(--vis-index-text)",
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--vis-index)" }} />
              Index / structure building
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]"
              style={{
                borderColor: "var(--vis-query)",
                background: "var(--vis-query-soft)",
                color: "var(--vis-query-text)",
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--vis-query)" }} />
              Query / retrieval
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]"
              style={{
                borderColor: "var(--vis-neutral)",
                background: "var(--vis-neutral-soft)",
                color: "var(--vis-neutral-text)",
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--vis-neutral)" }} />
              Production / operations
            </span>
          </div>
          <div className="flex justify-center overflow-x-auto">
            <MindMap data={data} width={640} />
          </div>
          <p className="mt-3 text-center text-[11.5px] text-faint">
            This chapter: <strong className="text-ink">{chapter.title}</strong> — responsible structure: <strong className="font-mono text-ink">{chapter.structure}</strong>
          </p>
        </div>
      )}
    </Card>
  );
}
