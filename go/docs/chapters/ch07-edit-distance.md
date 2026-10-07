# Chapter 07 — Edit Distance: The DP Oracle

Before any clever automaton, we need ground truth: exactly how many single-character edits turn one word into another?

> Code: `internal/fuzzy/fuzzy.go`

## Levenshtein with a rolling row

The classic dynamic-programming table, compressed to two rows:

```go
for i := 1; i <= len(ar); i++ {
	cur[0] = i
	for j := 1; j <= len(br); j++ {
		cost := 1
		if ar[i-1] == br[j-1] {
			cost = 0
		}
		del := prev[j] + 1      // delete a[i-1]
		ins := cur[j-1] + 1     // insert b[j-1]
		sub := prev[j-1] + cost // substitute
		best := del
		if ins < best { best = ins }
		if sub < best { best = sub }
		cur[j] = best
	}
	prev, cur = cur, prev
}
```

Three candidate costs — delete, insert, substitute — take the minimum at each cell. O(len·len) time, O(len) space. This function is the **oracle**: chapters 08–09 are trusted only insofar as they agree with it.

You can render the whole table to read cell-by-cell (the book's teaching device):

```go
fmt.Print(fuzzy.Table("kitten", "sitting"))
```

## Damerau: transpositions of adjacent characters

Real typos swap neighbors — `hte` for `the`. The restricted Damerau-Levenshtein adds one rule to the recurrence:

```go
if i > 1 && j > 1 && ar[i-1] == br[j-2] && ar[i-2] == br[j-1] {
	if t := d[i-2][j-2] + 1; t < best {
		best = t
	}
}
```

Note the semantics carefully — this variant forbids editing a region after transposing it, which produces honest surprises: `ab→ba` costs 1, but `ca→abc` costs **3**, not 2 (a true Damerau variant would say 2; the restricted one cannot transpose then insert into the same gap). The test suite documents exactly this distinction so future readers don't "fix" correct code.

## Why fuzziness=1 misses `kubernetes→kubernet`

Count the edits: delete `s`, delete `e` — **two deletions**. Intuition says "one typo" because the words look alike, but distance counts operations, not vibes. This is why Kaus's default fuzzy budget is 2, and why the demo corpus's misspelled title needs `fuzziness: 2` to surface. Chapter 13's smoke test encodes this expectation explicitly.

## Testing the oracle itself

Known-value cases cover the axes independently:

- identical strings → 0
- pure insertion, deletion, substitution
- transposition (`ab↔ba`)
- empty-string cases (distance = length)

Once the oracle is pinned, the automaton in chapter 08 gets differential-tested against it: random string pairs, assert `Distance(a,b) <= k ⇔ Automaton(a,k).Matches(b)`.
