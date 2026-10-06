package points

import (
	"reflect"
	"testing"
	"time"

	"kaus-go/internal/model"
)

func mkDocs(t *testing.T) []model.Document {
	t.Helper()
	raw := []map[string]any{
		{"id": "a", "price": 49.99, "created_at": "2024-01-15"},
		{"id": "b", "price": 120.0, "created_at": "2023-06-01"},
		{"id": "c", "price": 199.5, "created_at": "2022-12-31"},
		{"id": "d", "price": 350.0, "created_at": "2024-03-03"},
		{"id": "e", "rating": 4.8}, // no price: must be skipped, not zero
	}
	docs := make([]model.Document, 0, len(raw))
	for _, src := range raw {
		d, err := model.NewDocument(src["id"].(string), src)
		if err != nil {
			t.Fatal(err)
		}
		docs = append(docs, *d)
	}
	return docs
}

func TestPointIndexRange(t *testing.T) {
	pi := NewPointIndex("price", mkDocs(t))

	got := pi.Search(RangeConstraint{GTE: 100, LTE: 200, HasGTE: true, HasLTE: true})
	if !reflect.DeepEqual(got, []string{"b", "c"}) {
		t.Fatalf("price 100..200 = %v, want [b c]", got)
	}

	got = pi.Search(RangeConstraint{HasGTE: false, LTE: 100, HasLTE: true})
	if !reflect.DeepEqual(got, []string{"a"}) {
		t.Fatalf("price <=100 = %v, want [a]", got)
	}

	all := pi.Search(RangeConstraint{})
	if len(all) != 4 {
		t.Fatalf("unbounded = %v, want all 4 priced docs", all)
	}
}

func TestPointIndexDatesAreEpochsNotYears(t *testing.T) {
	pi := NewPointIndex("created_at", mkDocs(t))

	want := float64(time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC).Unix())
	mid := pi.Search(RangeConstraint{GTE: want - 3600, LTE: want + 3600, HasGTE: true, HasLTE: true})
	if !reflect.DeepEqual(mid, []string{"b"}) {
		t.Fatalf("date range around 2023-06-01 = %v, want [b] (dates must be epoch seconds)", mid)
	}

	// >= 2023-06-01 catches b (equal), a (2024-01-15) and d (2024-03-03);
	// c is 2022-12-31, safely before. Results follow value order.
	recent := pi.Search(RangeConstraint{GTE: want, HasGTE: true})
	if !reflect.DeepEqual(recent, []string{"b", "a", "d"}) {
		t.Fatalf("dates >= 2023-06-01 = %v, want [b a d]", recent)
	}
}

func TestKDTreeBoxSearch(t *testing.T) {
	raw := []map[string]any{
		{"id": "sf", "location": map[string]any{"lat": 37.77, "lon": -122.42}},
		{"id": "nyc", "location": map[string]any{"lat": 40.71, "lon": -74.00}},
		{"id": "la", "location": map[string]any{"lat": 34.05, "lon": -118.24}},
		{"id": "sj", "location": map[string]any{"lat": 37.33, "lon": -121.89}},
	}
	var docs []model.Document
	for _, src := range raw {
		d, err := model.NewDocument(src["id"].(string), src)
		if err != nil {
			t.Fatal(err)
		}
		docs = append(docs, *d)
	}

	tree, err := NewKDTree(docs, "location", 1)
	if err != nil {
		t.Fatal(err)
	}

	// Bay Area box.
	got, rejected := tree.Search(Box{MinLat: 36.9, MaxLat: 38.2, MinLon: -123, MaxLon: -121})
	if !reflect.DeepEqual(got, []string{"sf", "sj"}) {
		t.Fatalf("bay area box = %v, want [sf sj]", got)
	}
	if rejected == 0 {
		t.Error("pruning never fired; KD-tree is scanning everything")
	}

	// Boundary points are inclusive on every edge.
	got, _ = tree.Search(Box{MinLat: 40.71, MaxLat: 40.71, MinLon: -74.00, MaxLon: -74.00})
	if !reflect.DeepEqual(got, []string{"nyc"}) {
		t.Fatalf("boundary box = %v, want [nyc]", got)
	}

	// Empty box matches nothing.
	got, _ = tree.Search(Box{MinLat: 0, MaxLat: 1, MinLon: 0, MaxLon: 1})
	if len(got) != 0 {
		t.Fatalf("empty region returned %v", got)
	}
	if tree.NodesVisited() == 0 {
		t.Error("instrumentation should count visited nodes")
	}
}
