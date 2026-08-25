// Command seekerctl is a thin client for smoke-testing seekerd from the
// command line. It exists so chapter 13's verification can be scripted.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	server := flag.String("server", "http://localhost:8080", "seekerd base URL")
	flag.Parse()
	args := flag.Args()
	if len(args) < 1 {
		usage()
	}
	cmd, rest := args[0], args[1:]
	switch cmd {
	case "search":
		query := strings.Join(rest, " ")
		search(*server, query)
	case "health":
		get(*server + "/healthz")
	case "stats":
		get(*server + "/_stats")
	case "get":
		if len(rest) != 1 {
			usage()
		}
		get(*server + "/docs/" + rest[0])
	case "delete":
		if len(rest) != 1 {
			usage()
		}
		do("DELETE", *server+"/docs/"+rest[0], nil)
	default:
		usage()
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `usage:
  seekerctl health
  seekerctl stats
  seekerctl search [-field:title] kubernetes deployment
  seekerctl get doc-1
  seekerctl delete doc-1`)
	os.Exit(2)
}

func search(server, raw string) {
	field := "title"
	size := 10
	var words []string
	for _, part := range strings.Fields(raw) {
		switch {
		case strings.HasPrefix(part, "-field:"):
			field = strings.TrimPrefix(part, "-field:")
		case strings.HasPrefix(part, "-size:"):
			fmt.Sscanf(strings.TrimPrefix(part, "-size:"), "%d", &size)
		default:
			words = append(words, part)
		}
	}
	body := map[string]any{
		"query": map[string]any{"match": map[string]any{field: strings.Join(words, " ")}},
		"size":  size,
	}
	do("POST", server+"/_search", body)
}

func get(url string) { do("GET", url, nil) }

func do(method, url string, body any) {
	client := &http.Client{Timeout: 10 * time.Second}
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			fatal(err)
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	if err != nil {
		fatal(err)
	}
	defer resp.Body.Close()
	out, err := io.ReadAll(resp.Body)
	if err != nil {
		fatal(err)
	}
	var pretty bytes.Buffer
	if json.Indent(&pretty, out, "", "  ") == nil {
		fmt.Println(pretty.String())
	} else {
		fmt.Println(string(out))
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "seekerctl:", err)
	os.Exit(1)
}
