// Package search is Chapter 05: retrieval answers which documents match;
// ranking answers which are most useful. BM25 is the scoring function.
package search

import (
	"math"

	"kaus-go/internal/exec"
	"kaus-go/internal/index"
)

// BM25 holds the two dials from the book: k1 controls how quickly term
// frequency saturates; b controls how strongly document length is normalized.
type BM25 struct {
	K1 float64
	B  float64
}

// DefaultBM25 returns the usual k1=1.2, b=0.75.
func DefaultBM25() BM25 { return BM25{K1: 1.2, B: 0.75} }

// IDF is the inverse document frequency:
// ln(1 + (N - df + 0.5) / (df + 0.5)).
func (s BM25) IDF(totalDocs, docFreq int) float64 {
	n := float64(totalDocs)
	df := float64(docFreq)
	return math.Log(1 + (n-df+0.5)/(df+0.5))
}

// Score computes the full BM25 term score for one document.
func (s BM25) Score(tf, docFreq, totalDocs int, docLen, avgLen float64) float64 {
	if avgLen <= 0 {
		avgLen = 1
	}
	tfF := float64(tf)
	idf := s.IDF(totalDocs, docFreq)
	sat := tfF * (s.K1 + 1) / (tfF + s.K1*(1-s.B+s.B*docLen/avgLen))
	return idf * sat
}

// Explanation is a human-readable score tree, chapter 05's arithmetic shown.
type Explanation struct {
	Value       float64        `json:"value"`
	Description string         `json:"description"`
	Details     []*Explanation `json:"details,omitempty"`
}

// Hit is one scored result.
type Hit struct {
	DocID string
	Score float64
}

// topK is a bounded min-heap of hits: keep the best K, drop the rest.
type topK struct {
	k    int
	hits []Hit
}

func newTopK(k int) *topK { return &topK{k: k} }

// Add inserts a hit, evicting the worst when over capacity.
// A linear scan keeps this readable; production uses container/heap.
func (t *topK) Add(h Hit) {
	if t.k <= 0 {
		return
	}
	t.hits = append(t.hits, h)
	if len(t.hits) > t.k {
		// Evict the minimum.
		worst := 0
		for i, x := range t.hits {
			if x.Score < t.hits[worst].Score || (x.Score == t.hits[worst].Score && x.DocID > t.hits[worst].DocID) {
				worst = i
			}
		}
		t.hits = append(t.hits[:worst], t.hits[worst+1:]...)
	}
}

// Sorted returns hits best-first with deterministic tie-breaking.
func (t *topK) Sorted() []Hit {
	out := make([]Hit, len(t.hits))
	copy(out, t.hits)
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && less(out[j], out[j-1]); j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

func less(a, b Hit) bool {
	if a.Score != b.Score {
		return a.Score > b.Score // higher score first
	}
	return a.DocID < b.DocID // stable tie-break
}

// TermScorer scores every posting of one term against BM25.
type TermScorer struct {
	Field     string
	Term      string
	Postings  []index.Posting
	DocFreq   int
	TotalDocs int
	AvgLen    float64
	Scorer    BM25
	LengthOf  func(docID string) int
}

// Explain scores one document and returns the explanation tree.
func (ts *TermScorer) Explain(docID string) (*Explanation, float64) {
	var tf int
	for _, p := range ts.Postings {
		if p.DocID == docID {
			tf = p.Frequency
			break
		}
	}
	docLen := float64(ts.LengthOf(docID))
	idf := ts.Scorer.IDF(ts.TotalDocs, ts.DocFreq)
	score := ts.Scorer.Score(tf, ts.DocFreq, ts.TotalDocs, docLen, ts.AvgLen)
	details := []*Explanation{
		{
			Value:       idf,
			Description: "idf, computed as log(1 + (N - df + 0.5) / (df + 0.5))",
			Details: []*Explanation{
				{Value: float64(ts.TotalDocs), Description: "N, total number of documents"},
				{Value: float64(ts.DocFreq), Description: "df, document frequency"},
			},
		},
		{
			Value:       score / math.Max(idf, 1e-9),
			Description: "tf saturation, computed as tf * (k1 + 1) / (tf + k1 * (1 - b + b * dl / avgdl))",
			Details: []*Explanation{
				{Value: float64(tf), Description: "tf, term frequency in this document"},
				{Value: docLen, Description: "dl, field length of this document"},
				{Value: ts.AvgLen, Description: "avgdl, average field length"},
				{Value: ts.Scorer.K1, Description: "k1, term frequency saturation"},
				{Value: ts.Scorer.B, Description: "b, length normalization strength"},
			},
		},
	}
	return &Explanation{
		Value:       score,
		Description: "score = idf * tfNorm for term '" + ts.Term + "' in field '" + ts.Field + "'",
		Details:     details,
	}, score
}

// ScoreTerms walks an iterator tree leaf-by-leaf: for each candidate document,
// sum the BM25 contribution of every scoring leaf.
type Scorer struct {
	IX      *index.Index
	BM25    BM25
	scorers []*TermScorer
	root    exec.Iterator
}

// NewScorer binds scoring leaves to an execution tree root.
func NewScorer(ix *index.Index, bm25 BM25, scorers []*TermScorer, root exec.Iterator) *Scorer {
	return &Scorer{IX: ix, BM25: bm25, scorers: scorers, root: root}
}

// Run executes the tree and returns up to size hits best-first. Every
// matching document is visited (retrieval); the heap bounds what survives
// (ranking).
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
		if next == "" {
			break
		}
		doc = next
	}
	return heap.Sorted()
}

// Root exposes the execution tree for tests.
func (s *Scorer) Root() exec.Iterator { return s.root }
