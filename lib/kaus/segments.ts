/**
 * Segments and the write lifecycle (chapters 23, 24, 35 and 36).
 *
 * The central decision: **do not modify one giant index**. Writes accumulate in a
 * buffer, become an immutable segment, and are later merged. Deletes are
 * tombstones, never edits. Everything downstream — safe concurrent readers,
 * stable file formats, a page cache that can hold pages without invalidation,
 * background merging — falls out of immutability.
 *
 * The three verbs the book insists are different:
 *
 *   refresh   make recent writes *visible* to search
 *   flush     write buffered index work into *segment files*
 *   commit    create a *durable reopenable* index state
 *
 * A translog sits underneath, because otherwise "durable" and "visible" collapse
 * into one word and the distinction stops being teachable.
 */

import { analyzerFor } from "./corpus";
import { ByteWriter, crc32, encodePostings, type ByteRegion } from "./codec";
import { InvertedIndex } from "./inverted-index";
import { search as searchIndex, makeSearchContext, type FullSearchResult, type Query, type SearchContext, type SearchOptions } from "./query";
import { mergeExecStats, newExecStats, type ExecStats, type Explanation, type SourceDoc } from "./types";

export const SEGMENT_FORMAT_VERSION = 2;
export const SEGMENT_MAGIC = "SEEK";

export type SegmentState = "searchable" | "flushed" | "committed" | "merged-away";

export interface VirtualFile {
  name: string;
  bytes: Uint8Array;
  regions: ByteRegion[];
  checksumValid: boolean;
}

export interface Segment {
  id: string;
  /** Monotonic creation order, so the UI can show generations. */
  generation: number;
  index: InvertedIndex;
  /** The documents this segment owns, by their source id. */
  docKeys: string[];
  deletedKeys: Set<string>;
  state: SegmentState;
  files: VirtualFile[];
  createdAtTick: number;
  /** True once this segment came out of a merge rather than a refresh. */
  fromMerge: boolean;
  mergedFrom: string[];
}

export interface TranslogEntry {
  tick: number;
  op: "index" | "delete";
  docKey: string;
  source?: SourceDoc;
}

export interface EngineEvent {
  tick: number;
  kind: "index" | "delete" | "refresh" | "flush" | "commit" | "merge" | "recover" | "note";
  message: string;
}

export interface CommitPoint {
  generation: number;
  segmentIds: string[];
  docCount: number;
  tick: number;
}

export interface EngineHit {
  docKey: string;
  source: SourceDoc;
  score: number;
  segmentId: string;
  localDocId: number;
  explanation?: Explanation;
  matchedTerms?: string[];
}

export interface EngineSearchResult {
  hits: EngineHit[];
  /** Per-segment results, before the global merge (chapter 29 and 33). */
  perSegment: {
    segmentId: string;
    docCount: number;
    candidates: number;
    topK: { docKey: string; score: number }[];
    stats: ExecStats;
    tookMicros: number;
  }[];
  stats: ExecStats;
  totalCandidates: number;
  tookMicros: number;
  segmentsSearched: number;
}

export interface MergePolicy {
  /** Merge once a size tier holds this many segments. */
  segmentsPerTier: number;
  /** Never merge more than this many at once. */
  maxMergeAtOnce: number;
}

export const DEFAULT_MERGE_POLICY: MergePolicy = { segmentsPerTier: 3, maxMergeAtOnce: 4 };

function newIndex(): InvertedIndex {
  return new InvertedIndex((field) => analyzerFor(field));
}

export class KausEngine {
  private tick = 0;
  private nextSegmentNumber = 0;
  private commitGeneration = 0;

  readonly segments: Segment[] = [];
  /** Written but not yet visible to search. */
  ramBuffer: { docKey: string; source: SourceDoc }[] = [];
  /** Durable record of writes since the last commit. */
  translog: TranslogEntry[] = [];
  readonly events: EngineEvent[] = [];
  lastCommit: CommitPoint | null = null;
  /** Deletes issued against documents that are not yet visible. */
  private pendingDeletes = new Set<string>();

  private searchContexts = new Map<string, SearchContext>();

