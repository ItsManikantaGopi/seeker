/**
 * The book's table of contents, as data.
 *
 * Every chapter carries the two things the book keeps returning to: the question
 * being asked, and the data structure responsible for answering it. That pairing
 * is the Seeker Principle, so it belongs on every page rather than in a single
 * table at the front.
 */

export interface Chapter {
  number: number;
  slug: string;
  title: string;
  partNumber: number;
  /** What this chapter is really about, in one sentence. */
  summary: string;
  /** The question a user is asking. */
  question: string;
  /** The structure that answers it. */
  structure: string;
  /** What the lab on this page lets you do. */
  lab: string;
}

export interface Part {
  number: number;
  title: string;
  blurb: string;
}

export const PARTS: Part[] = [
  { number: 1, title: "Foundations", blurb: "What a search engine is actually doing, and what a document turns into before anything can find it." },
  { number: 2, title: "The First Search Engine", blurb: "A hash map, a set of document ids, and suddenly you no longer scan every document." },
  { number: 3, title: "Relevance", blurb: "Retrieval says which documents match. Ranking says which ones are worth showing." },
  { number: 4, title: "Query Language", blurb: "Field types and query types are different things, and confusing them is the most common search bug there is." },
  { number: 5, title: "Fuzzy Search", blurb: "From a dynamic-programming table you can read, to an automaton that never builds one." },
  { number: 6, title: "Term Dictionaries", blurb: "Prefix sharing, then suffix sharing, then outputs. Each step is a measurable size reduction." },
  { number: 7, title: "Numeric & Spatial Search", blurb: "Sorting solves one dimension. Two dimensions need you to partition space itself." },
  { number: 8, title: "Storage Engine", blurb: "Immutable segments, a real byte format, compression that you can decode by hand, and the page cache." },
  { number: 9, title: "Production Query Engine", blurb: "Planning, caching, concurrency and scripts — the difference between working and working under load." },
  { number: 10, title: "Distributed Search", blurb: "One index becomes many, and coordination becomes the hard part." },
  { number: 11, title: "Cluster & Operations", blurb: "Refresh, flush and commit are three different promises. Failure is part of the architecture." },
  { number: 12, title: "Production Engineering", blurb: "Optimise in order, size from the workload, and measure the percentiles users actually feel." },
  { number: 13, title: "The Seeker Project", blurb: "The build order, the testing strategy, and the map back to Lucene and OpenSearch." },
];

