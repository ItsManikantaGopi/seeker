# Chapter 08 — The Levenshtein Automaton

Chapter 07 answers *"how far apart are these two words?"* — but fuzzy search asks the inverse: *"which of a million terms lie within k edits of my query?"*. Running DP against every dictionary term is O(dict·len²). The automaton makes it O(len) per candidate, with early rejection.

> Code: `internal/fuzzy/fuzzy.go` (second half)

## An NFA whose paths are edits

States are `(col, edits)` pairs — a position in the query plus the edit budget spent:

```go
type position struct {
	col   int
	edits int
}
```

Transitions mirror the DP recurrence exactly:

- **Match** (input rune equals query char): advance col, pay 0
- **Substitution**: advance col, pay 1
- **Insertion** (term has an extra char): consume input, stay put, pay 1
- **ε-insertion** (skip a query char): advance col without consuming input, pay 1 — implemented as epsilon-closure to fixpoint

```go
func (n *nfa) Step(states map[position]bool, ch rune) map[position]bool {
	next := make(map[position]bool)
	for p := range states {
		match := n.query[p.col] == ch
		cost := 1
		if match { cost = 0 }
		if p.edits+cost <= n.k {
			next[position{p.col + 1, p.edits + cost}] = true
		}
		if p.edits+1 <= n.k {
			next[position{p.col, p.edits + 1}] = true
		}
	}
	return n.epsilonClosure(next)
}
```

Acceptance: any state whose `col` reached `len(query)`.

## Subset construction: NFA → DFA

`NewAutomaton` determinizes with the standard worklist algorithm — states become *sets* of positions:

```go
for len(worklist) > 0 {
	states := worklist[0]; worklist = worklist[1:]
	alphabet := make(map[rune]bool)      // runes that leave any live state
	...
	row[r] = stepTo(nfaInst.Step(states, r))
	// One representative rune outside the alphabet gives the default edge.
	def := -1
	if nextSet := nfaInst.Step(states, sentinel); len(nextSet) > 0 {
		def = stepTo(nextSet)
	}
}
```

The **default edge** is the payoff: all runes outside the query alphabet behave identically (one paid insertion), so instead of ~1M edges per state there's one fallback. Dead subsets simply aren't stored — falling off means instant rejection.

## Matching: walk the DFA

```go
func (a *Automaton) Matches(term string) bool {
	state := 0
	for _, r := range term {
		row := a.transitions[state]
		next, ok := row[r]
		if !ok {
			next = a.defaults[state]
			if next < 0 {
				return false // dead state kills the candidate early
			}
		}
		state = next
	}
	return a.accepting[state]
}
```

No table, no min-of-three — just pointer chasing. And crucially, rejection happens *mid-string*: a candidate diverging from the query dies after a few runes regardless of its remaining length.

## Trust, but verify: differential testing

The automaton exists to agree with the DP oracle, so the tests generate random string pairs and assert equivalence in both directions:

```
Distance(a,b) <= k  ⟺  NewAutomaton(a,k).Matches(b)
```

Any mismatch fails loudly. This pattern — slow obvious implementation as oracle, fast clever implementation verified against it — is the single most reusable idea in this codebase. The same shape reappears in chapter 13's iterator differential tests.

Next: the automaton needs something to run against — the sorted term dictionary.
