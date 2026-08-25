// Package querydsl is Chapter 06: match analyzes, term does not; bool
// combines must, filter, should and must_not. The JSON DSL is decoded into a
// typed AST, then compiled into the iterator tree of chapter 04.
package querydsl

import (
	"encoding/json"
	"fmt"
	"strings"

	"seeker-go/internal/exec"
	"seeker-go/internal/index"
	"seeker-go/internal/points"
	"seeker-go/internal/search"
)

// Query is the AST every clause decodes into.
type Query struct {
	Kind string // match | term | phrase | prefix | wildcard | fuzzy | range | bool

	Field string
	Value json.RawMessage

	Fuzziness int `json:"-"` // edit budget for fuzzy clauses
	Slop      int `json:"-"` // reserved for phrase slop (future chapter)

	// bool sub-clauses
	Must    []*Query
	Filter  []*Query
	Should  []*Query
	MustNot []*Query

	// noScore marks filter/must_not clauses: they match but never score.
	noScore bool
}

// SearchRequest is the /_search body.
type SearchRequest struct {
	Query *Query `json:"query"`
	Size  int    `json:"size"`
}

type rawQuery struct {
	Match    map[string]json.RawMessage `json:"match,omitempty"`
	Term     map[string]json.RawMessage `json:"term,omitempty"`
	Phrase   map[string]json.RawMessage `json:"phrase,omitempty"`
	Prefix   map[string]json.RawMessage `json:"prefix,omitempty"`
	Wildcard map[string]json.RawMessage `json:"wildcard,omitempty"`
	Fuzzy    map[string]fuzzyBody       `json:"fuzzy,omitempty"`
	Range    map[string]rangeValue      `json:"range,omitempty"`
	Bool     *boolBody                  `json:"bool,omitempty"`
}

// fuzzyBody accepts either "kubernetes" or {"value": "kubernetes", "fuzziness": 1}.
type fuzzyBody struct {
	value     string
	fuzziness int
}

func (f *fuzzyBody) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		f.value = s
		return nil
	}
	var obj struct {
		Value     string `json:"value"`
		Fuzziness int    `json:"fuzziness"`
	}
	if err := json.Unmarshal(b, &obj); err != nil {
		return err
	}
	f.value = obj.Value
	f.fuzziness = obj.Fuzziness
	return nil
}

type rangeValue struct {
	gte, lte       *float64
	hasGTE, hasLTE bool
}

func (r *rangeValue) UnmarshalJSON(b []byte) error {
	var obj struct {
		GTE *float64 `json:"gte"`
		Gt  *float64 `json:"gt"`
		LTE *float64 `json:"lte"`
		Lt  *float64 `json:"lt"`
	}
	if err := json.Unmarshal(b, &obj); err != nil {
		return err
	}
	if v := obj.GTE; v != nil {
		r.gte = v
		r.hasGTE = true
	} else if v := obj.Gt; v != nil {
		vv := *v + 1e-9
		r.gte = &vv
		r.hasGTE = true
	}
	if v := obj.LTE; v != nil {
		r.lte = v
		r.hasLTE = true
	} else if v := obj.Lt; v != nil {
		vv := *v - 1e-9
		r.lte = &vv
		r.hasLTE = true
	}
	return nil
}

type boolBody struct {
	Must    []json.RawMessage `json:"must,omitempty"`
	Filter  []json.RawMessage `json:"filter,omitempty"`
	Should  []json.RawMessage `json:"should,omitempty"`
	MustNot []json.RawMessage `json:"must_not,omitempty"`
}

// Decode turns request JSON into the AST.
func Decode(body []byte) (*SearchRequest, error) {
	var req SearchRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return nil, fmt.Errorf("bad search body: %w", err)
	}
	if req.Size == 0 {
		req.Size = 10
	}
	if req.Query == nil {
		return nil, fmt.Errorf(`missing "query"`)
	}
	return &req, nil
}

