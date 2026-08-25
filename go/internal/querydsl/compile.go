package querydsl

import (
	"seeker-go/internal/dict"
	"seeker-go/internal/index"
)

// dictFromIndex builds a sorted dictionary from one field's vocabulary. The
// index keeps terms in a map; sorted order is what chapters 09-10 walk.
func dictFromIndex(ix *index.Index, field string) *dict.Dictionary {
	return dict.NewDictionary(ix.Terms(field))
}

// Options re-exports the expansion options so callers stay decoupled.
type Options = dict.ExpansionOptions

// DefaultOptions is the bounded default (max 50 expansions, prefix length 1).
func DefaultOptions() Options { return dict.DefaultExpansion() }