  constructor(readonly mergePolicy: MergePolicy = DEFAULT_MERGE_POLICY) {}

  private log(kind: EngineEvent["kind"], message: string) {
    this.events.push({ tick: this.tick, kind, message });
  }

  get liveSegments(): Segment[] {
    return this.segments.filter((s) => s.state !== "merged-away");
  }

  get visibleDocCount(): number {
    return this.liveSegments.reduce((sum, s) => sum + s.docKeys.length - s.deletedKeys.size, 0);
  }

  get pendingWrites(): number {
    return this.ramBuffer.length;
  }

  /** Chapter 40: segment count is a metric you watch, not a detail. */
  get segmentCount(): number {
    return this.liveSegments.length;
  }

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  index(source: SourceDoc): void {
    this.tick++;
    // The translog entry is what makes this write survivable. It is durable
    // immediately; it is not searchable until a refresh.
    this.translog.push({ tick: this.tick, op: "index", docKey: source.id, source });
    this.ramBuffer.push({ docKey: source.id, source });
    this.log("index", `indexed ${source.id} into the RAM buffer (durable in the translog, not yet searchable)`);
  }

  indexAll(sources: SourceDoc[]): void {
    for (const s of sources) this.index(s);
  }

  delete(docKey: string): boolean {
    this.tick++;
    this.translog.push({ tick: this.tick, op: "delete", docKey });

    const bufferIndex = this.ramBuffer.findIndex((d) => d.docKey === docKey);
    if (bufferIndex >= 0) {
      this.ramBuffer.splice(bufferIndex, 1);
      this.log("delete", `${docKey} was still in the RAM buffer, so it never became a segment`);
      return true;
    }

    let found = false;
    for (const segment of this.liveSegments) {
      const localDocId = segment.docKeys.indexOf(docKey);
      if (localDocId >= 0) {
        // A tombstone. The bytes stay on disk until a merge rewrites them.
        segment.deletedKeys.add(docKey);
        segment.index.delete(localDocId);
        found = true;
      }
    }
    if (found) {
      this.log("delete", `tombstoned ${docKey} — the segment is immutable, so the data stays until a merge`);
    } else {
      this.pendingDeletes.add(docKey);
      this.log("delete", `${docKey} is not visible yet; the delete is remembered for when it is`);
    }
    return found;
  }

  // -------------------------------------------------------------------------
  // refresh / flush / commit
  // -------------------------------------------------------------------------

  /** Make buffered writes searchable. Cheap, frequent, not durable by itself. */
  refresh(): Segment | null {
    this.tick++;
    if (this.ramBuffer.length === 0) {
      this.log("refresh", "nothing buffered — refresh is a no-op, which is why an idle index costs nothing to keep fresh");
      return null;
    }

    const index = newIndex();
    const docKeys: string[] = [];
    for (const { source } of this.ramBuffer) {
      index.add(source);
      docKeys.push(source.id);
    }

    const segment: Segment = {
      id: `_${this.nextSegmentNumber.toString(36)}`,
      generation: this.nextSegmentNumber,
      index,
      docKeys,
      deletedKeys: new Set(),
      state: "searchable",
      files: [],
      createdAtTick: this.tick,
      fromMerge: false,
      mergedFrom: [],
    };
    this.nextSegmentNumber++;
    this.segments.push(segment);

    const count = this.ramBuffer.length;
    this.ramBuffer = [];

    // Apply deletes that arrived before their documents were visible.
    for (const key of [...this.pendingDeletes]) {
      const localDocId = segment.docKeys.indexOf(key);
      if (localDocId >= 0) {
        segment.deletedKeys.add(key);
        segment.index.delete(localDocId);
        this.pendingDeletes.delete(key);
      }
    }

    this.log("refresh", `refresh created segment ${segment.id} with ${count} document(s) — now searchable`);
    return segment;
  }

