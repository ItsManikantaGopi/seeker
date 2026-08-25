// Package fuzzy is Chapters 07-08. Chapter 07 builds the dynamic-programming
// edit distance table - the oracle everything else is tested against.
// Chapter 08 replaces it with a Levenshtein automaton that recognizes every
// string within N edits without ever comparing against a specific word.
package fuzzy

import "fmt"

// Distance computes Levenshtein distance with a traceable DP table.
func Distance(a, b string) int {
	ar, br := []rune(a), []rune(b)
	prev := make([]int, len(br)+1)
	cur := make([]int, len(br)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ar); i++ {
		cur[0] = i
		for j := 1; j <= len(br); j++ {
			cost := 1
			if ar[i-1] == br[j-1] {
				cost = 0
			}
			del := prev[j] + 1      // delete a[i-1]
			ins := cur[j-1] + 1     // insert b[j-1]
			sub := prev[j-1] + cost // substitute
			best := del
			if ins < best {
				best = ins
			}
			if sub < best {
				best = sub
			}
			cur[j] = best
		}
		prev, cur = cur, prev
	}
	return prev[len(br)]
}

// DamerauDistance adds transpositions of two adjacent characters.
func DamerauDistance(a, b string) int {
	ar, br := []rune(a), []rune(b)
	d := make([][]int, len(ar)+1)
	for i := range d {
		d[i] = make([]int, len(br)+1)
		d[i][0] = i
	}
	for j := 0; j <= len(br); j++ {
		d[0][j] = j
	}
	for i := 1; i <= len(ar); i++ {
		for j := 1; j <= len(br); j++ {
			cost := 1
			if ar[i-1] == br[j-1] {
				cost = 0
			}
			best := min3(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+cost)
			if i > 1 && j > 1 && ar[i-1] == br[j-2] && ar[i-2] == br[j-1] {
				if t := d[i-2][j-2] + 1; t < best {
					best = t
				}
			}
			d[i][j] = best
		}
	}
	return d[len(ar)][len(br)]
}

func min3(a, b, c int) int {
	m := a
	if b < m {
		m = b
	}
	if c < m {
		m = c
	}
	return m
}

