"use client";

import { useCallback, useMemo, useState } from "react";
import {
  analyzeGaps,
  corrupt,
  crc32,
  decodePostings,
  encodePostings,
  printableAscii,
  toHex,
  type ByteRegion,
} from "@/lib/kaus/codec";
import { CORPUS } from "@/lib/kaus/corpus";
import {
  KausEngine,
  SEGMENT_FORMAT_VERSION,
  verifyFile,
  type Segment,
} from "@/lib/kaus/segments";
import { comparePatterns, MappedFile, PAGE_SIZE, PATTERN_NOTES } from "@/lib/kaus/mmap";
import { demoIndex } from "@/lib/demo";
import {
  Badge, Bar, Button, Callout, EmptyState, Grid, KeyValue, Mono, Panel, Segmented,
  Select, Slider, Stack, Stat, StatRow, Table, Td, TextInput, Toggle, Tr,
  formatBytes, formatNumber, percent,
} from "@/components/ui";

// ===========================================================================
// Chapter 23 — segments
// ===========================================================================

function useEngine() {
  const [, force] = useState(0);
  const [engine] = useState(() => new KausEngine({ segmentsPerTier: 3, maxMergeAtOnce: 4 }));
  const rerender = useCallback(() => force((n) => n + 1), []);
  return { engine, rerender };
}

