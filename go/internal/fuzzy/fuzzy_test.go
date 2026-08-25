package fuzzy

import (
	"math/rand"
	"testing"
)

func TestDistanceCases(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"", "", 0},
		{"abc", "abc", 0},
		{"kitten", "sitting", 3},
		{"flaw", "lawn", 2},
		{"kubernets", "kubernetes", 1}, // the demo corpus typo
		{"", "abc", 3},
		{"abc", "", 3},
	}
	for _, c := range cases {
		if got := Distance(c.a, c.b); got != c.want {
			t.Errorf("Distance(%q,%q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestDamerauDistance(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"ab", "ba", 1}, // transposition
		// OSA forbids a transposition followed by another edit on the same
		// region, so this costs 3 (true Damerau-Levenshtein would say 2).
		{"ca", "abc", 3},
		{"abcd", "badc", 2},
		{"abc", "abc", 0},
		{"htlm", "html", 1},
	}
	for _, c := range cases {
		if got := DamerauDistance(c.a, c.b); got != c.want {
			t.Errorf("Damerau(%q,%q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

// TestAutomatonMatchesDP is the chapter 08 differential test: for every pair
// of strings the DFA verdict must equal the DP oracle.
func TestAutomatonMatchesDP(t *testing.T) {
	words := []string{
		"", "a", "b", "ab", "ba", "abc", "acb", "kubernet", "kubernetes",
		"kubernets", "roll", "rolling", "runs", "running",
	}
	rng := rand.New(rand.NewSource(42))
	alphabet := "abc"
	for i := 0; i < 40; i++ {
		n := rng.Intn(6)
		b := make([]byte, n)
		for j := range b {
			b[j] = alphabet[rng.Intn(len(alphabet))]
		}
		words = append(words, string(b))
	}

	for _, k := range []int{1, 2} {
		for _, query := range words {
			auto := NewAutomaton(query, k)
			for _, cand := range words {
				want := Distance(query, cand) <= k
				if got := auto.Matches(cand); got != want {
					t.Fatalf("query=%q k=%d term=%q: automaton=%v, dp=%d (want %v)",
						query, k, cand, got, Distance(query, cand), want)
				}
			}
		}
	}
}

func TestAutomatonNonAlphabetRunes(t *testing.T) {
	// Runes outside the query alphabet must flow through the default edges.
	auto := NewAutomaton("kubernet", 2)
	if auto.Matches("KUBERNET") {
		t.Error("case differs: K is 32 edit units away, not a substitution")
	}
	if auto.Matches("xyz") {
		t.Error("distant string accepted")
	}
	if !auto.Matches("kuberne!") { // substitution with non-alphabet rune
		t.Error("default edge broke substitution acceptance")
	}
}

func TestAutomatonBudgetRespected(t *testing.T) {
	auto := NewAutomaton("kubernetes", 1)
	if auto.Matches("kubernets") != true {
		t.Error("1-edit typo rejected at k=1")
	}
	if auto.Matches("kuber") {
		t.Error("4 deletions accepted at k=1")
	}
	if auto.MaxEdits() != 1 {
		t.Errorf("MaxEdits = %d, want 1", auto.MaxEdits())
	}
}
