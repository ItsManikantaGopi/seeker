"use client";

import dynamic from "next/dynamic";
import { CHAPTERS, chapterBySlug, PARTS } from "@/lib/chapters";

const PartMindMapPanel = dynamic(
  () => import("@/components/part-mind-map").then((m) => m.PartMindMapPanel),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-xl border border-edge bg-raised px-4 py-3">
        <div className="pulse font-mono text-[12.5px] text-faint">loading mind map…</div>
      </div>
    ),
  },
);

export function PartMindMapPanelLoader({ slug }: { slug: string }) {
  const chapter = chapterBySlug(slug);
  if (!chapter) return null;

  const partChapters = CHAPTERS.filter((c) => c.partNumber === chapter.partNumber);

  return <PartMindMapPanel chapter={chapter} partChapters={partChapters} />;
}
