"use client";

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MindMapTone = "index" | "query" | "neutral";

export interface MindMapLeaf {
  id: string;
  label: string;
  sublabel?: string;
  tone?: MindMapTone;
}

export interface MindMapBranch {
  id: string;
  label: string;
  tone: MindMapTone;
  leaves: MindMapLeaf[];
}

export interface MindMapData {
  center: string;
  sublabel?: string;
  branches: MindMapBranch[];
}

// ---------------------------------------------------------------------------
// Color helpers (read CSS vars at runtime so dark mode works)
// ---------------------------------------------------------------------------

const TONE_FILL: Record<MindMapTone, string> = {
  index:   "var(--vis-index-soft)",
  query:   "var(--vis-query-soft)",
  neutral: "var(--vis-neutral-soft)",
};
const TONE_STROKE: Record<MindMapTone, string> = {
  index:   "var(--vis-index)",
  query:   "var(--vis-query)",
  neutral: "var(--vis-neutral)",
};
const TONE_TEXT: Record<MindMapTone, string> = {
  index:   "var(--vis-index-text)",
  query:   "var(--vis-query-text)",
  neutral: "var(--vis-neutral-text)",
};

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** Convert polar coords (angle in radians, radius) to {x, y} */
function polar(cx: number, cy: number, angle: number, r: number) {
  return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
}

/** Compute the approximate pixel length of a straight SVG path segment */
function segLen(x1: number, y1: number, x2: number, y2: number) {
  return Math.hypot(x2 - x1, y2 - y1);
}