// Table renders the DP table as text so chapter 07 can be read cell by cell.
func Table(a, b string) string {
	ar, br := []rune(a), []rune(b)
	rows := make([]string, 0, len(ar)+2)
	header := "\t"
	for _, r := range br {
		header += string(r) + "\t"
	}
	rows = append(rows, header)
	prev := make([]int, len(br)+1)
	for j := range prev {
		prev[j] = j
	}
	rows = append(rows, " \t"+intsRow(prev))
	cur := make([]int, len(br)+1)
	for i := 1; i <= len(ar); i++ {
		cur[0] = i
		for j := 1; j <= len(br); j++ {
			cost := 1
			if ar[i-1] == br[j-1] {
				cost = 0
			}
			cur[j] = min3(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		rows = append(rows, string(ar[i-1])+"\t"+intsRow(cur))
		prev, cur = cur, prev
	}
	out := ""
	for _, r := range rows {
		out += r + "\n"
	}
	return out
}

func intsRow(xs []int) string {
	s := ""
	for i, x := range xs {
		if i > 0 {
			s += "\t"
		}
		s += fmt.Sprintf("%d", x)
	}
	return s
}

// --- Chapter 08: the Levenshtein automaton -------------------------------

// position is one NFA state: how far into the term we are (column of the DP
// table) and how many edits we have already spent.
type position struct {
	col   int
	edits int
}

// nfa is the parametric Levenshtein automaton for one query and budget k.
type nfa struct {
	query []rune
	k     int
	start position
}

func newNFA(query string, k int) *nfa {
	return &nfa{query: []rune(query), k: k, start: position{col: 0, edits: 0}}
}

// accepts reports whether the NFA state set contains an accepting state:
// any position at the final column.
func (n *nfa) accepts(states map[position]bool) bool {
	for p := range states {
		if p.col == len(n.query) {
			return true
		}
	}
	return false
}

// epsilonClosure expands insertions (skip a query character, pay an edit)
// until fixpoint.
func (n *nfa) epsilonClosure(states map[position]bool) map[position]bool {
	stack := make([]position, 0, len(states))
	for p := range states {
		stack = append(stack, p)
	}
	for len(stack) > 0 {
		p := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		// Insertion: consume nothing from the input, skip one query char.
		if p.col < len(n.query) && p.edits < n.k {
			np := position{col: p.col + 1, edits: p.edits + 1}
			if !states[np] {
				states[np] = true
				stack = append(stack, np)
			}
		}
	}
	return states
}

// Step consumes one input rune and returns the next state set.
func (n *nfa) Step(states map[position]bool, ch rune) map[position]bool {
	next := make(map[position]bool)
	for p := range states {
		if p.col >= len(n.query) {
			// Query exhausted: any further input is a paid insertion.
			if p.edits+1 <= n.k {
				next[position{p.col, p.edits + 1}] = true
			}
			continue
		}
		match := n.query[p.col] == ch
		// Match or substitution: advance both cursors.
		cost := 1
		if match {
			cost = 0
		}
		if p.edits+cost <= n.k {
			next[position{p.col + 1, p.edits + cost}] = true
		}
		// Insertion: the term has an extra character; consume it, stay put.
		if p.edits+1 <= n.k {
			next[position{p.col, p.edits + 1}] = true
		}
	}
	return n.epsilonClosure(next)
}

// Start returns the initial state set.
func (n *nfa) Start() map[position]bool {
	return n.epsilonClosure(map[position]bool{n.start: true})
}

// Automaton is the determinized DFA over subsets of NFA states. Each state
// keeps a default edge for runes outside the query alphabet: they behave
// identically (one paid insertion), so a single fallback per state suffices.
type Automaton struct {
	nfa         *nfa
	transitions []map[rune]int
	defaults    []int // -1 means dead state
	accepting   []bool
}

// NewAutomaton builds and determinizes the automaton for query within k edits.
func NewAutomaton(query string, k int) *Automaton {
	nfaInst := newNFA(query, k)
	startSet := nfaInst.Start()
	startKey := setKey(startSet)
	stateIndex := map[string]int{startKey: 0}
	accepting := []bool{nfaInst.accepts(startSet)}
	worklist := []map[position]bool{startSet}
	var transitions []map[rune]int
	var defaults []int

	for len(worklist) > 0 {
		states := worklist[0]
		worklist = worklist[1:]
		row := make(map[rune]int)
		idx := stateIndex[setKey(states)]

		// Collect all runes that leave any live state.
		alphabet := make(map[rune]bool)
		for p := range states {
			if p.col < len(nfaInst.query) {
				alphabet[nfaInst.query[p.col]] = true
			}
		}
		stepTo := func(nextSet map[position]bool) int {
			key := setKey(nextSet)
			ni, ok := stateIndex[key]
			if !ok {
				ni = len(accepting)
				stateIndex[key] = ni
				accepting = append(accepting, nfaInst.accepts(nextSet))
				worklist = append(worklist, nextSet)
			}
			return ni
		}
		for r := range alphabet {
			nextSet := nfaInst.Step(states, r)
			if len(nextSet) == 0 {
				continue // dead state: implicit reject
			}
			row[r] = stepTo(nextSet)
		}
		// One representative rune outside the alphabet gives the default edge.
		sentinel := rune(0)
		for alphabet[sentinel] {
			sentinel++
		}
		def := -1
		if nextSet := nfaInst.Step(states, sentinel); len(nextSet) > 0 {
			def = stepTo(nextSet)
		}
		for len(transitions) <= idx {
			transitions = append(transitions, nil)
		}
		transitions[idx] = row
		for len(defaults) <= idx {
			defaults = append(defaults, 0)
		}
		defaults[idx] = def
	}
	if transitions == nil {
		transitions = []map[rune]int{{}}
		defaults = []int{-1}
		accepting = []bool{nfaInst.accepts(startSet)}
	}
	return &Automaton{nfa: nfaInst, transitions: transitions, defaults: defaults, accepting: accepting}
}

func setKey(states map[position]bool) string {
	keys := make([]position, 0, len(states))
	for p := range states {
		keys = append(keys, p)
	}
	// Deterministic ordering for stable DFA construction.
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && posLess(keys[j], keys[j-1]); j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	s := ""
	for _, p := range keys {
		s += fmt.Sprintf("%d:%d,", p.col, p.edits)
	}
	return s
}

func posLess(a, b position) bool {
	if a.col != b.col {
		return a.col < b.col
	}
	return a.edits < b.edits
}

// Matches feeds term through the DFA and reports acceptance.
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

// MaxEdits returns the automaton's edit budget.
func (a *Automaton) MaxEdits() int { return a.nfa.k }
