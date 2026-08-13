/**
 * mmap and the page cache (chapter 26).
 *
 * Memory mapping does not load the index into your heap. It maps a file into the
 * address space and lets the OS fault pages in on demand. Hot pages sit in RAM,
 * cold pages stay on disk, and nobody copied a gigabyte to answer one query.
 *
 * The chapter's warning is the part worth simulating: mmap is not magic. Random
 * access still faults, still hits the disk, still evicts something else. Locality
 * is the whole game, so this model counts faults and lets you watch a sequential
 * read pattern beat a random one on identical data.
 */

export const PAGE_SIZE = 4096;

export interface PageAccess {
  page: number;
  hit: boolean;
  evicted: number | null;
  offset: number;
  length: number;
}

export interface MappedFileStats {
  reads: number;
  pageHits: number;
  pageFaults: number;
  evictions: number;
  bytesReadFromDisk: number;
  bytesRequested: number;
}

/**
 * An LRU page cache over a byte array. The cache capacity is in pages, so you can
 * make it smaller than the file and watch thrashing happen.
 */
export class MappedFile {
  readonly pageCount: number;
  /** Pages currently resident, most-recently-used last. */
  private resident: number[] = [];
  private residentSet = new Set<number>();
  readonly accesses: PageAccess[] = [];
  readonly stats: MappedFileStats = {
    reads: 0,
    pageHits: 0,
    pageFaults: 0,
    evictions: 0,
    bytesReadFromDisk: 0,
    bytesRequested: 0,
  };

  constructor(
    readonly name: string,
    readonly bytes: Uint8Array,
    /** How many pages the cache may hold. */
    public capacityPages: number,
  ) {
    this.pageCount = Math.max(1, Math.ceil(bytes.length / PAGE_SIZE));
  }

  get residentPages(): number[] {
    return [...this.resident];
  }

  isResident(page: number): boolean {
    return this.residentSet.has(page);
  }

  /** Fraction of the file currently in RAM. */
  get residencyRatio(): number {
    return this.resident.length / this.pageCount;
  }

  private touch(page: number, offset: number, length: number) {
    if (this.residentSet.has(page)) {
      this.stats.pageHits++;
      // Move to the most-recently-used end.
      const at = this.resident.indexOf(page);
      this.resident.splice(at, 1);
      this.resident.push(page);
      this.accesses.push({ page, hit: true, evicted: null, offset, length });
      return;
    }

    // Page fault: the OS has to go to disk for this page.
    this.stats.pageFaults++;
    this.stats.bytesReadFromDisk += Math.min(PAGE_SIZE, this.bytes.length - page * PAGE_SIZE);
    let evicted: number | null = null;
    if (this.resident.length >= this.capacityPages) {
      evicted = this.resident.shift() ?? null;
      if (evicted !== null) {
        this.residentSet.delete(evicted);
        this.stats.evictions++;
      }
    }
    this.resident.push(page);
    this.residentSet.add(page);
    this.accesses.push({ page, hit: false, evicted, offset, length });
  }

  /** Read a byte range, faulting in every page it touches. */
  read(offset: number, length: number): Uint8Array {
    this.stats.reads++;
    this.stats.bytesRequested += length;
    const firstPage = Math.floor(offset / PAGE_SIZE);
    const lastPage = Math.floor(Math.max(offset, offset + length - 1) / PAGE_SIZE);
    for (let page = firstPage; page <= lastPage; page++) {
      this.touch(page, offset, length);
    }
    return this.bytes.subarray(offset, offset + length);
  }

  /** Warm the cache the way a sequential scan would. */
  prefetch(fromPage: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const page = fromPage + i;
      if (page >= this.pageCount) break;
      this.touch(page, page * PAGE_SIZE, PAGE_SIZE);
    }
  }

  reset(capacityPages = this.capacityPages): void {
    this.resident = [];
    this.residentSet.clear();
    this.capacityPages = capacityPages;
    this.accesses.length = 0;
    Object.assign(this.stats, {
      reads: 0, pageHits: 0, pageFaults: 0, evictions: 0,
      bytesReadFromDisk: 0, bytesRequested: 0,
    });
  }

  get hitRate(): number {
    const total = this.stats.pageHits + this.stats.pageFaults;
    return total === 0 ? 0 : this.stats.pageHits / total;
  }

  /**
   * Read amplification: bytes the disk had to move divided by bytes we asked
   * for. A number well above 1 means poor locality.
   */
  get readAmplification(): number {
    return this.stats.bytesRequested === 0
      ? 0
      : this.stats.bytesReadFromDisk / this.stats.bytesRequested;
  }
}

export type AccessPattern = "sequential" | "random" | "clustered" | "repeated-hot";

export interface PatternResult {
  pattern: AccessPattern;
  faults: number;
  hits: number;
  evictions: number;
  hitRate: number;
  readAmplification: number;
  bytesFromDisk: number;
}

/**
 * Run the same number of reads over the same file in different orders. Identical
 * work, wildly different cost — which is chapter 26's actual lesson.
 */
export function comparePatterns(
  file: MappedFile,
  readCount: number,
  readSize: number,
  seed = 12345,
): PatternResult[] {
  const results: PatternResult[] = [];
  const maxOffset = Math.max(1, file.bytes.length - readSize);
  // Deterministic PRNG so the comparison is reproducible across renders.
  let state = seed >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const patterns: AccessPattern[] = ["sequential", "random", "clustered", "repeated-hot"];
  for (const pattern of patterns) {
    file.reset();
    state = seed >>> 0;
    for (let i = 0; i < readCount; i++) {
      let offset: number;
      switch (pattern) {
        case "sequential":
          offset = (i * readSize) % maxOffset;
          break;
        case "random":
          offset = Math.floor(random() * maxOffset);
          break;
        case "clustered": {
          // Ten hot regions, read at random within them.
          const region = Math.floor(random() * 10);
          const regionSize = Math.floor(maxOffset / 10);
          offset = region * regionSize + Math.floor(random() * Math.min(regionSize, PAGE_SIZE * 2));
          break;
        }
        case "repeated-hot":
          offset = Math.floor(random() * Math.min(maxOffset, PAGE_SIZE * 2));
          break;
      }
      file.read(Math.min(offset, maxOffset), readSize);
    }
    results.push({
      pattern,
      faults: file.stats.pageFaults,
      hits: file.stats.pageHits,
      evictions: file.stats.evictions,
      hitRate: file.hitRate,
      readAmplification: file.readAmplification,
      bytesFromDisk: file.stats.bytesReadFromDisk,
    });
  }
  file.reset();
  return results;
}

export const PATTERN_NOTES: Record<AccessPattern, string> = {
  sequential:
    "Each page is faulted once and then reused by the reads that follow. This is why postings are stored in doc-id order.",
  random:
    "Almost every read lands on a page nobody asked for recently. With a cache smaller than the file, this is where thrashing begins.",
  clustered:
    "Reads concentrate on a few regions. A handful of hot pages stay resident, and the rest of the file is never paid for.",
  "repeated-hot":
    "The same couple of pages over and over. Effectively free after the first fault, which is what a term index looks like in practice.",
};
