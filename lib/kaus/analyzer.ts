/**
 * The analysis chain (chapter 3).
 *
 *   character filters -> tokenizer -> token filters
 *
 * Every stage returns the full token list, including tokens it removed, so the
 * UI can show you the pipeline as a series of before/after snapshots instead of
 * just handing you the final terms.
 */

import { lightStem, porterStem } from "./stemmer";
import type { Token } from "./types";

export type TokenizerName = "standard" | "whitespace" | "letter" | "keyword" | "path";
export type StemmerName = "none" | "light" | "porter";
export type CharFilterName = "html_strip" | "map_symbols" | "strip_punctuation";

export interface AnalyzerConfig {
  charFilters: CharFilterName[];
  tokenizer: TokenizerName;
  lowercase: boolean;
  asciiFolding: boolean;
  stopwords: boolean;
  stemmer: StemmerName;
  /** Optional edge-ngram filter — the "index-time prefix" trick (chapter 12). */
  edgeNgram: { enabled: boolean; min: number; max: number };
  /** Split on `-` and `_` so `kubernetes-deployment` also yields both words. */
  splitOnDelimiters: boolean;
  minTokenLength: number;
}

export const ENGLISH_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "if", "in",
  "into", "is", "it", "its", "no", "not", "of", "on", "or", "such", "that",
  "the", "their", "then", "there", "these", "they", "this", "to", "was",
  "will", "with", "about", "from", "we", "you", "i",
]);

export const DEFAULT_ANALYZER: AnalyzerConfig = {
  charFilters: [],
  tokenizer: "standard",
  lowercase: true,
  asciiFolding: true,
  stopwords: false,
  stemmer: "none",
  edgeNgram: { enabled: false, min: 2, max: 6 },
  splitOnDelimiters: false,
  minTokenLength: 1,
};

/** What the book calls the "english" analyzer: stopwords + Porter. */
export const ENGLISH_ANALYZER: AnalyzerConfig = {
  ...DEFAULT_ANALYZER,
  stopwords: true,
  stemmer: "porter",
  splitOnDelimiters: true,
};

/** `keyword` fields are not analyzed at all — one exact value (chapter 10). */
export const KEYWORD_ANALYZER: AnalyzerConfig = {
  ...DEFAULT_ANALYZER,
  tokenizer: "keyword",
  lowercase: false,
  asciiFolding: false,
};

export const ANALYZER_PRESETS: Record<string, AnalyzerConfig> = {
  standard: DEFAULT_ANALYZER,
  english: ENGLISH_ANALYZER,
  keyword: KEYWORD_ANALYZER,
  whitespace: { ...DEFAULT_ANALYZER, tokenizer: "whitespace", stemmer: "none" },
  autocomplete: {
    ...DEFAULT_ANALYZER,
    edgeNgram: { enabled: true, min: 2, max: 8 },
    splitOnDelimiters: true,
  },
};

export interface AnalysisStage {
  name: string;
  kind: "char_filter" | "tokenizer" | "token_filter";
  /** Text after this stage — only set for character filters. */
  text?: string;
  tokens: Token[];
  note: string;
  /** True when the stage was configured off; we still list it for teaching. */
  skipped?: boolean;
}

export interface AnalysisResult {
  stages: AnalysisStage[];
  /** The surviving tokens, in position order. */
  tokens: Token[];
  /** Just the term strings — what actually reaches the inverted index. */
  terms: string[];
}

// --------------------------------------------------------------------------
// character filters
// --------------------------------------------------------------------------