  /** Serialise searchable segments into files. */
  flush(): VirtualFile[] {
    this.tick++;
    const written: VirtualFile[] = [];
    for (const segment of this.liveSegments) {
      if (segment.state !== "searchable") continue;
      segment.files = writeSegmentFiles(segment);
      segment.state = "flushed";
      written.push(...segment.files);
    }
    if (written.length === 0) {
      this.log("flush", "no searchable segment needed writing — flush is not the same as refresh");
    } else {
      const bytes = written.reduce((sum, f) => sum + f.bytes.length, 0);
      this.log("flush", `flushed ${written.length} file(s), ${bytes} bytes, across ${written.length ? new Set(written.map((f) => f.name.split(".")[0])).size : 0} segment(s)`);
    }
    return written;
  }

  /** Write a commit point. After this, the index can be reopened from disk. */
  commit(): CommitPoint {
    this.tick++;
    // Anything searchable but unflushed has to reach disk first, or the commit
    // would reference state that does not exist.
    this.flush();

    this.commitGeneration++;
    for (const segment of this.liveSegments) {
      if (segment.state === "flushed") segment.state = "committed";
    }

    const point: CommitPoint = {
      generation: this.commitGeneration,
      segmentIds: this.liveSegments.map((s) => s.id),
      docCount: this.visibleDocCount,
      tick: this.tick,
    };
    this.lastCommit = point;
    const replayed = this.translog.length;
    this.translog = [];
    this.log(
      "commit",
      `wrote segments_${this.commitGeneration} listing [${point.segmentIds.join(", ")}] and truncated ${replayed} translog entr${replayed === 1 ? "y" : "ies"}`,
    );
    return point;
  }

  // -------------------------------------------------------------------------
  // Chapter 36: crash and recovery
  // -------------------------------------------------------------------------

  /**
   * Simulate losing the process. Everything that was only in memory is gone;
   * committed segments and the translog survive.
   */
  crash(): { lostFromBuffer: number; recoverableFromTranslog: number; lostSegments: string[] } {
    this.tick++;
    const lostFromBuffer = this.ramBuffer.length;
    const lostSegments: string[] = [];

    for (const segment of [...this.segments]) {
      if (segment.state === "searchable") {
        // Never written to disk, so it does not survive.
        lostSegments.push(segment.id);
        segment.state = "merged-away";
      }
    }
    this.ramBuffer = [];
    this.log(
      "recover",
      `process died: ${lostFromBuffer} buffered write(s) and ${lostSegments.length} unflushed segment(s) vanished; ` +
      `${this.translog.length} translog entr${this.translog.length === 1 ? "y" : "ies"} survived`,
    );
    return {
      lostFromBuffer,
      recoverableFromTranslog: this.translog.length,
      lostSegments,
    };
  }

  /** Replay the translog to get back to where we were. */
  recover(): { replayed: number; verified: string[]; corrupted: string[] } {
    this.tick++;
    const verified: string[] = [];
    const corrupted: string[] = [];

    // Chapter 36: verify segments and checksums before trusting them.
    for (const segment of this.liveSegments) {
      for (const file of segment.files) {
        if (file.checksumValid) verified.push(file.name);
        else corrupted.push(file.name);
      }
    }

    const entries = [...this.translog];
    this.translog = [];
    let replayed = 0;
    for (const entry of entries) {
      if (entry.op === "index" && entry.source) {
        const alreadyVisible = this.liveSegments.some((s) => s.docKeys.includes(entry.docKey));
        if (!alreadyVisible) {
          this.index(entry.source);
          replayed++;
        }
      } else if (entry.op === "delete") {
        this.delete(entry.docKey);
        replayed++;
      }
    }
    if (replayed > 0) this.refresh();

    this.log(
      "recover",
      `verified ${verified.length} file checksum(s)${corrupted.length ? `, found ${corrupted.length} corrupt` : ""}; ` +
      `replayed ${replayed} translog operation(s)`,
    );
    return { replayed, verified, corrupted };
  }

  // -------------------------------------------------------------------------
  // Merging
  // -------------------------------------------------------------------------

