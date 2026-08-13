/**
 * KD trees and BKD trees (chapters 21 and 22).
 *
 * One dimension can be sorted, so binary search is enough. Two dimensions cannot
 * be sorted in a way that serves both, so we partition the *space* instead and
 * reject whole regions without looking at the points inside them.
 *
 * The KD tree here stores one point per node, which is the textbook version and
 * the one worth drawing. The BKD variant stores blocks of points in the leaves,
 * which is what you actually want on disk — chapter 22's "why block?".
 */

export interface Point2D {
  x: number;
  y: number;
  docId: number;
  label?: string;
}

export interface Region {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const INFINITE_REGION: Region = {
  minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity,
};

export interface KdNode {
  id: number;
  point: Point2D;
  /** 0 splits on x, 1 splits on y. Alternates with depth. */
  dim: 0 | 1;
  depth: number;
  left: KdNode | null;
  right: KdNode | null;
  /** The region of space this node is responsible for. */
  region: Region;
}

export function intersects(a: Region, b: Region): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

export function contains(outer: Region, inner: Region): boolean {
  return (
    outer.minX <= inner.minX && outer.maxX >= inner.maxX &&
    outer.minY <= inner.minY && outer.maxY >= inner.maxY
  );
}

export function inRegion(p: Point2D, r: Region): boolean {
  return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
}

export function buildKdTree(points: Point2D[]): { root: KdNode | null; nodeCount: number } {
  let nextId = 0;

  function build(items: Point2D[], depth: number, region: Region): KdNode | null {
    if (items.length === 0) return null;
    const dim: 0 | 1 = (depth % 2) as 0 | 1;
    const sorted = [...items].sort((a, b) => (dim === 0 ? a.x - b.x : a.y - b.y));
    const mid = sorted.length >> 1;
    const point = sorted[mid];

    // The split value cuts this node's region in two.
    const leftRegion: Region = dim === 0
      ? { ...region, maxX: point.x }
      : { ...region, maxY: point.y };
    const rightRegion: Region = dim === 0
      ? { ...region, minX: point.x }
      : { ...region, minY: point.y };

    return {
      id: nextId++,
      point,
      dim,
      depth,
      region,
      left: build(sorted.slice(0, mid), depth + 1, leftRegion),
      right: build(sorted.slice(mid + 1), depth + 1, rightRegion),
    };
  }

  const root = build(points, 0, INFINITE_REGION);
  return { root, nodeCount: nextId };
}

export type KdVisitKind = "skipped" | "visited" | "matched";

export interface KdVisit {
  nodeId: number;
  kind: KdVisitKind;
  depth: number;
  reason: string;
}

export interface KdSearchResult {
  docIds: number[];
  points: Point2D[];
  visits: KdVisit[];
  nodesVisited: number;
  nodesSkipped: number;
  pointsChecked: number;
}

/**
 * Range search. The interesting line is the first `if`: when the query rectangle
 * cannot touch a node's region, the entire subtree is rejected with one
 * comparison instead of one comparison per point.
 */
export function kdRangeSearch(root: KdNode | null, query: Region): KdSearchResult {
  const docIds: number[] = [];
  const points: Point2D[] = [];
  const visits: KdVisit[] = [];
  let nodesVisited = 0;
  let nodesSkipped = 0;
  let pointsChecked = 0;

  function visit(node: KdNode | null) {
    if (!node) return;
    if (!intersects(query, node.region)) {
      nodesSkipped++;
      visits.push({
        nodeId: node.id,
        kind: "skipped",
        depth: node.depth,
        reason: "query rectangle does not intersect this region — whole subtree skipped",
      });
      return;
    }
    nodesVisited++;
    pointsChecked++;
    const hit = inRegion(node.point, query);
    if (hit) {
      docIds.push(node.point.docId);
      points.push(node.point);
    }
    visits.push({
      nodeId: node.id,
      kind: hit ? "matched" : "visited",
      depth: node.depth,
      reason: hit
        ? `point (${node.point.x}, ${node.point.y}) is inside the query`
        : `point (${node.point.x}, ${node.point.y}) is outside, but the region overlaps so children must be checked`,
    });
    visit(node.left);
    visit(node.right);
  }

  visit(root);
  docIds.sort((a, b) => a - b);
  return { docIds, points, visits, nodesVisited, nodesSkipped, pointsChecked };
}

// ---------------------------------------------------------------------------
// Chapter 22: BKD — the block-oriented version
// ---------------------------------------------------------------------------

export interface BkdNode {
  id: number;
  depth: number;
  /** Tight bounding box over the points below this node. */
  bounds: Region;
  /** Which dimension this node split on, or null for a leaf. */
  splitDim: 0 | 1 | null;
  splitValue: number | null;
  left: BkdNode | null;
  right: BkdNode | null;
  /** Leaf blocks hold the points; internal nodes hold none. */
  points: Point2D[];
  /** Byte offset of the leaf block in the points file. */
  offset: number;
  /** Encoded size of the leaf block. */
  bytes: number;
}

export interface BkdTree {
  root: BkdNode | null;
  leafSize: number;
  nodeCount: number;
  leafCount: number;
  totalBytes: number;
  pointCount: number;
}

function boundsOf(points: Point2D[]): Region {
  const r: Region = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const p of points) {
    if (p.x < r.minX) r.minX = p.x;
    if (p.x > r.maxX) r.maxX = p.x;
    if (p.y < r.minY) r.minY = p.y;
    if (p.y > r.maxY) r.maxY = p.y;
  }
  return r;
}

