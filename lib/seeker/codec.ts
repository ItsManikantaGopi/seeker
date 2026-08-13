/**
 * Byte-level formats, compression and checksums (chapters 24 and 25).
 *
 * "Do not serialize language objects and call it a search index. Define a
 * format." So this module writes actual bytes, and records a labelled region for
 * every field it writes, which is what lets the lab show you the file rather
 * than describe it.
 *
 * The compression is the book's: sorted doc ids become gaps, gaps become
 * variable-length integers, and blocks of gaps get bit-packed to the width the
 * widest value in the block actually needs.
 */

// ---------------------------------------------------------------------------
// Writer / reader with a region log
// ---------------------------------------------------------------------------

export interface ByteRegion {
  label: string;
  start: number;
  end: number;
  depth: number;
  note?: string;
  /** A human-readable rendering of the value stored here. */
  value?: string;
}

export class ByteWriter {
  private buffer: number[] = [];
  readonly regions: ByteRegion[] = [];
  private stack: { label: string; start: number; note?: string }[] = [];

  get length(): number {
    return this.buffer.length;
  }

  begin(label: string, note?: string): void {
    this.stack.push({ label, start: this.buffer.length, note });
  }

  end(value?: string): void {
    const frame = this.stack.pop();
    if (!frame) return;
    this.regions.push({
      label: frame.label,
      start: frame.start,
      end: this.buffer.length,
      depth: this.stack.length,
      note: frame.note,
      value,
    });
  }

  /** Write a labelled scalar in one call. */
  field(label: string, write: () => void, note?: string, value?: string): void {
    this.begin(label, note);
    write();
    this.end(value);
  }

  u8(value: number): void {
    this.buffer.push(value & 0xff);
  }

  u16(value: number): void {
    this.buffer.push((value >>> 8) & 0xff, value & 0xff);
  }

