# syntax=docker/dockerfile:1
# Multi-stage build: compile a fully static kausd, ship it on a tiny runtime.

FROM golang:1.26-alpine AS build
WORKDIR /src

# No dependencies beyond the standard library, so go.mod alone is enough.
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal

RUN CGO_ENABLED=0 GOOS=linux go build \
      -trimpath \
      -ldflags="-s -w" \
      -o /out/kausd ./cmd/kausd

FROM alpine:3
RUN addgroup -S kaus && adduser -S -G kaus -u 10001 kaus \
    && mkdir -p /data && chown kaus:kaus /data

COPY --from=build /out/kausd /usr/local/bin/kausd
# Demo corpus baked in; override by mounting your own and passing -seed.
COPY testdata/corpus.json /corpus/corpus.json

USER kaus
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=10s --timeout=2s --start-period=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/kausd"]
CMD ["-addr", ":8080", "-seed", "/corpus/corpus.json", "-data-dir", "/data"]
