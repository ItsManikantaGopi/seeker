package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"seeker-go/internal/engine"
)

func newTestServer(t *testing.T) (*httptest.Server, *engine.Engine) {
	t.Helper()
	eng := engine.New()
	srv := httptest.NewServer(NewServer(eng).Handler())
	t.Cleanup(srv.Close)
	return srv, eng
}

func do(t *testing.T, method, url string, body any) map[string]any {
	t.Helper()
	var rd *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, url, rd)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	out := map[string]any{}
	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&out); err != nil {
		t.Fatalf("%s %s: undecodable body: %v", method, url, err)
	}
	return withStatus(out, resp.StatusCode)
}

func withStatus(m map[string]any, code int) map[string]any {
	m["_status"] = code
	return m
}

func TestEndToEndDocumentLifecycle(t *testing.T) {
	ts, _ := newTestServer(t)

	// Bulk index.
	res := do(t, "POST", ts.URL+"/_bulk", []map[string]any{
		{"id": "a", "title": "Golang Concurrency", "body": "goroutines and channels make pipelines easy", "status": "published", "price": 42.0},
		{"id": "b", "title": "Python Scripting", "body": "quick scripts and glue code", "status": "draft", "price": 19.0},
	})
	if res["_status"] != http.StatusOK || res["indexed"].(float64) != 2 {
		t.Fatalf("bulk response = %v", res)
	}

	// Search ranks the goroutine doc.
	res = do(t, "POST", ts.URL+"/_search", map[string]any{
		"query": map[string]any{"match": map[string]any{"body": "goroutines"}},
	})
	hits := res["hits"].([]any)
	if len(hits) == 0 || hits[0].(map[string]any)["_id"] != "a" {
		t.Fatalf("search hits = %v", hits)
	}

	// PUT upserts a new document.
	res = do(t, "PUT", ts.URL+"/docs/c", map[string]any{
		"id": "c", "title": "Rust Ownership", "body": "the borrow checker enforces lifetimes", "status": "published",
	})
	if res["_status"] != http.StatusCreated {
		t.Fatalf("PUT status = %v", res)
	}

	// GET returns it.
	res = do(t, "GET", ts.URL+"/docs/c", nil)
	src := res["_source"].(map[string]any)
	if src["title"] != "Rust Ownership" {
		t.Fatalf("GET docs/c = %v", res)
	}

	// DELETE removes it.
	res = do(t, "DELETE", ts.URL+"/docs/c", nil)
	if res["_status"] != http.StatusOK {
		t.Fatalf("DELETE = %v", res)
	}

	// And it's gone.
	res = do(t, "GET", ts.URL+"/docs/c", nil)
	if res["_status"] != http.StatusNotFound {
		t.Fatalf("GET after delete = %v", res)
	}

	// Search no longer sees it.
	res = do(t, "POST", ts.URL+"/_search", map[string]any{
		"query": map[string]any{"term": map[string]any{"title": "ownership"}},
	})
	if hits := res["hits"].([]any); len(hits) != 0 {
		t.Fatalf("deleted doc still in hits: %v", hits)
	}
}

func TestHealthAndStats(t *testing.T) {
	ts, _ := newTestServer(t)

	res := do(t, "GET", ts.URL+"/healthz", nil)
	if res["status"] != "ok" {
		t.Fatalf("healthz = %v", res)
	}

	before := do(t, "GET", ts.URL+"/_stats", nil)
	do(t, "POST", ts.URL+"/_search", map[string]any{
		"query": map[string]any{"match": map[string]any{"body": "anything"}},
	})
	after := do(t, "GET", ts.URL+"/_stats", nil)
	if before["searches"].(float64) >= after["searches"].(float64) {
		t.Fatalf("stats searches counter did not move: %v -> %v", before["searches"], after["searches"])
	}
}

func TestExplainEndpoint(t *testing.T) {
	ts, _ := newTestServer(t)
	do(t, "POST", ts.URL+"/_bulk", []map[string]any{
		{"id": "x1", "title": "Kubernetes Explained", "body": "control planes reconcile state"},
	})
	res := do(t, "POST", ts.URL+"/_explain", map[string]any{
		"query":  map[string]any{"match": map[string]any{"title": "kubernetes"}},
		"doc_id": "x1",
	})
	if res["_status"] != http.StatusOK {
		t.Fatalf("explain = %v", res)
	}
	if v, ok := res["value"].(float64); !ok || v <= 0 {
		t.Fatalf("explain value missing: %v", res)
	}
}

func TestAnalyzeEndpoint(t *testing.T) {
	ts, _ := newTestServer(t)
	res := do(t, "POST", ts.URL+"/_analyze", map[string]any{
		"field": "title",
		"text":  "The Rolling Updates",
	})
	tokens := toStrs(res["tokens"].([]any))
	want := []string{"roll", "updat"}
	if fmt.Sprint(tokens) != fmt.Sprint(want) {
		t.Fatalf("analyze tokens = %v, want %v", tokens, want)
	}
}

func TestSearchRejectsGarbage(t *testing.T) {
	ts, _ := newTestServer(t)
	resp, err := http.Post(ts.URL+"/_search", "application/json", bytes.NewBufferString(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty body status = %d, want 400", resp.StatusCode)
	}
}

func toStrs(in []any) []string {
	out := make([]string, len(in))
	for i, v := range in {
		out[i] = v.(string)
	}
	return out
}
