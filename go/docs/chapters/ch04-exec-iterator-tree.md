# Chapter 04 — Execution as an Iterator Tree

Given a query like `rolling AND updates NOT kafka`, the naive approach builds three sets and intersects them in memory. Real engines never materialize intermediate sets — they compose **iterators** into a tree and stream matching doc IDs.

> Code: `internal/exec/iterators.go`

## One interface to rule them all

```go
type Iterator interface {
	// DocID returns the current document, or "" when exhausted.
	DocID() string
	// Advance moves to the first doc >= target and returns it.
	Advance(target string) string
	// Cost is a cheap estimate of list size, used for ordering.
	Cost() int
}
```

`Advance(target)` is the whole trick: because postings are sorted, any tree can jump directly to *"first match at or after target"* — this is Lucene's `advance()`.

## Leaf: binary search over postings

```go
func (t *termIter) Advance(target string) string {
	// Galloping skip: postings are sorted by docID, so binary search.
	i := sort.Search(len(t.postings), func(i int) bool { return t.postings[i].DocID >= target })
	t.cur = i
	return t.DocID()
}
```

An empty postings list becomes an `emptyIter` — queries against missing terms just work.

## Conjunction: leapfrog join

```go
candidate := a.children[0].Advance(target)
...
allMatch := true
for _, c := range a.children[1:] {
	got := c.Advance(candidate)
	if got != candidate {
		target = got // someone is behind; restart from that doc
		allMatch = false
		break
	}
}
```

Each child either reaches the candidate or drags the search forward to where it *did* land. On skewed lists this skips huge ranges without touching them.

## Disjunction: min of children

`Or.Advance` advances every child to the target and returns the minimum non-empty result. Simple, correct, and the natural complement to the conjunction above.

## Exclusion: resume strictly after

The subtle one. When a doc is excluded, advancing `include` to the same doc would return it forever — an infinite loop that shipped in early testing:

```go
blocked := n.exclude.Advance(doc)
if blocked == doc {
	// This doc is excluded; resume strictly after it. Advancing
	// include to `doc` itself would return the same doc forever.
	target = Successor(doc)
	continue
}
```

Which raises the question: what *is* the successor of a string?

## Successor: append a zero byte

```go
// Successor returns the smallest string greater than s: appending a zero
// byte. Callers use it to step an iterator strictly forward. (Incrementing
// the last byte would jump over siblings - Successor("doc-1") = "doc-2" would
// skip "doc-12" entirely.)
func Successor(s string) string {
	return s + "\x00"
}
```

Incrementing the last byte feels natural but breaks lexicographic order: `"doc-2" > "doc-12"`, so stepping from `doc-1` to `doc-2` skips everything between. Appending `\x00` gives the true immediate successor. This exact bug caused the demo corpus to lose six of nine fuzzy hits — see chapter 13's differential tests.

## Phrase with slop

`Phrase` uses an inner `And` to find candidate docs containing every word, then checks positions: slop=0 requires offsets `k, k+1, ...`; slop=N allows gaps totalling N between consecutive words (verified by a bounded backtracking walk).

## Draining a tree

```go
func Collect(it Iterator) []string {
	var out []string
	doc := it.Advance("")
	for doc != "" {
		out = append(out, doc)
		next := nextAfter(it, doc) // Advance(Successor(doc))
		...
	}
	return out
}
```

Every query compiles (chapter 06) into exactly one such tree; the scorer (chapter 05) drains it once and ranks what falls out.

Next: turning matched docs into ranked hits with BM25.
