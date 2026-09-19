/**
 * The Hidden words editor's parser: comma- or newline-separated text to the
 * list `PUT /users/settings { hiddenWords: { custom } }` accepts.
 *
 * Mirrors the API's `validateCustomHiddenWords` (services/hiddenWords.js):
 * trim, collapse inner whitespace, 1-40 characters, no control characters,
 * at least one letter, number or emoji, at most 200 entries, de-duplicated on
 * the normalised form (NFKD, diacritics stripped, lower-cased, light
 * leetspeak folded) with the FIRST spelling kept. The server applies the same
 * rules and is the authority: the editor always re-hydrates from the
 * response rather than from its own parse.
 *
 * Import-free so tests can load it straight from source.
 */

export const HIDDEN_WORDS_MAX_CUSTOM = 200;
export const HIDDEN_WORDS_MAX_LENGTH = 40;

const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
const COMBINING_MARKS = /\p{M}+/gu;
const TOKEN_PATTERN = /[\p{L}\p{N}]+|\p{Extended_Pictographic}/gu;
// A leet character counts only where a letter would sit: between two letters
// ("l0ser") or as a leading digit before a word ("5tupid"), as on the server.
const LEET_BETWEEN_LETTERS = /(?<=\p{L})[013457@$!]+(?=\p{L})/gu;
const LEET_LEADING_DIGIT = /(?<![\p{L}\p{N}])[013457]+(?=\p{L}{2})/gu;
const LEET_MAP: Record<string, string> = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };
const foldLeet = (run: string) => run.replace(/./g, (char) => LEET_MAP[char] || char);

/** Case, width, diacritics and light leetspeak folded, then tokenised: the server's de-duplication key. */
export function hiddenWordKey(word: string): string {
  const normalized = word
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(LEET_BETWEEN_LETTERS, foldLeet)
    .replace(LEET_LEADING_DIGIT, foldLeet);
  return [...normalized.matchAll(TOKEN_PATTERN)].map((m) => m[0]).join(' ');
}

export type ParsedHiddenWords = {
  /** The entries that pass, in order, first spelling kept. Usable even when `errors` is non-empty. */
  words: string[];
  /** Exact server messages, first problem first; the editor shows `errors[0]`. */
  errors: string[];
};

/** Split on commas and newlines, then apply the server's per-entry rules. */
export function parseHiddenWords(text: string): ParsedHiddenWords {
  const words: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const push = (message: string) => {
    if (!errors.includes(message)) errors.push(message);
  };
  for (const raw of String(text ?? '').split(/[,\n\r]/)) {
    const word = raw.trim().replace(/\s+/g, ' ');
    if (!word) continue;
    if (word.length > HIDDEN_WORDS_MAX_LENGTH) {
      push(`Each hidden word must be ${HIDDEN_WORDS_MAX_LENGTH} characters or fewer`);
      continue;
    }
    if (CONTROL_CHARS.test(word)) {
      push('Hidden words cannot contain control characters');
      continue;
    }
    const key = hiddenWordKey(word);
    if (!key) {
      push(`"${word}" has no letters, numbers or emoji to match`);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(word);
  }
  if (words.length > HIDDEN_WORDS_MAX_CUSTOM) push(`Hidden words are limited to ${HIDDEN_WORDS_MAX_CUSTOM} entries`);
  return { words, errors };
}

/** One entry per line: what the editor shows for a saved list. */
export const formatHiddenWords = (words: readonly string[] | undefined | null): string => (words ?? []).join('\n');

/** Same list, same order, ignoring the spellings the server would fold together. */
export function sameHiddenWords(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((word, i) => word === b[i]);
}
