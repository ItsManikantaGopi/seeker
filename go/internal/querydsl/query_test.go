package querydsl

import (
	"reflect"
	"testing"

	"seeker-go/internal/index"
	"seeker-go/internal/model"
	"seeker-go/internal/points"
)

func buildIX(t *testing.T) *index.Index {
	t.Helper()
	ix := index.New()
	docs := []model.Document{
		mustDoc(t, "d1", map[string]any{"id": "d1", "title": "Kubernetes Deployment", "body": "rolling updates keep pods fresh", "status": "published", "price": 149.99}),
		mustDoc(t, "d2", map[string]any{"id": "d2", "title": "Docker Deployment Patterns", "body": "immutable images and cached layers", "status": "draft", "price": 89.5}),
		mustDoc(t, "d3", map[string]any{"id": "d3", "title": "Kubernets Cluster Setup", "body": "a misspelled title on purpose", "status": "published", "price": 39}),
	}
	for _, d := range docs {
		if err := ix.Add(d); err != nil {
			t.Fatal(err)
		}
	}
	return ix
}

func mustDoc(t *testing.T, id string, src map[string]any) model.Document {
	t.Helper()
	d, err := model.NewDocument(id, src)
	if err != nil {
		t.Fatal(err)
	}
	return *d
}

// compileWith lets callers register point indexes (range clauses search there).
func compileWith(t *testing.T, ix *index.Index, pts map[string]*points.PointIndex, body string) []string {
	t.Helper()
	req, err := Decode([]byte(body))
	if err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	c := &Compiler{IX: ix, Points: pts}
	res, err := c.Compile(req.Query)
	if err != nil {
		t.Fatalf("compile %s: %v", body, err)
	}
	if res.Root == nil {
		return nil
	}
	return drain(res.Root)
}

// compile uses the default compiler without point indexes.
func compile(t *testing.T, ix *index.Index, body string) []string {
	return compileWith(t, ix, nil, body)
}

// drain walks the compiled tree to a sorted doc list.
func drain(root interface {
	DocID() string
	Advance(string) string
	Cost() int
}) []string {
	var out []string
	doc := root.Advance("")
	for doc != "" {
		out = append(out, doc)
		next := root.Advance(successor(doc))
		if next == "" {
			break
		}
		doc = next
	}
	return out
}

func successor(s string) string {
	b := []byte(s)
	i := len(b) - 1
	for i >= 0 && b[i] == 0xff {
		i--
	}
	if i < 0 {
		return s + "\x00"
	}
	b[i]++
	return string(b[:i+1])
}

func TestDecodeRejectsBadBodies(t *testing.T) {
	for _, bad := range []string{
		`{}`,                             // no query at all
		`{"query": {}}`,                  // empty clause object
		`{"query": {"match_all": true}}`, // unknown clause kind
		`{"query": {"match": {"t":"x"}, "term": {"t":"y"}}}`, // two clause kinds
	} {
		if _, err := Decode([]byte(bad)); err == nil {
			t.Errorf("Decode(%s) accepted invalid body", bad)
		}
	}
}

func TestMatchAnalyzesButTermDoesNot(t *testing.T) {
	ix := buildIX(t)

	// match analyzes + stems: finds the deployment docs.
	got := compile(t, ix, `{"query": {"match": {"title": "deployments"}}, "size": 10}`)
	if !reflect.DeepEqual(got, []string{"d1", "d2"}) {
		t.Fatalf("match(deployments) = %v, want [d1 d2]", got)
	}

	// term does not analyze: the raw word is looked up verbatim. Both titles
	// hold the stemmed form "deploy", so the unstemmed word finds NOTHING.
	got = compile(t, ix, `{"query": {"term": {"title": "deployment"}}, "size": 10}`)
	if len(got) != 0 {
		t.Fatalf("unanalyzed term(deployment) matched %v, want none", got)
	}
	got = compile(t, ix, `{"query": {"term": {"title": "deploy"}}, "size": 10}`)
	if !reflect.DeepEqual(got, []string{"d1", "d2"}) {
		t.Fatalf("verbatim term(deploy) = %v, want [d1 d2]", got)
	}
}

func TestBoolMustFilterMustNot(t *testing.T) {
	ix := buildIX(t)
	pt := points.NewPointIndex("price", []model.Document{
		mustDoc(t, "d1", map[string]any{"id": "d1", "price": 149.99}),
		mustDoc(t, "d2", map[string]any{"id": "d2", "price": 89.5}),
		mustDoc(t, "d3", map[string]any{"id": "d3", "price": 39}),
	})
	body := `{"query": {"bool": {
		"must":   {"match": {"body": "images"}},
		"filter": {"term": {"status": "draft"}},
		"must_not": {"range": {"price": {"gte": 100}}}
	}}, "size": 10}`
	got := compileWith(t, ix, map[string]*points.PointIndex{"price": pt}, body)
	if !reflect.DeepEqual(got, []string{"d2"}) {
		t.Fatalf("bool combo = %v, want [d2]", got)
	}
}

func TestRangeUsesPointsIndex(t *testing.T) {
	ix := buildIX(t)
	pt := points.NewPointIndex("price", []model.Document{
		mustDoc(t, "d1", map[string]any{"id": "d1", "price": 149.99}),
		mustDoc(t, "d2", map[string]any{"id": "d2", "price": 89.5}),
		mustDoc(t, "d3", map[string]any{"id": "d3", "price": 39}),
	})
	c := &Compiler{IX: ix, Points: map[string]*points.PointIndex{"price": pt}}

	q := &Query{}
	if err := q.UnmarshalJSON([]byte(`{"range": {"price": {"gte": 50, "lte": 200}}}`)); err != nil {
		t.Fatal(err)
	}
	res, err := c.Compile(q)
	if err != nil {
		t.Fatal(err)
	}
	if got := drain(res.Root); !reflect.DeepEqual(got, []string{"d1", "d2"}) {
		t.Fatalf("range 50..200 = %v, want [d1 d2]", got)
	}

	// Without a registered point index the range must error out.
	cNoPoints := &Compiler{IX: ix}
	if _, err := cNoPoints.Compile(q); err == nil {
		t.Fatal("range without point index should fail")
	}
}

func TestFuzzyClauseExpandsThroughDict(t *testing.T) {
	ix := buildIX(t)
	// "Kubernets" stems to "kubernet", which sits 2 edits from
	// "kubernetes" - so fuzziness 1 finds nothing and 2 finds d3.
	got := compile(t, ix, `{"query": {"fuzzy": {"title": {"value": "kubernetes", "fuzziness": 1}}}, "size": 10}`)
	if len(got) != 0 {
		t.Fatalf("fuzzy(kubernetes, 1) matched %v, want none", got)
	}
	got = compile(t, ix, `{"query": {"fuzzy": {"title": {"value": "kubernetes", "fuzziness": 2}}}, "size": 10}`)
	// d1's title also stems to kubernet, so both d1 and d3 match.
	if !reflect.DeepEqual(got, []string{"d1", "d3"}) {
		t.Fatalf("fuzzy(kubernetes, 2) = %v, want [d1 d3]", got)
	}
}

func TestPhraseClausePositional(t *testing.T) {
	ix := buildIX(t)
	got := compile(t, ix, `{"query": {"phrase": {"body": "rolling updates"}}, "size": 10}`)
	if !reflect.DeepEqual(got, []string{"d1"}) {
		t.Fatalf("phrase = %v, want [d1]", got)
	}
}