export const CHAPTERS: Chapter[] = [
  {
    number: 1, slug: "what-a-search-engine-does", partNumber: 1,
    title: "What a Search Engine Actually Does",
    summary: "Two jobs: build structures that make retrieval fast, then use them to find and rank documents.",
    question: "Where does a query actually go?",
    structure: "The whole pipeline — there is no single search data structure",
    lab: "Push a document and a query through the live pipeline and watch every stage light up.",
  },
  {
    number: 2, slug: "documents-fields-types", partNumber: 1,
    title: "Documents, Fields & Data Types",
    summary: "A field's type decides its index structure. The same string can be two fields at once.",
    question: "How should this value be stored?",
    structure: "Mappings: text, keyword, numeric, date, point",
    lab: "Change a field's type and watch the terms it produces — and the queries it can answer — change with it.",
  },
  {
    number: 3, slug: "tokenization-normalization-stemming", partNumber: 1,
    title: "Tokenization, Normalization & Stemming",
    summary: "Character filters, a tokenizer, then token filters. A token is intermediate; a term is what gets indexed.",
    question: "What text becomes searchable?",
    structure: "The analysis chain",
    lab: "Build an analyzer stage by stage and see index-time and query-time analysis agree — or silently disagree.",
  },
  {
    number: 4, slug: "inverted-index", partNumber: 2,
    title: "Inverted Index",
    summary: "term → set(docID). One map turns scanning every document into a single lookup.",
    question: "Which documents contain this term?",
    structure: "Inverted index",
    lab: "Build the index a document at a time, then race it against a full scan.",
  },
  {
    number: 5, slug: "postings-positions", partNumber: 2,
    title: "Postings & Positions",
    summary: "A real postings list carries frequency and positions, not just document ids.",
    question: "Where does the term occur, and how often?",
    structure: "Postings with positions",
    lab: "Inspect real postings, then see why two documents with identical terms answer a phrase query differently.",
  },
  {
    number: 6, slug: "query-execution", partNumber: 2,
    title: "Query Execution",
    summary: "A query becomes an execution tree of iterators that never materialise a set.",
    question: "How do several postings lists combine?",
    structure: "Iterators: two pointers, and skipping",
    lab: "Step through the book's worked intersection, then compare stepping with skipping.",
  },
  {
    number: 7, slug: "ranking", partNumber: 3,
    title: "Ranking",
    summary: "Retrieval answers which documents match. Ranking answers which are most useful.",
    question: "Which matching document should come first?",
    structure: "Three signals: frequency, rarity, length",
    lab: "Rank the same result set by each signal alone and see where each one fails.",
  },
  {
    number: 8, slug: "bm25", partNumber: 3,
    title: "BM25 from First Principles",
    summary: "Saturating term frequency, inverse document frequency, and length normalisation, with k1 and b as the dials.",
    question: "How much is this match worth?",
    structure: "BM25",
    lab: "Turn k1 and b and watch the curves and the ranking move together, with the arithmetic shown.",
  },
  {
    number: 9, slug: "unknown-words", partNumber: 3,
    title: "Unknown Words, OOV Terms & Zero Results",
    summary: "No postings means no candidates. BM25 never gets a chance to score anything.",
    question: "What happens when the term is not in the dictionary?",
    structure: "Term dictionary lookup, and the fuzzy rescue",
    lab: "Search for a term that does not exist, then watch fuzzy search rescue it.",
  },
  {
    number: 10, slug: "text-vs-keyword", partNumber: 4,
    title: "Text vs Keyword",
    summary: "text is analyzed, keyword is not. keyword is a field type; term is a query type.",
    question: "Why does my exact-match query return nothing?",
    structure: "Field mapping vs query type",
    lab: "Run the same query against both representations of one string and watch them disagree.",
  },
  {
    number: 11, slug: "match-term-bool-range", partNumber: 4,
    title: "Match, Term, Bool & Range",
    summary: "match analyzes, term does not. must, filter, should and must_not each mean something specific.",
    question: "Which clause do I actually want?",
    structure: "Boolean query with scoring and non-scoring clauses",
    lab: "Assemble a bool query clause by clause and watch matching and scoring change independently.",
  },
  {
    number: 12, slug: "phrase-prefix-wildcard-regex", partNumber: 4,
    title: "Phrase, Prefix, Wildcard & Regex",
    summary: "Different query types stress different structures, and expansion must always be bounded.",
    question: "What does this pattern cost?",
    structure: "Positions, vocabulary traversal, term expansion",
    lab: "Run each pattern type and compare the real work each one does against the dictionary.",
  },
  {
    number: 13, slug: "edit-distance", partNumber: 5,
    title: "Edit Distance",
    summary: "Insertions, deletions and substitutions, computed by a table you can read cell by cell.",
    question: "How far apart are these two strings?",
    structure: "Dynamic programming table",
    lab: "Fill the table, follow the traceback, and use it as the oracle everything else is tested against.",
  },
  {
    number: 14, slug: "levenshtein-automata", partNumber: 5,
    title: "Levenshtein Automata",
    summary: "Stop asking about two known strings. Build a recognizer for every string within N edits.",
    question: "Which strings are within N edits of my query?",
    structure: "Levenshtein automaton (NFA determinized to a DFA)",
    lab: "Build the automaton, feed it terms character by character, and watch dead states kill candidates early.",
  },
  {
    number: 15, slug: "candidate-terms-expansion", partNumber: 5,
    title: "Candidate Terms & Expansion",
    summary: "The automaton recognizes; the dictionary supplies. Prefix length and max expansions keep it affordable.",
    question: "Which indexed terms does a fuzzy query actually reach?",
    structure: "Automaton intersected with the term dictionary",
    lab: "Tune edits, prefix length and expansion limits and watch the cost and the result set move.",
  },
  {
    number: 16, slug: "tries", partNumber: 6,
    title: "Tries",
    summary: "Characters along paths. Shared prefixes are stored once, which makes prefix queries natural.",
    question: "Which terms start with this prefix?",
    structure: "Trie",
    lab: "Build a trie from the real vocabulary, walk it, and measure what prefix sharing saves.",
  },
  {
    number: 17, slug: "finite-state-machines", partNumber: 6,
    title: "Finite-State Machines",
    summary: "A trie shares prefixes. Minimization also shares suffixes, by merging states with identical futures.",
    question: "Can two parts of the dictionary be the same structure?",
    structure: "Minimized deterministic automaton",
    lab: "Minimize the trie and see exactly which nodes merged, and how many disappeared.",
  },
  {
    number: 18, slug: "fsts", partNumber: 6,
    title: "FSTs",
    summary: "A transducer maps input to output, so a term can carry an ordinal, an offset or a block pointer.",
    question: "Where are this term's postings?",
    structure: "Finite-state transducer with outputs",
    lab: "Build an FST from sorted terms and watch outputs accumulate arc by arc along a lookup.",
  },
  {
    number: 19, slug: "blocktree", partNumber: 6,
    title: "BlockTree",
    summary: "A small index navigates; blocks store the terms. One enormous FST is not the answer.",
    question: "How does a dictionary too large for memory still get searched?",
    structure: "Prefix index plus term blocks",
    lab: "Compare an index over every term against an index over block keys, then look a term up through both.",
  },
  {
    number: 20, slug: "points-range-indexing", partNumber: 7,
    title: "Points & Range Indexing",
    summary: "Sort the values once and a range becomes an interval found by binary search.",
    question: "Which values are between A and B?",
    structure: "Sorted point values",
    lab: "Watch both binary searches find the interval endpoints, step by step.",
  },
  {
    number: 21, slug: "kd-trees", partNumber: 7,
    title: "KD Trees",
    summary: "Two dimensions cannot be sorted for both, so partition the space and reject whole regions.",
    question: "Which points are inside this rectangle?",
    structure: "KD tree",
    lab: "Drag a query rectangle over real coordinates and watch subtrees get rejected without being read.",
  },
  {
    number: 22, slug: "bkd-trees", partNumber: 7,
    title: "BKD Trees",
    summary: "The same partitioning, but leaves hold blocks of byte-encoded points instead of one object each.",
    question: "How does this work when the points live on disk?",
    structure: "BKD tree with leaf blocks",
    lab: "Change the leaf size and compare blocks read, points compared and bytes touched.",
  },
  {
    number: 23, slug: "segments", partNumber: 8,
    title: "Segments",
    summary: "Immutable segments instead of one mutable index. Deletes are tombstones; merges reclaim them.",
    question: "How is a growing index kept searchable?",
    structure: "Immutable segments with background merging",
    lab: "Index, refresh, delete and merge, and watch tombstones survive until a merge rewrites them.",
  },
  {
    number: 24, slug: "byte-level-formats", partNumber: 8,
    title: "Byte-Level Formats",
    summary: "Magic bytes, a version, a body, a checksum, a footer. Versions exist because layouts change.",
    question: "What is actually on disk?",
    structure: "A defined file format",
    lab: "Inspect the real bytes of a real segment file, region by region, down to individual vints.",
  },
  {
    number: 25, slug: "compression-checksums", partNumber: 8,
    title: "Compression & Checksums",
    summary: "Gaps instead of ids, vints instead of fixed widths, blocks instead of whole lists. Checksums catch corruption.",
    question: "How small can this get, and how do we know it is intact?",
    structure: "Gap encoding, bit packing, CRC32",
    lab: "Compress real postings four ways, then flip a byte and watch the checksum catch it.",
  },
  {
    number: 26, slug: "mmap-page-cache", partNumber: 8,
    title: "mmap & Page Cache",
    summary: "The index is not copied into the heap. Hot pages stay resident; cold pages stay on disk.",
    question: "Why is the second query so much faster?",
    structure: "Memory mapping and the OS page cache",
    lab: "Run identical reads in four access orders and watch locality decide the cost.",
  },
  {
    number: 27, slug: "query-planning", partNumber: 9,
    title: "Query Planning",
    summary: "Drive from the cheapest clause, and never score a document that cannot reach the top K.",
    question: "How much of this work can be skipped?",
    structure: "Cost-based ordering and a bounded heap",
    lab: "Flip the join order, then compare exhaustive scoring against WAND on the same query.",
  },
  {
    number: 28, slug: "caching", partNumber: 9,
    title: "Caching",
    summary: "Four layers, and hit rate alone will lie to you. Only deterministic, score-free work is cacheable.",
    question: "What can be reused, and how would I know it is working?",
    structure: "Page cache, filter cache, result cache",
    lab: "Drive an LRU with a real query stream and watch hit, miss and eviction rates disagree.",
  },
  {
    number: 29, slug: "concurrency", partNumber: 9,
    title: "Concurrency & Thread Pools",
    summary: "Segments can be searched in parallel, but unbounded concurrency buys queueing, not throughput.",
    question: "How many workers is the right number?",
    structure: "Bounded pool, bounded queue, timeouts, backpressure",
    lab: "Run a request stream through a simulated pool and watch p99 react to every knob.",
  },
  {
    number: 30, slug: "scripted-scoring", partNumber: 9,
    title: "Painless & Scripted Scoring",
    summary: "Cheap retrieval, small candidate set, expensive script. The other order is how you build a slow query.",
    question: "How do I add business logic to relevance?",
    structure: "A restricted expression language over the base score",
    lab: "Write a scoring script and watch the ranking, and the evaluation count, respond.",
  },
  {
    number: 31, slug: "shards", partNumber: 10,
    title: "Shards",
    summary: "One index becomes several. Each shard is a complete search index over part of the data.",
    question: "What happens when the data outgrows one machine?",
    structure: "Partitioned index",
    lab: "Change the shard count and watch fan-out, distribution and per-shard statistics move.",
  },
  {
    number: 32, slug: "replicas", partNumber: 10,
    title: "Replicas",
    summary: "Sharding splits data. Replication copies it. They solve different problems and cost differently.",
    question: "What survives a node failure?",
    structure: "Shard copies",
    lab: "Kill nodes with and without replicas and compare what the cluster can still answer.",
  },
  {
    number: 33, slug: "distributed-query-fetch", partNumber: 10,
    title: "Distributed Query & Fetch",
    summary: "Score everywhere, merge globally, then fetch bodies only for the winners.",
    question: "Why are there two round trips?",
    structure: "Query phase, global merge, fetch phase",
    lab: "Watch both phases run, with the bytes each one moves counted.",
  },
  {
    number: 34, slug: "routing-rescoring", partNumber: 10,
    title: "Routing & Rescoring",
    summary: "Routing decides fan-out and creates hot shards. Rescoring pays for expensive logic only where it matters.",
    question: "Can I ask fewer shards, and score fewer documents?",
    structure: "Routing key hash, and a rescore window",
    lab: "Compare routing strategies, then set a rescore window and see what it promotes and what it misses.",
  },
  {
    number: 35, slug: "refresh-flush-commit", partNumber: 11,
    title: "Refresh, Flush & Commit",
    summary: "Visibility, file writing and durability are three separate promises with three separate costs.",
    question: "Is this write searchable, written, or safe?",
    structure: "RAM buffer, segments, translog, commit point",
    lab: "Drive each verb by hand and watch exactly which guarantee it changes.",
  },
  {
    number: 36, slug: "recovery-replication", partNumber: 11,
    title: "Recovery & Replication",
    summary: "Failure is part of the architecture. Detect, find a valid copy, recover, verify checksums, mark healthy.",
    question: "What happens after the crash?",
    structure: "Translog replay and copy-based recovery",
    lab: "Crash the engine at different points and recover it, then corrupt a file and watch verification fail.",
  },
  {
    number: 37, slug: "cluster-management", partNumber: 11,
    title: "Cluster Management",
    summary: "A control plane tracks nodes, allocation and metadata. A data plane indexes, searches and scores.",
    question: "Who decides where a shard lives?",
    structure: "Cluster state",
    lab: "Add and remove nodes and watch allocation, promotion and health respond.",
  },
  {
    number: 38, slug: "performance-engineering", partNumber: 12,
    title: "Performance Engineering",
    summary: "Optimise in order. Every symptom has a first thing to check and a graph that will mislead you.",
    question: "Where is the time actually going?",
    structure: "A fixed optimisation order",
    lab: "Work the symptom table, and profile a real query to see which stage dominates.",
  },
  {
    number: 39, slug: "capacity-planning", partNumber: 12,
    title: "Capacity Planning",
    summary: "Start from the data and the workload. Never size a cluster from raw source-document size.",
    question: "How many nodes, and what binds first?",
    structure: "Storage, CPU and page-cache budgets",
    lab: "Size a cluster and watch which of the three constraints binds as you change the inputs.",
  },
  {
    number: 40, slug: "observability", partNumber: 12,
    title: "Observability & Failure Modes",
    summary: "Percentiles, not averages. And keep a reference implementation to test the fast path against.",
    question: "How would I know this is broken?",
    structure: "Metrics, percentiles, differential testing",
    lab: "Read a latency distribution the way an average would hide it, and tour the metric catalogue.",
  },
  {
    number: 41, slug: "implementation-roadmap", partNumber: 13,
    title: "Implementation Roadmap",
    summary: "Fifteen stages, each replacing one component. Do not skip an intermediate structure.",
    question: "In what order should this be built?",
    structure: "The staged build",
    lab: "Walk the roadmap and jump to the lab that proves each stage was necessary.",
  },
  {
    number: 42, slug: "testing-strategy", partNumber: 13,
    title: "Testing Strategy",
    summary: "A golden corpus for expectations, and a slow reference implementation as the oracle for everything fast.",
    question: "How do I know the optimisation did not change the answer?",
    structure: "Golden corpus and differential testing",
    lab: "Run the real differential test suite in the browser, against the real engine on this site.",
  },
  {
    number: 43, slug: "seeker-to-opensearch", partNumber: 13,
    title: "From Seeker to OpenSearch",
    summary: "Every structure here has a name in Lucene. The mapping is the point of the whole exercise.",
    question: "What is this called in the real thing?",
    structure: "The complete architecture",
    lab: "Follow a query through the full architecture and read the Lucene name for each stage.",
  },
];

