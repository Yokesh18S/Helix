import { SPOKEN_SYMBOL_MAP } from './speechNormalizer';

/**
 * Spoken number words → single digit strings (for passwords).
 * Unlike the email normalizer, we do NOT combine tens+units
 * ("twenty three" stays "2" then "3" separately) because
 * in a password "twenty three" most likely means the characters
 * "2" followed by "3", not the number 23.
 */
const PWD_DIGIT_MAP: Record<string, string> = {
  zero: '0', oh: '0',
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9',
  // Teens and tens — kept as full numbers
  ten: '10', eleven: '11', twelve: '12', thirteen: '13',
  fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17',
  eighteen: '18', nineteen: '19',
  twenty: '20', thirty: '30', forty: '40', fifty: '50',
  sixty: '60', seventy: '70', eighty: '80', ninety: '90',
  hundred: '100',
};

/**
 * Symbol entries sorted by phrase-word-count desc then length desc.
 * Ensures multi-word phrases like "exclamation mark" are tried before
 * the single word "exclamation".
 */
const SYMBOL_ENTRIES = Object.entries(SPOKEN_SYMBOL_MAP).sort(([a], [b]) => {
  const wa = a.split(' ').length;
  const wb = b.split(' ').length;
  return wb !== wa ? wb - wa : b.length - a.length;
});

/**
 * Attempts to match a symbol phrase starting at position `start` in `words`.
 * Returns the symbol character and the number of words consumed, or null.
 */
function lookupSymbol(
  words: string[],
  start: number
): { symbol: string; consumed: number } | null {
  for (const [phrase, symbol] of SYMBOL_ENTRIES) {
    const phraseWords = phrase.split(' ');
    const len = phraseWords.length;
    if (start + len > words.length) continue;
    const slice = words
      .slice(start, start + len)
      .map((w) => w.toLowerCase())
      .join(' ');
    if (slice === phrase) return { symbol, consumed: len };
  }
  return null;
}

/**
 * Parses a spoken password into its actual character sequence.
 *
 * Supported constructs:
 *  - "capital X" / "uppercase X"  → X  (uppercase letter)
 *  - "lowercase X"                → x  (lowercase letter, explicit)
 *  - Spoken symbol words          → character (at→@, exclamation→!, dollar→$, star→*, hash→#, …)
 *  - Number words                 → digits  (one→1, twenty→20, …)
 *  - Raw digits in transcript     → kept as-is
 *  - Single letter words          → kept as-is (preserving original case)
 *  - Unknown multi-char words     → appended as-is (e.g. "pass" → "pass")
 *
 * Examples:
 *   "capital P a s s at one two three exclamation"  → "Pass@123!"
 *   "Pass at one two three exclamation"             → "Pass@123!"
 *   "capital M y password dollar sign one"          → "Mypassword$1"
 *   "underscore secret hash"                        → "_secret#"
 */
export function parseSpokenPassword(text: string): string {
  if (!text) return '';

  const originalWords = text.trim().split(/\s+/);
  const words = originalWords.map((w) => w.toLowerCase());
  let result = '';
  let i = 0;

  while (i < words.length) {
    const word = words[i];
    const next = words[i + 1];

    // ── "capital / uppercase / upper  X" → uppercase ─────────────────────────
    if ((word === 'capital' || word === 'uppercase' || word === 'upper') && next) {
      // First check if the next word(s) are a symbol phrase
      const sym = lookupSymbol(words, i + 1);
      if (sym) {
        result += sym.symbol.toUpperCase();
        i += 1 + sym.consumed;
        continue;
      }
      // Otherwise treat next token as a letter/word to uppercase
      result += originalWords[i + 1].toUpperCase();
      i += 2;
      continue;
    }

    // ── "lowercase / lower  X" → lowercase ───────────────────────────────────
    if ((word === 'lowercase' || word === 'lower') && next) {
      result += originalWords[i + 1].toLowerCase();
      i += 2;
      continue;
    }

    // ── Multi- or single-word symbol ─────────────────────────────────────────
    const sym = lookupSymbol(words, i);
    if (sym) {
      result += sym.symbol;
      i += sym.consumed;
      continue;
    }

    // ── Number word → digit(s) ────────────────────────────────────────────────
    if (PWD_DIGIT_MAP[word] !== undefined) {
      result += PWD_DIGIT_MAP[word];
      i++;
      continue;
    }

    // ── Raw digit string ──────────────────────────────────────────────────────
    if (/^\d+$/.test(word)) {
      result += word;
      i++;
      continue;
    }

    // ── Single letter (a–z) → preserve original case from ASR ────────────────
    if (/^[a-zA-Z]$/.test(originalWords[i])) {
      result += originalWords[i];
      i++;
      continue;
    }

    // ── Unknown multi-character word → append original (e.g. "pass") ─────────
    result += originalWords[i];
    i++;
  }

  return result;
}
