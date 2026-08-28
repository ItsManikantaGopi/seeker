# Chapter 10 — Points: Numeric Ranges and Spatial Boxes

Inverted indexes answer *"which docs contain this token?"* but are helpless against `price BETWEEN 100 AND 200`. Numeric and geographic fields need different machinery.

> Code: `internal/points/points.go`

## One dimension: sort and binary-search

```go
type PointIndex struct {
	field  string
	values []entry
}

type entry struct {
	value float64
	docID string
}
```

Build sorts once by `(value, docID)`; queries become two boundary finds:

```go
lo := sort.Search(len(p.values), func(i int) bool {
	return !c.HasGTE || p.values[i].value >= c.GTE
})
var out []string
for i := lo; i < len(p.values); i++ {
	v := p.values[i]
	if c.HasLTE && v.value > c.LTE {
		break
	}
	out = append(out, v.docID)
}
```

Scan forward until the upper bound is crossed — everything past it is sorted away. `RangeConstraint`'s `Has*` flags distinguish "unbounded" from "zero", which matters for open-ended queries like `gte: 100`.

## DateValue before Number: an ordering bug worth remembering

```go
// DateValue first: Number() would happily parse "2023" out of the
// date string "2023-01-15", turning timestamps into year numbers.
if ts, ok := d.DateValue(field); ok {
	p.values = append(p.values, entry{value: ts, docID: d.ID})
} else if v, ok := d.Number(field); ok {
	...
}
```

Checked in that order **on purpose**. Flip the branches and every `created_at` range query silently matches only documents from the year 2023 — timestamps collapse into their year prefix. Type coercion order is API surface; the test suite pins it.

## Two dimensions: partition space

A KD-tree splits points along alternating axes (lat at even depths, lon at odd), always at the median, stopping at small leaves:

```go
axis := depth % 2
sort.Slice(pts, func(i, j int) bool {
	if axis == 0 {
		return pts[i].lat < pts[j].lat
	}
	return pts[i].lon < pts[j].lon
})
mid := len(pts) / 2
...
n.bounds = boundsOf(pts)
```

Every node carries its bounding box — the metadata that makes pruning possible.

## Search prunes whole regions

```go
visit = func(n *node) {
	...
	t.nodesSeen++
	if !n.bounds.intersects(box.toBBox()) {
		rejected++ // whole region thrown away without reading its points
		return
	}
	if n.isLeaf {
		for _, p := range n.points {
			if box.toBBox().contains(p) {
				out = append(out, p.docID)
			}
		}
		return
	}
	visit(n.left)
	visit(n.right)
}
```

The bbox test is one rectangle comparison against potentially thousands of points. `Search` returns the rejected-subtree count alongside results so tests (and chapter labs) can *show* the savings: query a corner box over a large tree and watch most subtrees never get visited.

Note the final `sort.Strings(out)` — like chapter 03's postings invariant, results are returned deterministically regardless of tree shape.

Next: making all of this survive a restart — segments, codecs, and merges.
