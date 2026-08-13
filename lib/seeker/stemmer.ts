/**
 * Stemmers (chapter 3).
 *
 * `light` is a handful of obvious suffix rules — the kind of thing you write in
 * ten minutes when you first realise "running" and "run" should match. `porter`
 * is the real Porter algorithm, which is what you reach for once the ten-minute
 * version starts producing nonsense.
 *
 * Keeping both is the whole point of the book's method: you can see exactly
 * which words the naive version gets wrong.
 */

const CONSONANT = /[^aeiou]/;

function isConsonant(word: string, i: number): boolean {
  const ch = word[i];
  if (ch === "y") {
    // `y` is a consonant unless preceded by a consonant.
    return i === 0 ? true : !isConsonant(word, i - 1);
  }
  return CONSONANT.test(ch) && "aeiou".indexOf(ch) === -1;
}

/** Porter's `m`: the number of vowel-consonant sequences in the stem. */
function measure(stem: string): number {
  let m = 0;
  let i = 0;
  const n = stem.length;
  // skip a leading consonant run
  while (i < n && isConsonant(stem, i)) i++;
  while (i < n) {
    while (i < n && !isConsonant(stem, i)) i++;
    if (i >= n) break;
    m++;
    while (i < n && isConsonant(stem, i)) i++;
  }
  return m;
}

function containsVowel(stem: string): boolean {
  for (let i = 0; i < stem.length; i++) if (!isConsonant(stem, i)) return true;
  return false;
}

function endsWithDoubleConsonant(stem: string): boolean {
  if (stem.length < 2) return false;
  const a = stem[stem.length - 1];
  const b = stem[stem.length - 2];
  return a === b && isConsonant(stem, stem.length - 1);
}

/** consonant-vowel-consonant where the final consonant is not w, x or y. */
function cvc(stem: string): boolean {
  const n = stem.length;
  if (n < 3) return false;
  if (!isConsonant(stem, n - 1) || isConsonant(stem, n - 2) || !isConsonant(stem, n - 3)) {
    return false;
  }
  return !"wxy".includes(stem[n - 1]);
}

function replaceIf(
  word: string,
  suffix: string,
  replacement: string,
  test: (stem: string) => boolean,
): string | null {
  if (!word.endsWith(suffix)) return null;
  const stem = word.slice(0, word.length - suffix.length);
  if (!test(stem)) return word; // matched the suffix but failed the condition
  return stem + replacement;
}

const STEP2: [string, string][] = [
  ["ational", "ate"], ["tional", "tion"], ["enci", "ence"], ["anci", "ance"],
  ["izer", "ize"], ["bli", "ble"], ["alli", "al"], ["entli", "ent"],
  ["eli", "e"], ["ousli", "ous"], ["ization", "ize"], ["ation", "ate"],
  ["ator", "ate"], ["alism", "al"], ["iveness", "ive"], ["fulness", "ful"],
  ["ousness", "ous"], ["aliti", "al"], ["iviti", "ive"], ["biliti", "ble"],
  ["logi", "log"],
];

const STEP3: [string, string][] = [
  ["icate", "ic"], ["ative", ""], ["alize", "al"], ["iciti", "ic"],
  ["ical", "ic"], ["ful", ""], ["ness", ""],
];

const STEP4: string[] = [
  "al", "ance", "ence", "er", "ic", "able", "ible", "ant", "ement", "ment",
  "ent", "sion", "tion", "ou", "ism", "ate", "iti", "ous", "ive", "ize",
];