  /** Tiered policy: merge when one size tier gets crowded. */
  findMerge(): Segment[] | null {
    const candidates = this.liveSegments.filter((s) => s.state !== "merged-away");
    if (candidates.length < this.mergePolicy.segmentsPerTier) return null;

    const tiers = new Map<number, Segment[]>();
    for (const segment of candidates) {
      const size = Math.max(1, segment.docKeys.length);
      const tier = Math.floor(Math.log2(size));
      const list = tiers.get(tier);
      if (list) list.push(segment);
      else tiers.set(tier, [segment]);
    }

    for (const tier of [...tiers.keys()].sort((a, b) => a - b)) {
      const group = tiers.get(tier)!;
      if (group.length >= this.mergePolicy.segmentsPerTier) {
        return group.slice(0, this.mergePolicy.maxMergeAtOnce);
      }
    }
    return null;
  }

  merge(toMerge: Segment[]): Segment | null {
    this.tick++;
    if (toMerge.length < 2) return null;

    const index = newIndex();
    const docKeys: string[] = [];
    let reclaimed = 0;

    for (const segment of toMerge) {
      segment.docKeys.forEach((key, localDocId) => {
        if (segment.deletedKeys.has(key)) {
          // The merge is where deleted documents finally stop costing anything.
          reclaimed++;
          return;
        }
        const source = segment.index.source(localDocId);
        if (source) {
          index.add(source);
          docKeys.push(key);
        }
      });
    }

    const merged: Segment = {
      id: `_${this.nextSegmentNumber.toString(36)}`,
      generation: this.nextSegmentNumber,
      index,
      docKeys,
      deletedKeys: new Set(),
      state: "searchable",
      files: [],
      createdAtTick: this.tick,
      fromMerge: true,
      mergedFrom: toMerge.map((s) => s.id),
    };
    this.nextSegmentNumber++;

    for (const segment of toMerge) {
      segment.state = "merged-away";
      this.searchContexts.delete(segment.id);
    }
    this.segments.push(merged);

    this.log(
      "merge",
      `merged [${merged.mergedFrom.join(", ")}] into ${merged.id}: ${docKeys.length} live document(s)` +
      `${reclaimed ? `, reclaimed ${reclaimed} tombstoned document(s)` : ""}`,
    );
    return merged;
  }

  /** Run merges until the policy is satisfied. */
  mergeAll(maxRounds = 20): number {
    let rounds = 0;
    for (let i = 0; i < maxRounds; i++) {
      const candidates = this.findMerge();
      if (!candidates) break;
      this.merge(candidates);
      rounds++;
    }
    return rounds;
  }

  /** Force everything into one segment — the "optimize" people reach for. */
  forceMerge(): Segment | null {
    const live = this.liveSegments;
    if (live.length < 2) return null;
    return this.merge(live);
  }

  // -------------------------------------------------------------------------
  // Searching across segments
  // -------------------------------------------------------------------------

  private contextFor(segment: Segment): SearchContext {
    let ctx = this.searchContexts.get(segment.id);
    if (!ctx) {
      ctx = makeSearchContext(segment.index);
      this.searchContexts.set(segment.id, ctx);
    }
    return ctx;
  }

  search(query: Query, options: SearchOptions & { topK?: number } = {}): EngineSearchResult {
    const topK = options.topK ?? 10;
    const started = performance.now();
    const perSegment: EngineSearchResult["perSegment"] = [];
    let stats = newExecStats();
    let totalCandidates = 0;
    const all: EngineHit[] = [];

    for (const segment of this.liveSegments) {
      const ctx = this.contextFor(segment);
      const result: FullSearchResult = searchIndex(ctx, query, { ...options, topK });
      stats = mergeExecStats(stats, result.stats);
      totalCandidates += result.totalCandidates;

      const hits: EngineHit[] = [];
      for (const hit of result.hits) {
        const source = segment.index.source(hit.docId);
        if (!source) continue;
        if (segment.deletedKeys.has(source.id)) continue;
        hits.push({
          docKey: source.id,
          source,
          score: hit.score,
          segmentId: segment.id,
          localDocId: hit.docId,
          explanation: hit.explanation,
          matchedTerms: hit.matchedTerms,
        });
      }

      perSegment.push({
        segmentId: segment.id,
        docCount: segment.docKeys.length - segment.deletedKeys.size,
        candidates: result.totalCandidates,
        topK: hits.map((h) => ({ docKey: h.docKey, score: h.score })),
        stats: result.stats,
        tookMicros: result.tookMicros,
      });
      all.push(...hits);
    }

    // The global merge. Each segment ranked with its *own* statistics, which is
    // the same source of skew that shards have in chapter 33.
    all.sort((a, b) => b.score - a.score || a.docKey.localeCompare(b.docKey));

    return {
      hits: all.slice(0, topK),
      perSegment,
      stats,
      totalCandidates,
      tookMicros: (performance.now() - started) * 1000,
      segmentsSearched: perSegment.length,
    };
  }