function SegmentCard({ segment }: { segment: Segment }) {
  const live = segment.docKeys.length - segment.deletedKeys.size;
  const tone =
    segment.state === "committed" ? "ok"
      : segment.state === "flushed" ? "info"
        : segment.state === "searchable" ? "warn" : "neutral";
  return (
    <div className={`rounded-lg border px-3 py-2 ${segment.state === "merged-away" ? "border-dashed border-edge opacity-40" : "border-edge bg-raised"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12.5px] font-semibold text-ink">{segment.id}</span>
        <Badge tone={tone}>{segment.state}</Badge>
        {segment.fromMerge && <Badge tone="accent">merged from {segment.mergedFrom.join(", ")}</Badge>}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11.5px] text-muted">
        <span>{live} live</span>
        {segment.deletedKeys.size > 0 && (
          <span className="text-bad">{segment.deletedKeys.size} tombstoned</span>
        )}
        <span className="text-faint">{segment.files.length} file(s)</span>
        <span className="text-faint">
          {formatBytes(segment.files.reduce((s, f) => s + f.bytes.length, 0))}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {segment.docKeys.map((key) => (
          <span
            key={key}
            className={`rounded px-1 py-0.5 font-mono text-[10px] ${
              segment.deletedKeys.has(key) ? "bg-bad-soft text-bad line-through" : "bg-sunken text-muted"
            }`}
          >
            {key}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Ch23() {
  const { engine, rerender } = useEngine();
  const [cursor, setCursor] = useState(0);
  const [deleteKey, setDeleteKey] = useState("");

  const stats = engine.stats();
  const visible = engine.liveSegments;

  const addDocs = (count: number) => {
    for (let i = 0; i < count && cursor + i < CORPUS.length; i++) {
      engine.index(CORPUS[cursor + i]);
    }
    setCursor((c) => Math.min(CORPUS.length, c + count));
    rerender();
  };

  return (
    <Stack gap={4}>
      <Panel
        title="Immutable segments, not one mutable index"
        subtitle="Writes land in a buffer, become a segment, and are never edited again. Everything else in this part depends on that."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => addDocs(3)} disabled={cursor >= CORPUS.length}>
              index 3 docs
            </Button>
            <Button size="sm" tone="primary" onClick={() => { engine.refresh(); rerender(); }}>
              refresh
            </Button>
            <Button size="sm" onClick={() => { engine.flush(); rerender(); }}>flush</Button>
            <Button size="sm" onClick={() => { engine.commit(); rerender(); }}>commit</Button>
            <Button size="sm" onClick={() => { engine.mergeAll(); rerender(); }}>run merges</Button>
            <Button size="sm" onClick={() => { engine.forceMerge(); rerender(); }}>force merge</Button>
          </div>
        }
      >
        <Stack gap={4}>
          <StatRow>
            <Stat label="buffered (not searchable)" value={stats.pendingWrites} tone={stats.pendingWrites > 0 ? "warn" : "default"} />
            <Stat label="searchable documents" value={stats.documents} tone="accent" />
            <Stat label="live segments" value={stats.segments} />
            <Stat label="tombstoned" value={stats.deleted} tone={stats.deleted > 0 ? "bad" : "default"} />
          </StatRow>

          {visible.length === 0 ? (
            <EmptyState>No segments yet. Index some documents and refresh.</EmptyState>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {engine.segments.map((segment) => (
                <SegmentCard key={segment.id} segment={segment} />
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <Select
                label="Delete a document"
                value={deleteKey}
                onChange={setDeleteKey}
                options={[
                  { value: "", label: "choose a document…" },
                  ...visible.flatMap((s) => s.docKeys.filter((k) => !s.deletedKeys.has(k)))
                    .map((k) => ({ value: k, label: k })),
                ]}
              />
            </div>
            <Button
              tone="danger"
              disabled={!deleteKey}
              onClick={() => { engine.delete(deleteKey); setDeleteKey(""); rerender(); }}
            >
              delete
            </Button>
          </div>

          <Callout tone="info" title="A delete does not delete anything">
            The segment is immutable, so a delete records a tombstone and the bytes stay exactly where they
            were. They are only reclaimed when a merge rewrites the segment without them. Run the merge and
            watch the tombstone count drop to zero.
          </Callout>
        </Stack>
      </Panel>

      <Panel title="What immutability buys" tone="sunken">
        <Grid cols={2}>
          {[
            ["Readers never lock", "A search holds a segment while writers create new ones. No coordination, no torn reads."],
            ["File formats stay stable", "Nothing is patched in place, so the on-disk layout only ever needs to be readable, never editable."],
            ["The page cache stays valid", "A cached page of an immutable file can never go stale, which is what makes mmap practical."],
            ["Merging is a background job", "It reads old segments and writes a new one. Nothing it does invalidates a query in flight."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-lg border border-edge bg-raised p-3">
              <div className="text-[12.5px] font-semibold text-ink">{title}</div>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </Grid>
      </Panel>

      <Panel title="Event log" subtitle="Every operation, in order.">
        <div className="max-h-[240px] overflow-y-auto rounded-lg border border-edge bg-code p-2">
          {engine.events.length === 0 ? (
            <p className="p-2 text-[12px] text-faint">Nothing has happened yet.</p>
          ) : (
            <ul className="space-y-0.5 font-mono text-[11.5px]">
              {engine.events.map((event, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-8 shrink-0 text-right text-faint">{event.tick}</span>
                  <span className={`w-16 shrink-0 ${
                    event.kind === "merge" ? "text-accent-text"
                      : event.kind === "commit" ? "text-ok"
                        : event.kind === "delete" ? "text-bad" : "text-muted"
                  }`}>{event.kind}</span>
                  <span className="text-muted">{event.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 24 — byte-level formats
// ===========================================================================

function HexView({
  bytes, regions, selected, onSelect,
}: {
  bytes: Uint8Array;
  regions: ByteRegion[];
  selected: ByteRegion | null;
  onSelect: (region: ByteRegion | null) => void;
}) {
  const hex = useMemo(() => toHex(bytes), [bytes]);
  const perRow = 16;
  const rows = Math.ceil(bytes.length / perRow);

  // For each byte, the deepest region containing it.
  const owner = useMemo(() => {
    const map = new Array<ByteRegion | null>(bytes.length).fill(null);
    for (const region of regions) {
      for (let i = region.start; i < region.end && i < bytes.length; i++) {
        const existing = map[i];
        if (!existing || region.depth >= existing.depth) map[i] = region;
      }
    }
    return map;
  }, [regions, bytes.length]);

  return (
    <div className="scroll-x rounded-lg border border-edge bg-code p-2">
      <table className="font-mono text-[11px] tabular-nums">
        <tbody>
          {Array.from({ length: rows }, (_, row) => {
            const start = row * perRow;
            return (
              <tr key={row}>
                <td className="pr-3 text-right text-faint">{start.toString(16).padStart(4, "0")}</td>
                {Array.from({ length: perRow }, (_, col) => {
                  const i = start + col;
                  if (i >= bytes.length) return <td key={col} className="px-[2px]" />;
                  const region = owner[i];
                  const isSelected = selected && i >= selected.start && i < selected.end;
                  return (
                    <td key={col} className="px-[1px]">
                      <button
                        type="button"
                        onClick={() => onSelect(region)}
                        title={region ? `${region.label}${region.value ? ` = ${region.value}` : ""}` : undefined}
                        className={`block w-[19px] rounded-sm text-center transition-colors ${
                          isSelected
                            ? "bg-[var(--accent)] text-[var(--bg-raised)]"
                            : region
                              ? "text-ink hover:bg-accent-soft"
                              : "text-faint"
                        }`}
                      >
                        {hex[i]}
                      </button>
                    </td>
                  );
                })}
                <td className="pl-3 text-faint">
                  {Array.from({ length: Math.min(perRow, bytes.length - start) }, (_, col) =>
                    printableAscii(bytes[start + col]),
                  ).join("")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Ch24() {
  const [engine] = useState(() => {
    const e = new KausEngine();
    e.indexAll(CORPUS.slice(0, 4));
    e.refresh();
    e.commit();
    return e;
  });

  const files = engine.liveSegments.flatMap((s) => s.files);
  const [fileName, setFileName] = useState(files[0]?.name ?? "");
  const file = files.find((f) => f.name === fileName) ?? files[0];
  const [selected, setSelected] = useState<ByteRegion | null>(null);

  const verification = file ? verifyFile(file) : null;

  if (!file) return <EmptyState>No files were written.</EmptyState>;

  return (
    <Stack gap={4}>
      <Panel
        title="Define a format. Do not serialise objects."
        subtitle="These are the real bytes this engine wrote. Click any byte to see which field it belongs to."
        actions={
          <Select
            value={fileName}
            onChange={(v) => { setFileName(v); setSelected(null); }}
            options={files.map((f) => ({ value: f.name, label: `${f.name} (${f.bytes.length}B)` }))}
          />
        }
      >
        <Stack gap={4}>
          <pre className="rounded-lg border border-edge bg-code p-3 font-mono text-[11.5px] leading-relaxed text-muted">
{`+----------------------+
| magic bytes          |  "SEEK"
| format version       |  ${SEGMENT_FORMAT_VERSION}
| segment id           |
| metadata             |
+----------------------+
| encoded data         |
| term blocks          |
| postings             |
+----------------------+
| checksum             |  CRC32 over everything above
| footer               |  "DONE"
+----------------------+`}
          </pre>

          <HexView bytes={file.bytes} regions={file.regions} selected={selected} onSelect={setSelected} />

          {selected ? (
            <Callout tone="accent" title={selected.label}>
              <KeyValue
                items={[
                  { key: "byte range", value: `${selected.start} – ${selected.end - 1} (${selected.end - selected.start} bytes)` },
                  ...(selected.value ? [{ key: "value", value: selected.value }] : []),
                ]}
              />
              {selected.note && <p className="mt-1.5">{selected.note}</p>}
            </Callout>
          ) : (
            <p className="text-[12px] text-faint">Click a byte above to inspect the field it belongs to.</p>
          )}
        </Stack>
      </Panel>

      <Panel title="Regions, in order" subtitle="The nesting is the format." tone="sunken">
        <div className="max-h-[300px] overflow-y-auto">
          <Table head={["offset", "length", "field", "value"]} dense>
            {[...file.regions]
              .sort((a, b) => a.start - b.start || a.depth - b.depth)
              .slice(0, 120)
              .map((region, i) => (
                <Tr key={i} highlight={selected === region}>
                  <Td mono tone="muted">{region.start}</Td>
                  <Td mono align="right" tone="muted">{region.end - region.start}</Td>
                  <Td mono>
                    <span style={{ paddingLeft: region.depth * 10 }}>{region.label}</span>
                  </Td>
                  <Td mono tone="accent">{region.value ?? ""}</Td>
                </Tr>
              ))}
          </Table>
        </div>
      </Panel>

      <Grid cols={2}>
        <Panel title="Why version the format?">
          <pre className="rounded-lg border border-edge bg-code p-3 font-mono text-[11.5px] leading-relaxed text-muted">
{`version 1:  integer = 4 fixed bytes
version 2:  integer = variable length

a reader that cannot tell them apart
reads garbage — confidently`}
          </pre>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            The version is two bytes at a known offset, before anything whose layout could change. That is the
            only ordering that works.
          </p>
        </Panel>

        <Panel title="Verification">
          {verification && (
            <KeyValue
              items={[
                { key: "magic", value: verification.magicOk ? "SEEK ✓" : "wrong ✗" },
                { key: "version", value: verification.version },
                { key: "stored checksum", value: `0x${verification.storedChecksum.toString(16).padStart(8, "0")}` },
                { key: "computed checksum", value: `0x${verification.computedChecksum.toString(16).padStart(8, "0")}` },
                { key: "footer", value: verification.footerOk ? "DONE ✓" : "missing ✗" },
                { key: "verdict", value: verification.valid ? "valid" : "CORRUPT" },
              ]}
            />
          )}
        </Panel>
      </Grid>
    </Stack>
  );
}

// ===========================================================================
// Chapter 25 — compression and checksums
// ===========================================================================

export function Ch25() {
  const index = demoIndex();
  const [term, setTerm] = useState("deployment");
  const [blockSize, setBlockSize] = useState(4);
  const [withPositions, setWithPositions] = useState(true);
  const [corruptOffset, setCorruptOffset] = useState(-1);

  // Prefer the body field, which has longer postings lists and therefore more
  // interesting gaps. Memoized so the `?? []` fallback does not hand every
  // dependent computation a fresh array on each render.
  const { postings, field } = useMemo(() => {
    const body = index.postings("body", term) ?? [];
    if (body.length > 0) return { postings: body, field: "body" as const };
    return { postings: index.postings("title", term) ?? [], field: "title" as const };
  }, [index, term]);

  const gaps = useMemo(
    () => analyzeGaps(postings.map((p) => p.docId), blockSize),
    [postings, blockSize],
  );

  const encoded = useMemo(
    () => encodePostings(term, postings, { positions: withPositions }),
    [term, postings, withPositions],
  );

  const roundTrip = useMemo(() => {
    const decoded = decodePostings(encoded.bytes, withPositions);
    return {
      decoded,
      identical: JSON.stringify(decoded) === JSON.stringify(
        postings.map((p) => ({ docId: p.docId, freq: p.freq, positions: withPositions ? p.positions : [] })),
      ),
    };
  }, [encoded, postings, withPositions]);

  const checksum = useMemo(() => {
    const original = encoded.bytes;
    const damaged = corruptOffset >= 0 ? corrupt(original, corruptOffset) : original;
    return {
      original: crc32(original),
      recomputed: crc32(damaged),
      damaged,
      matches: crc32(original) === crc32(damaged),
    };
  }, [encoded, corruptOffset]);

  return (
    <Stack gap={4}>
      <Panel
        title="Sorted ids become gaps. Gaps become small numbers. Small numbers become few bytes."
        subtitle="Four encodings of the same postings list, measured."
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextInput label="Term" value={term} onChange={setTerm} />
            <Slider label="block size" value={blockSize} min={2} max={16} onChange={setBlockSize} />
            <div className="flex items-end pb-1">
              <Toggle label="store positions" checked={withPositions} onChange={setWithPositions} />
            </div>
          </div>

          {postings.length === 0 ? (
            <EmptyState>No postings for <Mono>{term}</Mono>.</EmptyState>
          ) : (
            <>
              <div className="space-y-2">
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wider text-faint">document ids ({field})</div>
                  <div className="flex flex-wrap gap-1">
                    {gaps.original.map((id) => <Badge key={id} tone="info">{id}</Badge>)}
                  </div>
                </div>
                <div className="text-center font-mono text-[11px] text-faint">↓ subtract the previous id</div>
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wider text-faint">gaps</div>
                  <div className="flex flex-wrap gap-1">
                    {gaps.gaps.map((g, i) => <Badge key={i} tone="accent">{g}</Badge>)}
                  </div>
                </div>
              </div>

              <Table head={["encoding", "bytes", "", "per posting"]}>
                {[
                  { name: "fixed 4-byte integers", bytes: gaps.fixedBytes, tone: "bad" as const },
                  { name: "vint over raw ids", bytes: gaps.vintRawBytes, tone: "warn" as const },
                  { name: "vint over gaps", bytes: gaps.vintGapBytes, tone: "ok" as const },
                  { name: `bit-packed blocks of ${blockSize}`, bytes: gaps.packedBytes, tone: "accent" as const },
                ].map((row) => (
                  <Tr key={row.name}>
                    <Td>{row.name}</Td>
                    <Td mono align="right">{row.bytes}</Td>
                    <Td><Bar value={row.bytes} max={gaps.fixedBytes} tone={row.tone} width={160} /></Td>
                    <Td mono align="right" tone="muted">
                      {formatNumber(row.bytes / Math.max(1, gaps.original.length), 2)}
                    </Td>
                  </Tr>
                ))}
              </Table>

              <Panel title="Frame of reference, per block" tone="sunken" dense>
                <Table head={["block", "values", "max", "bits needed", "bytes"]} dense>
                  {gaps.blocks.map((block) => (
                    <Tr key={block.index}>
                      <Td mono tone="muted">{block.index}</Td>
                      <Td mono>{block.values.join(", ")}</Td>
                      <Td mono align="right">{block.maxValue}</Td>
                      <Td mono align="right" tone="accent">{block.bitsPerValue}</Td>
                      <Td mono align="right">{block.bytes}</Td>
                    </Tr>
                  ))}
                </Table>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  Each block gets only the bit width its largest value needs. One outlier inflates its own
                  block instead of the whole postings list — which is the entire reason for blocking.
                </p>
              </Panel>

              <Callout tone={roundTrip.identical ? "ok" : "bad"} title="Round trip">
                {roundTrip.identical
                  ? `Encoded to ${encoded.bytes.length} bytes and decoded back to exactly the same ${postings.length} postings. Compression that loses a posting is not compression.`
                  : "Decoding did not reproduce the input — that would be a bug."}
              </Callout>
            </>
          )}
        </Stack>
      </Panel>

      <Panel
        title="Checksums catch corruption"
        subtitle="Flip a single bit and watch the CRC disagree. This detects damage; it does not prove authenticity."
      >
        <Stack gap={4}>
          <Slider
            label="corrupt byte at offset"
            value={corruptOffset}
            min={-1}
            max={Math.max(0, encoded.bytes.length - 1)}
            onChange={setCorruptOffset}
            format={(v) => (v < 0 ? "none — file intact" : `byte ${v}`)}
          />

          <StatRow>
            <Stat label="stored CRC32" value={`0x${checksum.original.toString(16).padStart(8, "0")}`} />
            <Stat
              label="recomputed CRC32"
              value={`0x${checksum.recomputed.toString(16).padStart(8, "0")}`}
              tone={checksum.matches ? "ok" : "bad"}
            />
            <Stat label="bytes" value={encoded.bytes.length} />
            <Stat label="verdict" value={checksum.matches ? "accept" : "corruption detected"} tone={checksum.matches ? "ok" : "bad"} />
          </StatRow>

          <Callout tone={checksum.matches ? "ok" : "bad"}>
            {checksum.matches
              ? "The recomputed checksum matches the stored one, so the reader accepts the bytes."
              : "One byte changed and the checksum no longer matches. The reader refuses the file rather than returning quietly wrong results."}
          </Callout>

          <Callout tone="warn" title="What a checksum is not">
            CRC32 detects accidental damage — a bad sector, a truncated write, a flipped bit. It is not a
            signature. Anyone who can change the bytes can recompute the checksum.
          </Callout>
        </Stack>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 26 — mmap and the page cache
// ===========================================================================

export function Ch26() {
  const [fileSizeKb, setFileSizeKb] = useState(256);
  const [capacityPages, setCapacityPages] = useState(16);
  const [readSize, setReadSize] = useState(256);
  const [readCount, setReadCount] = useState(300);

  const bytes = useMemo(() => new Uint8Array(fileSizeKb * 1024), [fileSizeKb]);
  const file = useMemo(
    () => new MappedFile("_0.body.terms", bytes, capacityPages),
    [bytes, capacityPages],
  );

  const results = useMemo(
    () => comparePatterns(file, readCount, readSize),
    [file, readCount, readSize],
  );

  // A live view of residency for one chosen pattern.
  const [pattern, setPattern] = useState<"sequential" | "random">("sequential");
  const residency = useMemo(() => {
    const f = new MappedFile("view", bytes, capacityPages);
    let state = 12345;
    const rnd = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
    const maxOffset = Math.max(1, bytes.length - readSize);
    for (let i = 0; i < readCount; i++) {
      const offset = pattern === "sequential"
        ? (i * readSize) % maxOffset
        : Math.floor(rnd() * maxOffset);
      f.read(offset, readSize);
    }
    return f;
  }, [bytes, capacityPages, readSize, readCount, pattern]);

  return (
    <Stack gap={4}>
      <Panel
        title="The index is not copied into your heap"
        subtitle="A mapped file is faulted in one page at a time. Hot pages stay resident, cold pages stay on disk, and nobody copied a gigabyte to answer one query."
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Slider label="file size" value={fileSizeKb} min={64} max={2048} step={64}
              onChange={setFileSizeKb} format={(v) => formatBytes(v * 1024)} />
            <Slider label="page cache capacity" value={capacityPages} min={2} max={128}
              onChange={setCapacityPages} format={(v) => `${v} pages (${formatBytes(v * PAGE_SIZE)})`} />
            <Slider label="read size" value={readSize} min={64} max={4096} step={64}
              onChange={setReadSize} format={formatBytes} />
            <Slider label="reads" value={readCount} min={50} max={1000} step={50} onChange={setReadCount} />
          </div>

          <KeyValue
            items={[
              { key: "page size", value: formatBytes(PAGE_SIZE) },
              { key: "pages in file", value: file.pageCount },
              { key: "cache holds", value: `${capacityPages} of ${file.pageCount} pages (${percent(capacityPages / file.pageCount, 0)})` },
            ]}
          />

          <Table head={["access pattern", "faults", "hits", "hit rate", "evictions", "read amplification"]}>
            {results.map((row) => (
              <Tr key={row.pattern}>
                <Td mono>{row.pattern}</Td>
                <Td mono align="right" tone={row.faults > row.hits ? "bad" : "muted"}>{row.faults}</Td>
                <Td mono align="right" tone="ok">{row.hits}</Td>
                <Td>
                  <Bar value={row.hitRate} max={1} tone={row.hitRate > 0.6 ? "ok" : row.hitRate > 0.3 ? "warn" : "bad"}
                    label={percent(row.hitRate, 1)} width={100} />
                </Td>
                <Td mono align="right">{row.evictions}</Td>
                <Td mono align="right" tone={row.readAmplification > 3 ? "bad" : "muted"}>
                  {formatNumber(row.readAmplification, 2)}×
                </Td>
              </Tr>
            ))}
          </Table>

          <div className="space-y-2">
            {results.map((row) => (
              <Callout key={row.pattern} tone={row.hitRate > 0.6 ? "ok" : row.hitRate > 0.3 ? "warn" : "bad"} title={row.pattern}>
                {PATTERN_NOTES[row.pattern]}
              </Callout>
            ))}
          </div>
        </Stack>
      </Panel>

      <Panel
        title="Which pages are resident"
        subtitle="Identical work, different order. Each cell is one page of the file."
        actions={
          <Segmented
            value={pattern}
            onChange={setPattern}
            options={[{ value: "sequential", label: "sequential" }, { value: "random", label: "random" }]}
          />
        }
        tone="sunken"
      >
        <Stack gap={3}>
          <div className="flex flex-wrap gap-[3px]">
            {Array.from({ length: residency.pageCount }, (_, page) => (
              <span
                key={page}
                title={`page ${page}${residency.isResident(page) ? " — resident" : " — on disk"}`}
                className={`h-[13px] w-[13px] rounded-[2px] ${
                  residency.isResident(page) ? "bg-[var(--accent)]" : "bg-sunken border border-edge"
                }`}
              />
            ))}
          </div>
          <StatRow>
            <Stat label="resident pages" value={residency.residentPages.length} />
            <Stat label="residency" value={percent(residency.residencyRatio, 1)} />
            <Stat label="page faults" value={residency.stats.pageFaults} tone="bad" />
            <Stat label="bytes read from disk" value={formatBytes(residency.stats.bytesReadFromDisk)} />
          </StatRow>
        </Stack>
      </Panel>

      <Callout tone="warn" title="mmap is not magic">
        Random access still faults, still hits the disk, and still evicts something else that was useful.
        The reason postings are stored in document-id order, and terms in sorted blocks, is precisely so that
        the access pattern above is the good one rather than the bad one.
      </Callout>
    </Stack>
  );
}
