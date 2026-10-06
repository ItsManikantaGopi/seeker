# Kaus in Go

A from-scratch search engine built as a guided series of chapters — inverted indexes, BM25 ranking, a Levenshtein automaton, numeric/geo point indexes, immutable segments, and an HTTP API. Each chapter page explains the code it ships with, including the bugs found along the way.

## Read the chapters

| Chapter | Topic | Code |
|---|---|---|
| [01](docs/chapters/ch01-documents-and-mappings.md) | Documents, mappings, field types | `internal/model` |
| [02](docs/chapters/ch02-analyzer.md) | Tokenizer, filters, Porter stemmer | `internal/analyzer` |
| [03](docs/chapters/ch03-inverted-index.md) | Inverted index, postings, stats | `internal/index` |
| [04](docs/chapters/ch04-exec-iterator-tree.md) | Iterator tree: AND/OR/NOT/phrase | `internal/exec` |
| [05](docs/chapters/ch05-bm25-scoring.md) | BM25 scoring, top-K, explanations | `internal/search` |
| [06](docs/chapters/ch06-query-dsl.md) | JSON query DSL → execution | `internal/querydsl` |
| [07](docs/chapters/ch07-edit-distance.md) | Edit distance (Levenshtein/Damerau) | `internal/fuzzy` |
| [08](docs/chapters/ch08-fuzzy-automaton.md) | Levenshtein automaton (NFA→DFA) | `internal/fuzzy` |
| [09](docs/chapters/ch09-term-dictionary.md) | Sorted dictionary, trie, bounded expansion | `internal/dict` |
| [10](docs/chapters/ch10-points.md) | Numeric ranges, KD-tree geo boxes | `internal/points` |
| [11](docs/chapters/ch11-segments.md) | Segment codec, tombstones, merge | `internal/segment` |
| [12](docs/chapters/ch12-http-api.md) | HTTP API + kausd | `internal/api`, `cmd/kausd` |
| [13](docs/chapters/ch13-testing.md) | Testing: oracles & differential tests | all `*_test.go` |

## Quickstart

Requires Go 1.22+ (module targets the standard library only — no dependencies).

```bash
# run tests
go test ./...

# start the server seeded with the demo corpus (28 docs)
go run ./cmd/kausd -addr :8080 -seed testdata/corpus.json
```

Then search:

```bash
# full-text match (analyzed + stemmed)
curl -s localhost:8080/_search \
  -d '{"query":{"match":{"title":"kubernetes"}},"size":3}'

# typo tolerance via the Levenshtein automaton
curl -s localhost:8080/_search \
  -d '{"query":{"fuzzy":{"title":{"value":"kubernets","fuzziness":2}}}}'

# boolean composition: filters don't score, must does
curl -s localhost:8080/_search -d '{"query":{"bool":{
  "filter":[{"term":{"status":"published"}}],
  "must":[{"match":{"body":"redis"}}]}}}'

# numeric range over the point index
curl -s localhost:8080/_search \
  -d '{"query":{"range":{"price":{"gte":100,"lte":200}}}}'

# why did doc-3 score that?
curl -s localhost:8080/_explain \
  -d '{"query":{"match":{"body":"kubernetes cluster"}},"doc_id":"doc-3"}'

# inspect the analyzer pipeline
curl -s localhost:8080/_analyze -d '{"field":"title","text":"Rolling Updates"}'
```

### Docker

```bash
docker compose up --build
# server on localhost:8080, seeded with the demo corpus
```

## The query DSL

```jsonc
{"query":
  {"match":   {"title": "kubernetes"}},          // analyzed full-text
//{"term":    {"status": "published"}},           // verbatim keyword lookup
//{"phrase":  {"body": "rolling updates"}},       // ordered, adjacent terms
//{"prefix":  {"title": "kuber"}},
//{"wildcard":{"title": "kuber*"}},
//{"fuzzy":   {"title": {"value":"kubernets","fuzziness":2}}},
//{"range":   {"price": {"gte":100, "lte":200}}},
//{"bool":    {"must":[...], "should":[...], "filter":[...], "must_not":[...]}}
, "size": 10}
```

## Layout

```
cmd/kausd/      the server binary
internal/
  model/          documents, mappings, field types        (ch01)
  analyzer/       tokenizer + filters + Porter stemmer    (ch02)
  index/          inverted index                          (ch03)
  exec/           iterator tree                           (ch04)
  search/         BM25 + top-K + explain                  (ch05)
  querydsl/       JSON DSL → AST → iterators              (ch06)
  fuzzy/          edit distances + automaton              (ch07-08)
  dict/           term dictionary + trie                  (ch09)
  points/         numeric ranges + KD-tree                (ch10)
  segment/        persistence codec                       (ch11)
  api/            HTTP handlers                           (ch12)
  engine/         facade tying it together                (ch12)
testdata/corpus.json   demo corpus exported from the TypeScript edition
docs/chapters/    the book
```

## Quality gate

```bash
go vet ./... && gofmt -l . && go test ./...
```

Chapter 13 explains what the suite guards against — including three real bugs it caught.
