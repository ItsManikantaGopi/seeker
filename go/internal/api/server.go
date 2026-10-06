// Package api is Chapter 12: the HTTP server. Handlers stay thin - decode,
// delegate to model.Engine, encode. Concurrency safety lives in index.Index's
// RWMutex, so many readers scale while writes serialize.
package api

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"kaus-go/internal/engine"
	"kaus-go/internal/model"
	"kaus-go/internal/querydsl"
)

// Server is the HTTP face of one engine node.
type Server struct {
	Eng       *engine.Engine
	startedAt time.Time
	searches  atomic.Int64
}

// NewServer builds the handler set.
func NewServer(eng *engine.Engine) *Server {
	return &Server{Eng: eng, startedAt: time.Now()}
}

// Handler returns the routed http.Handler.
func (s *Server) Handler() http.Handler {
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
	return mux
}

// ListenAndServe starts the server; graceful shutdown is the caller's job.
func (s *Server) ListenAndServe(addr string) error {
	srv := &http.Server{Addr: addr, Handler: s.Handler(), ReadHeaderTimeout: 5 * time.Second}
	log.Printf("kausd listening on %s", addr)
	return srv.ListenAndServe()
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("encode response: %v", err)
	}
}

func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

// --- handlers --------------------------------------------------------------

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"uptime": time.Since(s.startedAt).String(),
	})
}

func (s *Server) handleStats(w http.ResponseWriter, _ *http.Request) {
	stats := s.Eng.Index.Stats()
	writeJSON(w, http.StatusOK, map[string]any{
		"documents": stats.Documents,
		"terms":     stats.Fields,
		"avg_len":   stats.AvgLens,
		"searches":  s.searches.Load(),
	})
}

type searchBody struct {
	Query json.RawMessage `json:"query"`
	Size  int             `json:"size"`
}

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	var body searchBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	req, err := querydsl.Decode([]byte(`{"query":` + string(body.Query) + `,"size":` + strconv.Itoa(body.Size) + `}`))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	resp, err := s.Eng.Search(req)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	s.searches.Add(1)
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleExplain(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Query json.RawMessage `json:"query"`
		DocID string          `json:"doc_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	req, err := querydsl.Decode([]byte(`{"query":` + string(body.Query) + `}`))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	exp, err := s.Eng.Explain(req, body.DocID)
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, exp)
}

func (s *Server) handleAnalyze(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Field string `json:"field"`
		Text  string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	tokens := s.Eng.Analyze(body.Field, body.Text)
	writeJSON(w, http.StatusOK, map[string]any{
		"field":    body.Field,
		"analyzer": s.Eng.DefaultAnalyzerName(body.Field),
		"tokens":   tokens,
	})
}

func (s *Server) handleBulk(w http.ResponseWriter, r *http.Request) {
	var raw []map[string]any
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	docs := make([]model.Document, 0, len(raw))
	for _, src := range raw {
		id, _ := src["id"].(string)
		doc, err := model.NewDocument(id, src)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		docs = append(docs, *doc)
	}
	if err := s.Eng.Bulk(docs); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"indexed": len(docs)})
}

func (s *Server) handlePutDoc(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var src map[string]any
	if err := json.NewDecoder(r.Body).Decode(&src); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	doc, err := model.NewDocument(id, src)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := s.Eng.Add(*doc); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	status := http.StatusCreated
	writeJSON(w, status, map[string]string{"result": "created"})
}

func (s *Server) handleGetDoc(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	src, err := s.Eng.Index.Source(id)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeErr(w, http.StatusNotFound, errors.New("document not found"))
			return
		}
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"_id": id, "_source": src})
}

func (s *Server) handleDeleteDoc(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if s.Eng.Delete(id) {
		writeJSON(w, http.StatusOK, map[string]string{"result": "deleted"})
		return
	}
	writeErr(w, http.StatusNotFound, errors.New("document not found"))
}
