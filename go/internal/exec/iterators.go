// Package exec is Chapter 04: query execution as an iterator tree. A query
// becomes a tree of iterators that never materialize an intermediate set.
package exec

import (
	"sort"

	"kaus-go/internal/index"
)

// Iterator walks one postings list (or a combination of them) in docID order.
type Iterator interface {
	// DocID returns the current document, or "" when exhausted.
	DocID() string
	// Advance moves to the first doc >= target and returns it.
	Advance(target string) string
	// Cost is a cheap estimate of list size, used for ordering.
	Cost() int
}

// --- leaf -------------------------------------------------------------

// termIter iterates one stored postings list.
type termIter struct {
	postings []index.Posting
	cur      int
}

// NewTerm wraps a postings list into an iterator.
func NewTerm(pl *index.PostingsList) Iterator {
	if pl == nil {
		return &emptyIter{}
	}
	return &termIter{postings: pl.Postings, cur: 0}
}

func (t *termIter) DocID() string {
	if t.cur >= len(t.postings) {
		return ""
	}
	return t.postings[t.cur].DocID
}

func (t *termIter) Advance(target string) string {
	// Galloping skip: postings are sorted by docID, so binary search.
	i := sort.Search(len(t.postings), func(i int) bool { return t.postings[i].DocID >= target })
	t.cur = i
	return t.DocID()
}

func (t *termIter) Cost() int { return len(t.postings) }

type emptyIter struct{}

func (emptyIter) DocID() string         { return "" }
func (emptyIter) Advance(string) string { return "" }
func (emptyIter) Cost() int             { return 0 }

// --- conjunction ------------------------------------------------------

// And yields documents present in every child.
type And struct {
	children []Iterator
	cur      string
}

// NewAnd builds a conjunction; children should be ordered cheapest-first by
// the planner, because the first child drives.
func NewAnd(children ...Iterator) *And {
	return &And{children: children}
}

func (a *And) DocID() string { return a.cur }

func (a *And) Advance(target string) string {
	if len(a.children) == 0 {
		a.cur = ""
		return ""
	}
	for {
		candidate := a.children[0].Advance(target)
		if candidate == "" {
			a.cur = ""
			return ""
		}
		// Leapfrog: each other child must reach candidate too.
		allMatch := true
		for _, c := range a.children[1:] {
			got := c.Advance(candidate)
			if got == "" {
				a.cur = ""
				return ""
			}
			if got != candidate {
				// Someone is behind; restart from that doc.
				target = got
				allMatch = false
				break
			}
		}
		if allMatch {
			a.cur = candidate
			return candidate
		}
	}
}

func (a *And) Cost() int {
	total := 0
	for _, c := range a.children {
		total += c.Cost()
	}
	return total
}

// --- disjunction --------------------------------------------------------

// Or yields documents present in any child.
type Or struct {
	children []Iterator
	cur      string
}

// NewOr builds a disjunction.
func NewOr(children ...Iterator) *Or { return &Or{children: children} }

func (o *Or) DocID() string { return o.cur }

func (o *Or) Advance(target string) string {
	best := ""
	for _, c := range o.children {
		got := c.Advance(target)
		if got == "" {
			continue
		}
		if best == "" || got < best {
			best = got
		}
	}
	o.cur = best
	return best
}

func (o *Or) Cost() int {
	total := 0
	for _, c := range o.children {
		total += c.Cost()
	}
	return total
}

// --- exclusion ----------------------------------------------------------

// Not yields documents in include but not in exclude. Exclude is non-scoring.
type Not struct {
	include Iterator
	exclude Iterator
	cur     string
}

// NewNot builds an exclusion.
func NewNot(include, exclude Iterator) *Not { return &Not{include: include, exclude: exclude} }

func (n *Not) DocID() string { return n.cur }

func (n *Not) Advance(target string) string {
	for {
		doc := n.include.Advance(target)
		if doc == "" {
			n.cur = ""
			return ""
		}
		blocked := n.exclude.Advance(doc)
		if blocked == doc {
			// This doc is excluded; resume strictly after it. Advancing
			// include to `doc` itself would return the same doc forever.
			target = Successor(doc)
			continue
		}
		n.cur = doc
		return doc
	}
}