  u32(value: number): void {
    this.buffer.push(
      (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff,
    );
  }

  /**
   * Variable-length integer: seven bits of payload per byte, high bit set while
   * more bytes follow. Small numbers cost one byte, which is the entire reason
   * gap encoding pays off.
   */
  vint(value: number): number {
    let v = value;
    let written = 0;
    if (v < 0) throw new Error("vint cannot encode a negative number; use zigzag");
    do {
      let byte = v & 0x7f;
      v >>>= 7;
      if (v > 0) byte |= 0x80;
      this.buffer.push(byte);
      written++;
    } while (v > 0);
    return written;
  }

  /** Signed values, folded so that small magnitudes stay small. */
  zigzag(value: number): number {
    return this.vint(value < 0 ? -2 * value - 1 : 2 * value);
  }

  ascii(text: string): void {
    for (let i = 0; i < text.length; i++) this.buffer.push(text.charCodeAt(i) & 0xff);
  }

  /** A length-prefixed string, the way a term is stored in a block. */
  string(text: string): void {
    const encoded = new TextEncoder().encode(text);
    this.vint(encoded.length);
    for (const b of encoded) this.buffer.push(b);
  }

  raw(bytes: number[] | Uint8Array): void {
    for (const b of bytes) this.buffer.push(b & 0xff);
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  /** Bytes written so far, for computing a checksum over the body. */
  snapshot(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

export class ByteReader {
  position = 0;
  constructor(readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.position;
  }

  u8(): number {
    return this.bytes[this.position++];
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  u32(): number {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }
  vint(): number {
    let shift = 0;
    let result = 0;
    for (;;) {
      const byte = this.u8();
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result >>> 0;
  }
  zigzag(): number {
    const raw = this.vint();
    return raw % 2 === 0 ? raw / 2 : -(raw + 1) / 2;
  }
  ascii(length: number): string {
    let out = "";
    for (let i = 0; i < length; i++) out += String.fromCharCode(this.u8());
    return out;
  }
  string(): string {
    const length = this.vint();
    const slice = this.bytes.subarray(this.position, this.position + length);
    this.position += length;
    return new TextDecoder().decode(slice);
  }
  seek(offset: number): void {
    this.position = offset;
  }
}

// ---------------------------------------------------------------------------
// Chapter 25: checksums
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

/**
 * CRC32. Detects corruption, not tampering — the book is explicit that a
 * checksum is an integrity check and not a cryptographic guarantee.
 */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function corrupt(bytes: Uint8Array, offset: number, xorMask = 0x01): Uint8Array {
  const copy = new Uint8Array(bytes);
  if (offset >= 0 && offset < copy.length) copy[offset] ^= xorMask;
  return copy;
}

// ---------------------------------------------------------------------------
// Gap encoding and bit packing
// ---------------------------------------------------------------------------

export interface GapEncoding {
  original: number[];
  gaps: number[];
  /** Bytes if every id were a fixed 4-byte integer. */
  fixedBytes: number;
  /** Bytes as variable-length integers over the raw ids. */
  vintRawBytes: number;
  /** Bytes as variable-length integers over the gaps. */
  vintGapBytes: number;
  /** Bytes with the gaps bit-packed in blocks. */
  packedBytes: number;
  blocks: PackedBlock[];
}

export interface PackedBlock {
  index: number;
  values: number[];
  maxValue: number;
  bitsPerValue: number;
  bytes: number;
}

export function vintSize(value: number): number {
  if (value < 0) throw new Error("vintSize expects a non-negative number");
  let size = 1;
  let v = value >>> 7;
  while (v > 0) {
    size++;
    v >>>= 7;
  }
  return size;
}

export function bitsRequired(value: number): number {
  if (value <= 0) return 1;
  return 32 - Math.clz32(value);
}

/** Chapter 5's example: `100, 105, 110, 250` becomes `100, 5, 5, 140`. */
export function gapEncode(sortedIds: number[]): number[] {
  const gaps: number[] = [];
  let previous = 0;
  for (const id of sortedIds) {
    gaps.push(id - previous);
    previous = id;
  }
  return gaps;
}

export function gapDecode(gaps: number[]): number[] {
  const ids: number[] = [];
  let running = 0;
  for (const gap of gaps) {
    running += gap;
    ids.push(running);
  }
  return ids;
}

/**
 * Frame of reference: chop the gaps into fixed-size blocks and give each block
 * only as many bits per value as its largest value needs. One outlier inflates
 * its own block instead of the entire postings list.
 */
export function packBlocks(gaps: number[], blockSize = 8): PackedBlock[] {
  const blocks: PackedBlock[] = [];
  for (let i = 0; i < gaps.length; i += blockSize) {
    const values = gaps.slice(i, i + blockSize);
    const maxValue = values.reduce((m, v) => Math.max(m, v), 0);
    const bitsPerValue = bitsRequired(maxValue);
    blocks.push({
      index: blocks.length,
      values,
      maxValue,
      bitsPerValue,
      // one header byte for the bit width, then the packed payload
      bytes: 1 + Math.ceil((values.length * bitsPerValue) / 8),
    });
  }
  return blocks;
}

export function analyzeGaps(sortedIds: number[], blockSize = 8): GapEncoding {
  const gaps = gapEncode(sortedIds);
  const blocks = packBlocks(gaps, blockSize);
  return {
    original: sortedIds,
    gaps,
    fixedBytes: sortedIds.length * 4,
    vintRawBytes: sortedIds.reduce((sum, v) => sum + vintSize(v), 0),
    vintGapBytes: gaps.reduce((sum, v) => sum + vintSize(v), 0),
    packedBytes: blocks.reduce((sum, b) => sum + b.bytes, 0),
    blocks,
  };
}

/** Actually bit-pack the values, so the byte view is real and reversible. */
export function bitPack(values: number[], bitsPerValue: number): Uint8Array {
  const out = new Uint8Array(Math.ceil((values.length * bitsPerValue) / 8));
  let bitPosition = 0;
  for (const value of values) {
    for (let bit = bitsPerValue - 1; bit >= 0; bit--) {
      if ((value >>> bit) & 1) {
        out[bitPosition >>> 3] |= 0x80 >>> (bitPosition & 7);
      }
      bitPosition++;
    }
  }
  return out;
}

export function bitUnpack(bytes: Uint8Array, bitsPerValue: number, count: number): number[] {
  const out: number[] = [];
  let bitPosition = 0;
  for (let i = 0; i < count; i++) {
    let value = 0;
    for (let bit = 0; bit < bitsPerValue; bit++) {
      const byte = bytes[bitPosition >>> 3] ?? 0;
      const isSet = (byte >>> (7 - (bitPosition & 7))) & 1;
      value = (value << 1) | isSet;
      bitPosition++;
    }
    out.push(value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Postings encoding
// ---------------------------------------------------------------------------

import type { Posting } from "./types";

export interface PostingsEncoding {
  bytes: Uint8Array;
  regions: ByteRegion[];
  /** Same postings stored as plain fixed-width integers, for comparison. */
  uncompressedBytes: number;
  withPositions: boolean;
}

/**
 * Encode one postings list. Layout, per term:
 *
 *   vint  docFreq
 *   for each posting:
 *     vint  docId gap
 *     vint  frequency
 *     if positions: vint each position gap
 */
export function encodePostings(
  term: string,
  postings: Posting[],
  options: { positions?: boolean } = {},
): PostingsEncoding {
  const withPositions = options.positions ?? true;
  const w = new ByteWriter();

  w.begin(`postings for "${term}"`, "One term's entire document list.");
  w.field("docFreq", () => w.vint(postings.length), "How many documents contain the term.",
    String(postings.length));

  let previousDoc = 0;
  for (const posting of postings) {
    w.begin(`doc ${posting.docId}`);
    const gap = posting.docId - previousDoc;
    w.field("docId gap", () => w.vint(gap),
      `${posting.docId} - ${previousDoc} = ${gap}. Gaps stay small, so the vint stays one byte.`,
      String(gap));
    w.field("freq", () => w.vint(posting.freq), "Occurrences in this document.", String(posting.freq));
    if (withPositions && posting.positions.length > 0) {
      w.begin("positions", "Also gap encoded, since positions are sorted too.");
      let previousPosition = 0;
      for (const position of posting.positions) {
        const positionGap = position - previousPosition;
        w.field(`+${positionGap}`, () => w.vint(positionGap), undefined, String(position));
        previousPosition = position;
      }
      w.end(posting.positions.join(", "));
    }
    previousDoc = posting.docId;
    w.end();
  }
  w.end();

  let uncompressed = 4; // docFreq
  for (const p of postings) {
    uncompressed += 8; // docId + freq as fixed 4-byte ints
    if (withPositions) uncompressed += p.positions.length * 4;
  }

  return {
    bytes: w.toBytes(),
    regions: w.regions,
    uncompressedBytes: uncompressed,
    withPositions,
  };
}

export function decodePostings(bytes: Uint8Array, withPositions: boolean): Posting[] {
  const r = new ByteReader(bytes);
  const docFreq = r.vint();
  const postings: Posting[] = [];
  let docId = 0;
  for (let i = 0; i < docFreq; i++) {
    docId += r.vint();
    const freq = r.vint();
    const positions: number[] = [];
    if (withPositions) {
      let position = 0;
      for (let p = 0; p < freq; p++) {
        position += r.vint();
        positions.push(position);
      }
    }
    postings.push({ docId, freq, positions });
  }
  return postings;
}

// ---------------------------------------------------------------------------
// Hex rendering
// ---------------------------------------------------------------------------

export function toHex(bytes: Uint8Array): string[] {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
}

export function printableAscii(byte: number): string {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".";
}
