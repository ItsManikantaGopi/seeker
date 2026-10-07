/**
 * BlockTree-style term dictionary (chapter 19).
 *
 * Chapter 18 ends with a working FST, so the obvious next move is to shove every
 * term into one enormous FST and call the dictionary done. Chapter 19 explains
 * why production systems do not: the FST has to live in memory, and a dictionary
 * with millions of terms is too big for that to be free.
 *
 * The split is:
 *
 *   FST / prefix index  = navigation, small, in RAM
 *   term blocks         = local term storage and enumeration, on disk
 *   postings            = document membership
 *
 * We build both variants so the sizes can be compared directly, which is the
 * only honest way to justify the extra layer.
 */

import { buildFst, type Fst } from "./fst";

export interface TermBlock {
  index: number;
  terms: string[];
  firstTerm: string;
  lastTerm: string;
  /** Longest prefix shared by every term in the block. */
  sharedPrefix: string;
  /** Byte offset this block would occupy in the terms file. */
  offset: number;
  /** Bytes the block occupies with front coding (chapter 25). */
  bytes: number;
  /** Bytes the same block would take storing every term in full. */
  rawBytes: number;
}

export interface BlockTree {
  blocks: TermBlock[];
  blockSize: number;
  /** The small index: block key -> block number. This is what stays in RAM. */
  prefixIndex: Fst;
  /** The alternative: every term -> block number. Kept only for comparison. */
  everyTermIndex: Fst;
  totalTerms: number;
  totalBlockBytes: number;
  totalRawBytes: number;
  lookup(term: string): BlockTreeLookup;
  /** Terms with a given prefix, using the index to find the starting block. */
  prefixScan(prefix: string, limit?: number): { terms: string[]; blocksRead: number };
}

export interface BlockTreeLookup {
  term: string;
  found: boolean;
  /** Which block the index sent us to. */
  blockIndex: number;
  /** Comparisons spent navigating the index. */
  indexSteps: number;
  /** Terms compared inside the block. */
  blockScanSteps: number;
  /** Position of the term inside the block, or -1. */
  positionInBlock: number;
  /** The global term ordinal, which is what the postings pointer hangs off. */
  ordinal: number;
}

function sharedPrefixOf(terms: string[]): string {
  if (terms.length === 0) return "";
  let prefix = terms[0];
  for (const term of terms.slice(1)) {
    let i = 0;
    const n = Math.min(prefix.length, term.length);
    while (i < n && prefix[i] === term[i]) i++;
    prefix = prefix.slice(0, i);
    if (prefix === "") break;
  }
  return prefix;
}

/**
 * Front coding: store the number of characters shared with the previous term,
 * then only the tail. `kubernetes`, `kubernetes-deployment` becomes
 * `10:kubernetes`, then `10:-deployment`.
 */
function frontCodedBytes(terms: string[]): number {
  let bytes = 0;
  let previous = "";
  for (const term of terms) {
    let shared = 0;
    const n = Math.min(previous.length, term.length);
    while (shared < n && previous[shared] === term[shared]) shared++;
    bytes += 1 + 1 + (term.length - shared); // shared length, suffix length, suffix
    previous = term;
  }
  return bytes;
}

function rawBytes(terms: string[]): number {
  let bytes = 0;
  for (const term of terms) bytes += 1 + term.length; // length prefix + chars
  return bytes;
}

export function buildBlockTree(sortedTerms: string[], blockSize = 8): BlockTree {
  const blocks: TermBlock[] = [];
  let offset = 0;

  for (let i = 0; i < sortedTerms.length; i += blockSize) {
    const terms = sortedTerms.slice(i, i + blockSize);
    const bytes = frontCodedBytes(terms);
    blocks.push({
      index: blocks.length,
      terms,
      firstTerm: terms[0],
      lastTerm: terms[terms.length - 1],
      sharedPrefix: sharedPrefixOf(terms),
      offset,
      bytes,
      rawBytes: rawBytes(terms),
    });
    offset += bytes;
  }

  // The index maps each block's first term to its block number. Sorted terms
  // mean the first terms are sorted too, which is exactly what an FST wants.
  const prefixIndex = buildFst(
    blocks.map((b) => ({ key: b.firstTerm, output: b.index })),
  );
  const everyTermIndex = buildFst(
    sortedTerms.map((term, i) => ({ key: term, output: Math.floor(i / blockSize) })),
  );

  const totalBlockBytes = blocks.reduce((sum, b) => sum + b.bytes, 0);
  const totalRawBytes = blocks.reduce((sum, b) => sum + b.rawBytes, 0);

  const tree: BlockTree = {
    blocks,
    blockSize,
    prefixIndex,
    everyTermIndex,
    totalTerms: sortedTerms.length,
    totalBlockBytes,
    totalRawBytes,

    lookup(term: string): BlockTreeLookup {
      // Navigate: find the last block whose first term is <= the query. The
      // index is small enough to binary search, and in a real implementation
      // this is the FST walk that stops at the deepest matching block pointer.
      let lo = 0;
      let hi = blocks.length - 1;
      let candidate = -1;
      let indexSteps = 0;
      while (lo <= hi) {
        indexSteps++;
        const mid = (lo + hi) >> 1;
        if (blocks[mid].firstTerm <= term) {
          candidate = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (candidate < 0) {
        return {
          term, found: false, blockIndex: -1, indexSteps,
          blockScanSteps: 0, positionInBlock: -1, ordinal: -1,
        };
      }

      // Read the block and scan it. This is the part that touches the disk.
      const block = blocks[candidate];
      let blockScanSteps = 0;
      let positionInBlock = -1;
      for (let i = 0; i < block.terms.length; i++) {
        blockScanSteps++;
        if (block.terms[i] === term) {
          positionInBlock = i;
          break;
        }
        if (block.terms[i] > term) break; // sorted, so we can stop early
      }

      return {
        term,
        found: positionInBlock >= 0,
        blockIndex: candidate,
        indexSteps,
        blockScanSteps,
        positionInBlock,
        ordinal: positionInBlock < 0 ? -1 : candidate * blockSize + positionInBlock,
      };
    },

    prefixScan(prefix: string, limit = Infinity) {
      const start = tree.lookup(prefix);
      let blockIndex = start.blockIndex < 0 ? 0 : start.blockIndex;
      const terms: string[] = [];
      let blocksRead = 0;
      while (blockIndex < blocks.length && terms.length < limit) {
        const block = blocks[blockIndex];
        blocksRead++;
        // If even the first term already sorts past the prefix range, stop.
        if (block.firstTerm > prefix && !block.firstTerm.startsWith(prefix)) break;
        for (const term of block.terms) {
          if (term.startsWith(prefix)) {
            if (terms.length >= limit) break;
            terms.push(term);
          } else if (term > prefix && !term.startsWith(prefix) && terms.length > 0) {
            return { terms, blocksRead };
          }
        }
        blockIndex++;
      }
      return { terms, blocksRead };
    },
  };
  return tree;
}
