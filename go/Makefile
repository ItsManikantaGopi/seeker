BINARY := kausd
ADDR   := :8080
BASE   := localhost:8080
CORPUS := testdata/corpus.json

.PHONY: all build run test vet fmt check smoke docker-build up down

all: check

build:
	go build -o $(BINARY) ./cmd/kausd

run:
	go run ./cmd/kausd -addr $(ADDR) -seed $(CORPUS)

test:
	go test ./...

vet:
	go vet ./...

fmt:
	gofmt -l -w .

check: vet
	@out="$$(gofmt -l .)"; \
	if [ -n "$$out" ]; then echo "gofmt needed:"; echo "$$out"; exit 1; fi
	go test ./...

smoke: ## curl the running server; expects seeded demo corpus
	@echo "== healthz"; curl -sf $(BASE)/healthz; echo
	@echo "== fuzzy kubernets fuzziness 2 (expect doc-4 first, doc-7 present)"
	curl -sf $(BASE)/_search -d '{"query":{"fuzzy":{"title":{"value":"kubernets","fuzziness":2}}}}' | head -c 400; echo
	@echo "== phrase rolling updates (expect doc-1, doc-12)"
	curl -sf $(BASE)/_search -d '{"query":{"phrase":{"body":"rolling updates"}}}' | head -c 400; echo
	@echo "== price range 100..200 (expect 10 hits)"
	curl -sf $(BASE)/_search -d '{"query":{"range":{"price":{"gte":100,"lte":200}}},"size":50}' | head -c 400; echo

docker-build:
	docker build -t kaus-go:latest .

up:
	docker compose up --build -d

down:
	docker compose down -v