function applyCharFilter(name: CharFilterName, text: string): { text: string; note: string } {
  switch (name) {
    case "html_strip":
      return {
        text: text.replace(/<[^>]*>/g, " "),
        note: "Removed HTML tags before tokenizing.",
      };
    case "map_symbols":
      return {
        text: text.replace(/&/g, " and ").replace(/\+\+/g, "plusplus"),
        note: "Mapped `&` to `and` and `++` to `plusplus` so the tokenizer keeps them.",
      };
    case "strip_punctuation":
      return {
        text: text.replace(/[.,;:!?()"']/g, " "),
        note: "Replaced punctuation with spaces.",
      };
  }
}

// --------------------------------------------------------------------------
// tokenizers
// --------------------------------------------------------------------------

function tokenize(name: TokenizerName, text: string): Token[] {
  const tokens: Token[] = [];
  const push = (raw: string, start: number, type: string) => {
    tokens.push({
      text: raw,
      position: tokens.length,
      start,
      end: start + raw.length,
      type,
    });
  };

  switch (name) {
    case "keyword": {
      const trimmed = text.trim();
      if (trimmed.length > 0) push(trimmed, text.indexOf(trimmed), "keyword");
      return tokens;
    }
    case "whitespace": {
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) push(m[0], m.index, "word");
      return tokens;
    }
    case "letter": {
      const re = /\p{L}+/gu;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) push(m[0], m.index, "alpha");
      return tokens;
    }
    case "path": {
      let offset = 0;
      for (const part of text.split("/")) {
        if (part.length > 0) push(part, offset, "path_part");
        offset += part.length + 1;
      }
      return tokens;
    }
    case "standard": {
      // Letters, digits and internal marks that people expect to survive:
      // `c++` is handled by a char filter, `kubernetes-deployment` and
      // `user_123` stay whole here and can be split by a later filter.
      const re = /[\p{L}\p{N}]+(?:[-_.][\p{L}\p{N}]+)*/gu;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        push(m[0], m.index, /^\p{N}+$/u.test(m[0]) ? "num" : "word");
      }
      return tokens;
    }
  }
}

// --------------------------------------------------------------------------
// token filters
// --------------------------------------------------------------------------

const FOLD_MAP: Record<string, string> = {
  á: "a", à: "a", â: "a", ä: "a", ã: "a", å: "a",
  é: "e", è: "e", ê: "e", ë: "e",
  í: "i", ì: "i", î: "i", ï: "i",
  ó: "o", ò: "o", ô: "o", ö: "o", õ: "o",
  ú: "u", ù: "u", û: "u", ü: "u",
  ñ: "n", ç: "c", ß: "ss", ø: "o", æ: "ae", œ: "oe",
};

function foldAscii(text: string): string {
  let out = "";
  for (const ch of text) out += FOLD_MAP[ch] ?? ch;
  return out;
}

/** Renumber positions over surviving tokens, the way a real analyzer does. */
function renumber(tokens: Token[]): Token[] {
  let position = 0;
  return tokens.map((t) => (t.removed ? t : { ...t, position: position++ }));
}

