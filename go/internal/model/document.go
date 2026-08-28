// Package engine defines the document model: documents, fields and the
// mapping that decides how every value becomes searchable.
//
// Chapter 01 of the Go edition. A field's type decides its index structure:
// text fields are analyzed into terms, keyword fields are kept whole, numeric
// and date fields go to a point index, geo_point goes to the KD tree.
package model

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

// FieldType enumerates the kinds of values Seeker knows how to index.
type FieldType string

const (
	FieldText     FieldType = "text"      // analyzed: tokenized, lowercased, stemmed
	FieldKeyword  FieldType = "keyword"   // verbatim: exact match, filters, aggregations
	FieldNumeric  FieldType = "numeric"   // float64 stored in the point index
	FieldDate     FieldType = "date"      // RFC 3339 date stored as epoch seconds
	FieldGeoPoint FieldType = "geo_point" // {lat, lon} indexed in the KD tree
)

// FieldMapping describes one field: its type and whether positions are kept.
type FieldMapping struct {
	Name      string    `json:"name"`
	Type      FieldType `json:"type"`
	Positions bool      `json:"positions,omitempty"` // store word offsets (phrase queries)
}

// Mapping is an ordered set of field mappings.
type Mapping []FieldMapping

// Type returns the mapping for one field name; unknown fields default to
// keyword so that nothing is silently unsearchable.
func (m Mapping) Type(field string) FieldType {
	for _, f := range m {
		if f.Name == field {
			return f.Type
		}
	}
	return FieldKeyword
}

// DefaultMapping mirrors lib/seeker/corpus.ts MAPPING: two analyzed text
// fields, keyword identity fields, numerics, a date and coordinates.
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

// Document is a logical record: an id plus whatever JSON the user sent.
type Document struct {
	ID     string
	Source map[string]any
}

// NewDocument validates source against the mapping and returns a Document.
func NewDocument(id string, source map[string]any) (*Document, error) {
	if strings.TrimSpace(id) == "" {
		return nil, fmt.Errorf("document id must not be empty")
	}
	if source == nil {
		return nil, fmt.Errorf("document %q has no source", id)
	}
	return &Document{ID: id, Source: source}, nil
}

// GeoPoint is a latitude/longitude pair.
type GeoPoint struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

// TextValues returns the raw strings of one field. Multi-valued keyword
// fields (like tags) yield every value; each becomes its own term.
func (d *Document) TextValues(field string) ([]string, bool) {
	v, ok := d.Source[field]
	if !ok || v == nil {
		return nil, false
	}
	switch t := v.(type) {
	case string:
		return []string{t}, true
	case []any:
		var out []string
		for _, e := range t {
			if s, ok := e.(string); ok {
				out = append(out, s)
			}
		}
		return out, true
	default:
		return nil, false
	}
}

// Number returns a single float64 value for numeric/date fields.
func (d *Document) Number(field string) (float64, bool) {
	v, ok := d.Source[field]
	if !ok || v == nil {
		return 0, false
	}
	switch t := v.(type) {
	case float64:
		return t, true
	case int:
		return float64(t), true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	case string:
		// Dates arrive as strings; the caller decides their semantics,
		// but a bare numeric string still parses.
		var f float64
		if _, err := fmt.Sscanf(t, "%g", &f); err == nil {
			return f, true
		}
	}
	return 0, false
}

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

// Geo returns the point for a geo_point field.
func (d *Document) Geo(field string) (GeoPoint, bool) {
	v, ok := d.Source[field]
	if !ok {
		return GeoPoint{}, false
	}
	switch t := v.(type) {
	case map[string]any:
		lat, lok := t["lat"].(float64)
		lon, ook := t["lon"].(float64)
		if lok && ook {
			return GeoPoint{Lat: lat, Lon: lon}, true
		}
	case []any:
		if len(t) == 2 {
			lon, _ := t[0].(float64) // [lon, lat], GeoJSON order
			lat, _ := t[1].(float64)
			if lon != 0 || lat != 0 {
				return GeoPoint{Lat: lat, Lon: lon}, true
			}
		}
	}
	return GeoPoint{}, false
}

// Fields lists the mapped field names in mapping order.
func (m Mapping) Fields() []string {
	out := make([]string, 0, len(m))
	for _, f := range m {
		out = append(out, f.Name)
	}
	sort.Strings(out)
	return out
}