// UnmarshalJSON parses one clause object like {"match": {"title": "kubernetes"}}.
func (q *Query) UnmarshalJSON(b []byte) error {
	var raw rawQuery
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	count := 0
	for _, k := range []string{"match", "term", "phrase", "prefix", "wildcard", "fuzzy", "range", "bool"} {
		if hasClause(raw, k) {
			count++
		}
	}
	if count != 1 {
		return fmt.Errorf("query object must contain exactly one clause kind, got %d", count)
	}
	switch {
	case len(raw.Match) > 0:
		q.Kind = "match"
		return oneField(raw.Match, &q.Field, &q.Value)
	case len(raw.Term) > 0:
		q.Kind = "term"
		return oneField(raw.Term, &q.Field, &q.Value)
	case len(raw.Phrase) > 0:
		q.Kind = "phrase"
		return oneField(raw.Phrase, &q.Field, &q.Value)
	case len(raw.Prefix) > 0:
		q.Kind = "prefix"
		return oneField(raw.Prefix, &q.Field, &q.Value)
	case len(raw.Wildcard) > 0:
		q.Kind = "wildcard"
		return oneField(raw.Wildcard, &q.Field, &q.Value)
	case len(raw.Fuzzy) > 0:
		q.Kind = "fuzzy"
		for field, body := range raw.Fuzzy {
			q.Field = field
			q.Value = json.RawMessage(fmt.Sprintf("%q", body.value))
			q.Fuzziness = body.fuzziness
			return nil
		}
	case len(raw.Range) > 0:
		q.Kind = "range"
		for field, body := range raw.Range {
			q.Field = field
			enc, _ := json.Marshal(map[string]any{
				"gte": body.gte, "lte": body.lte,
				"hasGTE": body.hasGTE, "hasLTE": body.hasLTE,
			})
			q.Value = enc
			return nil
		}
	case raw.Bool != nil:
		q.Kind = "bool"
		for _, m := range raw.Bool.Must {
			sub, err := decodeChild(m)
			if err != nil {
				return err
			}
			q.Must = append(q.Must, sub)
		}
		for _, m := range raw.Bool.Filter {
			sub, err := decodeChild(m)
			if err != nil {
				return err
			}
			sub.noScore = true
			q.Filter = append(q.Filter, sub)
		}
		for _, m := range raw.Bool.Should {
			sub, err := decodeChild(m)
			if err != nil {
				return err
			}
			q.Should = append(q.Should, sub)
		}
		for _, m := range raw.Bool.MustNot {
			sub, err := decodeChild(m)
			if err != nil {
				return err
			}
			sub.noScore = true
			q.MustNot = append(q.MustNot, sub)
		}
	}
	return nil
}

func hasClause(raw rawQuery, kind string) bool {
	switch kind {
	case "match":
		return len(raw.Match) > 0
	case "term":
		return len(raw.Term) > 0
	case "phrase":
		return len(raw.Phrase) > 0
	case "prefix":
		return len(raw.Prefix) > 0
	case "wildcard":
		return len(raw.Wildcard) > 0
	case "fuzzy":
		return len(raw.Fuzzy) > 0
	case "range":
		return len(raw.Range) > 0
	case "bool":
		return raw.Bool != nil
	}
	return false
}

func oneField(m map[string]json.RawMessage, field *string, value *json.RawMessage) error {
	n := 0
	for f, v := range m {
		*field = f
		*value = v
		n++
	}
	if n != 1 {
		return fmt.Errorf("expected exactly one field in clause, got %d", n)
	}
	return nil
}

func decodeChild(b json.RawMessage) (*Query, error) {
	var q Query
	if err := q.UnmarshalJSON(b); err != nil {
		return nil, fmt.Errorf("decode sub-query %s: %w", b, err)
	}
	return &q, nil
}

// Compiler builds execution artifacts from the AST. Points carries the
// numeric/date point indexes by field name; range clauses search there.
type Compiler struct {
	IX     *index.Index
	Points map[string]*points.PointIndex
}

// Result carries the retrieval tree plus its scoring leaves.
type Result struct {
	Root    exec.Iterator
	scorers []*search.TermScorer
}

// Leaves exposes the scoring leaves (chapter 05's explain walks these).
func (r *Result) Leaves() []*search.TermScorer { return r.scorers }

// addScorer registers one term leaf for BM25 ranking.
func (r *Result) addScorer(ts *search.TermScorer) { r.scorers = append(r.scorers, ts) }

// Scorer wires BM25 over this result's leaves.
func (r *Result) Scorer(ix *index.Index, bm25 search.BM25) *search.Scorer {
	totalDocs := ix.DocCount()
	for _, ts := range r.scorers {
		ts.TotalDocs = totalDocs
		ts.AvgLen = ix.AvgFieldLength(ts.Field)
		ts.Scorer = bm25
		field := ts.Field
		ts.LengthOf = func(docID string) int { return ix.FieldLength(field, docID) }
	}
	return search.NewScorer(ix, bm25, r.scorers, r.Root)
}

// Compile walks the AST and produces the iterator tree. Filter clauses
// contribute to matching but not to scoring (chapter 11's cacheable clauses).
func (c *Compiler) Compile(q *Query) (*Result, error) {
	res := &Result{}
	if err := c.compileInto(q, res, false); err != nil {
		return nil, err
	}
	return res, nil
}

