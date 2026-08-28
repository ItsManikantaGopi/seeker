# Chapter 09 — The Term Dictionary: Sorted Arrays, Tries, Bounded Expansion

Fuzzy (ch. 08) and prefix/wildcard queries need the vocabulary itself. The dictionary is where "what terms exist?" gets answered fast — and, just as importantly, *boundedly*.

> Code: `internal/dict/dict.go`

## A sorted slice is already a search engine

```go
type Dictionary struct {
	terms []string
}

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
```

Sort + dedupe in one pass. From there the standard library does the heavy lifting:

```go
func (d *Dictionary) Has(term string) bool {
	i := sort.SearchStrings(d.terms, term)
	return i < len(d.terms) && d.terms[i] == term
}
```

`Range(lo, hi)` is two binary searches; `ExpandPrefix` is `Range(prefix, prefix+"\xff")` with a cap. No trees needed until we want shared-prefix walks.

## The trie: prefixes stored once

```go
type Trie struct {
	children map[rune]*Trie
	isTerm   bool
	size     int // number of terms in this subtree
}
```

Insertion walks runes, allocating nodes only for new branches. The recursive walk carries the **accumulated term** so nested suffixes keep their ancestors' characters:

```go
func (t *Trie) walk(current string, visit func(string)) {
	if t.isTerm {
		visit(current)
	}
	for r, c := range t.children {
		c.walk(current+string(r), visit)
	}
}
```

`NodeCount()` exists to make the teaching point visible: count nodes for a real vocabulary versus its total characters and see how much prefix sharing saved.

## ExpansionOptions: the production checklist

Unbounded expansion is a self-inflicted DoS — a one-character fuzzy query against a big dictionary can expand to millions of terms:

```go
type ExpansionOptions struct {
	MaxExpansions int // hard cap on candidate terms (production checklist!)
	PrefixLength  int // fuzzy: only expand terms sharing this much prefix
}

func DefaultExpansion() ExpansionOptions { return ExpansionOptions{MaxExpansions: 50, PrefixLength: 1} }
```

These are exactly Lucene's `FuzzyQuery` defaults (`maxExpansions`, `fuzzyPrefixLength`). Wildcard patterns also get a length guard (`ErrPatternTooLong`) since `*` at position zero forces a full scan.

## Fuzzy = automaton ∩ sorted dictionary

Chapter 08 built the recognizer; here it meets candidates:

```go
func (d *Dictionary) ExpandFuzzy(query string, maxEdits int, opts ExpansionOptions) []string {
	auto := fuzzy.NewAutomaton(query, maxEdits)
	...
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
```

Two accelerations stack: binary search jumps straight to the prefix band, and sorted order lets us `break` the moment a term stops sharing it — no full-dictionary scan. Then each candidate is DFA-checked in O(len). This is why `fuzzy(kubernetes, 2)` over the demo corpus returns 9 titles instantly instead of churning through DP tables.

## Wildcards without regexp import

`*` (any run) and `?` (exactly one) compile into a tiny piece-list matcher — literals, stars handled by lazy recursion on the remainder — keeping semantics exactly as defined rather than inheriting all of POSIX `regexp`.

Next: numbers and locations — points, ranges, and space partitioning.