/**
 * Chapter 22's "encode dimensions as bytes". Real BKD writes fixed-width big
 * endian values so byte-wise comparison equals numeric comparison. We model the
 * *size*: 4 bytes per dimension plus a vint doc id.
 */
export const BYTES_PER_DIM = 4;

export function encodePointBytes(count: number, dims = 2): number {
  return count * (dims * BYTES_PER_DIM + 2);
}

export function buildBkdTree(points: Point2D[], leafSize = 4): BkdTree {
  let nextId = 0;
  let leafCount = 0;
  let offset = 0;
  let totalBytes = 0;

  function build(items: Point2D[], depth: number): BkdNode | null {
    if (items.length === 0) return null;
    const bounds = boundsOf(items);

    if (items.length <= leafSize) {
      const bytes = encodePointBytes(items.length);
      const node: BkdNode = {
        id: nextId++,
        depth,
        bounds,
        splitDim: null,
        splitValue: null,
        left: null,
        right: null,
        points: items,
        offset,
        bytes,
      };
      leafCount++;
      offset += bytes;
      totalBytes += bytes;
      return node;
    }

    // Split on the wider dimension rather than blindly alternating: it produces
    // squarer regions, which reject more query rectangles.
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const dim: 0 | 1 = width >= height ? 0 : 1;
    const sorted = [...items].sort((a, b) => (dim === 0 ? a.x - b.x : a.y - b.y));
    const mid = sorted.length >> 1;
    const splitValue = dim === 0 ? sorted[mid].x : sorted[mid].y;

    const node: BkdNode = {
      id: nextId++,
      depth,
      bounds,
      splitDim: dim,
      splitValue,
      left: null,
      right: null,
      points: [],
      offset: -1,
      bytes: 0,
    };
    node.left = build(sorted.slice(0, mid), depth + 1);
    node.right = build(sorted.slice(mid), depth + 1);
    return node;
  }

  const root = build(points, 0);
  return { root, leafSize, nodeCount: nextId, leafCount, totalBytes, pointCount: points.length };
}

export type BkdVisitKind = "skipped" | "fully-inside" | "descend" | "leaf-checked";

export interface BkdVisit {
  nodeId: number;
  kind: BkdVisitKind;
  depth: number;
  reason: string;
  pointsAdded: number;
}

export interface BkdSearchResult {
  docIds: number[];
  points: Point2D[];
  visits: BkdVisit[];
  /** Subtrees rejected without reading any points. */
  subtreesSkipped: number;
  /** Subtrees accepted wholesale without checking individual points. */
  subtreesFullyInside: number;
  leafBlocksRead: number;
  pointsChecked: number;
  bytesRead: number;
}