func (c *Compiler) compileInto(q *Query, res *Result, filterOnly bool) error {
	switch q.Kind {
	case "match":
		return c.compileTextTerms(q, res, filterOnly)
	case "phrase":
		return c.compilePhrase(q, res)
	case "term":
		val, err := stringValue(q.Value)
		if err != nil {
			return err
		}
		pl := c.IX.Lookup(q.Field, val) // term does NOT analyze (book ch. 10)
		it := exec.NewTerm(pl)
		if !filterOnly && pl != nil {
			res.addScorer(&search.TermScorer{Field: q.Field, Term: val, Postings: pl.Postings, DocFreq: pl.DocFreq})
		}
		res.Root = join(res.Root, it)
		return nil
	case "prefix":
		val, err := stringValue(q.Value)
		if err != nil {
			return err
		}
		dict := dictFromIndex(c.IX, q.Field)
		matches := dict.ExpandPrefix(val, defaultOpts())
		return c.expandTerms(matches, q, res, filterOnly)
	case "wildcard":
		val, err := stringValue(q.Value)
		if err != nil {
			return err
		}
		dict := dictFromIndex(c.IX, q.Field)
		matches, err := dict.ExpandWildcard(val, defaultOpts())
		if err != nil {
			return err
		}
		return c.expandTerms(matches, q, res, filterOnly)
	case "fuzzy":
		val, err := stringValue(q.Value)
		if err != nil {
			return err
		}
		k := q.Fuzziness
		if k <= 0 {
			k = 2
		}
		dict := dictFromIndex(c.IX, q.Field)
		matches := dict.ExpandFuzzy(val, k, defaultOpts())
		return c.expandTerms(matches, q, res, filterOnly)
	case "range":
		return c.compileRange(q, res)
	case "bool":
		return c.compileBool(q, res)
	default:
		return fmt.Errorf("unknown query kind %q", q.Kind)
	}
}

// compileTextTerms implements match: analyze the query string with the
// field's analyzer, then OR the resulting terms.
func (c *Compiler) compileTextTerms(q *Query, res *Result, filterOnly bool) error {
	text, err := stringValue(q.Value)
	if err != nil {
		return err
	}
	an := c.IX.AnalyzerFor(q.Field) // match DOES analyze (book ch. 10-11)
	terms := an.Analyze(text)
	if len(terms) == 0 {
		res.Root = exec.NewTerm(nil)
		return nil
	}
	var children []exec.Iterator
	seen := make(map[string]bool)
	for _, t := range terms {
		if seen[t] {
			continue
		}
		seen[t] = true
		pl := c.IX.Lookup(q.Field, t)
		child := exec.NewTerm(pl)
		if pl != nil && !filterOnly {
			res.addScorer(&search.TermScorer{Field: q.Field, Term: t, Postings: pl.Postings, DocFreq: pl.DocFreq})
		}
		children = append(children, child)
	}
	if len(children) == 1 {
		res.Root = join(res.Root, children[0])
		return nil
	}
	// A multi-word match is an OR of its terms (the usual Lucene behavior).
	res.Root = join(res.Root, exec.NewOr(children...))
	return nil
}

func (c *Compiler) compilePhrase(q *Query, res *Result) error {
	text, err := stringValue(q.Value)
	if err != nil {
		return err
	}
	an := c.IX.AnalyzerFor(q.Field)
	terms := an.Analyze(text)
	if len(terms) == 0 {
		res.Root = exec.NewTerm(nil)
		return nil
	}
	var members []exec.Iterator
	for _, t := range terms {
		members = append(members, exec.NewTerm(c.IX.Lookup(q.Field, t)))
	}
	src := exec.IndexPositions{IX: c.IX}
	ph := exec.NewPhrase(src, q.Field, terms, members, q.Slop)
	res.Root = join(res.Root, ph)
	return nil
}

func (c *Compiler) expandTerms(terms []string, q *Query, res *Result, filterOnly bool) error {
	var children []exec.Iterator
	for _, t := range terms {
		pl := c.IX.Lookup(q.Field, t)
		child := exec.NewTerm(pl)
		if pl != nil && !filterOnly {
			res.addScorer(&search.TermScorer{Field: q.Field, Term: t, Postings: pl.Postings, DocFreq: pl.DocFreq})
		}
		children = append(children, child)
	}
	if len(children) == 0 {
		res.Root = join(res.Root, exec.NewTerm(nil))
		return nil
	}
	res.Root = join(res.Root, exec.NewOr(children...))
	return nil
}

