# syntax=docker/dockerfile:1
# Multi-stage build: compile a fully static seekerd, ship it on a tiny runtime.

FROM golang:1.26-alpine AS build
WORKDIR /src

# No dependencies beyond the standard library, so go.mod alone is enough.
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal

RUN CGO_ENABLED=0 GOOS=linux go build \
      -trimpath \
      -ldflags="-s -w" \
      -o /out/seekerd ./cmd/seekerd

FROM alpine:3
RUN addgroup -S seeker && adduser -S -G seeker -u 10001 seeker \
    && mkdir -p /data && chown seeker:seeker /data

COPY --from=build /out/seekerd /usr/local/bin/seekerd
# Demo corpus baked in; override by mounting your own and passing -seed.
COPY testdata/corpus.json /corpus/corpus.json

USER seeker
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=10s --timeout=2s --start-period=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/seekerd"]
CMD ["-addr", ":8080", "-seed", "/corpus/corpus.json", "-data-dir", "/data"]
