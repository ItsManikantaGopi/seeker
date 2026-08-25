package dict

import (
	"errors"
	"reflect"
	"testing"
)

func testDict() *Dictionary {
	return NewDictionary([]string{
		"kubernet", "kubernetes", "kubernetesk", "docker", "dockerize",
		"rolling", "runs", "run", "zebra", "apple",
	})
}

func TestDictionaryHasAndRange(t *testing.T) {
	d := testDict()
	if !d.Has("kubernetes") || d.Has("missing") {
		t.Fatal("Has membership wrong")
	}
	got := d.Range("d", "f")
	want := []string{"docker", "dockerize"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Range = %v, want %v", got, want)
	}
	// Duplicates collapse at construction.
	if got := NewDictionary([]string{"a", "a", "b"}).Len(); got != 2 {
		t.Errorf("dedup failed: %d entries", got)
	}
}

func TestTrieWalkPrefix(t *testing.T) {
	tr := NewTrie()
	for _, w := range []string{"dock", "docker", "dockerize", "dot"} {
		tr.Insert(w)
	}
	var got []string
	tr.WalkPrefix("dock", func(term string) { got = append(got, term) })
	want := []string{"dock", "docker", "dockerize"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("walk = %v, want %v (sorted order)", got, want)
	}
	// Shared prefixes must be stored once.
	small := NewTrie()
	small.Insert("aaaa")
	small.Insert("aaab")
	if small.NodeCount() != 6 { // root + a,a,a + b,b
		t.Errorf("NodeCount = %d, want 6", small.NodeCount())
	}
}

func TestExpandPrefixBounded(t *testing.T) {
	d := testDict()
	opts := ExpansionOptions{MaxExpansions: 1, PrefixLength: 1}
	if got := d.ExpandPrefix("kube", opts); !reflect.DeepEqual(got, []string{"kubernet"}) {
		t.Fatalf("bounded expand = %v", got)
	}
	opts.MaxExpansions = 50
	got := d.ExpandPrefix("kube", opts)
	want := []string{"kubernet", "kubernetes", "kubernetesk"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expand = %v, want %v", got, want)
	}
}

func TestExpandWildcard(t *testing.T) {
	d := testDict()
	opts := DefaultExpansion()

	got, err := d.ExpandWildcard("docker*", opts)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"docker", "dockerize"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("docker* = %v, want %v", got, want)
	}

	got, _ = d.ExpandWildcard("ru?", opts)
	if want := []string{"run"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("ru? = %v, want %v", got, want)
	}

	got, _ = d.ExpandWildcard("*net*", opts)
	if len(got) == 0 || got[0] != "kubernet" {
		t.Fatalf("*net* = %v", got)
	}

	if _, err := d.ExpandWildcard(string(make([]byte, 200))+"*", opts); !errors.Is(err, ErrPatternTooLong) {
		t.Fatalf("long pattern error = %v", err)
	}
}

func TestExpandFuzzyMatchesAutomatonSemantics(t *testing.T) {
	d := testDict()
	got := d.ExpandFuzzy("kubernets", 1, DefaultExpansion())
	want := []string{"kubernet", "kubernetes"} // both within 1 edit
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("fuzzy(kubernets,1) = %v, want %v", got, want)
	}
	// PrefixLength=1 means terms not starting with 'k' are never candidates.
	got = d.ExpandFuzzy("docker", 2, DefaultExpansion())
	if !reflect.DeepEqual(got, []string{"docker"}) {
		t.Fatalf("fuzzy(docker,2) = %v, want [docker]", got)
	}
}
