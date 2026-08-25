# Chapter 06 — The Query DSL: JSON → AST → Iterator Tree

Users send JSON like Elasticsearch's DSL; the compiler turns it into chapter 04's iterator trees plus chapter 05's scoring leaves.

> Code: `internal/querydsl/query.go`, `internal/querydsl/compile.go`

## The AST

Every clause decodes into one type:

```go
type Query struct {
	Kind string // match | term | phrase | prefix | wildcard | fuzzy | range | bool

	Field string
	Value json.RawMessage

	Fuzziness int `json:"-"` // edit budget for fuzzy clauses

	// bool sub-clauses
	Must    []*Query
	Filter  []*Query
	Should  []*Query
	MustNot []*Query

	// noScore marks filter/must_not clauses: they match but never score.
	noScore bool
}
```

Decoding validates exactly-one-clause-per-object up front:

```go
if count != 1 {
	return fmt.Errorf("query object must contain exactly one clause kind, got %d", count)
}
```

Bool sub-clauses accept either one object or an array — `{"must": {...}}` and `{"must": [{...}]}` are both legal, matching ES conventions.

## match analyzes; term does not

The single most important distinction in text retrieval:

```go
an := c.IX.AnalyzerFor(q.Field) // match DOES analyze (book ch. 10-11)
terms := an.Analyze(text)       // "deployments" -> ["deploy"]
```

- `match` runs the full standard chain, so `"deployments"` finds documents containing `"Deployment"` (both stem to `deploy`).
- `term` looks the value up **verbatim**: `term(title, "deployment")` finds *nothing* when only the stemmed form is indexed, while `term(status, "published")` hits exactly — keyword fields are never analyzed.

The test suite pins both behaviors side by side.

## Fuzzy: expansion through the dictionary

```go
k := q.Fuzziness
if k <= 0 {
	k = 2
}
dict := dictFromIndex(c.IX, q.Field)
matches := dict.ExpandFuzzy(val, k, defaultOpts())
return c.expandTerms(matches, q, res, filterOnly)
```

Fuzzy compiles to an **OR over expanded terms** — the automaton (chapter 08) recognizes candidates, the dictionary (chapter 09) supplies them, bounded by `max_expansions`. A fuzzy clause is just a union of ordinary term iterators underneath.

## Bool: composition with scoring rules

```go
build := func(subs []*Query) ([]exec.Iterator, error) {
	var its []exec.Iterator
	for _, sub := range subs {
		subRes := &Result{}
		if err := c.compileInto(sub, subRes, sub.noScore); err != nil {
			return nil, err
		}
		its = append(its, subRes.Root)
		// Scoring leaves bubble up unless the clause is filter/must_not.
		if !sub.noScore {
			res.scorers = append(res.scorers, subRes.scorers...)
		}
	}
	return its, nil
}
```

- `must` / `should` → conjuncts/disjuncts **and** scoring leaves
- `filter` / `must_not` → iterators only, `noScore = true`

That separation is what makes filters cacheable in real engines: they can't change rankings, only membership.

## Range goes to points

```go
constraint := pointsConstraint(bounds.GTE, bounds.LTE, bounds.HasGTE, bounds.HasLTE)
```

Range clauses don't touch the inverted index at all — they query the point index registered per field (chapter 10), and error out cleanly (`field "price" is not point-indexed`) when none exists.

## Decode rejects garbage

`Decode` enforces a non-empty top-level `query`, defaults `size` to 10, and the tests feed it `{}`, `{}`, `match_all`, double-clause bodies to confirm each is rejected with a clear error rather than silently returning everything.

Next: how we know two edits is two edits — edit distances, then the Levenshtein automaton.
