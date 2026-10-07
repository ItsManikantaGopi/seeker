package analyzer

import "strings"

// Stem implements the Porter stemming algorithm (Porter, 1980), the same
// algorithm lib/kaus/stemmer.ts uses. It reduces "deployment" to "deploy"
// and "networking" to "network" so morphological variants share postings.
func Stem(word string) string {
	if len(word) <= 2 {
		return word
	}
	w := word
	w = step1a(w)
	w = step1b(w)
	w = step1c(w)
	w = step2(w)
	w = step3(w)
	w = step4(w)
	w = step5a(w)
	w = step5b(w)
	return w
}

// consonant reports whether the rune at index i is a consonant. 'y' counts as
// a consonant only when it does not follow another consonant.
func isConsonant(w string, i int) bool {
	switch w[i] {
	case 'a', 'e', 'i', 'o', 'u':
		return false
	case 'y':
		if i == 0 {
			return true
		}
		return !isConsonant(w, i-1)
	}
	return true
}

// measure counts VC sequences: [C](VC)^m[V].
func measure(w string) int {
	m := 0
	prevVowel := false
	sawVowel := false
	for i := range len(w) {
		cons := isConsonant(w, i)
		if !cons {
			sawVowel = true
			prevVowel = true
			continue
		}
		if prevVowel {
			m++
		}
		prevVowel = false
	}
	_ = sawVowel
	return m
}

func hasVowel(w string) bool {
	for i := range len(w) {
		if !isConsonant(w, i) {
			return true
		}
	}
	return false
}

func endsDoubleConsonant(w string) bool {
	n := len(w)
	if n < 2 {
		return false
	}
	return w[n-1] == w[n-2] && isConsonant(w, n-1)
}

func cvc(w string) bool {
	n := len(w)
	if n < 3 {
		return false
	}
	return isConsonant(w, n-3) && !isConsonant(w, n-2) && isConsonant(w, n-1)
}

func endsWith(w, suffix string) (string, bool) {
	if strings.HasSuffix(w, suffix) {
		return w[:len(w)-len(suffix)], true
	}
	return w, false
}

// replace swaps stem+suffix when the stem's measure satisfies cond.
func applyStep(w, suffix, repl string, cond func(string) bool) string {
	stem, ok := endsWith(w, suffix)
	if ok && cond(stem) {
		return stem + repl
	}
	return w
}

func mAtLeast(stem string, n int) bool { return measure(stem) > n }

func step1a(w string) string {
	if _, ok := endsWith(w, "sses"); ok {
		return applyStep(w, "sses", "ss", func(string) bool { return true })
	}
	if _, ok := endsWith(w, "ies"); ok {
		return applyStep(w, "ies", "i", func(string) bool { return true })
	}
	if _, ok := endsWith(w, "ss"); ok {
		return w // ss stays ss
	}
	if strings.HasSuffix(w, "s") {
		return applyStep(w, "s", "", hasVowel)
	}
	return w
}

func step1b(w string) string {
	if stem, ok := endsWith(w, "eed"); ok {
		if mAtLeast(stem, 0) {
			return stem + "ee"
		}
		return w
	}
	cleaned := ""
	matched := false
	for _, s := range []string{"ed", "ing"} {
		if stem, ok := endsWith(w, s); ok && hasVowel(stem) {
			cleaned = stem
			matched = true
			break
		}
	}
	if !matched {
		return w
	}
	switch {
	case strings.HasSuffix(cleaned, "at"), strings.HasSuffix(cleaned, "bl"), strings.HasSuffix(cleaned, "iz"):
		return cleaned + "e"
	case endsDoubleConsonant(cleaned) && !strings.HasSuffix(cleaned, "l") &&
		!strings.HasSuffix(cleaned, "s") && !strings.HasSuffix(cleaned, "z"):
		return cleaned[:len(cleaned)-1]
	case measure(cleaned) == 1 && cvc(cleaned):
		return cleaned + "e"
	default:
		return cleaned
	}
}

func step1c(w string) string {
	if strings.HasSuffix(w, "y") && len(w) > 2 && hasVowel(w[:len(w)-1]) {
		return w[:len(w)-1] + "i"
	}
	return w
}

var step2Pairs = [][2]string{
	{"ational", "ate"}, {"tional", "tion"}, {"enci", "ence"}, {"anci", "ance"},
	{"izer", "ize"}, {"abli", "able"}, {"alli", "al"}, {"entli", "ent"},
	{"eli", "e"}, {"ousli", "ous"}, {"ization", "ize"}, {"ation", "ate"},
	{"ator", "ate"}, {"alism", "al"}, {"iveness", "ive"}, {"fulness", "ful"},
	{"ousness", "ous"}, {"aliti", "al"}, {"iviti", "ive"}, {"biliti", "ble"},
}

func step2(w string) string {
	for _, p := range step2Pairs {
		if stem, ok := endsWith(w, p[0]); ok && mAtLeast(stem, 0) {
			return stem + p[1]
		}
	}
	return w
}

var step3Pairs = [][2]string{
	{"icate", "ic"}, {"ative", ""}, {"alize", "al"}, {"iciti", "ic"},
	{"ical", "ic"}, {"ful", ""}, {"ness", ""},
}

func step3(w string) string {
	for _, p := range step3Pairs {
		if stem, ok := endsWith(w, p[0]); ok && mAtLeast(stem, 0) {
			return stem + p[1]
		}
	}
	return w
}

var step4Pairs = []string{
	"al", "ance", "ence", "er", "ic", "able", "ible", "ant", "ement",
	"ment", "ent", "ion", "ou", "ism", "ate", "iti", "ous", "ive", "ize",
}

func step4(w string) string {
	for _, s := range step4Pairs {
		if stem, ok := endsWith(w, s); ok && mAtLeast(stem, 1) {
			// ion only counts when preceded by s or t.
			if s == "ion" && len(stem) > 0 {
				last := stem[len(stem)-1]
				if last != 's' && last != 't' {
					continue
				}
			}
			return stem
		}
	}
	return w
}

func step5a(w string) string {
	if strings.HasSuffix(w, "e") {
		stem := w[:len(w)-1]
		if mAtLeast(stem, 1) || (measure(stem) == 1 && !cvc(stem)) {
			return stem
		}
	}
	return w
}

func step5b(w string) string {
	if strings.HasSuffix(w, "ll") && mAtLeast(w[:len(w)-1], 1) {
		return w[:len(w)-1]
	}
	return w
}