func (c *Compiler) compileRange(q *Query, res *Result) error {
	var bounds struct {
		GTE    *float64 `json:"gte"`
		LTE    *float64 `json:"lte"`
		HasGTE bool     `json:"hasGTE"`
		HasLTE bool     `json:"hasLTE"`
	}
	if err := json.Unmarshal(q.Value, &bounds); err != nil {
		return fmt.Errorf("decode range for %q: %w", q.Field, err)
	}
	constraint := pointsConstraint(bounds.GTE, bounds.LTE, bounds.HasGTE, bounds.HasLTE)

	// The point index lives inside engine.Engine; reach for it via the
	// registered provider to avoid an import cycle with package points.
	if c.Points == nil || c.Points[q.Field] == nil {
		return fmt.Errorf("field %q is not point-indexed", q.Field)
	}
	ids := c.Points[q.Field].Search(points.RangeConstraint{
		GTE:    constraint.GTE,
		LTE:    constraint.LTE,
		HasGTE: constraint.HasGTE,
		HasLTE: constraint.HasLTE,
	})
	var children []exec.Iterator
	for _, id := range ids {
		children = append(children, &docIDIter{id: id})
	}
	if len(children) == 0 {
		res.Root = join(res.Root, exec.NewTerm(nil))
		return nil
	}
	res.Root = join(res.Root, exec.NewOr(children...))
	return nil
}

func pointsConstraint(gte, lte *float64, hasGTE, hasLTE bool) (out struct {
	GTE, LTE       float64
	HasGTE, HasLTE bool
}) {
	if gte != nil {
		out.GTE, out.HasGTE = *gte, true
	}
	if lte != nil {
		out.LTE, out.HasLTE = *lte, true
	}
	return out
}

func (c *Compiler) compileBool(q *Query, res *Result) error {
	var mustIters, shouldIters, notIters []exec.Iterator

	build := func(subs []*Query) ([]exec.Iterator, error) {
		var its []exec.Iterator
		for _, sub := range subs {
			subRes := &Result{}
			if err := c.compileInto(sub, subRes, sub.noScore); err != nil {
				return nil, err
			}
			if subRes.Root == nil {
				continue
			}
			its = append(its, subRes.Root)
			// Scoring leaves bubble up unless the clause is filter/must_not.
			if !sub.noScore {
				res.scorers = append(res.scorers, subRes.scorers...)
			}
		}
		return its, nil
	}

	var err error
	if mustIters, err = build(q.Must); err != nil {
		return err
	}
	if shouldIters, err = build(q.Should); err != nil {
		return err
	}
	if notIters, err = build(q.MustNot); err != nil {
		return err
	}
	filterIters, err := build(q.Filter)
	if err != nil {
		return err
	}

	// Semantics: at least one of must/should/filter must match; must_not
	// excludes. Pure-should queries are optional-match ORs; with a must or
	// filter present, should only boosts (its docs still need must/filter).
	var positive []exec.Iterator
	positive = append(positive, mustIters...)
	positive = append(positive, filterIters...)

	var root exec.Iterator
	switch {
	case len(positive) > 1:
		root = exec.NewAnd(positive...)
	case len(positive) == 1:
		root = positive[0]
	case len(shouldIters) > 0:
		// Pure-should: documents matching more should-clauses score higher,
		// but every matcher is retrieved.
		root = exec.NewOr(shouldIters...)
	default:
		root = exec.NewTerm(nil)
	}
	for _, n := range notIters {
		exclude := n
		root = exec.NewNot(root, exclude)
	}
	res.Root = join(res.Root, root)
	return nil
}

// join composes an existing tree with a new clause (AND), flattening nils.
func join(existing, next exec.Iterator) exec.Iterator {
	if existing == nil {
		return next
	}
	return exec.NewAnd(existing, next)
}

func stringValue(v json.RawMessage) (string, error) {
	var s string
	if err := json.Unmarshal(v, &s); err != nil {
		return "", fmt.Errorf("expected string value: %w", err)
	}
	if strings.TrimSpace(s) == "" {
		return "", fmt.Errorf("empty query value")
	}
	return s, nil
}

func defaultOpts() Options { return DefaultOptions() }

// docIDIter matches exactly one document id.
type docIDIter struct {
	id   string
	done bool
}

func (d *docIDIter) DocID() string {
	if d.done {
		return ""
	}
	return d.id
}

func (d *docIDIter) Advance(target string) string {
	if d.done || target > d.id {
		d.done = true
		return ""
	}
	// target <= id: land on the id; consumed once, so mark done only when
	// the caller asks for something strictly greater next time.
	if target == d.id {
		d.done = true // single-shot: a second Advance past the same doc fails
	}
	return d.id
}

func (d *docIDIter) Cost() int {
	if d.done {
		return 0
	}
	return 1
}
