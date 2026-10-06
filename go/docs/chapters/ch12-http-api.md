# Chapter 12 — The HTTP API: kausd

Eleven chapters of machinery, one thin JSON veneer. The rule that keeps it clean: **handlers decode, delegate, encode** — no business logic lives here.

> Code: `internal/api/server.go`, `cmd/kausd/main.go`

## The route table

Go 1.22+ pattern routing makes the surface declarative:

```go
mux := http.NewServeMux()
mux.HandleFunc("GET /healthz", s.handleHealth)
mux.HandleFunc("GET /_stats", s.handleStats)
mux.HandleFunc("POST /_search", s.handleSearch)
mux.HandleFunc("POST /_explain", s.handleExplain)
mux.HandleFunc("POST /_analyze", s.handleAnalyze)
mux.HandleFunc("POST /_bulk", s.handleBulk)
mux.HandleFunc("PUT /docs/{id}", s.handlePutDoc)
mux.HandleFunc("GET /docs/{id}", s.handleGetDoc)
mux.HandleFunc("DELETE /docs/{id}", s.handleDeleteDoc)
```

`{id}` + `r.PathValue("id")` replaces hand-rolled path parsing. The full API:

| Endpoint | Purpose |
|---|---|
| `GET /healthz` | liveness + uptime |
| `GET /_stats` | doc/term counts, avg lengths, search counter |
| `POST /_search` | query DSL → ranked hits |
| `POST /_explain` | score decomposition for one doc |
| `POST /_analyze` | run a field's analyzer on text |
| `POST /_bulk` | index a JSON array of docs |
| `PUT/GET/DELETE /docs/{id}` | single-document CRUD |

## Search: raw passthrough to the DSL

```go
type searchBody struct {
	Query json.RawMessage `json:"query"`
	Size  int             `json:"size"`
}
```

The handler keeps the user's query as `json.RawMessage` and hands it straight to `querydsl.Decode`, so error semantics live in exactly one place. Responses share one shape:

```json
{"took_ms": 0, "total": 9, "hits": [{"_id": "doc-4", "_score": 1.87, "_source": {...}}]}
```

Errors are uniform too: `writeErr` emits `{"error": "..."}` with 400 for bad queries, 404 for missing docs.

## Instrumentation without locks

```go
type Server struct {
	Eng       *engine.Engine
	startedAt time.Time
	searches  atomic.Int64
}
```

One atomic counter per server; `_stats` reads it lock-free. Concurrency correctness belongs to `index.Index`'s RWMutex (ch. 03) — many readers scale, writes serialize.

## kausd: flags, signals, snapshot

```go
addr := flag.String("addr", ":8080", "listen address")
dataDir := flag.String("data-dir", "", "optional directory to persist documents as segments")
corpus := flag.String("seed", "", "path to a JSON array of documents to index at boot")
```

Shutdown is the interesting part — SIGINT/SIGTERM trigger a bounded drain:

```go
stop := make(chan os.Signal, 1)
signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
...
<-stop
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()
if err := httpServer.Shutdown(ctx); err != nil { ... }
```

In-flight requests finish (up to 10s), then the deferred snapshot writes every live document into `data-dir/snapshot-<unix>.json` — chapter 11's persistence in its simplest form. Restart with the same `-data-dir` plus `-seed` pointing at the newest snapshot to recover state. Production engines flush continuously instead of at exit; the concept fits in one `defer`.

## Try it

```bash
go run ./cmd/kausd -addr :8080 -seed testdata/corpus.json

curl -s localhost:8080/_search -d '{"query":{"match":{"title":"kubernetes"}},"size":3}'
curl -s localhost:8080/_analyze -d '{"field":"title","text":"Rolling Updates"}'
curl -s localhost:8080/_explain -d '{"query":{"match":{"body":"kubernetes cluster"}},"doc_id":"doc-3"}'
```

Next: the tests that kept all twelve chapters honest.
