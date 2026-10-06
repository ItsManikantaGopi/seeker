# Chapter 05 — Ranking with BM25

Retrieval answers *which documents match*; ranking answers *which are most useful*. Kaus uses BM25 — still the reference scoring function after 30 years.

> Code: `internal/search/bm25.go`

## The two dials

```go
type BM25 struct {
	K1 float64
	B  float64
}

func DefaultBM25() BM25 { return BM25{K1: 1.2, B: 0.75} }
```

`K1` controls how quickly term frequency saturates (a word appearing 10× isn't 10× as relevant). `B` controls how strongly document length is normalized (long docs get a handicap).

## IDF and the full score

```go
// ln(1 + (N - df + 0.5) / (df + 0.5)) -- always positive, rare terms win.
func (s BM25) IDF(totalDocs, docFreq int) float64 {
	n := float64(totalDocs)
	df := float64(docFreq)
	return math.Log(1 + (n-df+0.5)/(df+0.5))
}

func (s BM25) Score(tf, docFreq, totalDocs int, docLen, avgLen float64) float64 {
	...
	sat := tfF * (s.K1 + 1) / (tfF + s.K1*(1-s.B+s.B*docLen/avgLen))
	return idf * sat
}
```

The saturation term is where both dials act: tf grows the score with diminishing returns (`K1`), scaled down for long documents (`B`, via `docLen/avgLen`). The hand-computed test pins exact arithmetic: `Score(2, 1, 4, 6, 3)` = `ln(10/3) · 44/41` — if anyone touches the formula, the test knows.

## The explanation tree

Every score decomposes into named parts, so users can ask *why did this doc rank first?*:

```go
details := []*Explanation{
	{
		Value:       idf,
		Description: "idf, computed as log(1 + (N - df + 0.5) / (df + 0.5))",
		Details: []*Explanation{
			{Value: float64(ts.TotalDocs), Description: "N, total number of documents"},
			{Value: float64(ts.DocFreq),   Description: "df, document frequency"},
		},
	},
	{
		Value:       score / math.Max(idf, 1e-9),
		Description: "tf saturation, computed as ...",
		...
	},
}
```

The engine's `/​_explain` endpoint walks this tree; the test asserts `sum(details) == total` so the arithmetic shown is the arithmetic used.

## Top-K: keep the best, drop the rest

A bounded heap means memory stays O(K) no matter how many docs match:

```go
func (t *topK) Add(h Hit) {
	t.hits = append(t.hits, h)
	if len(t.hits) > t.k {
		worst := 0
		for i, x := range t.hits {
			if x.Score < t.hits[worst].Score || (x.Score == t.hits[worst].Score && x.DocID > t.hits[worst].DocID) {
				worst = i
			}
		}
		t.hits = append(t.hits[:worst], t.hits[worst+1:]...)
	}
}
```

The linear scan keeps it readable; production swaps in `container/heap`. Note the tie-break on `DocID`: equal scores must order deterministically or every page load reshuffles results.

## Wiring leaves to the tree

Each scoring leaf is one `TermScorer` (term, postings, df) plus the statistics bound at query time:

```go
ts.TotalDocs = totalDocs
ts.AvgLen = ix.AvgFieldLength(ts.Field)
ts.Scorer = bm25
ts.LengthOf = func(docID string) int { return ix.FieldLength(field, docID) }
```

Forgetting this binding shipped once: the explainers had a nil `LengthOf` and panicked. Now `Result.Scorer` does it in one place.

## Run: retrieval feeds ranking

```go
func (s *Scorer) Run(size int) []Hit {
	heap := newTopK(size)
	doc := s.root.Advance("")
	for doc != "" {
		total := 0.0
		for _, ts := range s.scorers {
			_, sc := ts.Explain(doc)
			total += sc
		}
		heap.Add(Hit{DocID: doc, Score: total})
		next := s.root.Advance(exec.Successor(doc))
		...
	}
	return heap.Sorted()
}
```

One drain of the iterator tree (chapter 04), summing leaf scores per candidate doc, feeding the heap. Filter clauses contribute iterators but no scorers — they match without influencing rank.

Next: the JSON query DSL that builds these trees from user input.