/** Build a cubic bezier control points that curves gently from center to node */
function bezierPath(
  x1: number, y1: number,
  x2: number, y2: number,
  tension = 0.35,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx1 = x1 + dx * tension;
  const cy1 = y1 + dy * tension;
  const cx2 = x2 - dx * tension;
  const cy2 = y2 - dy * tension;
  return `M ${x1} ${y1} C ${cx1} ${cy1} ${cx2} ${cy2} ${x2} ${y2}`;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

interface BranchLayout {
  branch: MindMapBranch;
  angle: number;
  branchX: number;
  branchY: number;
  leaves: { leaf: MindMapLeaf; x: number; y: number }[];
}

function buildLayout(
  data: MindMapData,
  cx: number,
  cy: number,
  branchR: number,
  leafR: number,
): BranchLayout[] {
  const n = data.branches.length;
  return data.branches.map((branch, bi) => {
    const angle = (bi / n) * 2 * Math.PI - Math.PI / 2;
    const { x: bx, y: by } = polar(cx, cy, angle, branchR);

    const leaves = branch.leaves.map((leaf, li) => {
      const spread = Math.PI * 0.55;
      const start = angle - spread / 2;
      const leafAngle =
        branch.leaves.length === 1
          ? angle
          : start + (li / (branch.leaves.length - 1)) * spread;
      const { x: lx, y: ly } = polar(bx, by, leafAngle, leafR);
      return { leaf, x: lx, y: ly };
    });

    return { branch, angle, branchX: bx, branchY: by, leaves };
  });
}

// ---------------------------------------------------------------------------
// MindMap component
// ---------------------------------------------------------------------------

export interface MindMapProps {
  data: MindMapData;
  /** Pixel width (height is derived from aspect ratio). */
  width?: number;
  /** Called when a leaf or branch node is clicked. */
  onSelect?: (id: string) => void;
  selectedId?: string;
  className?: string;
}

const CENTER_R = 48;
const BRANCH_R = 22;
const LEAF_R   = 18;
const BRANCH_DIST = 160;
const LEAF_DIST   = 100;

export function MindMap({
  data, width = 700, onSelect, selectedId, className = "",
}: MindMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Delay render so CSS vars are available
  useEffect(() => { setMounted(true); }, []);

  const H = Math.round(width * 0.72);
  const cx = width / 2;
  const cy = H / 2;

  const layout = buildLayout(data, cx, cy, BRANCH_DIST, LEAF_DIST);

  if (!mounted) {
    return (
      <div
        className={`rounded-xl border border-edge bg-raised ${className}`}
        style={{ width, height: H }}
      />
    );
  }

  return (
    <svg
      ref={svgRef}
      width={width}
      height={H}
      viewBox={`0 0 ${width} ${H}`}
      className={`overflow-visible ${className}`}
      aria-label={`Mind map: ${data.center}`}
      role="img"
    >
      {/* Branch lines from center → branch node */}
      {layout.map(({ branch, branchX, branchY }, bi) => {
        const path = bezierPath(cx, cy, branchX, branchY);
        const len  = segLen(cx, cy, branchX, branchY);
        const isActive = selectedId === branch.id || hovered === branch.id;
        return (
          <path
            key={`b-line-${bi}`}
            d={path}
            stroke={TONE_STROKE[branch.tone]}
            strokeWidth={isActive ? 2.5 : 1.5}
            strokeDasharray={len}
            strokeDashoffset={len}
            fill="none"
            opacity={isActive ? 1 : 0.55}
            className="branch-draw"
            style={{ animationDelay: `${bi * 60}ms`, "--branch-len": len } as React.CSSProperties}
          />
        );
      })}

      {/* Leaf lines from branch node → leaf */}
      {layout.map(({ branch, branchX, branchY, leaves }, bi) =>
        leaves.map(({ leaf, x: lx, y: ly }, li) => {
          const path = bezierPath(branchX, branchY, lx, ly, 0.3);
          const len  = segLen(branchX, branchY, lx, ly);
          const isActive = selectedId === leaf.id || hovered === leaf.id;
          return (
            <path
              key={`l-line-${bi}-${li}`}
              d={path}
              stroke={TONE_STROKE[leaf.tone ?? branch.tone]}
              strokeWidth={isActive ? 2 : 1}
              strokeDasharray={len}
              strokeDashoffset={len}
              fill="none"
              opacity={isActive ? 1 : 0.35}
              className="branch-draw"
              style={{ animationDelay: `${bi * 60 + 80 + li * 40}ms`, "--branch-len": len } as React.CSSProperties}
            />
          );
        }),
      )}

      {/* Leaf nodes */}
      {layout.map(({ branch, leaves }, bi) =>
        leaves.map(({ leaf, x: lx, y: ly }, li) => {
          const isActive = selectedId === leaf.id;
          const isHovered = hovered === leaf.id;
          const tone = leaf.tone ?? branch.tone;
          return (
            <g
              key={`leaf-${bi}-${li}`}
              className="node-pop"
              style={{
                animationDelay: `${bi * 60 + 120 + li * 40}ms`,
                transformOrigin: `${lx}px ${ly}px`,
                cursor: onSelect ? "pointer" : "default",
              }}
              onClick={() => onSelect?.(leaf.id)}
              onMouseEnter={() => setHovered(leaf.id)}
              onMouseLeave={() => setHovered(null)}
            >
              <circle
                cx={lx} cy={ly} r={LEAF_R}
                fill={TONE_FILL[tone]}
                stroke={TONE_STROKE[tone]}
                strokeWidth={isActive ? 2.5 : isHovered ? 2 : 1}
                className={isActive ? "node-glow" : ""}
              />
              <text
                x={lx} y={ly - 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={TONE_TEXT[tone]}
                fontSize={10}
                fontWeight={isActive ? 700 : 500}
                style={{ fontFamily: "var(--font-sans)", pointerEvents: "none" }}
              >
                {leaf.label.length > 12 ? leaf.label.slice(0, 11) + "…" : leaf.label}
              </text>
              {leaf.sublabel && (
                <text
                  x={lx} y={ly + 10}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={TONE_TEXT[tone]}
                  fontSize={8}
                  opacity={0.7}
                  style={{ fontFamily: "var(--font-mono)", pointerEvents: "none" }}
                >
                  {leaf.sublabel}
                </text>
              )}
            </g>
          );
        }),
      )}

      {/* Branch nodes */}
      {layout.map(({ branch, branchX: bx, branchY: by }, bi) => {
        const isActive = selectedId === branch.id;
        const isHovered = hovered === branch.id;
        return (
          <g
            key={`branch-${bi}`}
            className="node-pop"
            style={{ animationDelay: `${bi * 60 + 60}ms`, transformOrigin: `${bx}px ${by}px` }}
            onClick={() => onSelect?.(branch.id)}
            onMouseEnter={() => setHovered(branch.id)}
            onMouseLeave={() => setHovered(null)}
            cursor="pointer"
          >
            <circle
              cx={bx} cy={by} r={BRANCH_R}
              fill={TONE_FILL[branch.tone]}
              stroke={TONE_STROKE[branch.tone]}
              strokeWidth={isActive ? 3 : isHovered ? 2 : 1.5}
              className={isActive ? "node-glow" : ""}
            />
            <text
              x={bx} y={by}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={TONE_TEXT[branch.tone]}
              fontSize={10}
              fontWeight={700}
              style={{ fontFamily: "var(--font-sans)", pointerEvents: "none" }}
            >
              {branch.label.length > 10 ? branch.label.slice(0, 9) + "…" : branch.label}
            </text>
          </g>
        );
      })}

      {/* Center node */}
      <g className="node-pop" style={{ animationDelay: "0ms", transformOrigin: `${cx}px ${cy}px` }}>
        <circle
          cx={cx} cy={cy} r={CENTER_R}
          fill="var(--vis-center)"
          stroke="var(--vis-center)"
          strokeWidth={2}
        />
        <text
          x={cx} y={cy - (data.sublabel ? 8 : 0)}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--bg)"
          fontSize={13}
          fontWeight={700}
          style={{ fontFamily: "var(--font-sans)", pointerEvents: "none" }}
        >
          {data.center.length > 14 ? data.center.slice(0, 13) + "…" : data.center}
        </text>
        {data.sublabel && (
          <text
            x={cx} y={cy + 12}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="var(--bg)"
            fontSize={9}
            opacity={0.75}
            style={{ fontFamily: "var(--font-mono)", pointerEvents: "none" }}
          >
            {data.sublabel}
          </text>
        )}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Compact inline MindMap — for chapter headers (smaller, fewer labels)
// ---------------------------------------------------------------------------

export interface ChapterMindMapProps {
  /** The chapter's central concept / title */
  centerLabel: string;
  /** The data structure responsible */
  structure: string;
  /** Neighboring concepts shown as branches */
  concepts: {
    label: string;
    tone: MindMapTone;
    items: string[];
  }[];
  onSelect?: (label: string) => void;
  selectedLabel?: string;
}

export function ChapterMindMap({
  centerLabel, structure, concepts, onSelect, selectedLabel,
}: ChapterMindMapProps) {
  const data: MindMapData = {
    center: centerLabel,
    sublabel: structure,
    branches: concepts.map((c, i) => ({
      id: `branch-${i}`,
      label: c.label,
      tone: c.tone,
      leaves: c.items.map((item, j) => ({
        id: `leaf-${i}-${j}`,
        label: item,
        tone: c.tone,
      })),
    })),
  };

  const [selected, setSelected] = useState<string | undefined>(selectedLabel);

  return (
    <div className="flex justify-center overflow-x-auto py-2">
      <MindMap
        data={data}
        width={680}
        selectedId={selected}
        onSelect={(id) => {
          setSelected((s) => (s === id ? undefined : id));
          onSelect?.(id);
        }}
      />
    </div>
  );
}
