package search

import (
	"math"
	"testing"

	"seeker-go/internal/index"
)

func TestIDFKnownValues(t *testing.T) {
	bm := DefaultBM25()
	// ln(1 + (10 - 1 + 0.5) / (1 + 0.5)) = ln(7)
	// ln(1 + (N - df + 0.5) / (df + 0.5)) with N=10, df=1: ln(22/3).
	want := math.Log(22.0 / 3.0)
	if got := bm.IDF(10, 1); math.Abs(got-want) > 1e-12 {
		t.Errorf("IDF(10,1) = %v, want %v", got, want)
	}
	// df = N: ln(1 + 0.5/(N+0.5)) is small but positive.
	if got := bm.IDF(10, 10); got <= 0 || got >= bm.IDF(10, 1) {
		t.Errorf("IDF ordering broken: IDF(N,N)=%v vs IDF(N,1)=%v", got, bm.IDF(10, 1))
	}
}

func TestScoreHandComputed(t *testing.T) {
	bm := DefaultBM25() // k1=1.2 b=0.75
	// tf=2, df=1, N=4, dl=6, avg=3:
	// idf   = ln(1 + 3.5/1.5)                    = ln(10/3)
	// sat   = 4.4 / (2 + 1.2*(0.25 + 0.75*2))    = 44/41
	score := bm.Score(2, 1, 4, 6, 3)
	want := math.Log(10.0/3.0) * (44.0 / 41.0)
	if math.Abs(score-want) > 1e-9 {
		t.Errorf("Score = %v, want %v", score, want)
	}

	// Longer documents are penalized at the same tf.
	longer := bm.Score(2, 1, 4, 12, 3)
	if longer >= score {
		t.Errorf("length normalization inverted: long doc scored %v >= %v", longer, score)
	}

	// tf saturates: doubling tf must add less than it did before.
	s1 := bm.Score(1, 1, 100, 5, 5)
	s2 := bm.Score(2, 1, 100, 5, 5)
	s4 := bm.Score(4, 1, 100, 5, 5)
	if s2-s1 <= s4-s2 {
		t.Errorf("tf not saturating: deltas %v then %v", s2-s1, s4-s2)
	}
}

func TestTopKOrderingAndTies(t *testing.T) {
	h := newTopK(3)
	for _, hit := range []Hit{
		{DocID: "d5", Score: 1.0},
		{DocID: "d3", Score: 3.0},
		{DocID: "d1", Score: 3.0},
		{DocID: "d9", Score: 0.5},
		{DocID: "d2", Score: 2.0},
	} {
		h.Add(hit)
	}
	got := h.Sorted()
	want := []Hit{{DocID: "d1", Score: 3}, {DocID: "d3", Score: 3}, {DocID: "d2", Score: 2}}
	if len(got) != len(want) {
		t.Fatalf("got %d hits, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("rank %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestTopKEviction(t *testing.T) {
	h := newTopK(2)
	for i := 0; i < 10; i++ {
		h.Add(Hit{DocID: string(rune('a' + i)), Score: float64(i)})
	}
	got := h.Sorted()
	if len(got) != 2 || got[0].Score != 9 || got[1].Score != 8 {
		t.Fatalf("top-2 of ascending stream wrong: %+v", got)
	}
}

func TestTermScorerExplain(t *testing.T) {
	ts := &TermScorer{
		Field:     "title",
		Term:      "kubernet",
		Postings:  []index.Posting{{DocID: "doc-1", Frequency: 2}},
		DocFreq:   1,
		TotalDocs: 4,
		AvgLen:    3,
		Scorer:    DefaultBM25(),
		LengthOf:  func(string) int { return 6 },
	}
	exp, score := ts.Explain("doc-1")
	if math.Abs(exp.Value-score) > 1e-12 {
		t.Errorf("explanation value %v disagrees with score %v", exp.Value, score)
	}
	if len(exp.Details) != 2 {
		t.Fatalf("expected idf + tfNorm detail branches, got %d", len(exp.Details))
	}
	if _, s := ts.Explain("missing-doc"); s != 0 {
		t.Errorf("absent document should score 0, got %v", s)
	}
}
