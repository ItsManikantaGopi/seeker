// Package dict is Chapter 09: the term dictionary. A sorted array answers
// exact lookups by binary search; a trie makes prefix walks natural; bounded
// expansion keeps fuzzy/wildcard queries affordable.
package dict

import (
	"sort"
	"strings"

	"seeker-go/internal/fuzzy"
)

// Dictionary is a sorted, deduplicated list of terms.
type Dictionary struct {
	terms []string
}

// NewDictionary builds from any term slice (order irrelevant).
func NewDictionary(terms []string) *Dictionary {
	cp := make([]string, len(terms))
	copy(cp, terms)
	sort.Strings(cp)
	out := cp[:0]
	var prev string
	for i, t := range cp {
		if i == 0 || t != prev {
			out = append(out, t)
		}
		prev = t
	}
	return &Dictionary{terms: out}
}

// Terms returns the sorted vocabulary.
func (d *Dictionary) Terms() []string {
	out := make([]string, len(d.terms))
	copy(out, d.terms)
	return out
}

// Len is the vocabulary size.
func (d *Dictionary) Len() int { return len(d.terms) }

// Has is an exact membership check via binary search.
func (d *Dictionary) Has(term string) bool {
	i := sort.SearchStrings(d.terms, term)
	return i < len(d.terms) && d.terms[i] == term
}

// Range returns terms in [lo, hi) - binary search finds both endpoints.
func (d *Dictionary) Range(lo, hi string) []string {
	from := sort.SearchStrings(d.terms, lo)
	to := sort.SearchStrings(d.terms, hi)
	out := make([]string, to-from)
	copy(out, d.terms[from:to])
	return out
}

// --- trie ---------------------------------------------------------------

// Trie stores terms along character paths. Shared prefixes are stored once,
// which is what makes prefix queries cheap.
type Trie struct {
	children map[rune]*Trie
	isTerm   bool
	size     int // number of terms in this subtree
}

// NewTrie builds an empty trie.
func NewTrie() *Trie { return &Trie{children: make(map[rune]*Trie)} }

// Insert adds one term.
func (t *Trie) Insert(term string) {
	node := t
	for _, r := range term {
		next := node.children[r]
		if next == nil {
			next = NewTrie()
			node.children[r] = next
		}
		node = next
	}
	if !node.isTerm {
		node.isTerm = true
		t.size++
	}
}

// NodeCount counts every trie node - the number prefix sharing saved.
func (t *Trie) NodeCount() int {
	n := 1
	for _, c := range t.children {
		n += c.NodeCount()
	}
	return n
}

// WalkPrefix visits every stored term under prefix.
func (t *Trie) WalkPrefix(prefix string, visit func(term string)) {
	node := t.descend(prefix)
	if node == nil {
		return
	}
	node.walk(prefix, visit)
}

func (t *Trie) descend(prefix string) *Trie {
	node := t
	for _, r := range prefix {
		node = node.children[r]
		if node == nil {
			return nil
		}
	}
	return node
}

// walk carries the full accumulated term so nested suffixes keep their
// ancestors' characters.
func (t *Trie) walk(current string, visit func(string)) {
	if t.isTerm {
		visit(current)
	}
	for r, c := range t.children {
		c.walk(current+string(r), visit)
	}
}

// --- expansion -----------------------------------------------------------

// ExpansionOptions bounds how much work a pattern query may do.
type ExpansionOptions struct {
	MaxExpansions int // hard cap on candidate terms (production checklist!)
	PrefixLength  int // fuzzy: only expand terms sharing this much prefix
}

// DefaultExpansion is the safe default.
func DefaultExpansion() ExpansionOptions { return ExpansionOptions{MaxExpansions: 50, PrefixLength: 1} }

// ExpandPrefix returns up to maxExpansions terms starting with prefix.
func (d *Dictionary) ExpandPrefix(prefix string, opts ExpansionOptions) []string {
	var out []string
	for _, t := range d.Range(prefix, prefix+"\xff") {
		out = append(out, t)
		if len(out) >= opts.MaxExpansions {
			break
		}
	}
	return out
}

// ExpandWildcard supports '*' (any run) and '?' (exactly one). It scans the
// dictionary linearly; chapter 19's BlockTree is what production would use.
func (d *Dictionary) ExpandWildcard(pattern string, opts ExpansionOptions) ([]string, error) {
	if strings.Count(pattern, "*")+strings.Count(pattern, "?") > 0 && len(pattern) > 128 {
		return nil, ErrPatternTooLong
	}
	re := wildcardRegexp(pattern)
	var out []string
	for _, t := range d.terms {
		if re(t) {
			out = append(out, t)
			if len(out) >= opts.MaxExpansions {
				break
			}
		}
	}
	return out, nil
}

// ExpandFuzzy intersects the Levenshtein automaton with the dictionary:
// the automaton recognizes; the dictionary supplies candidates.
func (d *Dictionary) ExpandFuzzy(query string, maxEdits int, opts ExpansionOptions) []string {
	auto := fuzzy.NewAutomaton(query, maxEdits)
	prefixLen := opts.PrefixLength
	if prefixLen > len(query) {
		prefixLen = len(query)
	}
	prefix := ""
	if prefixLen > 0 {
		prefix = query[:prefixLen]
	}
	var out []string
	scanFrom := sort.SearchStrings(d.terms, prefix)
	for i := scanFrom; i < len(d.terms); i++ {
		t := d.terms[i]
		if prefix != "" && !strings.HasPrefix(t, prefix) {
			break // sorted order means nothing further can share the prefix
		}
		if auto.Matches(t) {
			out = append(out, t)
			if len(out) >= opts.MaxExpansions {
				break
			}
		}
	}
	return out
}

// piece is one segment of a compiled wildcard pattern.
type piece struct {
	lit     string
	star    bool
	onlyOne bool // '?', exactly one arbitrary character
}

// wildcardRegexp compiles '*'/'?' into a matcher without pulling in regexp
// semantics beyond what the book defines.
func wildcardRegexp(pattern string) func(string) bool {
	var pieces []piece
	var lit strings.Builder
	flush := func() {
		if lit.Len() > 0 {
			pieces = append(pieces, piece{lit: lit.String()})
			lit.Reset()
		}
	}
	for _, r := range pattern {
		switch r {
		case '*':
			flush()
			pieces = append(pieces, piece{star: true})
		case '?':
			flush()
			pieces = append(pieces, piece{onlyOne: true})
		default:
			lit.WriteRune(r)
		}
	}
	flush()

	match := func(s string) bool {
		return matchPieces(pieces, s)
	}
	return match
}

func matchPieces(pieces []piece, s string) bool {
	i := 0
	for pi, p := range pieces {
		switch {
		case p.star:
			// Try consuming 0..n chars; recurse on remainder lazily.
			rest := pieces[pi+1:]
			if len(rest) == 0 {
				return true
			}
			for j := i; j <= len(s); j++ {
				if matchPieces(rest, s[j:]) {
					return true
				}
			}
			return false
		case p.onlyOne:
			if i >= len(s) {
				return false
			}
			i++
		default:
			if !strings.HasPrefix(s[i:], p.lit) {
				return false
			}
			i += len(p.lit)
		}
	}
	return i == len(s)
}

// ErrPatternTooLong guards against pathological patterns.
var ErrPatternTooLong = &patternError{}

type patternError struct{}

func (*patternError) Error() string { return "wildcard pattern too long" }