export const CHAPTERS_BY_SLUG = new Map(CHAPTERS.map((c) => [c.slug, c]));

export function chapterBySlug(slug: string): Chapter | undefined {
  return CHAPTERS_BY_SLUG.get(slug);
}

export function chaptersInPart(partNumber: number): Chapter[] {
  return CHAPTERS.filter((c) => c.partNumber === partNumber);
}

export function neighbours(slug: string): { previous: Chapter | null; next: Chapter | null } {
  const i = CHAPTERS.findIndex((c) => c.slug === slug);
  return {
    previous: i > 0 ? CHAPTERS[i - 1] : null,
    next: i >= 0 && i < CHAPTERS.length - 1 ? CHAPTERS[i + 1] : null,
  };
}

/** The book's opening table: a question, and the structure responsible for it. */
export const QUESTION_TO_STRUCTURE: { question: string; structure: string; chapter: number }[] = [
  { question: "Does this term exist?", structure: "Term dictionary", chapter: 19 },
  { question: "Which documents contain this term?", structure: "Postings", chapter: 4 },
  { question: "Where does the term occur?", structure: "Positions", chapter: 5 },
  { question: "What terms start with this prefix?", structure: "Trie / FST / term dictionary", chapter: 16 },
  { question: "Which terms are within edit distance 1?", structure: "Levenshtein automaton + dictionary", chapter: 14 },
  { question: "Which prices are between 100 and 200?", structure: "Point index", chapter: 20 },
  { question: "Which geo points are inside a region?", structure: "BKD", chapter: 22 },
  { question: "Which matching documents are most relevant?", structure: "BM25", chapter: 8 },
  { question: "How is the index persisted?", structure: "Segments / files", chapter: 23 },
  { question: "How is it distributed?", structure: "Shards / replicas", chapter: 31 },
];

