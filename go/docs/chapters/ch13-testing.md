# Chapter 13 — Testing: Oracles, Differential Tests, and Bugs the Suite Caught

A search engine fails *silently* when wrong: no panic, no stack trace — just documents that should have matched and didn't, ranked one row too low. That makes ordinary unit tests insufficient; this chapter is about the techniques that caught real bugs in this very codebase before they shipped.

> Code: every `*_test.go` in `internal/…`, plus `internal/engine/engine_test.go` for end-to-end coverage

## Technique 1: hand-computed arithmetic

The BM25 tests don't assert "score > 0" — they assert exact values computed by hand from the formula:

```
IDF(10, 1)           = ln(22/3)
Score(2, 1, 4, 6, 3) = ln(10/3) · 44/41
```

If anyone reorders terms in the saturation denominator or flips a sign in IDF, the test names the exact expression that broke. Floating-point comparisons use a tiny epsilon; the *structure* must match to the operation.

## Technique 2: differential tests against an oracle

Chapter 07's DP distance is slow and obviously correct; chapter 08's automaton is fast and subtly complex. So the automaton is tested *against* the DP implementation on randomized string pairs:

```
Distance(a, b) <= k  ⟺  NewAutomaton(a, k).Matches(b)
```

Any disagreement fails with both strings printed. The same philosophy appears elsewhere: iterator-tree results are checked against brute-force scans over all documents; dictionary expansion results are checked against linear filtering. **Write the dumb version once, then trust only agreement.**

## Technique 3: semantic pinning

Some behaviors are conventions, not derivations — so tests encode them as documentation:

- Damerau (restricted) says `ca → abc` is **3**, not 2. A comment in `fuzzy_test.go` explains why, so nobody "fixes" it.
- The stemmer maps `shared → share` (the cvc rule) and `kubernetes → kubernet`.
- `term(title, "deployment")` matches nothing while `match(title, "deployments")` does — analyzed vs verbatim lookup.
- `Decode("{}")`, empty query objects, unknown clause kinds, and double-clause bodies are each rejected with distinct errors.

## The three bugs the suite caught

These were found while making the suite green, and each got a regression test:

**1. Unsorted postings (`internal/index`).** Postings were appended in insertion order, but iterators binary-search assuming lexicographic docID order. Symptom: the demo corpus's fuzzy query returned **4 of 9** known matches — silently. Fix: sort touched postings lists by DocID at the end of `Add`; invariant now asserted in tests.

**2. Wrong successor (`internal/exec`).** `Successor("doc-1")` incremented the last byte, yielding `"doc-2"` — skipping `doc-12` entirely mid-scan. Any query could silently drop hits whose ids share prefixes. Fix: the immediate successor is `s + "\x00"`. The lesson: when your iteration protocol is "advance past X", the definition of "past" deserves its own test.

**3. Parse-before-verify (`internal/segment`).** `Decode` trusted header lengths before checking the CRC, so corrupt counts could walk the parser off the buffer. Fix: verify checksum + footer magic first (ch. 11). Truncated input now produces `ErrChecksum`, never a panic.

Each bug shares a profile: **no crash, plausible-looking partial results**. Only tests grounded in independently-computed expectations can catch that class.

## Grounding expectations with throwaway probes

When writing tests for behavior nobody had pinned yet, temporary programs under a scratch directory called the real APIs and printed actual outputs (`IDF(10,1)`, analyzer chains, distances, hit lists). Those outputs became test constants — expectations grounded in verified reality, not vibes. The probes were deleted afterward; their assertions live on in the suite.

## End-to-end via httptest

`engine_test.go` spins up the full stack — corpus seed → engine → `api.Server.Handler()` inside `httptest` — and exercises the HTTP surface without sockets: health, stats, bulk indexing from `testdata/corpus.json`, CRUD, search shapes, explain trees. Smoke-level expectations mirror what chapter 12's curl commands show:

- `fuzzy(title, kubernetes, fuzziness=2)` → 9 docs, `doc-4` first, misspelled `doc-7` included (fuzziness=1 finds none — two deletions, remember ch. 07)
- `phrase(body, "rolling updates")` → `[doc-1, doc-12]`
- `bool(filter: status=published, must: cached=true)` → `{doc-2, doc-5, doc-10}`
- deleting `doc-5` shrinks the redis match result from 2 docs to 1

Run everything with:

```bash
go vet ./... && gofmt -l . && go test ./...
```

That's the whole quality gate — and after thirteen chapters, it's green.
