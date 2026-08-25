// engine.go is the facade chapter 12 builds on: one Engine that owns the
// inverted index, the point indexes, and the segment store, and exposes
// Add/Delete/Search. The HTTP layer talks only to this type.
package engine

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"seeker-go/internal/index"
	"seeker-go/internal/model"
	"seeker-go/internal/points"
	"seeker-go/internal/querydsl"
	"seeker-go/internal/search"
)

// SearchHit is one result row.
type SearchHit struct {
	ID     string         `json:"_id"`
	Score  float64        `json:"_score"`
	Source map[string]any `json:"_source"`
}

// SearchResponse is the /_search reply.
type SearchResponse struct {
	TookMS int64       `json:"took_ms"`
	Total  int         `json:"total"`
	Hits   []SearchHit `json:"hits"`
}

// Engine is a complete search engine over one node.
type Engine struct {
	Index  *index.Index
	points map[string]*points.PointIndex
	docs   []model.Document // last known full document set for point rebuilds
}

// New creates an empty engine.
func New() *Engine {
	return &Engine{
		Index:  index.New(),
		points: make(map[string]*points.PointIndex),
	}
}

// Add indexes one document (inverted index) and refreshes point indexes.
func (e *Engine) Add(doc model.Document) error {
	if err := e.Index.Add(doc); err != nil {
		return err
	}
	e.rebuildPoints()
	return nil
}

// Bulk indexes many documents in one call.
func (e *Engine) Bulk(docs []model.Document) error {
	for _, d := range docs {
		if err := e.Index.Add(d); err != nil {
			return err
		}
	}
	e.rebuildPoints()
	return nil
}

// Delete removes a document.
func (e *Engine) Delete(id string) bool {
	removed := e.Index.Delete(id)
	if removed {
		e.rebuildPoints()
	}
	return removed
}

// rebuildPoints re-derives numeric/date point indexes from live documents.
// Small corpora rebuild instantly; production engines update incrementally.
func (e *Engine) rebuildPoints() {
	e.docs = nil
	for _, id := range e.Index.AllDocs() {
		if d, ok := e.Index.Get(id); ok {
			e.docs = append(e.docs, d)
		}
	}
	for _, field := range []string{"price", "rating", "created_at"} {
		e.points[field] = points.NewPointIndex(field, e.docs)
	}
}

// Search compiles the request, runs retrieval, then ranks with BM25.
func (e *Engine) Search(req *querydsl.SearchRequest) (*SearchResponse, error) {
	start := time.Now()
	compiler := &querydsl.Compiler{IX: e.Index, Points: e.points}
	res, err := compiler.Compile(req.Query)
	if err != nil {
		return nil, err
	}
	scorer := res.Scorer(e.Index, search.DefaultBM25())
	hits := scorer.Run(req.Size)

	out := &SearchResponse{
		TookMS: time.Since(start).Milliseconds(),
		Total:  len(hits),
		Hits:   make([]SearchHit, 0, len(hits)),
	}
	for _, h := range hits {
		src := map[string]any{}
		if d, ok := e.Index.Get(h.DocID); ok {
			src = d.Source
		}
		out.Hits = append(out.Hits, SearchHit{ID: h.DocID, Score: h.Score, Source: src})
	}
	return out, nil
}

// Explain returns the BM25 explanation for one hit (chapter 05).
func (e *Engine) Explain(req *querydsl.SearchRequest, docID string) (*search.Explanation, error) {
	compiler := &querydsl.Compiler{IX: e.Index, Points: e.points}
	res, err := compiler.Compile(req.Query)
	if err != nil {
		return nil, err
	}
	leaves := res.Leaves()
	if len(leaves) == 0 {
		return nil, fmt.Errorf("query has no scoring leaves to explain")
	}
	total := &search.Explanation{Description: "sum of term scores for " + docID}
	sum := 0.0
	for _, ts := range leaves {
		exp, sc := ts.Explain(docID)
		sum += sc
		total.Details = append(total.Details, exp)
	}
	total.Value = sum
	return total, nil
}

// Analyze exposes the analyzer chain for debugging (used by smoke tests).
func (e *Engine) Analyze(field, text string) []string {
	return e.Index.AnalyzerFor(field).Analyze(text)
}

// DefaultAnalyzerName reports which analyzer a field uses.
func (e *Engine) DefaultAnalyzerName(field string) string {
	if e.Index.Mapping().Type(field) == model.FieldText {
		return "standard"
	}
	return "keyword"
}

// SeedCorpus loads the demo corpus JSON exported from lib/seeker/corpus.ts.
func (e *Engine) SeedCorpus(corpusJSON []byte) error {
	var raw []map[string]any
	if err := json.Unmarshal(corpusJSON, &raw); err != nil {
		return fmt.Errorf("bad corpus: %w", err)
	}
	docs := make([]model.Document, 0, len(raw))
	for _, src := range raw {
		id, _ := src["id"].(string)
		doc, err := model.NewDocument(id, src)
		if err != nil {
			return err
		}
		docs = append(docs, *doc)
	}
	return e.Bulk(docs)
}

// SortedDocIDs lists live ids (helper for tests).
func (e *Engine) SortedDocIDs() []string {
	ids := e.Index.AllDocs()
	sort.Strings(ids)
	return ids
}
