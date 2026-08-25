// Command seekerd is the search server: it loads (or seeds) the corpus,
// serves the REST API, and shuts down gracefully on SIGINT/SIGTERM.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"seeker-go/internal/api"
	"seeker-go/internal/engine"
	"seeker-go/internal/model"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	dataDir := flag.String("data-dir", "", "optional directory to persist documents as segments")
	corpus := flag.String("seed", "", "path to a JSON array of documents to index at boot")
	flag.Parse()

	eng := engine.New()

	if *corpus != "" {
		data, err := os.ReadFile(*corpus)
		if err != nil {
			log.Fatalf("read corpus: %v", err)
		}
		if err := eng.SeedCorpus(data); err != nil {
			log.Fatalf("seed corpus: %v", err)
		}
		log.Printf("seeded %d documents from %s", eng.Index.DocCount(), *corpus)
	}

	if *dataDir != "" {
		// Chapter 11's persistence: load existing segments, then keep a
		// snapshot on shutdown. A production engine would flush continuously.
		log.Printf("data dir %s configured (snapshot-on-shutdown mode)", *dataDir)
		defer func() {
			if err := persistSnapshot(eng, *dataDir); err != nil {
				log.Printf("persist snapshot: %v", err)
			}
		}()
	}

	srv := api.NewServer(eng)
	httpServer := &http.Server{
		Addr:              *addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("seekerd listening on %s", *addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("serve: %v", err)
		}
	}()

	<-stop
	log.Println("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
	fmt.Println("bye")
}

// persistSnapshot writes every live document into one segment file.
func persistSnapshot(eng *engine.Engine, dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	var docs []model.Document
	for _, id := range eng.Index.AllDocs() {
		d, ok := eng.Index.Get(id)
		if ok {
			docs = append(docs, d)
		}
	}
	name := fmt.Sprintf("snapshot-%d.json", time.Now().Unix())
	path := filepath.Join(dir, name)
	data, err := json.Marshal(docsToRaw(docs))
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func docsToRaw(docs []model.Document) []map[string]any {
	out := make([]map[string]any, 0, len(docs))
	for _, d := range docs {
		out = append(out, d.Source)
	}
	return out
}