/** Chapter 43's mapping table. */
export const SEEKER_TO_LUCENE: { seeker: string; lucene: string; chapter: number }[] = [
  { seeker: "Analyzer", lucene: "analysis chain", chapter: 3 },
  { seeker: "term → docs", lucene: "postings", chapter: 4 },
  { seeker: "sorted terms", lucene: "term dictionary", chapter: 16 },
  { seeker: "trie / automaton", lucene: "FST / term index", chapter: 18 },
  { seeker: "term blocks", lucene: "BlockTree", chapter: 19 },
  { seeker: "point tree", lucene: "BKD", chapter: 22 },
  { seeker: "segment", lucene: "Lucene segment", chapter: 23 },
  { seeker: "BM25", lucene: "BM25Similarity", chapter: 8 },
  { seeker: "match / term / bool", lucene: "Query DSL", chapter: 11 },
  { seeker: "fuzzy", lucene: "FuzzyQuery", chapter: 15 },
  { seeker: "script", lucene: "Painless", chapter: 30 },
  { seeker: "shards", lucene: "distributed partitions", chapter: 31 },
  { seeker: "replicas", lucene: "shard copies", chapter: 32 },
];

/** Chapter 41's staged build. */
export const ROADMAP: { stage: number; build: string; replaceWith: string; chapter: number }[] = [
  { stage: 1, build: "documents + tokenizer", replaceWith: "real analyzer", chapter: 3 },
  { stage: 2, build: "term → set(docID)", replaceWith: "compressed postings", chapter: 25 },
  { stage: 3, build: "positions", replaceWith: "position codecs", chapter: 5 },
  { stage: 4, build: "AND/OR/phrase", replaceWith: "iterator execution", chapter: 6 },
  { stage: 5, build: "toy score", replaceWith: "BM25", chapter: 8 },
  { stage: 6, build: "sorted terms", replaceWith: "trie", chapter: 16 },
  { stage: 7, build: "trie", replaceWith: "minimized automaton", chapter: 17 },
  { stage: 8, build: "automaton + outputs", replaceWith: "FST", chapter: 18 },
  { stage: 9, build: "term blocks", replaceWith: "BlockTree-style dictionary", chapter: 19 },
  { stage: 10, build: "sorted numeric values", replaceWith: "BKD", chapter: 22 },
  { stage: 11, build: "simple files", replaceWith: "versioned segment codec", chapter: 24 },
  { stage: 12, build: "file reads", replaceWith: "mmap reader", chapter: 26 },
  { stage: 13, build: "single node", replaceWith: "shards", chapter: 31 },
  { stage: 14, build: "shards", replaceWith: "replicas / recovery", chapter: 36 },
  { stage: 15, build: "basic metrics", replaceWith: "production observability", chapter: 40 },
];

