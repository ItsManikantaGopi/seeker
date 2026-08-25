"use client";

import { useEffect, useRef, useState } from "react";
import { StepPlayer, useSteps } from "@/components/ui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FlowTone = "index" | "query" | "neutral";

export interface FlowNode {
  id: string;
  label: string;
  sublabel?: string;
  tone: FlowTone;
}

export interface FlowDiagramProps {
  nodes: FlowNode[];
  /** If provided, this node id is always highlighted as "active" */
  activeId?: string;
  /** Called when user clicks a node */
  onSelect?: (id: string) => void;
  /** If true, show a step player that animates through nodes automatically */
  animated?: boolean;
  /** Pixel width; height is auto */
  width?: number;
  /** Gap between node centers in px */
  nodeSpacing?: number;
  /** Show data label above the flow line */
  dataLabel?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const TONE_FILL: Record<FlowTone, string> = {
  index:   "var(--vis-index-soft)",
  query:   "var(--vis-query-soft)",
  neutral: "var(--vis-neutral-soft)",
};
const TONE_STROKE: Record<FlowTone, string> = {
  index:   "var(--vis-index)",
  query:   "var(--vis-query)",
  neutral: "var(--vis-neutral)",
};
const TONE_TEXT: Record<FlowTone, string> = {
  index:   "var(--vis-index-text)",
  query:   "var(--vis-query-text)",
  neutral: "var(--vis-neutral-text)",
};

// ---------------------------------------------------------------------------
// FlowDiagram component
// ---------------------------------------------------------------------------

const NODE_W = 96;
const NODE_H = 52;
const ARROW_W = 32;
const V_PADDING = 28;

export function FlowDiagram({
  nodes, activeId, onSelect, animated = false,
  width, nodeSpacing = 128, dataLabel, className = "",
}: FlowDiagramProps) {
  const [mounted, setMounted] = useState(false);
  const [stepIdx, setStepIdx] = useSteps(nodes.length);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  const totalW = nodes.length * nodeSpacing + (NODE_W - nodeSpacing);
  const svgW = width ?? totalW + 16;
  const svgH = NODE_H + V_PADDING * 2;

  // The x position of the center of node i
  const nodeX = (i: number) => 8 + i * nodeSpacing + NODE_W / 2;
  const nodeY = svgH / 2;

  const effectiveActive = animated ? nodes[stepIdx]?.id : activeId;

  if (!mounted) {
    return (
      <div
        className={`rounded-xl border border-edge bg-raised ${className}`}
        style={{ height: svgH + (animated ? 40 : 0) }}
      />
    );
  }

  return (
    <div className={`${className}`}>
      {dataLabel && (
        <div className="mb-1 text-center font-mono text-[11px] text-faint">{dataLabel}</div>
      )}
      <div ref={containerRef} className="scroll-x">
        <svg
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          aria-label={`Flow diagram: ${nodes.map((n) => n.label).join(" → ")}`}
          role="img"
        >
          {/* Connector arrows between nodes */}
          {nodes.slice(0, -1).map((node, i) => {
            const x1 = nodeX(i) + NODE_W / 2;
            const x2 = nodeX(i + 1) - NODE_W / 2;
            const y  = nodeY;
            const isFlowing = animated && stepIdx > i;
            const currTone = node.tone;
            return (
              <g key={`arrow-${i}`}>
                {/* Static background line */}
                <line
                  x1={x1} y1={y} x2={x2} y2={y}
                  stroke={TONE_STROKE[currTone]}
                  strokeWidth={1.5}
                  opacity={0.25}
                />
                {/* Animated marching-dash overlay */}
                {isFlowing && (
                  <line
                    x1={x1} y1={y} x2={x2} y2={y}
                    stroke={TONE_STROKE[currTone]}
                    strokeWidth={2}
                    strokeDasharray="6 6"
                    className="flow-march"
                    opacity={0.8}
                  />
                )}
                {/* Arrow head */}
                <polygon
                  points={`${x2},${y} ${x2 - 7},${y - 4} ${x2 - 7},${y + 4}`}
                  fill={TONE_STROKE[currTone]}
                  opacity={isFlowing ? 1 : 0.3}
                />
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map((node, i) => {
            const cx = nodeX(i);
            const cy = nodeY;
            const isActive   = node.id === effectiveActive;
            const isHovered  = node.id === hoveredId;
            const isPast     = animated && stepIdx > i;
            const opacity    = animated && !isActive && !isPast ? 0.4 : 1;

            return (
              <g
                key={node.id}
                className="node-pop"
                style={{
                  animationDelay: `${i * 60}ms`,
                  transformOrigin: `${cx}px ${cy}px`,
                  cursor: onSelect ? "pointer" : "default",
                  opacity,
                  transition: "opacity 0.2s",
                }}
                onClick={() => onSelect?.(node.id)}
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {/* Node box */}
                <rect
                  x={cx - NODE_W / 2}
                  y={cy - NODE_H / 2}
                  width={NODE_W}
                  height={NODE_H}
                  rx={10}
                  fill={TONE_FILL[node.tone]}
                  stroke={TONE_STROKE[node.tone]}
                  strokeWidth={isActive ? 2.5 : isHovered ? 2 : 1}
                  className={isActive ? "node-glow" : ""}
                />

                {/* Label */}
                <text
                  x={cx}
                  y={cy - (node.sublabel ? 8 : 0)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={TONE_TEXT[node.tone]}
                  fontSize={11}
                  fontWeight={isActive ? 700 : 600}
                  style={{ fontFamily: "var(--font-sans)", pointerEvents: "none" }}
                >
                  {node.label.length > 12 ? node.label.slice(0, 11) + "…" : node.label}
                </text>

                {node.sublabel && (
                  <text
                    x={cx}
                    y={cy + 10}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={TONE_TEXT[node.tone]}
                    fontSize={9}
                    opacity={0.75}
                    style={{ fontFamily: "var(--font-mono)", pointerEvents: "none" }}
                  >
                    {node.sublabel}
                  </text>
                )}

                {/* Step number bubble */}
                {animated && (
                  <text
                    x={cx + NODE_W / 2 - 10}
                    y={cy - NODE_H / 2 + 10}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={TONE_TEXT[node.tone]}
                    fontSize={8}
                    fontWeight={700}
                    opacity={0.7}
                    style={{ fontFamily: "var(--font-mono)", pointerEvents: "none" }}
                  >
                    {i + 1}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {animated && (
        <div className="mt-2">
          <StepPlayer
            total={nodes.length}
            index={stepIdx}
            onChange={setStepIdx}
            autoPlayMs={900}
            label="stage"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TwoColumnFlow — index side left, query side right, with a divider
// ---------------------------------------------------------------------------

export interface TwoColumnFlowProps {
  indexNodes: Omit<FlowNode, "tone">[];
  queryNodes: Omit<FlowNode, "tone">[];
  activeId?: string;
  onSelect?: (id: string) => void;
}

export function TwoColumnFlow({ indexNodes, queryNodes, activeId, onSelect }: TwoColumnFlowProps) {
  const idx: FlowNode[] = indexNodes.map((n) => ({ ...n, tone: "index" as FlowTone }));
  const qry: FlowNode[] = queryNodes.map((n) => ({ ...n, tone: "query" as FlowTone }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <div
            className="h-2 w-2 rounded-full"
            style={{ background: "var(--vis-index)" }}
          />
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">
            Build — index side
          </span>
        </div>
        <FlowDiagram
          nodes={idx}
          activeId={activeId}
          onSelect={onSelect}
          nodeSpacing={100}
        />
      </div>
      <div>
        <div className="mb-2 flex items-center gap-2">
          <div
            className="h-2 w-2 rounded-full"
            style={{ background: "var(--vis-query)" }}
          />
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">
            Query — retrieval side
          </span>
        </div>
        <FlowDiagram
          nodes={qry}
          activeId={activeId}
          onSelect={onSelect}
          nodeSpacing={100}
        />
      </div>
    </div>
  );
}