  /** Every field's vocabulary across live segments — used by the dictionary labs. */
  vocabulary(field: string): string[] {
    const set = new Set<string>();
    for (const segment of this.liveSegments) {
      for (const term of segment.index.sortedTerms(field)) set.add(term);
    }
    return [...set].sort();
  }

  stats() {
    const live = this.liveSegments;
    return {
      segments: live.length,
      documents: this.visibleDocCount,
      deleted: live.reduce((sum, s) => sum + s.deletedKeys.size, 0),
      pendingWrites: this.ramBuffer.length,
      translogEntries: this.translog.length,
      committedGeneration: this.lastCommit?.generation ?? 0,
      diskBytes: live.reduce(
        (sum, s) => sum + s.files.reduce((fs, f) => fs + f.bytes.length, 0),
        0,
      ),
      unflushed: live.filter((s) => s.state === "searchable").length,
    };
  }
}

// ---------------------------------------------------------------------------
// Chapter 24: the actual file format
// ---------------------------------------------------------------------------

/**
 * Write a segment's files. Layout per file:
 *
 *   magic "SEEK" | version | segment id | metadata
 *   ...body...
 *   checksum | footer
 *
 * The version is not decoration. Chapter 24's example is exactly right: if v1
 * wrote fixed 4-byte integers and v2 writes variable-length ones, a reader that
 * cannot tell them apart reads garbage confidently.
 */
