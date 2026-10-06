"use client";

import { useMemo, useState } from "react";
import {
  bkdLayout, bkdRangeSearch, buildBkdTree, buildKdTree, kdRangeSearch,
  naiveRangeSearch, type Point2D, type Region,
} from "@/lib/kaus/kdtree";
import { naivePointRange, pointRange } from "@/lib/kaus/points";
import { demoIndex, demoPoints } from "@/lib/demo";
import { CORPUS } from "@/lib/kaus/corpus";
import { numberToDate } from "@/lib/kaus/inverted-index";
import {
  Badge,
  Callout,
  EmptyState,
  Grid,
  Mono,
  Panel,
  Segmented,
  Slider,
  Stack,
  Stat,
  StatRow,
  StepPlayer,
  Table,
  Td,
  Toggle,
  Tr,
  formatBytes,
  useSteps,
} from "@/components/ui";

// ===========================================================================
// Chapter 20 — points and range indexing
// ===========================================================================

type NumericField = "price" | "rating" | "created_at";

export function Ch20() {
  const index = demoIndex();
  const [field, setField] = useState<NumericField>("price");
  const [lower, setLower] = useState(100);
  const [upper, setUpper] = useState(200);

  const values = index.pointValues(field);
  const min = values[0]?.value ?? 0;
  const max = values[values.length - 1]?.value ?? 100;

  const result = useMemo(
    () => pointRange(values, { gte: lower, lte: upper }),
    [values, lower, upper],
  );
  const oracle = useMemo(
    () => naivePointRange(values, { gte: lower, lte: upper }),
    [values, lower, upper],
  );
  const agrees = result.docIds.join(",") === oracle.join(",");

  const allSteps = [...result.lowerSteps, ...result.upperSteps];
  const [step, setStep] = useSteps(allSteps.length);
  const current = allSteps[step];
  const inLowerPhase = step < result.lowerSteps.length;

  const format = (v: number) => (field === "created_at" ? numberToDate(v) : String(v));

  return (
    <Stack gap={4}>
      <Panel
        title="Text asks about membership. Numbers ask about intervals."
        subtitle="Sort the values once and both endpoints become a binary search. The matching documents are whatever lies between them."
        actions={
          <Segmented
            value={field}
            onChange={(f) => {
              setField(f);
              const vs = index.pointValues(f);
              setLower(vs[Math.floor(vs.length * 0.25)]?.value ?? 0);
              setUpper(vs[Math.floor(vs.length * 0.75)]?.value ?? 0);
            }}
            options={[
              { value: "price", label: "price" },
              { value: "rating", label: "rating" },
              { value: "created_at", label: "created_at" },
            ]}
          />
        }
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Slider label="lower bound (gte)" value={lower} min={min} max={max}
              step={field === "rating" ? 0.1 : 1} onChange={setLower} format={format} />
            <Slider label="upper bound (lte)" value={upper} min={min} max={max}
              step={field === "rating" ? 0.1 : 1} onChange={setUpper} format={format} />
          </div>

          {/* The sorted array, with the matching interval highlighted. */}
          <div className="scroll-x">
            <div className="flex gap-1">
              {values.map((entry, i) => {
                const inRange = i >= result.from && i < result.to;
                const isCursor = current && i === current.mid;
                return (
                  <div
                    key={i}
                    className={`flex min-w-[46px] flex-col items-center rounded-md border px-1.5 py-1 transition-all ${
                      isCursor
                        ? "border-[var(--accent)] bg-accent-soft ring-2 ring-[var(--accent)]/25"
                        : inRange
                          ? "border-transparent bg-ok-soft"
                          : "border-edge bg-raised"
                    }`}
                    title={index.source(entry.docId)?.title}
                  >
                    <span className={`font-mono text-[11.5px] tabular-nums ${inRange ? "text-ok" : "text-muted"}`}>
                      {format(entry.value)}
                    </span>
                    <span className="mt-0.5 font-mono text-[9px] text-faint">d{entry.docId}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <StepPlayer total={allSteps.length} index={step} onChange={setStep} label="comparison" />

          {current && (
            <Callout tone="accent">
              <span className="font-mono text-[12px]">
                {inLowerPhase ? "lower_bound" : "upper_bound"}: window [{current.lo}, {current.hi}), probe index{" "}
                {current.mid} = {format(current.midValue)} → {current.decision}
              </span>
            </Callout>
          )}

          <StatRow>
            <Stat label="comparisons" value={result.comparisons} tone="ok" />
            <Stat label="full scan would cost" value={result.scanCost} tone="bad" />
            <Stat label="matching documents" value={result.docIds.length} tone="accent" />
            <Stat label="agrees with a full scan" value={agrees ? "yes" : "NO"} tone={agrees ? "ok" : "bad"} />
          </StatRow>
        </Stack>
      </Panel>

      <Panel title="Matching documents" tone="sunken">
        {result.docIds.length === 0 ? (
          <EmptyState>Nothing in that interval.</EmptyState>
        ) : (
          <Table head={["docId", "document", field]} dense>
            {result.docIds.map((docId) => (
              <Tr key={docId}>
                <Td mono tone="muted">{docId}</Td>
                <Td>{index.source(docId)?.title}</Td>
                <Td mono align="right" tone="accent">
                  {format(index.numericValue(field, docId))}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>

      <Callout tone="warn" title="Why a numeric field is not a term">
        You could index <Mono>149.99</Mono> as a term. Then <Mono>price between 100 and 200</Mono> would mean
        enumerating every distinct price in that interval and OR-ing them together. Sorting the values instead
        turns the whole question into two binary searches.
      </Callout>
    </Stack>
  );
}

// ===========================================================================
// Shared scatter plot for chapters 21 and 22
// ===========================================================================

function Scatter({
  points, query, matched, regions = [], width = 460, height = 300,
}: {
  points: Point2D[];
  query: Region;
  matched: Set<number>;
  regions?: { region: Region; kind: "skipped" | "inside" | "checked" }[];
  width?: number;
  height?: number;
}) {
  const pad = 26;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - 6;
  const maxX = Math.max(...xs) + 6;
  const minY = Math.min(...ys) - 10;
  const maxY = Math.max(...ys) + 10;

  const sx = (x: number) => pad + ((x - minX) / (maxX - minX || 1)) * (width - pad * 2);
  const sy = (y: number) => height - pad - ((y - minY) / (maxY - minY || 1)) * (height - pad * 2);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const toRect = (r: Region) => {
    // x axis is latitude (p.x), y axis is longitude (p.y)
    const left = clamp(sx(Number.isFinite(r.minX) ? r.minX : minX), pad, width - pad);
    const right = clamp(sx(Number.isFinite(r.maxX) ? r.maxX : maxX), pad, width - pad);
    const bottom = clamp(sy(Number.isFinite(r.minY) ? r.minY : minY), pad, height - pad);
    const top = clamp(sy(Number.isFinite(r.maxY) ? r.maxY : maxY), pad, height - pad);
    return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };

  const q = toRect(query);

  return (
    <div className="scroll-x">
      <svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: 380 }} role="img" aria-label="Point scatter with query rectangle">
        <rect x={pad} y={pad} width={width - pad * 2} height={height - pad * 2} fill="var(--bg-sunken)" stroke="var(--border)" />

        {regions.map((r, i) => {
          const box = toRect(r.region);
          // No hue to work with, so the three outcomes are separated by fill
          // weight and stroke style: skipped is the faintest and dashed,
          // fully-inside is mid, and a leaf we had to open is the heaviest.
          const fill = r.kind === "skipped"
            ? "var(--bar-muted)"
            : r.kind === "inside" ? "var(--bar-ok)" : "var(--bar-warn)";
          return (
            <rect
              key={i}
              x={box.x} y={box.y} width={box.width} height={box.height}
              fill={fill} fillOpacity={r.kind === "skipped" ? 0.1 : 0.22}
              stroke={fill} strokeOpacity={0.75} strokeWidth={r.kind === "skipped" ? 1 : 1.4}
              strokeDasharray={r.kind === "skipped" ? "3 3" : undefined}
            />
          );
        })}

        <rect
          x={q.x} y={q.y} width={q.width} height={q.height}
          fill="var(--accent)" fillOpacity={0.1}
          stroke="var(--accent)" strokeWidth={1.6}
        />

        {points.map((p) => {
          const hit = matched.has(p.docId);
          return (
            <circle
              key={p.docId}
              cx={sx(p.x)} cy={sy(p.y)} r={hit ? 4.5 : 3}
              fill={hit ? "var(--accent)" : "var(--text-faint)"}
              fillOpacity={hit ? 1 : 0.55}
            >
              <title>{`${p.label ?? `doc ${p.docId}`} (${p.x}, ${p.y})`}</title>
            </circle>
          );
        })}

        <text x={width - 6} y={height - 8} textAnchor="end" fontSize="9" fill="var(--text-faint)">latitude →</text>
        <text x={6} y={16} fontSize="9" fill="var(--text-faint)">↑ longitude</text>
      </svg>
    </div>
  );
}

// ===========================================================================
// Chapter 21 — KD trees
// ===========================================================================

export function Ch21() {
  const points = useMemo(() => demoPoints(), []);
  const [minLat, setMinLat] = useState(30);
  const [maxLat, setMaxLat] = useState(60);
  const [minLon, setMinLon] = useState(-130);
  const [maxLon, setMaxLon] = useState(30);
  const [showRegions, setShowRegions] = useState(true);

  // Memoized so the query rectangle keeps a stable identity between renders and
  // the searches below only rerun when a slider actually moves.
  const query = useMemo<Region>(
    () => ({ minX: minLat, maxX: maxLat, minY: minLon, maxY: maxLon }),
    [minLat, maxLat, minLon, maxLon],
  );
  const tree = useMemo(() => buildKdTree(points), [points]);
  const result = useMemo(() => kdRangeSearch(tree.root, query), [tree, query]);
  const oracle = useMemo(() => naiveRangeSearch(points, query), [points, query]);
  const agrees = result.docIds.join(",") === oracle.join(",");

  const [step, setStep] = useSteps(result.visits.length);

  const regions = useMemo(() => {
    if (!showRegions) return [];
    const visitsSoFar = result.visits.slice(0, step + 1);
    const nodeById = new Map<number, Region>();
    const collect = (node: typeof tree.root) => {
      if (!node) return;
      nodeById.set(node.id, node.region);
      collect(node.left);
      collect(node.right);
    };
    collect(tree.root);
    return visitsSoFar
      .filter((v) => v.kind === "skipped")
      .map((v) => ({ region: nodeById.get(v.nodeId)!, kind: "skipped" as const }))
      .filter((r) => r.region !== undefined);
  }, [result.visits, step, tree, showRegions]);

  const matched = useMemo(
    () => new Set(
      result.visits.slice(0, step + 1).filter((v) => v.kind === "matched")
        .map((v) => {
          const find = (node: typeof tree.root): Point2D | null => {
            if (!node) return null;
            if (node.id === v.nodeId) return node.point;
            return find(node.left) ?? find(node.right);
          };
          return find(tree.root)?.docId ?? -1;
        }),
    ),
    [result.visits, step, tree],
  );

  const current = result.visits[step];

  return (
    <Stack gap={4}>
      <Panel
        title="Two dimensions cannot be sorted for both at once"
        subtitle="So partition the space instead. Alternating the split dimension gives every node a rectangle it is responsible for."
        actions={<Toggle label="Show rejected regions" checked={showRegions} onChange={setShowRegions} />}
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Slider label="min latitude" value={minLat} min={-40} max={70} onChange={setMinLat} />
            <Slider label="max latitude" value={maxLat} min={-40} max={70} onChange={setMaxLat} />
            <Slider label="min longitude" value={minLon} min={-180} max={180} onChange={setMinLon} />
            <Slider label="max longitude" value={maxLon} min={-180} max={180} onChange={setMaxLon} />
          </div>

          <Grid cols={2}>
            <Scatter points={points} query={query} matched={matched} regions={regions} />
            <Stack gap={3}>
              <StatRow>
                <Stat label="points" value={points.length} />
                <Stat label="nodes visited" value={result.nodesVisited} />
                <Stat label="subtrees skipped" value={result.nodesSkipped} tone="ok" />
                <Stat label="matches" value={result.docIds.length} tone="accent" />
              </StatRow>

              <div className="rounded-lg border border-edge bg-raised p-3">
                <div className="mb-1.5 text-[11px] uppercase tracking-wider text-faint">The decision at each node</div>
                <pre className="font-mono text-[11.5px] leading-relaxed text-muted">
{`does the query rectangle
intersect this node's region?

  no  → skip the entire subtree
  yes → check this point,
        then recurse`}
                </pre>
              </div>

              <Callout tone={agrees ? "ok" : "bad"} title={agrees ? "Agrees with a full scan" : "Disagreement"}>
                {agrees
                  ? `Both found the same ${oracle.length} point(s). The KD tree compared ${result.pointsChecked} of ${points.length}.`
                  : "The tree and the scan disagree, which would be a bug."}
              </Callout>
            </Stack>
          </Grid>

          <StepPlayer total={result.visits.length} index={step} onChange={setStep} label="node" />

          {current && (
            <Callout tone={current.kind === "skipped" ? "bad" : current.kind === "matched" ? "ok" : "info"}>
              <span className="font-mono text-[12px]">
                depth {current.depth} · {current.kind} — {current.reason}
              </span>
            </Callout>
          )}
        </Stack>
      </Panel>

      <Panel title="Points in this corpus" tone="sunken">
        <div className="max-h-[240px] overflow-y-auto">
          <Table head={["doc", "title", "lat", "lon", "in query"]} dense>
            {CORPUS.map((doc, i) => (
              <Tr key={doc.id} highlight={result.docIds.includes(i)}>
                <Td mono tone="muted">{doc.id}</Td>
                <Td>{doc.title}</Td>
                <Td mono align="right">{doc.lat}</Td>
                <Td mono align="right">{doc.lon}</Td>
                <Td align="center" tone={result.docIds.includes(i) ? "ok" : "muted"}>
                  {result.docIds.includes(i) ? "yes" : "—"}
                </Td>
              </Tr>
            ))}
          </Table>
        </div>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 22 — BKD trees
// ===========================================================================

export function Ch22() {
  const points = useMemo(() => demoPoints(), []);
  const [leafSize, setLeafSize] = useState(4);
  const [minLat, setMinLat] = useState(30);
  const [maxLat, setMaxLat] = useState(60);
  const [minLon, setMinLon] = useState(-130);
  const [maxLon, setMaxLon] = useState(30);

  // Memoized so the query rectangle keeps a stable identity between renders and
  // the searches below only rerun when a slider actually moves.
  const query = useMemo<Region>(
    () => ({ minX: minLat, maxX: maxLat, minY: minLon, maxY: maxLon }),
    [minLat, maxLat, minLon, maxLon],
  );
  const tree = useMemo(() => buildBkdTree(points, leafSize), [points, leafSize]);
  const result = useMemo(() => bkdRangeSearch(tree, query), [tree, query]);
  const oracle = useMemo(() => naiveRangeSearch(points, query), [points, query]);
  const agrees = result.docIds.join(",") === oracle.join(",");
  const layout = useMemo(() => bkdLayout(tree), [tree]);

  const visitKind = new Map(result.visits.map((v) => [v.nodeId, v.kind]));

  const leafComparison = useMemo(
    () => [1, 2, 4, 8, 16].map((size) => {
      const t = buildBkdTree(points, size);
      const r = bkdRangeSearch(t, query);
      return {
        leafSize: size,
        leaves: t.leafCount,
        nodes: t.nodeCount,
        blocksRead: r.leafBlocksRead,
        pointsChecked: r.pointsChecked,
        bytesRead: r.bytesRead,
        skipped: r.subtreesSkipped,
      };
    }),
    [points, query],
  );

  return (
    <Stack gap={4}>
      <Panel
        title="The same partitioning, but leaves hold blocks"
        subtitle="One object per point is fine in memory and hopeless on disk. BKD stores blocks of byte-encoded points instead."
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Slider label="leaf size" value={leafSize} min={1} max={16} onChange={setLeafSize}
              format={(v) => `${v} points/leaf`} />
            <Slider label="min latitude" value={minLat} min={-40} max={70} onChange={setMinLat} />
            <Slider label="max latitude" value={maxLat} min={-40} max={70} onChange={setMaxLat} />
            <Slider label="min longitude" value={minLon} min={-180} max={180} onChange={setMinLon} />
            <Slider label="max longitude" value={maxLon} min={-180} max={180} onChange={setMaxLon} />
          </div>

          <Grid cols={2}>
            <Scatter
              points={points}
              query={query}
              matched={new Set(result.docIds)}
              regions={result.visits
                .filter((v) => v.kind === "skipped" || v.kind === "fully-inside")
                .map((v) => {
                  const find = (node: typeof tree.root): Region | null => {
                    if (!node) return null;
                    if (node.id === v.nodeId) return node.bounds;
                    return find(node.left) ?? find(node.right);
                  };
                  const region = find(tree.root);
                  return region ? { region, kind: v.kind === "skipped" ? ("skipped" as const) : ("inside" as const) } : null;
                })
                .filter((r): r is { region: Region; kind: "skipped" | "inside" } => r !== null)}
            />

            <Stack gap={3}>
              <StatRow>
                <Stat label="leaf blocks" value={tree.leafCount} />
                <Stat label="blocks read" value={result.leafBlocksRead} tone="accent" />
                <Stat label="subtrees skipped" value={result.subtreesSkipped} tone="ok" />
                <Stat label="taken wholesale" value={result.subtreesFullyInside} tone="ok"
                  hint="Region entirely inside the query — no per-point comparison needed" />
              </StatRow>
              <StatRow>
                <Stat label="points compared" value={result.pointsChecked} />
                <Stat label="full scan would compare" value={points.length} tone="bad" />
                <Stat label="bytes read" value={formatBytes(result.bytesRead)} />
                <Stat label="index size" value={formatBytes(tree.totalBytes)} />
              </StatRow>

              <Callout tone={agrees ? "ok" : "bad"}>
                {agrees
                  ? `Same ${oracle.length} result(s) as a full scan, after comparing ${result.pointsChecked} of ${points.length} points.`
                  : "Disagreement with the full scan — that would be a bug."}
              </Callout>
            </Stack>
          </Grid>
        </Stack>
      </Panel>

      <Panel
        title="The tree"
        subtitle="Every node is labelled with what happened to it: skipped without reading, taken whole, or opened and checked point by point."
        tone="sunken"
      >
        <div className="scroll-x">
          <div className="space-y-1" style={{ minWidth: 420 }}>
            {layout.nodes.map((node) => {
              const kind = visitKind.get(node.id);
              const tone =
                kind === "skipped" ? "bg-bad-soft border-transparent"
                  : kind === "fully-inside" ? "bg-ok-soft border-transparent"
                    : kind === "leaf-checked" ? "bg-warn-soft border-transparent"
                      : "bg-raised border-edge";
              return (
                <div
                  key={node.id}
                  className={`flex items-center gap-2 rounded border px-2 py-1 ${tone}`}
                  style={{ marginLeft: node.depth * 18 }}
                >
                  <span className="font-mono text-[11px] text-muted">n{node.id}</span>
                  <span className="font-mono text-[11.5px] text-ink">{node.label}</span>
                  <span className="text-[10.5px] text-muted">{node.count} pt</span>
                  {kind && (
                    <Badge tone={kind === "skipped" ? "bad" : kind === "fully-inside" ? "ok" : kind === "leaf-checked" ? "warn" : "neutral"}>
                      {kind}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Panel>

      <Panel title="What leaf size costs you" subtitle="Same query, same points, different block granularity.">
        <Table head={["leaf size", "leaves", "nodes", "blocks read", "points compared", "bytes read"]}>
          {leafComparison.map((row) => (
            <Tr key={row.leafSize} highlight={row.leafSize === leafSize}>
              <Td mono>{row.leafSize}</Td>
              <Td mono align="right">{row.leaves}</Td>
              <Td mono align="right" tone="muted">{row.nodes}</Td>
              <Td mono align="right" tone="accent">{row.blocksRead}</Td>
              <Td mono align="right">{row.pointsChecked}</Td>
              <Td mono align="right">{formatBytes(row.bytesRead)}</Td>
            </Tr>
          ))}
        </Table>
        <Callout tone="info" title="The trade">
          Small leaves mean more nodes and more precise skipping, but a deeper tree and more random reads.
          Large leaves mean fewer, bigger sequential reads — and more points compared that were never going to
          match. On disk, the bigger block usually wins, which is why this is a <em>block</em> KD tree.
        </Callout>
      </Panel>
    </Stack>
  );
}