export const PRODUCTION_CHECKLIST: { item: string; chapter: number }[] = [
  { item: "Define freshness guarantees.", chapter: 35 },
  { item: "Define durability guarantees.", chapter: 35 },
  { item: "Bound fuzzy expansion.", chapter: 15 },
  { item: "Bound wildcard/regex expansion.", chapter: 12 },
  { item: "Set distributed timeouts.", chapter: 29 },
  { item: "Monitor p50/p95/p99.", chapter: 40 },
  { item: "Track shard sizes.", chapter: 31 },
  { item: "Track shard skew.", chapter: 34 },
  { item: "Test node failures.", chapter: 32 },
  { item: "Test disk failures.", chapter: 25 },
  { item: "Test network failures.", chapter: 36 },
  { item: "Test recovery.", chapter: 36 },
  { item: "Test snapshot/restore.", chapter: 36 },
  { item: "Monitor segment counts.", chapter: 23 },
  { item: "Monitor merge pressure.", chapter: 23 },
  { item: "Keep index formats versioned.", chapter: 24 },
  { item: "Verify checksums.", chapter: 25 },
  { item: "Keep a reference implementation.", chapter: 42 },
  { item: "Differential-test optimized algorithms.", chapter: 42 },
  { item: "Load-test realistic query distributions.", chapter: 38 },
  { item: "Version analyzers and mappings carefully.", chapter: 3 },
  { item: "Treat reindexing as a data migration.", chapter: 2 },
  { item: "Protect expensive scripts.", chapter: 30 },
];
