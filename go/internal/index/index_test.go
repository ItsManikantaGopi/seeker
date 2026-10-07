package index

import (
	"testing"

	"kaus-go/internal/model"
)

func doc(id, title, body string, tags ...string) model.Document {
	src := map[string]any{
		"id":     id,
		"title":  title,
		"body":   body,
		"status": "In-Stock",
	}
	if len(tags) > 0 {
		t := make([]any, len(tags))
		for i, s := range tags {
			t[i] = s
		}
		src["tags"] = t
	}
	d, err := model.NewDocument(id, src)
	if err != nil {
		panic(err)
	}
	return *d
}

func TestIndexAddAndLookup(t *testing.T) {
	ix := New()
	if err := ix.Add(doc("d1", "Kubernetes Basics", "rolling updates keep pods alive")); err != nil {
		t.Fatal(err)
	}
	if err := ix.Add(doc("d2", "Docker Deep Dive", "containers and images")); err != nil {
		t.Fatal(err)
	}

	pl := ix.Lookup("title", "kubernet")
	if pl == nil || pl.DocFreq != 1 {
		t.Fatalf("Lookup(kubernet in title) = %+v", pl)
	}
	if p := pl.Postings[0]; p.DocID != "d1" || p.Frequency != 1 || len(p.Positions) != 1 || p.Positions[0] != 0 {
		t.Errorf("unexpected posting %+v", p)
	}

	// Positions survive later words: "updates" is the second word of d1's body.
	pl = ix.Lookup("body", "updat")
	if pl == nil {
		t.Fatal("missing posting for updat")
	}
	if got := pl.Postings[0].Positions[0]; got != 1 {
		t.Errorf("position of updat = %d, want 1", got)
	}

	// Keyword fields are verbatim.
	if pl := ix.Lookup("status", "in-stock"); pl != nil {
		t.Error("keyword field must not be lowercased at lookup")
	}
	if pl := ix.Lookup("status", "In-Stock"); pl == nil {
		t.Error("verbatim keyword term missing")
	}

	if got := ix.Lookup("title", "nonexistent"); got != nil {
		t.Errorf("unknown term should give nil, got %+v", got)
	}
}

func TestIndexDocLengthsAndStats(t *testing.T) {
	ix := New()
	_ = ix.Add(doc("a", "one two three", "x"))
	_ = ix.Add(doc("b", "four five", "y"))

	if got := ix.FieldLength("title", "a"); got != 3 {
		t.Errorf("FieldLength(title,a) = %d, want 3", got)
	}
	if got := ix.FieldLength("title", "b"); got != 2 {
		t.Errorf("FieldLength(title,b) = %d, want 2", got)
	}
	if avg := ix.AvgFieldLength("title"); avg != 2.5 {
		t.Errorf("AvgFieldLength(title) = %v, want 2.5", avg)
	}

	st := ix.Stats()
	if st.Documents != 2 {
		t.Errorf("stats documents = %d, want 2", st.Documents)
	}
	if n := st.Fields["title"]; n != 5 {
		t.Errorf("distinct title terms = %d, want 5", n)
	}
}

func TestIndexUpsertReplacesPostings(t *testing.T) {
	ix := New()
	_ = ix.Add(doc("u", "alpha beta", "old body"))
	_ = ix.Add(doc("u", "gamma", "new body"))

	if ix.Lookup("title", "alpha") != nil {
		t.Error("stale alpha survived upsert")
	}
	if ix.Lookup("title", "gamma") == nil {
		t.Error("fresh gamma missing after upsert")
	}
	if got := ix.FieldLength("title", "u"); got != 1 {
		t.Errorf("doc length after upsert = %d, want 1", got)
	}
	if avg := ix.AvgFieldLength("title"); avg != 1.0 {
		t.Errorf("avg length after upsert = %v, want 1 (no double counting)", avg)
	}
	if ix.DocCount() != 1 {
		t.Errorf("doc count = %d, want 1", ix.DocCount())
	}
}

func TestIndexDelete(t *testing.T) {
	ix := New()
	_ = ix.Add(doc("x", "shared term", "b"))
	_ = ix.Add(doc("y", "shared term", "b"))

	if !ix.Delete("x") {
		t.Fatal("Delete(x) returned false")
	}
	if ix.Delete("x") {
		t.Error("second Delete should be false")
	}

	pl := ix.Lookup("title", "share") // "shared" stems to "share" (cvc rule)
	if pl == nil || pl.DocFreq != 1 {
		t.Fatalf("postings after delete: %+v", pl)
	}
	if pl.Postings[0].DocID != "y" {
		t.Errorf("survivor = %q, want y", pl.Postings[0].DocID)
	}
	// The survivor keeps its full length of 2 terms, so the average is 2.
	if got := ix.AvgFieldLength("title"); got != 2.0 {
		t.Errorf("avg length after delete = %v, want 2", got)
	}
	if _, ok := ix.Get("x"); ok {
		t.Error("deleted document still retrievable via Get")
	}
}

func TestLookupReturnsCopy(t *testing.T) {
	ix := New()
	_ = ix.Add(doc("c1", "warp drive", "b"))
	pl := ix.Lookup("title", "warp")
	pl.Postings[0].Frequency = 99 // mutate the copy
	fresh := ix.Lookup("title", "warp")
	if fresh.Postings[0].Frequency != 1 {
		t.Error("Lookup leaked internal postings state")
	}
}

func TestTermsSorted(t *testing.T) {
	ix := New()
	// "apple" stems to "appl"; sorted order of indexed terms is what matters.
	_ = ix.Add(doc("t1", "mango apple banana", "b"))
	got := ix.Terms("title")
	want := []string{"appl", "banana", "mango"}
	if !equal(got, want) {
		t.Fatalf("terms = %v, want sorted %v", got, want)
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
