# Chapter 03 — The Inverted Index

The heart of every search engine: map each **(field, term)** to the list of documents containing it, with frequencies and positions.

> Code: `internal/index/index.go`

## Postings

```go
type Posting struct {
	DocID     string
	Frequency int
	Positions []int // term positions after analysis, 0-based
}

type PostingsList struct {
	Postings   []Posting
	DocFreq    int        // how many docs contain the term (feeds IDF)
	TotalTerms int        // sum of frequencies
}
```

`Frequency` feeds BM25's tf-saturation; `Positions` feeds phrase queries; `DocFreq` feeds IDF. Everything ranking needs lives here.

## Adding a document

`Add` analyzes every mapped text field, then writes postings per (field, term):

```go
seen := make(map[string][]int)
order := make([]string, 0, len(terms))
for pos, t := range terms {
	if _, ok := seen[t]; !ok {
		order = append(order, t)
	}
	seen[t] = append(seen[t], pos)
}
sort.Strings(order)
for _, term := range order {
	positions := seen[term]
	pl := fi.Terms[term]
	...
	pl.Postings = append(pl.Postings, Posting{DocID: doc.ID, Frequency: len(positions), Positions: positions})
	pl.DocFreq++
	pl.TotalTerms += len(positions)
}
```

### The sorted-postings invariant (a real bug story)

Iterators binary-search postings by doc ID (chapter 04), so lists **must stay lexicographically sorted** — even when documents arrive out of order. With ids like `doc-12` vs `doc-3`, insertion order (`doc-3` before `doc-12`) is *not* sort order, and binary search silently skips hits. That bug shipped, hid behind small test corpora, and was caught only when the demo corpus returned 4 of 9 expected fuzzy results:

```go
// Iterators binary-search postings by docID, so the list MUST stay
// sorted lexicographically even when documents arrive out of order
// (doc-12 sorts before doc-3 as strings).
for _, pl := range touched {
	sort.Slice(pl.Postings, func(i, j int) bool { return pl.Postings[i].DocID < pl.Postings[j].DocID })
}
```

Lesson: an invariant you don't enforce is an invariant you don't have. The test suite now drains iterators over shuffled ids to guard it.

## Upsert and delete

Upsert removes the previous version first — otherwise stale postings survive and `totalLen` double-counts:

```go
// Remove any previous version of this document first (upsert).
if l, existed := fi.DocLength[doc.ID]; existed {
	ix.totalLen[field] -= int64(l)
}
ix.removeDocFromFieldLocked(field, fi, doc.ID)
```

Delete subtracts lengths, strips postings, decrements `DocFreq`, and drops empty lists entirely so the dictionary stays clean.

## Statistics for scoring

BM25 needs two global numbers per field, both maintained incrementally:

```go
totalLen map[string]int64 // field -> total terms across docs
docCount int
```

`AvgFieldLength("body")` divides one by the other. Recomputing these on every query would be O(N); maintaining them on mutation keeps scoring O(1).

## Encapsulation: lookup returns copies

```go
cp := *pl
// Deep-copy the postings slice: callers may mutate their view (or the
// TermScorer may hold it) without corrupting the live index.
cp.Postings = make([]Posting, len(pl.Postings))
copy(cp.Postings, pl.Postings)
return &cp
```

A test mutates a returned posting and verifies a fresh `Lookup` is untouched — cheap insurance against aliasing bugs that would otherwise appear as random score corruption.

All access sits behind a `sync.RWMutex`: many concurrent readers, serialized writers. Chapter 12's HTTP server relies on this for free thread safety.

Next: chapter 04 walks these lists without materializing sets — the iterator tree.
