package engine

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"kaus-go/internal/querydsl"
)

// newSeeded loads the real demo corpus exported from the TypeScript edition.
func newSeeded(t *testing.T) *Engine {
	t.Helper()
	data, err := os.ReadFile("../../testdata/corpus.json")
	if err != nil {
		t.Fatalf("corpus not found: %v", err)
	}
	eng := New()
	if err := eng.SeedCorpus(data); err != nil {
		t.Fatal(err)
	}
	if got := eng.Index.DocCount(); got != 28 {
		t.Fatalf("seeded %d docs, want 28", got)
	}
	return eng
}

func runQuery(t *testing.T, eng *Engine, query string) []string {
	t.Helper()
	req := struct {
		Query json.RawMessage `json:"query"`
		Size  int             `json:"size"`
	}{Query: json.RawMessage(query), Size: 28}
	body, _ := json.Marshal(req)
	sr, err := querydsl.Decode(body)
	if err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	resp, err := eng.Search(sr)
	if err != nil {
		t.Fatalf("search %s: %v", query, err)
	}
	var ids []string
	for _, h := range resp.Hits {
		ids = append(ids, h.ID)
	}
	return ids
}

func TestFuzzyFindsMisspelledDoc(t *testing.T) {
	eng := newSeeded(t)
	// All nine Kubernetes titles stem to "kubernet", which is 2 edits from
	// "kubernetes" (delete 's', delete 'e') - so fuzziness 1 finds nothing.
	if got := runQuery(t, eng, `{"fuzzy": {"title": {"value": "kubernetes", "fuzziness": 1}}}`); len(got) != 0 {
		t.Fatalf("fuzzy(kubernetes,1) matched %v, want none", got)
	}
	got := runQuery(t, eng, `{"fuzzy": {"title": {"value": "kubernetes", "fuzziness": 2}}}`)
	found := false
	for _, id := range got {
		if id == "doc-7" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("fuzzy kubernetes missed doc-7: %v", got)
	}
	// doc-4 ("Kubernetes Kubernetes Kubernetes") is an exact match and must rank first.
	if got[0] != "doc-4" {
		t.Errorf("top fuzzy hit = %s, want doc-4 (exact term scores highest)", got[0])
	}
}

func TestPhraseRollingUpdates(t *testing.T) {
	eng := newSeeded(t)
	// doc-1 and doc-12 both contain the exact phrase; doc-1 outranks doc-12
	// because "updates" repeats in its longer body.
	got := runQuery(t, eng, `{"phrase": {"body": "rolling updates"}}`)
	if len(got) != 2 || got[0] != "doc-1" || got[1] != "doc-12" {
		t.Fatalf("phrase rolling updates = %v, want [doc-1 doc-12]", got)
	}

	// The words appear separately in other docs but not adjacently.
	got = runQuery(t, eng, `{"phrase": {"body": "updates rolling"}}`)
	if len(got) != 0 {
		t.Errorf("reversed phrase matched %v", got)
	}
}

// countInRange recomputes the answer from raw sources - a tiny oracle.
func countInRange(eng *Engine) int {
	n := 0
	for _, id := range eng.SortedDocIDs() {
		d, _ := eng.Index.Get(id)
		if p, ok := d.Source["price"].(float64); ok && p >= 100 && p <= 200 {
			n++
		}
	}
	return n
}

func containsAll(haystack []string, want map[string]bool) bool {
	for _, id := range haystack {
		if !want[id] {
			return false
		}
	}
	return true
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestPriceRange100to200(t *testing.T) {
	eng := newSeeded(t)
	req, err := querydsl.Decode([]byte(`{"query": {"range": {"price": {"gte": 100, "lte": 200}}}, "size": 28}`))
	if err != nil {
		t.Fatal(err)
	}
	resp, err := eng.Search(req)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{
		"doc-1": true /*149.99*/, "doc-3": true /*129*/, "doc-6": true, /*199*/
		"doc-8": true /*159*/, "doc-11": true /*119*/, "doc-16": true, /*179*/
		"doc-17": true /*139*/, "doc-21": true /*109*/, "doc-25": true, /*189*/
		"doc-27": true, /*169*/
	}
	if n := countInRange(eng); n != len(want) {
		t.Fatalf("corpus oracle says %d docs in [100,200], test fixture claims %d", n, len(want))
	}

	var ids []string
	for _, h := range resp.Hits {
		ids = append(ids, h.ID)
		d, _ := eng.Index.Get(h.ID)
		price := d.Source["price"].(float64)
		if price < 100 || price > 200 {
			t.Errorf("hit %s has price %v outside [100,200]", h.ID, price)
		}
	}
	// doc-6 (199) is in; doc-18 (209), doc-20 (299), doc-10 (249) are out.
	if len(ids) != len(want) || !containsAll(ids, want) {
		t.Fatalf("range hits = %v, want exactly %v", ids, keys(want))
	}
}

func TestBoolFilterAndMust(t *testing.T) {
	eng := newSeeded(t)
	body := `{"bool": {
		"must":   {"match": {"body": "cache"}},
		"filter": {"term": {"status": "published"}}
	}}`
	got := runQuery(t, eng, body)
	// Corpus oracle: doc-2, doc-5 and doc-10 mention cache in the body and
	// all are published (doc-13 only mentions cache in its title).
	want := map[string]bool{"doc-2": true, "doc-5": true, "doc-10": true}
	for _, id := range got {
		if !want[id] {
			t.Errorf("unexpected hit %s (cache+published set is doc-2/5/10)", id)
		}
		d, _ := eng.Index.Get(id)
		if d.Source["status"] != "published" {
			t.Errorf("filter leaked %s with status %v", id, d.Source["status"])
		}
	}
}

func TestExplainSumsTermScores(t *testing.T) {
	eng := newSeeded(t)
	req, err := querydsl.Decode([]byte(`{"query": {"match": {"body": "kubernetes cluster"}}, "size": 5}`))
	if err != nil {
		t.Fatal(err)
	}
	exp, err := eng.Explain(req, "doc-3")
	if err != nil {
		t.Fatal(err)
	}
	if exp.Value <= 0 {
		t.Fatalf("explanation value = %v", exp.Value)
	}
	if len(exp.Details) == 0 {
		t.Fatal("no per-term details in explanation")
	}
	sum := 0.0
	for _, d := range exp.Details {
		sum += d.Value
	}
	if sum != exp.Value {
		t.Errorf("details sum %v != total %v", sum, exp.Value)
	}
}

func TestDeleteRemovesFromSearch(t *testing.T) {
	eng := newSeeded(t)
	before := runQuery(t, eng, `{"match": {"title": "redis"}}`)
	// doc-17 (Redis Cluster Resharding) and doc-5 (Redis Caching Strategies).
	if len(before) != 2 {
		t.Fatalf("redis baseline = %v", before)
	}
	if !eng.Delete("doc-5") {
		t.Fatal("delete failed")
	}
	after := runQuery(t, eng, `{"match": {"title": "redis"}}`)
	if len(after) != 1 || after[0] != "doc-17" {
		t.Fatalf("after delete = %v, want [doc-17]", after)
	}
}

var _ = reflect.DeepEqual // keep import if assertions change
