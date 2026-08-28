// Package analyzer is Chapter 02: character filters, a tokenizer, then token
// filters. A token is intermediate; a term is what gets indexed.
package analyzer

import (
	"strings"
	"unicode"
)

// Token is an intermediate unit: raw bytes plus the offsets they came from.
type Token struct {
	Term        string
	StartOffset int
	EndOffset   int
	Position    int
}

// Analyzer turns raw text into terms. The pipeline is always:
// character filters -> tokenizer -> token filters.
type Analyzer struct {
	CharFilters  []CharFilter
	Tokenizer    Tokenizer
	TokenFilters []TokenFilter
}

// CharFilter rewrites the input string before tokenization.
type CharFilter func(string) string

// Tokenizer splits filtered text into tokens.
type Tokenizer interface {
	Tokenize(text string) []Token
}

// TokenFilter rewrites, drops or normalizes individual tokens.
type TokenFilter interface {
	Filter([]Token) []Token
}

// Analyze runs the full chain and returns final terms.
func (a *Analyzer) Analyze(text string) []string {
	for _, f := range a.CharFilters {
		text = f(text)
	}
	tokens := a.Tokenizer.Tokenize(text)
	for _, f := range a.TokenFilters {
		tokens = f.Filter(tokens)
	}
	out := make([]string, 0, len(tokens))
	for _, t := range tokens {
		out = append(out, t.Term)
	}
	return out
}

// --- tokenizer ---------------------------------------------------------

// unicodeTokenizer splits on anything that is not a letter or digit. It keeps
// byte offsets so positions survive downstream filtering.
type unicodeTokenizer struct{}

// NewTokenizer returns the standard tokenizer.
func NewTokenizer() Tokenizer { return &unicodeTokenizer{} }

func (u *unicodeTokenizer) Tokenize(text string) []Token {
	var tokens []Token
	start := -1 // rune index of the current token's first rune
	runes := []rune(text)
	pos := 0
	byteStart := 0
	for i, r := range runes {
		isWord := unicode.IsLetter(r) || unicode.IsDigit(r)
		if isWord && start < 0 {
			start = i
			byteStart = len(string(runes[:i]))
		}
		if !isWord && start >= 0 {
			tokens = append(tokens, Token{
				Term:        string(runes[start:i]),
				StartOffset: byteStart,
				EndOffset:   len(string(runes[:i])),
				Position:    pos,
			})
			pos++
			start = -1
		}
	}
	if start >= 0 {
		tokens = append(tokens, Token{
			Term:        string(runes[start:]),
			StartOffset: byteStart,
			EndOffset:   len(text),
			Position:    pos,
		})
	}
	return tokens
}

// --- token filters ------------------------------------------------------

// LowercaseFilter normalizes case so "Kubernetes" and "kubernetes" meet.
type LowercaseFilter struct{}

func (LowercaseFilter) Filter(in []Token) []Token {
	for i := range in {
		in[i].Term = strings.ToLower(in[i].Term)
	}
	return in
}

var defaultStopwords = map[string]struct{}{
	"a": {}, "an": {}, "and": {}, "are": {}, "as": {}, "at": {}, "be": {},
	"but": {}, "by": {}, "for": {}, "if": {}, "in": {}, "into": {}, "is": {},
	"it": {}, "no": {}, "not": {}, "of": {}, "on": {}, "or": {}, "such": {},
	"that": {}, "the": {}, "their": {}, "then": {}, "there": {}, "these": {},
	"they": {}, "this": {}, "to": {}, "was": {}, "will": {}, "with": {},
}

// StopwordFilter drops extremely common words. They carry no relevance signal.
type StopwordFilter struct {
	Words map[string]struct{}
}

func NewStopwordFilter() StopwordFilter { return StopwordFilter{Words: defaultStopwords} }

func (f StopwordFilter) Filter(in []Token) []Token {
	out := make([]Token, 0, len(in))
	for _, t := range in {
		if _, stop := f.Words[t.Term]; !stop {
			out = append(out, t)
		}
	}
	return out
}

// PorterStemmer applies the Porter stemming algorithm (chapter 02). Query-time
// and index-time analysis must agree, so both sides run this filter.
type PorterStemmer struct{}

func NewPorterStemmer() PorterStemmer { return PorterStemmer{} }

func (PorterStemmer) Filter(in []Token) []Token {
	for i := range in {
		in[i].Term = Stem(in[i].Term)
	}
	return in
}

// Standard returns the default analyzer used for text fields:
// tokenize -> lowercase -> stopwords -> Porter stem.
func Standard() *Analyzer {
	return &Analyzer{
		Tokenizer:    NewTokenizer(),
		TokenFilters: []TokenFilter{LowercaseFilter{}, NewStopwordFilter(), NewPorterStemmer()},
	}
}

// Keyword returns an analyzer that emits the whole input as one term.
func Keyword() *Analyzer {
	return &Analyzer{Tokenizer: wholeTokenizer{}}
}

type wholeTokenizer struct{}

func (wholeTokenizer) Tokenize(text string) []Token {
	if text == "" {
		return nil
	}
	return []Token{{Term: text}}
}
