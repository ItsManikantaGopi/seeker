package exec

import (
	"reflect"
	"testing"

	"seeker-go/internal/index"
	"seeker-go/internal/model"
)

// buildIndex loads a tiny corpus so iterators run against real postings.
func buildIndex(t *testing.T) *index.Index {
	t.Helper()
	ix := index.New()
	mk := func(id, title, body string) model.Document {
		d, err := model.NewDocument(id, map[string]any{"id": id, "title": title, "body": body})
		if err != nil {
			t.Fatal(err)
		}
		return *d
	}
	docs := []model.Document{
		mk("doc-1", "Kubernetes in Action", "rolling updates keep the fleet fresh"),
		mk("doc-2", "Docker Basics", "containers share the host kernel"),
		mk("doc-3", "Rolling with Kubernetes", "updates roll out gradually"),
	}
	for _, d := range docs {
		if err := ix.Add(d); err != nil {
			t.Fatal(err)
		}
	}
	return ix
}

func pl(ix *index.Index, field, term string) *index.PostingsList { return ix.Lookup(field, term) }

func TestTermIterAdvance(t *testing.T) {
	ix := buildIndex(t)
	it := NewTerm(pl(ix, "body", "roll")) // doc-1 (rolling), doc-3 (roll)
	if got := it.Advance(""); got != "doc-1" {
		t.Fatalf("first = %q", got)
	}
	if got := it.Advance("doc-1"); got != "doc-1" {
		t.Errorf("Advance(current) should stay: %q", got)
	}
	if got := it.Advance("doc-2"); got != "doc-3" {
		t.Fatalf("skip to second = %q, want doc-3", got)
	}
	if got := it.Advance(Successor("doc-3")); got != "" {
		t.Fatalf("expected exhaustion, got %q", got)
	}
	if got := NewTerm(nil).Advance(""); got != "" {
		t.Errorf("nil postings must be empty iterator, got %q", got)
	}
}

func TestAndLeapfrog(t *testing.T) {
	ix := buildIndex(t)
	and := NewAnd(
		NewTerm(pl(ix, "title", "kubernet")), // doc-1, doc-3
		NewTerm(pl(ix, "body", "updat")),     // doc-1, doc-3
	)
	got := Collect(and)
	want := []string{"doc-1", "doc-3"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("and = %v, want %v", got, want)
	}

	// Disjoint children match nothing.
	and = NewAnd(NewTerm(pl(ix, "title", "docker")), NewTerm(pl(ix, "title", "kubernet")))
	if got := Collect(and); len(got) != 0 {
		t.Fatalf("disjoint and = %v, want empty", got)
	}

	// Mid-stream Advance still works after partial consumption.
	and = NewAnd(NewTerm(pl(ix, "title", "kubernet")), NewTerm(pl(ix, "body", "updat")))
	if got := and.Advance("doc-2"); got != "doc-3" {
		t.Fatalf("and.Advance(doc-2) = %q, want doc-3", got)
	}
}

func TestOrDisjunction(t *testing.T) {
	ix := buildIndex(t)
	or := NewOr(
		NewTerm(pl(ix, "title", "docker")),
		NewTerm(pl(ix, "title", "kubernet")),
	)
	got := Collect(or)
	want := []string{"doc-1", "doc-2", "doc-3"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("or = %v, want %v", got, want)
	}
	if got := or.Advance("doc-2"); got != "doc-2" {
		t.Errorf("or.Advance(doc-2) = %q, want doc-2", got)
	}
}

func TestNotExcludesWithoutLooping(t *testing.T) {
	ix := buildIndex(t)
	not := NewNot(
		NewTerm(pl(ix, "title", "kubernet")), // doc-1, doc-3
		NewTerm(pl(ix, "body", "roll")),      // excludes doc-1, doc-3
	)
	got := Collect(not)
	if len(got) != 0 {
		t.Fatalf("fully excluded not = %v, want empty (no infinite loop)", got)
	}

	not = NewNot(
		NewOr(NewTerm(pl(ix, "title", "docker")), NewTerm(pl(ix, "title", "kubernet"))),
		NewTerm(pl(ix, "body", "updat")), // kills doc-1 and doc-3
	)
	if got := Collect(not); !reflect.DeepEqual(got, []string{"doc-2"}) {
		t.Fatalf("not = %v, want [doc-2]", got)
	}
}

func TestPhraseExact(t *testing.T) {
	ix := buildIndex(t)
	src := IndexPositions{IX: ix}
	terms := []string{"roll", "updat"}
	members := []Iterator{NewTerm(pl(ix, "body", "roll")), NewTerm(pl(ix, "body", "updat"))}

	ph := NewPhrase(src, "body", terms, members, 0)
	if got := Collect(ph); !reflect.DeepEqual(got, []string{"doc-1"}) {
		t.Fatalf("exact phrase hits = %v, want [doc-1]", got)
	}

	// Order is a positional fact: "updates roll" IS a phrase in doc-3 even
	// though "rolling updates" only matches doc-1.
	rev := NewPhrase(src, "body",
		[]string{"updat", "roll"},
		[]Iterator{NewTerm(pl(ix, "body", "updat")), NewTerm(pl(ix, "body", "roll"))}, 0)
	if got := Collect(rev); !reflect.DeepEqual(got, []string{"doc-3"}) {
		t.Fatalf("updates-roll phrase hits = %v, want [doc-3]", got)
	}
}

func TestPhraseWithSlop(t *testing.T) {
	ix := buildIndex(t)
	src := IndexPositions{IX: ix}
	members := []Iterator{NewTerm(pl(ix, "body", "updat")), NewTerm(pl(ix, "body", "gradual"))}
	ph := NewPhrase(src, "body", []string{"updat", "gradual"}, members, 1)
	// doc-3 body: "updates roll out gradually" -> updat@0, gradual@3, gap 2 > slop 1.
	if got := Collect(ph); len(got) != 0 {
		t.Fatalf("slop=1 should reject gap of 2, got %v", got)
	}

	ph = NewPhrase(src, "body", []string{"updat", "gradual"}, members, 2)
	if got := Collect(ph); !reflect.DeepEqual(got, []string{"doc-3"}) {
		t.Fatalf("slop=2 hits = %v, want [doc-3]", got)
	}
}

// naiveScan is the oracle: brute-force term matching over raw text.
func naiveScan(ix *index.Index, term string) []string {
	var out []string
	for _, id := range ix.AllDocs() {
		d, _ := ix.Get(id)
		hit := false
		for _, f := range []string{"title", "body"} {
			for _, w := range ix.AnalyzerFor(f).Analyze(d.Source[f].(string)) {
				if w == term {
					hit = true
					break
				}
			}
		}
		if hit {
			out = append(out, id) // AllDocs is sorted, so out stays sorted+unique
		}
	}
	return out
}

// TestIteratorsMatchNaiveScan drains iterator trees through Collect and
// compares them against brute force - chapter 04's differential harness.
func TestIteratorsMatchNaiveScan(t *testing.T) {
	ix := buildIndex(t)
	terms := []string{"kubernet", "docker", "roll", "updat", "fleet", "absent"}

	for _, term := range terms {
		want := naiveScan(ix, term)
		tree := NewOr(
			NewTerm(pl(ix, "title", term)),
			NewTerm(pl(ix, "body", term)),
		)
		if got := Collect(tree); !reflect.DeepEqual(got, want) {
			t.Errorf("term %q: tree = %v, naive scan = %v", term, got, want)
		}
	}
}