export function analyze(text: string, config: AnalyzerConfig): AnalysisResult {
  const stages: AnalysisStage[] = [];
  let working = text;

  for (const filter of config.charFilters) {
    const { text: next, note } = applyCharFilter(filter, working);
    working = next;
    stages.push({ name: filter, kind: "char_filter", text: working, tokens: [], note });
  }
  if (config.charFilters.length === 0) {
    stages.push({
      name: "no character filters",
      kind: "char_filter",
      text: working,
      tokens: [],
      note: "Raw text goes straight to the tokenizer.",
      skipped: true,
    });
  }

  let tokens = tokenize(config.tokenizer, working);
  stages.push({
    name: `${config.tokenizer} tokenizer`,
    kind: "tokenizer",
    tokens: tokens.map((t) => ({ ...t })),
    note:
      config.tokenizer === "keyword"
        ? "The whole value becomes one token. Nothing is split."
        : `Split the text into ${tokens.length} token(s), each with an offset back into the original string.`,
  });

  if (config.splitOnDelimiters) {
    const next: Token[] = [];
    let changed = false;
    for (const t of tokens) {
      const parts = t.text.split(/[-_.]/).filter((p) => p.length > 0);
      if (parts.length <= 1) {
        next.push(t);
        continue;
      }
      changed = true;
      // Keep the original too: `kubernetes-deployment` matches both the whole
      // token and its parts. This is why term counts can exceed word counts.
      next.push(t);
      let cursor = t.start;
      for (const part of parts) {
        const at = working.indexOf(part, cursor);
        next.push({
          text: part,
          position: t.position,
          start: at < 0 ? t.start : at,
          end: (at < 0 ? t.start : at) + part.length,
          type: "sub_word",
        });
        cursor = (at < 0 ? t.start : at) + part.length;
      }
    }
    tokens = next;
    stages.push({
      name: "word_delimiter",
      kind: "token_filter",
      tokens: tokens.map((t) => ({ ...t })),
      note: changed
        ? "Split tokens on `-`, `_` and `.`, keeping the original token as well."
        : "No token contained a delimiter, so nothing changed.",
      skipped: !changed,
    });
  }

  if (config.lowercase) {
    tokens = tokens.map((t) => ({ ...t, text: t.text.toLowerCase() }));
    stages.push({
      name: "lowercase",
      kind: "token_filter",
      tokens: tokens.map((t) => ({ ...t })),
      note: "Case is normalized so `Kubernetes` and `kubernetes` become the same term.",
    });
  }

  if (config.asciiFolding) {
    const before = tokens.map((t) => t.text).join(" ");
    tokens = tokens.map((t) => ({ ...t, text: foldAscii(t.text) }));
    const changed = before !== tokens.map((t) => t.text).join(" ");
    stages.push({
      name: "asciifolding",
      kind: "token_filter",
      tokens: tokens.map((t) => ({ ...t })),
      note: changed
        ? "Folded accented characters to their ASCII equivalents."
        : "No accented characters present, so nothing changed.",
      skipped: !changed,
    });
  }

  if (config.minTokenLength > 1) {
    let dropped = 0;
    tokens = tokens.map((t) => {
      if (!t.removed && t.text.length < config.minTokenLength) {
        dropped++;
        return { ...t, removed: true };
      }
      return t;
    });
    stages.push({
      name: `length >= ${config.minTokenLength}`,
      kind: "token_filter",
      tokens: renumber(tokens).map((t) => ({ ...t })),
      note: `Dropped ${dropped} token(s) shorter than ${config.minTokenLength} characters.`,
      skipped: dropped === 0,
    });
  }

  if (config.stopwords) {
    let dropped = 0;
    tokens = tokens.map((t) => {
      if (!t.removed && ENGLISH_STOPWORDS.has(t.text)) {
        dropped++;
        return { ...t, removed: true };
      }
      return t;
    });
    tokens = renumber(tokens);
    stages.push({
      name: "stop",
      kind: "token_filter",
      tokens: tokens.map((t) => ({ ...t })),
      note: dropped
        ? `Removed ${dropped} stopword(s). Note the positions get renumbered — this is why stopwords change phrase matching.`
        : "No stopwords in this text.",
      skipped: dropped === 0,
    });
  }

  if (config.stemmer !== "none") {
    const stem = config.stemmer === "porter" ? porterStem : lightStem;
    const changes: string[] = [];
    tokens = tokens.map((t) => {
      if (t.removed) return t;
      const stemmed = stem(t.text);
      if (stemmed !== t.text) changes.push(`${t.text} -> ${stemmed}`);
      return { ...t, text: stemmed };
    });
    stages.push({
      name: `${config.stemmer} stemmer`,
      kind: "token_filter",
      tokens: tokens.map((t) => ({ ...t })),
      note: changes.length
        ? `Rewrote ${changes.length} token(s): ${changes.slice(0, 4).join(", ")}${changes.length > 4 ? ", ..." : ""}`
        : "No token matched a stemming rule.",
      skipped: changes.length === 0,
    });
  }

  if (config.edgeNgram.enabled) {
    const next: Token[] = [];
    for (const t of tokens) {
      if (t.removed) {
        next.push(t);
        continue;
      }
      const max = Math.min(config.edgeNgram.max, t.text.length);
      for (let n = config.edgeNgram.min; n <= max; n++) {
        next.push({ ...t, text: t.text.slice(0, n), type: "edge_ngram" });
      }
      if (t.text.length < config.edgeNgram.min) next.push(t);
    }
    tokens = next;
    stages.push({
      name: `edge_ngram(${config.edgeNgram.min},${config.edgeNgram.max})`,
      kind: "token_filter",
      tokens: tokens.map((t) => ({ ...t })),
      note:
        "Every prefix becomes its own term. Prefix search now costs one term lookup — " +
        "paid for with a much larger index.",
    });
  }

  const surviving = tokens.filter((t) => !t.removed);
  return {
    stages,
    tokens: surviving,
    terms: surviving.map((t) => t.text),
  };
}

/** Convenience: just the terms. Used everywhere in the indexing path. */
export function analyzeToTerms(text: string, config: AnalyzerConfig): string[] {
  return analyze(text, config).terms;
}
