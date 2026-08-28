# Chapter 01 — Documents, Mappings and Field Types

Every search engine starts with the same question: what is a document? In Seeker a document is just an **id plus whatever JSON the user sent** — and a **mapping** decides how each field becomes searchable.

> Code: `internal/model/document.go`

## The model

```go
// Document is a logical record: an id plus whatever JSON the user sent.
type Document struct {
	ID     string
	Source map[string]any
}
```

We deliberately keep `Source` as raw `map[string]any`. A search engine is a *view* over your data, not its owner — we never force documents into rigid structs.

## Field types decide index structure

```go
const (
	FieldText     FieldType = "text"      // analyzed: tokenized, lowercased, stemmed
	FieldKeyword  FieldType = "keyword"   // verbatim: exact match, filters, aggregations
	FieldNumeric  FieldType = "numeric"   // float64 stored in the point index
	FieldDate     FieldType = "date"      // RFC 3339 date stored as epoch seconds
	FieldGeoPoint FieldType = "geo_point" // {lat, lon} indexed in the KD tree
)
```

This single enum drives the whole engine:

| Type | Indexed by | Queried by |
|------|------------|------------|
| `text` | inverted index (chapters 02–03) | match / phrase / fuzzy |
| `keyword` | inverted index, unanalyzed | term filters |
| `numeric` | point index (chapter 10) | range queries |
| `date` | point index as epoch seconds | range queries |
| `geo_point` | KD tree (chapter 10) | bounding boxes |

The default mapping mirrors the TypeScript edition's corpus:

```go
func DefaultMapping() Mapping {
	return Mapping{
		{Name: "title", Type: FieldText, Positions: true},
		{Name: "body", Type: FieldText, Positions: true},
		{Name: "status", Type: FieldKeyword},
		{Name: "tags", Type: FieldKeyword},
		{Name: "author", Type: FieldKeyword},
		{Name: "price", Type: FieldNumeric},
		{Name: "rating", Type: FieldNumeric},
		{Name: "created_at", Type: FieldDate},
		{Name: "location", Type: FieldGeoPoint},
	}
}
```

`Positions: true` on text fields means we store word offsets — without them phrase queries ("rolling updates") are impossible, only bag-of-words matches.

## Dates are numbers wearing a costume

One of the sneakiest bugs in search engines is treating `"2023-01-15"` as a number (`2023`). The accessor makes dates parse *first*:

```go
// DateValue parses an RFC 3339 date into epoch seconds. "A date is a number
// wearing a costume."
func (d *Document) DateValue(field string) (float64, bool) {
	s, ok := d.Source[field].(string)
	if !ok {
		return d.Number(field)
	}
	for _, layout := range []string{"2006-01-02", time.RFC3339} {
		if ts, err := time.Parse(layout, s); err == nil {
			return float64(ts.Unix()), true
		}
	}
	return 0, false
}
```

Chapter 10 leans on this ordering — `points.NewPointIndex` tries `DateValue` before `Number` for exactly this reason.

## Accessors per type

Each field kind gets one typed accessor: `TextValues` (handles multi-valued keyword fields like tags), `Number`, `DateValue`, `Geo` (accepts `{lat, lon}` objects or GeoJSON `[lon, lat]` arrays). Unknown fields default to `keyword` so nothing is silently unsearchable:

```go
func (m Mapping) Type(field string) FieldType {
	for _, f := range m {
		if f.Name == field {
			return f.Type
		}
	}
	return FieldKeyword
}
```

## Try it

```go
doc, err := model.NewDocument("doc-1", map[string]any{
	"id": "doc-1", "title": "Kubernetes Deployment Guide",
	"price": 149.99, "status": "published",
})
fmt.Println(doc.TextValues("title")) // [Kubernetes Deployment Guide]
fmt.Println(doc.Number("price"))     // 149.99 true
```

Next: chapter 02 turns those raw strings into indexed terms.
