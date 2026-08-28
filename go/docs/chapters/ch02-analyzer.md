# Chapter 02 — Analysis: Tokenizer, Filters, Stemmer

Users type `Kubernetes!`; the index stores `kubernet`. Analysis is the bridge, and it is always the same pipeline: **character filters → tokenizer → token filters**.

> Code: `internal/analyzer/analyzer.go`, `internal/analyzer/stemmer.go`

## Tokens vs terms

A *token* is intermediate (raw bytes plus offsets); a *term* is what gets indexed after filtering:

```go
type Token struct {
	Term        string
	StartOffset int
	EndOffset   int
	Position    int
}

type Analyzer struct {
	CharFilters  []CharFilter
	Tokenizer    Tokenizer
	TokenFilters []TokenFilter
}
```

`Position` survives filtering so phrase queries still work even after stopwords are dropped.

## The standard tokenizer

Split on anything that is not a letter or digit — unicode-aware, keeping byte offsets:

```go
for i, r := range runes {
	isWord := unicode.IsLetter(r) || unicode.IsDigit(r)
	if isWord && start < 0 {
		start = i
		byteStart = len(string(runes[:i]))
	}
	if !isWord && start >= 0 {
		tokens = append(tokens, Token{Term: string(runes[start:i]), ...})
		pos++
		start = -1
	}
}
```

`"don't panic"` → tokens `don`, `t`, `panic` — punctuation never hides inside terms.

## Token filters

Three filters make up the standard chain:

1. **LowercaseFilter** — `"Kubernetes"` and `"kubernetes"` must meet at the same term.
2. **StopwordFilter** — drops ~35 high-frequency words (`the`, `of`, …). They carry almost no relevance signal and bloat postings.
3. **PorterStemmer** — the interesting one.

```go
func Standard() *Analyzer {
	return &Analyzer{
		Tokenizer:    NewTokenizer(),
		TokenFilters: []TokenFilter{LowercaseFilter{}, NewStopwordFilter(), NewPorterStemmer()},
	}
}
```

## Porter stemming in ~200 lines

`internal/analyzer/stemmer.go` implements the classic Porter algorithm step by step: plurals (`boxes`→`box`), `-ed`/`-ing` (`deployments`→`deploy`), `y→i`, suffix doubling (`control`→`control`), and the tricky cvc rule (`shared`→`share`, not `shar`).

The golden invariant: **index-time and query-time analysis must run the identical chain**, otherwise `"deployment"` indexes as `deploy` while your query looks up `deployment` and finds nothing. That is why both sides call the same `Standard()` analyzer.

## Keyword: the anti-analyzer

Keyword fields skip all of it — the whole input becomes exactly one term, verbatim:

```go
type wholeTokenizer struct{}

func (wholeTokenizer) Tokenize(text string) []Token {
	if text == "" {
		return nil
	}
	return []Token{{Term: text}}
}
```

This is what makes `{"term": {"status": "published"}}` an exact filter: `"In-Stock"` stays `"In-Stock"`, never lowercased or split.

## See it work

The server exposes analysis directly:

```bash
curl -s localhost:8080/_analyze -d '{"field":"title","text":"Rolling Updates Keep Pods Fresh"}'
# {"tokens":["roll","updat","keep","pod","fresh"], ...}
```

Next: chapter 03 stores these terms where they can be found again — the inverted index.
