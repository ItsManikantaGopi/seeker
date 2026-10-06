// Package index is Chapter 03: the inverted index. term -> set(docID) is the
// whole trick; a real postings list carries frequency and positions too.
package index

import (
	"fmt"
	"sort"
	"sync"

	"kaus-go/internal/analyzer"
	"kaus-go/internal/model"
)

// Posting is one document's occurrence record for one term in one field.
type Posting struct {
	DocID     string
	Frequency int
	Positions []int // term positions after analysis, 0-based
}

// PostingsList is everything the index knows about one (field, term).
type PostingsList struct {
	Postings   []Posting
	DocFreq    int
	TotalTerms int // sum of frequencies, used by BM25's average length
}

// FieldIndex holds the vocabulary of one field.
type FieldIndex struct {
	Terms     map[string]*PostingsList
	DocLength map[string]int // docID -> number of terms after analysis
}

// Index is an in-memory, thread-safe inverted index over documents.
type Index struct {
	mu       sync.RWMutex
	mapping  model.Mapping
	analyzer *analyzer.Analyzer
	fields   map[string]*FieldIndex
	docCount int
	totalLen map[string]int64 // field -> total terms across docs
	docs     map[string]model.Document
}

// New creates an empty index using the default mapping and standard analyzer.
func New() *Index {
	return &Index{
		mapping:  model.DefaultMapping(),
		analyzer: analyzer.Standard(),
		fields:   make(map[string]*FieldIndex),
		totalLen: make(map[string]int64),
		docs:     make(map[string]model.Document),
	}
}

// Mapping returns the index's field mapping.
func (ix *Index) Mapping() model.Mapping { return ix.mapping }

// DocCount returns how many live documents are indexed.
func (ix *Index) DocCount() int {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return ix.docCount
}

// AnalyzerFor picks the analyzer for one field: text fields get the standard
// chain, everything else is keyword (verbatim).
func (ix *Index) AnalyzerFor(field string) *analyzer.Analyzer {
	if ix.mapping.Type(field) == model.FieldText {
		return ix.analyzer
	}
	return analyzer.Keyword()
}

// Add analyzes every mapped field of the document and writes postings.
func (ix *Index) Add(doc model.Document) error {
	termsByField := ix.analyzeDocument(&doc)

	ix.mu.Lock()
	defer ix.mu.Unlock()
	if _, exists := ix.docs[doc.ID]; !exists {
		ix.docCount++
	}
	ix.docs[doc.ID] = doc

	for field, terms := range termsByField {
		fi := ix.fields[field]
		if fi == nil {
			fi = &FieldIndex{Terms: make(map[string]*PostingsList), DocLength: make(map[string]int)}
			ix.fields[field] = fi
		}
		// Remove any previous version of this document first (upsert).
		if l, existed := fi.DocLength[doc.ID]; existed {
			ix.totalLen[field] -= int64(l)
		}
		ix.removeDocFromFieldLocked(field, fi, doc.ID)

		fi.DocLength[doc.ID] = len(terms)
		ix.totalLen[field] += int64(len(terms))

		seen := make(map[string][]int)
		order := make([]string, 0, len(terms))
		for pos, t := range terms {
			if _, ok := seen[t]; !ok {
				order = append(order, t)
			}
			seen[t] = append(seen[t], pos)
		}
		sort.Strings(order)
		var touched []*PostingsList
		for _, term := range order {
			positions := seen[term]
			pl := fi.Terms[term]
			if pl == nil {
				pl = &PostingsList{}
				fi.Terms[term] = pl
			}
			pl.Postings = append(pl.Postings, Posting{
				DocID:     doc.ID,
				Frequency: len(positions),
				Positions: positions,
			})
			pl.DocFreq++
			pl.TotalTerms += len(positions)
			touched = append(touched, pl)
		}
		// Iterators binary-search postings by docID, so the list MUST stay
		// sorted lexicographically even when documents arrive out of order
		// (doc-12 sorts before doc-3 as strings).
		for _, pl := range touched {
			sort.Slice(pl.Postings, func(i, j int) bool { return pl.Postings[i].DocID < pl.Postings[j].DocID })
		}
	}
	return nil
}

// Delete records the document as gone. Like book chapter 23, deletion is a
// tombstone: postings remain until a merge rewrites them. Here "merge" is
// removeDocFromFieldLocked, invoked eagerly because this index rebuilds
// affected lists on upsert.
func (ix *Index) Delete(id string) bool {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	if _, ok := ix.docs[id]; !ok {
		return false
	}
	for _, f := range ix.mapping {
		fi := ix.fields[f.Name]
		if fi == nil {
			continue
		}
		if l, had := fi.DocLength[id]; had {
			ix.totalLen[f.Name] -= int64(l)
			delete(fi.DocLength, id)
		}
		ix.removeDocFromFieldLocked(f.Name, fi, id)
	}
	delete(ix.docs, id)
	ix.docCount--
	return true
}