func (n *Not) Cost() int { return n.include.Cost() }

// --- helpers ------------------------------------------------------------

// Collect drains an iterator into a sorted slice of doc ids. The testsuite
// uses this to compare trees against the naive scan oracle.
func Collect(it Iterator) []string {
	var out []string
	doc := it.Advance("")
	for doc != "" {
		out = append(out, doc)
		next := nextAfter(it, doc)
		if next == "" {
			break
		}
		doc = next
	}
	return out
}

// nextAfter advances just past doc without binary searching from scratch.
func nextAfter(it Iterator, doc string) string {
	return it.Advance(Successor(doc))
}

// Successor returns the smallest string greater than s: appending a zero
// byte. Callers use it to step an iterator strictly forward. (Incrementing
// the last byte would jump over siblings - Successor("doc-1") = "doc-2" would
// skip "doc-12" entirely.)
func Successor(s string) string {
	return s + "\x00"
}

// PostingsFor exposes positions of the term in one document, needed by the
// phrase executor.
type PositionSource interface {
	PositionsIn(field, term, docID string) []int
}

// IndexPositions adapts index.Index to PositionSource.
type IndexPositions struct{ IX *index.Index }

func (p IndexPositions) PositionsIn(field, term, docID string) []int {
	pl := p.IX.Lookup(field, term)
	if pl == nil {
		return nil
	}
	for _, posting := range pl.Postings {
		if posting.DocID == docID {
			return posting.Positions
		}
	}
	return nil
}

// Phrase finds documents where all terms appear consecutively (slop=0) or
// within slop moves. It only visits documents that contain every term.
type Phrase struct {
	Field   string
	Terms   []string
	Slop    int
	src     PositionSource
	members []Iterator // one term iterator per phrase word
	cur     string
}

// NewPhrase builds a phrase iterator. Members must be term iterators over the
// same field so conjunction prunes candidates before position checks.
func NewPhrase(src PositionSource, field string, terms []string, members []Iterator, slop int) *Phrase {
	return &Phrase{Field: field, Terms: terms, Slop: slop, src: src, members: members}
}

func (p *Phrase) DocID() string { return p.cur }

func (p *Phrase) Advance(target string) string {
	and := NewAnd(p.members...)
	for {
		doc := and.Advance(target)
		if doc == "" {
			p.cur = ""
			return ""
		}
		if p.matches(doc) {
			p.cur = doc
			return doc
		}
		target = Successor(doc)
	}
}

func (p *Phrase) Cost() int {
	total := 0
	for _, m := range p.members {
		total += m.Cost()
	}
	return total
}

// matches checks positional adjacency with bounded slop. Positions are
// 0-based term offsets produced by the analyzer chain.
func (p *Phrase) matches(doc string) bool {
	lists := make([][]int, len(p.Terms))
	for i, t := range p.Terms {
		pos := p.src.PositionsIn(p.Field, t, doc)
		if len(pos) == 0 {
			return false
		}
		sort.Ints(pos)
		lists[i] = pos
	}
	if p.Slop <= 0 {
		// Exact phrase: positions must line up at offset k, k+1, ...
		for _, start := range lists[0] {
			ok := true
			for i := 1; i < len(lists); i++ {
				found := false
				for _, q := range lists[i] {
					if q == start+i {
						found = true
						break
					}
					if q > start+i {
						break
					}
				}
				if !found {
					ok = false
					break
				}
			}
			if ok {
				return true
			}
		}
		return false
	}
	// Bounded slop: search for any assignment where consecutive terms are
	// within slop+1 positions of each other, moving forward only.
	var walk func(idx int, lastPos int, budget int) bool
	walk = func(idx int, lastPos int, budget int) bool {
		if idx == len(lists) {
			return true
		}
		for _, q := range lists[idx] {
			if q <= lastPos {
				continue
			}
			gap := q - lastPos - 1
			if gap > budget {
				break
			}
			if walk(idx+1, q, budget-gap) {
				return true
			}
		}
		return false
	}
	for _, start := range lists[0] {
		if walk(1, start, p.Slop) {
			return true
		}
	}
	return false
}
