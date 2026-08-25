package analyzer

import (
	"reflect"
	"testing"
)

func TestUnicodeTokenizer(t *testing.T) {
	tok := NewTokenizer()
	tokens := tok.Tokenize("Kubernetes rolling updates, v1.23!")
	var terms []string
	for _, tk := range tokens {
		terms = append(terms, tk.Term)
	}
	want := []string{"Kubernetes", "rolling", "updates", "v1", "23"}
	if !reflect.DeepEqual(terms, want) {
		t.Fatalf("terms = %v, want %v", terms, want)
	}
	for i, tk := range tokens {
		if tk.Position != i {
			t.Errorf("token %q position = %d, want %d", tk.Term, tk.Position, i)
		}
	}
}

func TestUnicodeTokenizerOffsets(t *testing.T) {
	tok := NewTokenizer()
	text := "ab cd"
	tokens := tok.Tokenize(text)
	if len(tokens) != 2 {
		t.Fatalf("got %d tokens, want 2", len(tokens))
	}
	if tokens[0].StartOffset != 0 || tokens[0].EndOffset != 2 {
		t.Errorf("first token offsets = %d..%d, want 0..2", tokens[0].StartOffset, tokens[0].EndOffset)
	}
	if tokens[1].StartOffset != 3 || tokens[1].EndOffset != 5 {
		t.Errorf("second token offsets = %d..%d, want 3..5", tokens[1].StartOffset, tokens[1].EndOffset)
	}
}

func TestStandardAnalyze(t *testing.T) {
	a := Standard()
	got := a.Analyze("The Rolling Updates are running")
	want := []string{"roll", "updat", "run"} // stopwords dropped, stemmed
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestKeywordAnalyze(t *testing.T) {
	a := Keyword()
	got := a.Analyze("In-Stock")
	if !reflect.DeepEqual(got, []string{"In-Stock"}) {
		t.Fatalf("keyword analyzer must keep input verbatim, got %v", got)
	}
}

// TestPorterStemmer walks the classic table from the original paper.
func TestPorterStemmer(t *testing.T) {
	cases := map[string]string{
		"caresses":       "caress",
		"ponies":         "poni",
		"ties":           "ti",
		"caress":         "caress",
		"cats":           "cat",
		"feed":           "feed",
		"agreed":         "agre",
		"plastered":      "plaster",
		"bled":           "bled",
		"motoring":       "motor",
		"sing":           "sing",
		"conflated":      "conflat",
		"troubled":       "troubl",
		"sized":          "size",
		"hopping":        "hop",
		"tanned":         "tan",
		"falling":        "fall",
		"hissing":        "hiss",
		"fizzed":         "fizz",
		"failing":        "fail",
		"filing":         "file",
		"happy":          "happi",
		"sky":            "sky",
		"relational":     "relat",
		"conditional":    "condit",
		"rational":       "ration",
		"valenci":        "valenc",
		"hesitanci":      "hesit",
		"digitizer":      "digit",
		"conformabli":    "conform",
		"radicalli":      "radic",
		"differentli":    "differ",
		"vileli":         "vile",
		"analogousli":    "analog",
		"vietnamization": "vietnam",
		"predication":    "predic",
		"operator":       "oper",
		"feudalism":      "feudal",
		"decisiveness":   "decis",
		"hopefulness":    "hope",
		"callousness":    "callous",
		"formaliti":      "formal",
		"sensitiviti":    "sensit",
		"sensibiliti":    "sensibl",
		"triplicate":     "triplic",
		"formative":      "form",
		"formalize":      "formal",
		"electricity":    "electr",
		"hopeful":        "hope",
		"goodness":       "good",
		"revival":        "reviv",
		"allowance":      "allow",
		"inference":      "infer",
		"airliner":       "airlin",
		"gyroscopic":     "gyroscop",
		"adjustable":     "adjust",
		"defensible":     "defens",
		"irritant":       "irrit",
		"replacement":    "replac",
		"adjustment":     "adjust",
		"dependent":      "depend",
		"adoption":       "adopt",
		"homologou":      "homolog",
		"communism":      "commun",
		"activate":       "activ",
		"angulariti":     "angular",
		"homologous":     "homolog",
		"effective":      "effect",
		"bowdlerize":     "bowdler",
		"probate":        "probat",
		"rate":           "rate",
		"cease":          "ceas",
		"controll":       "control",
		"roll":           "roll",
		"running":        "run",
		"kubernetes":     "kubernet",
	}
	for in, want := range cases {
		if got := Stem(in); got != want {
			t.Errorf("Stem(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestStemmerIdempotent(t *testing.T) {
	for _, w := range []string{"running", "kubernetes", "updates", "cats"} {
		once := Stem(w)
		if twice := Stem(once); twice != once {
			t.Errorf("Stem not idempotent: %q -> %q -> %q", w, once, twice)
		}
	}
}

func TestStopwordFilter(t *testing.T) {
	f := NewStopwordFilter()
	in := []Token{
		{Term: "the"}, {Term: "quick"}, {Term: "and"}, {Term: "brown"},
	}
	got := f.Filter(in)
	if len(got) != 2 || got[0].Term != "quick" || got[1].Term != "brown" {
		t.Fatalf("stopword filter left %v", got)
	}
}