func (ix *Index) removeDocFromFieldLocked(_ string, fi *FieldIndex, docID string) {
	for term, pl := range fi.Terms {
		kept := make([]Posting, 0, len(pl.Postings))
		removed := 0
		for _, p := range pl.Postings {
			if p.DocID == docID {
				removed++
				continue
			}
			kept = append(kept, p)
		}
		if removed > 0 {
			pl.Postings = kept
			pl.DocFreq -= removed
			pl.TotalTerms = 0 // recompute from survivors
			for _, p := range kept {
				pl.TotalTerms += p.Frequency
			}
			if len(kept) == 0 {
				delete(fi.Terms, term)
			}
		}
	}
}

func (ix *Index) analyzeDocument(doc *model.Document) map[string][]string {
	out := make(map[string][]string)
	for _, f := range ix.mapping {
		switch f.Type {
		case model.FieldText:
			vals, ok := doc.TextValues(f.Name)
			if !ok {
				continue
			}
			var all []string
			for _, v := range vals {
				all = append(all, ix.AnalyzerFor(f.Name).Analyze(v)...)
			}
			out[f.Name] = all
		case model.FieldKeyword:
			vals, ok := doc.TextValues(f.Name)
			if !ok {
				continue
			}
			for _, v := range vals {
				out[f.Name] = append(out[f.Name], analyzer.Keyword().Analyze(v)...)
			}
		}
		// numeric/date/geo values are indexed by package points, not here.
	}
	return out
}

// Lookup returns the postings list for one (field, term), or nil.
func (ix *Index) Lookup(field, term string) *PostingsList {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	fi := ix.fields[field]
	if fi == nil {
		return nil
	}
	pl := fi.Terms[term]
	if pl == nil || len(pl.Postings) == 0 {
		return nil
	}
	cp := *pl
	// Deep-copy the postings slice: callers may mutate their view (or the
	// TermScorer may hold it) without corrupting the live index.
	cp.Postings = make([]Posting, len(pl.Postings))
	copy(cp.Postings, pl.Postings)
	return &cp
}

// Terms returns every distinct term of a field in sorted order - the term
// dictionary that chapters 09 and 08 walk.
func (ix *Index) Terms(field string) []string {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	fi := ix.fields[field]
	if fi == nil {
		return nil
	}
	out := make([]string, 0, len(fi.Terms))
	for t := range fi.Terms {
		out = append(out, t)
	}
	sort.Strings(out)
	return out
}

// AllDocs returns ids of every live document in sorted order.
func (ix *Index) AllDocs() []string {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	out := make([]string, 0, len(ix.docs))
	for id := range ix.docs {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

// Get returns a stored document by id.
func (ix *Index) Get(id string) (model.Document, bool) {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	d, ok := ix.docs[id]
	return d, ok
}

// AvgFieldLength is the denominator of BM25's length normalisation.
func (ix *Index) AvgFieldLength(field string) float64 {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	n := float64(ix.docCount)
	if n == 0 {
		return 0
	}
	return float64(ix.totalLen[field]) / n
}

// FieldLength returns one document's analyzed length in a field.
func (ix *Index) FieldLength(field, docID string) int {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	fi := ix.fields[field]
	if fi == nil {
		return 0
	}
	return fi.DocLength[docID]
}

// Stats summarizes the index for /_stats.
type Stats struct {
	Documents int                `json:"documents"`
	Fields    map[string]int     `json:"fields_per_term"`
	AvgLens   map[string]float64 `json:"avg_field_length"`
}

// Snapshot builds a consistent stats view.
func (ix *Index) Stats() Stats {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	s := Stats{
		Documents: ix.docCount,
		Fields:    make(map[string]int),
		AvgLens:   make(map[string]float64),
	}
	for name, fi := range ix.fields {
		s.Fields[name] = len(fi.Terms)
		if ix.docCount > 0 {
			s.AvgLens[name] = float64(ix.totalLen[name]) / float64(ix.docCount)
		}
	}
	return s
}

// Source returns the original JSON body of a document.
func (ix *Index) Source(id string) (map[string]any, error) {
	d, ok := ix.Get(id)
	if !ok {
		return nil, fmt.Errorf("document %q not found", id)
	}
	return d.Source, nil
}