/** The classic Porter stemmer. Not perfect English — deliberately mechanical. */
export function porterStem(input: string): string {
  let word = input;
  if (word.length < 3) return word;

  let startsWithY = false;
  if (word[0] === "y") {
    startsWithY = true;
    word = "Y" + word.slice(1);
  }

  // --- Step 1a: plurals -----------------------------------------------------
  if (word.endsWith("sses")) word = word.slice(0, -2);
  else if (word.endsWith("ies")) word = word.slice(0, -2);
  else if (word.endsWith("ss")) {
    /* keep */
  } else if (word.endsWith("s")) word = word.slice(0, -1);

  // --- Step 1b: -eed / -ed / -ing -------------------------------------------
  let step1bApplied = false;
  if (word.endsWith("eed")) {
    if (measure(word.slice(0, -3)) > 0) word = word.slice(0, -1);
  } else if (word.endsWith("ed")) {
    const stem = word.slice(0, -2);
    if (containsVowel(stem)) {
      word = stem;
      step1bApplied = true;
    }
  } else if (word.endsWith("ing")) {
    const stem = word.slice(0, -3);
    if (containsVowel(stem)) {
      word = stem;
      step1bApplied = true;
    }
  }
  if (step1bApplied) {
    if (word.endsWith("at") || word.endsWith("bl") || word.endsWith("iz")) {
      word += "e";
    } else if (endsWithDoubleConsonant(word) && !/[lsz]$/.test(word)) {
      word = word.slice(0, -1);
    } else if (measure(word) === 1 && cvc(word)) {
      word += "e";
    }
  }

  // --- Step 1c: terminal y --------------------------------------------------
  if (word.endsWith("y") && containsVowel(word.slice(0, -1))) {
    word = word.slice(0, -1) + "i";
  }

  // --- Step 2 ---------------------------------------------------------------
  for (const [suffix, replacement] of STEP2) {
    const next = replaceIf(word, suffix, replacement, (s) => measure(s) > 0);
    if (next !== null) {
      word = next;
      break;
    }
  }

  // --- Step 3 ---------------------------------------------------------------
  for (const [suffix, replacement] of STEP3) {
    const next = replaceIf(word, suffix, replacement, (s) => measure(s) > 0);
    if (next !== null) {
      word = next;
      break;
    }
  }

  // --- Step 4 ---------------------------------------------------------------
  for (const suffix of STEP4) {
    if (!word.endsWith(suffix)) continue;
    const stem = word.slice(0, word.length - suffix.length);
    // -sion/-tion only strip after an s or t respectively
    if (suffix === "sion" && !stem.endsWith("s")) continue;
    if (suffix === "tion" && !stem.endsWith("t")) continue;
    if (measure(stem) > 1) word = stem;
    break;
  }

  // --- Step 5a: terminal e --------------------------------------------------
  if (word.endsWith("e")) {
    const stem = word.slice(0, -1);
    const m = measure(stem);
    if (m > 1 || (m === 1 && !cvc(stem))) word = stem;
  }

  // --- Step 5b: double l ----------------------------------------------------
  if (word.endsWith("ll") && measure(word) > 1) word = word.slice(0, -1);

  if (startsWithY) word = "y" + word.slice(1);
  return word;
}

const LIGHT_RULES: [RegExp, string][] = [
  [/ings$/, ""],
  [/ing$/, ""],
  [/ies$/, "y"],
  [/es$/, ""],
  [/s$/, ""],
  [/ed$/, ""],
  [/ly$/, ""],
];

/** The naive stemmer you write first. Fast, cheerful, sometimes wrong. */
export function lightStem(input: string): string {
  if (input.length < 4) return input;
  for (const [pattern, replacement] of LIGHT_RULES) {
    if (pattern.test(input)) {
      const out = input.replace(pattern, replacement);
      // never strip a word down to nothing useful
      if (out.length >= 2) return out;
    }
  }
  return input;
}

/**
 * Cases where the light stemmer and Porter disagree. Chapter 3 says "the exact
 * behavior depends on the analyzer" — this is what that sentence looks like.
 */
export const STEMMER_DISAGREEMENTS = [
  "running",
  "runs",
  "deployment",
  "deployments",
  "deploying",
  "relational",
  "relate",
  "nationalization",
  "happiness",
  "caresses",
  "ponies",
  "agreed",
  "sized",
  "hopping",
  "failing",
  "cluster",
  "clustering",
];
