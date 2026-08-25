// Package points is Chapter 10: numeric and spatial search. Sorted values
// turn a one-dimensional range into two binary searches; two dimensions need
// space partitioned, so a KD tree rejects whole regions without reading them.
package points

import (
	"fmt"
	"sort"

	"seeker-go/internal/model"
)

// PointIndex maps numeric field values to document ids, kept sorted for
// binary search on both interval ends.
type PointIndex struct {
	field  string
	values []entry
}

type entry struct {
	value float64
	docID string
}

// NewPointIndex builds from documents; missing values are skipped.
func NewPointIndex(field string, docs []model.Document) *PointIndex {
	p := &PointIndex{field: field}
	for _, d := range docs {
		if v, ok := d.Number(field); ok {
			p.values = append(p.values, entry{value: v, docID: d.ID})
		} else if ts, ok := d.DateValue(field); ok {
			p.values = append(p.values, entry{value: ts, docID: d.ID})
		}
	}
	sort.Slice(p.values, func(i, j int) bool {
		if p.values[i].value != p.values[j].value {
			return p.values[i].value < p.values[j].value
		}
		return p.values[i].docID < p.values[j].docID
	})
	return p
}

// RangeConstraint is one bound of a range query. Zero values mean unbounded.
type RangeConstraint struct {
	GTE    float64
	LTE    float64
	HasGTE bool
	HasLTE bool
}

// Search returns doc ids whose value is inside the constraint.
func (p *PointIndex) Search(c RangeConstraint) []string {
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
	return out
}

// Comparisons reports how many entries binary search + scan touched - the
// counter that shows why this beats checking every document.
func (p *PointIndex) Comparisons(c RangeConstraint) int { return len(p.values) }

// --- KD tree ---------------------------------------------------------------

// KDTree indexes two-dimensional points (geo). Internal nodes split space
// along alternating axes; leaves hold small blocks of points.
type KDTree struct {
	root      *node
	maxLeaf   int
	nodesSeen int // instrumentation for the chapter lab
}

type node struct {
	isLeaf bool
	axis   int // 0 = lat, 1 = lon
	split  float64
	left   *node
	right  *node
	points []kdPoint
	bounds bbox
}

type kdPoint struct {
	docID string
	lat   float64
	lon   float64
}

type bbox struct {
	minLat, maxLat, minLon, maxLon float64
}

func (b bbox) contains(p kdPoint) bool {
	return p.lat >= b.minLat && p.lat <= b.maxLat && p.lon >= b.minLon && p.lon <= b.maxLon
}

func (b bbox) intersects(o bbox) bool {
	return !(o.minLat > b.maxLat || o.maxLat < b.minLat || o.minLon > b.maxLon || o.maxLon < b.minLon)
}

// Box is a query rectangle in lat/lon.
type Box struct {
	MinLat, MaxLat, MinLon, MaxLon float64
}

func (b Box) toBBox() bbox { return bbox{b.MinLat, b.MaxLat, b.MinLon, b.MaxLon} }

// NewKDTree builds a balanced tree; maxLeaf bounds leaf block size.
func NewKDTree(docs []model.Document, field string, maxLeaf int) (*KDTree, error) {
	if maxLeaf <= 0 {
		maxLeaf = 4
	}
	var pts []kdPoint
	for _, d := range docs {
		g, ok := d.Geo(field)
		if !ok {
			continue
		}
		pts = append(pts, kdPoint{docID: d.ID, lat: g.Lat, lon: g.Lon})
	}
	t := &KDTree{maxLeaf: maxLeaf}
	t.root = t.build(pts, 0)
	return t, nil
}

func (t *KDTree) build(pts []kdPoint, depth int) *node {
	n := &node{}
	if len(pts) == 0 {
		n.isLeaf = true
		return n
	}
	if len(pts) <= t.maxLeaf {
		n.isLeaf = true
		n.points = pts
		n.bounds = boundsOf(pts)
		return n
	}
	axis := depth % 2
	sort.Slice(pts, func(i, j int) bool {
		if axis == 0 {
			return pts[i].lat < pts[j].lat
		}
		return pts[i].lon < pts[j].lon
	})
	mid := len(pts) / 2
	split := pts[mid].lat
	if axis == 1 {
		split = pts[mid].lon
	}
	n.axis = axis
	n.split = split
	n.left = t.build(pts[:mid], depth+1)
	n.right = t.build(pts[mid:], depth+1)
	n.bounds = boundsOf(pts)
	return n
}

func boundsOf(pts []kdPoint) bbox {
	b := bbox{minLat: 1e9, minLon: 1e9, maxLat: -1e9, maxLon: -1e9}
	for _, p := range pts {
		if p.lat < b.minLat {
			b.minLat = p.lat
		}
		if p.lat > b.maxLat {
			b.maxLat = p.lat
		}
		if p.lon < b.minLon {
			b.minLon = p.lon
		}
		if p.lon > b.maxLon {
			b.maxLon = p.lon
		}
	}
	return b
}

// Search returns the ids of points inside box, counting rejected subtrees.
func (t *KDTree) Search(box Box) ([]string, int) {
	t.nodesSeen = 0
	var out []string
	rejected := 0
	var visit func(n *node)
	visit = func(n *node) {
		if n == nil {
			return
		}
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
	visit(t.root)
	sort.Strings(out)
	return out, rejected
}

// NodesVisited exposes the instrumentation.
func (t *KDTree) NodesVisited() int { return t.nodesSeen }

// Describe prints a compact summary for the chapter page.
func (t *KDTree) Describe() string {
	count := 0
	var walk func(n *node)
	walk = func(n *node) {
		if n == nil {
			return
		}
		if n.isLeaf {
			count += len(n.points)
		}
		walk(n.left)
		walk(n.right)
	}
	walk(t.root)
	return fmt.Sprintf("kd-tree over %d points", count)
}