export function writeSegmentFiles(segment: Segment): VirtualFile[] {
  const files: VirtualFile[] = [];

  // --- terms + postings ----------------------------------------------------
  for (const field of ["title", "body", "status", "tags", "author"]) {
    const terms = segment.index.sortedTerms(field);
    if (terms.length === 0) continue;
    const w = new ByteWriter();

    w.begin("header", "Every file starts the same way so a reader can identify it.");
    w.field("magic", () => w.ascii(SEGMENT_MAGIC), "Four bytes that say 'this is one of ours'.", SEGMENT_MAGIC);
    w.field("format version", () => w.u16(SEGMENT_FORMAT_VERSION),
      "A reader must know which layout it is looking at.", String(SEGMENT_FORMAT_VERSION));
    w.field("segment id", () => w.string(segment.id), undefined, segment.id);
    w.field("field name", () => w.string(field), undefined, field);
    w.field("term count", () => w.vint(terms.length), undefined, String(terms.length));
    w.field("doc count", () => w.vint(segment.docKeys.length), undefined, String(segment.docKeys.length));
    w.end();

    const withPositions = field === "title" || field === "body";
    w.begin("term dictionary + postings",
      "Terms in sorted order, front coded, each followed by its postings.");
    let previousTerm = "";
    for (const term of terms) {
      const postings = segment.index.postings(field, term) ?? [];
      let shared = 0;
      while (
        shared < previousTerm.length && shared < term.length &&
        previousTerm[shared] === term[shared]
      ) shared++;

      w.begin(`term "${term}"`);
      w.field("shared prefix length", () => w.vint(shared),
        shared > 0 ? `Reuses "${term.slice(0, shared)}" from the previous term.` : undefined,
        String(shared));
      w.field("suffix", () => w.string(term.slice(shared)), undefined, term.slice(shared));
      const encoded = encodePostings(term, postings, { positions: withPositions });
      w.field("postings", () => w.raw(encoded.bytes),
        `${postings.length} document(s), gap and vint encoded.`,
        `${encoded.bytes.length} bytes`);
      w.end();
      previousTerm = term;
    }
    w.end();

    const body = w.snapshot();
    const checksum = crc32(body);
    w.begin("footer", "Written last so it covers everything before it.");
    w.field("checksum (CRC32)", () => w.u32(checksum),
      "Recomputed on read. A mismatch means corruption, not tampering.",
      `0x${checksum.toString(16).padStart(8, "0")}`);
    w.field("footer magic", () => w.ascii("DONE"),
      "Proof the writer got to the end rather than dying mid-file.", "DONE");
    w.end();

    files.push({
      name: `${segment.id}.${field}.terms`,
      bytes: w.toBytes(),
      regions: w.regions,
      checksumValid: true,
    });
  }

  // --- points --------------------------------------------------------------
  for (const field of ["price", "rating", "created_at"]) {
    const values = segment.index.pointValues(field);
    if (values.length === 0) continue;
    const w = new ByteWriter();
    w.begin("header");
    w.field("magic", () => w.ascii(SEGMENT_MAGIC), undefined, SEGMENT_MAGIC);
    w.field("format version", () => w.u16(SEGMENT_FORMAT_VERSION), undefined, String(SEGMENT_FORMAT_VERSION));
    w.field("field name", () => w.string(field), undefined, field);
    w.field("point count", () => w.vint(values.length), undefined, String(values.length));
    w.end();

    w.begin("sorted points", "Values ascending, so a range is an interval and not a scan.");
    let previous = 0;
    for (const { value, docId } of values) {
      w.begin(`${value}`);
      // Values can be fractional, so store them scaled rather than as vints.
      const scaled = Math.round(value * 100);
      w.field("value delta", () => w.zigzag(scaled - previous), undefined, String(value));
      w.field("docId", () => w.vint(docId), undefined, String(docId));
      w.end();
      previous = scaled;
    }
    w.end();

    const body = w.snapshot();
    const checksum = crc32(body);
    w.begin("footer");
    w.field("checksum (CRC32)", () => w.u32(checksum), undefined,
      `0x${checksum.toString(16).padStart(8, "0")}`);
    w.field("footer magic", () => w.ascii("DONE"), undefined, "DONE");
    w.end();

    files.push({
      name: `${segment.id}.${field}.points`,
      bytes: w.toBytes(),
      regions: w.regions,
      checksumValid: true,
    });
  }

  return files;
}

/** Chapter 25: read the bytes back and check they are what we wrote. */
export function verifyFile(file: VirtualFile): {
  valid: boolean;
  magicOk: boolean;
  version: number;
  storedChecksum: number;
  computedChecksum: number;
  footerOk: boolean;
} {
  const bytes = file.bytes;
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  const version = (bytes[4] << 8) | bytes[5];
  const footerStart = bytes.length - 8;
  const body = bytes.subarray(0, footerStart);
  const storedChecksum =
    ((bytes[footerStart] << 24) | (bytes[footerStart + 1] << 16) |
     (bytes[footerStart + 2] << 8) | bytes[footerStart + 3]) >>> 0;
  const computedChecksum = crc32(body);
  const footerOk = String.fromCharCode(...bytes.subarray(bytes.length - 4)) === "DONE";

  return {
    valid: magic === SEGMENT_MAGIC && storedChecksum === computedChecksum && footerOk,
    magicOk: magic === SEGMENT_MAGIC,
    version,
    storedChecksum,
    computedChecksum,
    footerOk,
  };
}

/** Build an engine already loaded with a corpus, refreshed and committed. */
export function buildEngine(
  sources: SourceDoc[],
  options: { docsPerSegment?: number; commit?: boolean; policy?: MergePolicy } = {},
): KausEngine {
  const engine = new KausEngine(options.policy ?? DEFAULT_MERGE_POLICY);
  const perSegment = options.docsPerSegment ?? sources.length;
  sources.forEach((source, i) => {
    engine.index(source);
    if ((i + 1) % perSegment === 0) engine.refresh();
  });
  engine.refresh();
  if (options.commit !== false) engine.commit();
  return engine;
}