export function bkdRangeSearch(tree: BkdTree, query: Region): BkdSearchResult {
  const docIds: number[] = [];
  const points: Point2D[] = [];
  const visits: BkdVisit[] = [];
  let subtreesSkipped = 0;
  let subtreesFullyInside = 0;
  let leafBlocksRead = 0;
  let pointsChecked = 0;
  let bytesRead = 0;

  function collectAll(node: BkdNode) {
    if (node.splitDim === null) {
      leafBlocksRead++;
      bytesRead += node.bytes;
      for (const p of node.points) {
        docIds.push(p.docId);
        points.push(p);
      }
      return;
    }
    if (node.left) collectAll(node.left);
    if (node.right) collectAll(node.right);
  }

  function visit(node: BkdNode | null) {
    if (!node) return;

    if (!intersects(query, node.bounds)) {
      subtreesSkipped++;
      visits.push({
        nodeId: node.id,
        kind: "skipped",
        depth: node.depth,
        reason: "bounding box misses the query — skip the entire subtree, read nothing",
        pointsAdded: 0,
      });
      return;
    }

    if (contains(query, node.bounds)) {
      // Every point below here matches, so no per-point comparison is needed.
      const before = docIds.length;
      collectAll(node);
      subtreesFullyInside++;
      visits.push({
        nodeId: node.id,
        kind: "fully-inside",
        depth: node.depth,
        reason: "bounding box sits entirely inside the query — take every point without comparing",
        pointsAdded: docIds.length - before,
      });
      return;
    }

    if (node.splitDim === null) {
      leafBlocksRead++;
      bytesRead += node.bytes;
      let added = 0;
      for (const p of node.points) {
        pointsChecked++;
        if (inRegion(p, query)) {
          docIds.push(p.docId);
          points.push(p);
          added++;
        }
      }
      visits.push({
        nodeId: node.id,
        kind: "leaf-checked",
        depth: node.depth,
        reason: `partial overlap — read the leaf block and check its ${node.points.length} point(s)`,
        pointsAdded: added,
      });
      return;
    }

    visits.push({
      nodeId: node.id,
      kind: "descend",
      depth: node.depth,
      reason: `partial overlap on ${node.splitDim === 0 ? "x" : "y"} at ${node.splitValue} — descend`,
      pointsAdded: 0,
    });
    visit(node.left);
    visit(node.right);
  }

  if (tree.root) visit(tree.root);
  docIds.sort((a, b) => a - b);
  return {
    docIds, points, visits,
    subtreesSkipped, subtreesFullyInside, leafBlocksRead, pointsChecked,
    bytesRead,
  };
}

/** The oracle again: check every point. */
export function naiveRangeSearch(points: Point2D[], query: Region): number[] {
  return points.filter((p) => inRegion(p, query)).map((p) => p.docId).sort((a, b) => a - b);
}

/** 1D BKD, for the chapter's "educational 1D version" in appendix C. */
export function buildBkd1D(values: { value: number; docId: number }[], leafSize = 4): BkdTree {
  return buildBkdTree(
    values.map((v) => ({ x: v.value, y: 0, docId: v.docId })),
    leafSize,
  );
}

export function bkd1DRange(tree: BkdTree, gte: number, lte: number): BkdSearchResult {
  return bkdRangeSearch(tree, { minX: gte, maxX: lte, minY: -Infinity, maxY: Infinity });
}

/** Flatten a tree for drawing. */
export function bkdLayout(tree: BkdTree): {
  nodes: { id: number; depth: number; leaf: boolean; label: string; count: number; bounds: Region }[];
  edges: { from: number; to: number; side: "left" | "right" }[];
} {
  const nodes: { id: number; depth: number; leaf: boolean; label: string; count: number; bounds: Region }[] = [];
  const edges: { from: number; to: number; side: "left" | "right" }[] = [];

  function countPoints(node: BkdNode): number {
    if (node.splitDim === null) return node.points.length;
    return (node.left ? countPoints(node.left) : 0) + (node.right ? countPoints(node.right) : 0);
  }

  function walk(node: BkdNode | null) {
    if (!node) return;
    const leaf = node.splitDim === null;
    nodes.push({
      id: node.id,
      depth: node.depth,
      leaf,
      label: leaf
        ? `leaf ${node.points.length}pt`
        : `${node.splitDim === 0 ? "x" : "y"} < ${node.splitValue}`,
      count: countPoints(node),
      bounds: node.bounds,
    });
    if (node.left) {
      edges.push({ from: node.id, to: node.left.id, side: "left" });
      walk(node.left);
    }
    if (node.right) {
      edges.push({ from: node.id, to: node.right.id, side: "right" });
      walk(node.right);
    }
  }

  if (tree.root) walk(tree.root);
  return { nodes, edges };
}
