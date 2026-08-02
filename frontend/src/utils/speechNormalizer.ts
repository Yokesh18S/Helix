/**
 * Complete speech normalizer with full spoken symbol support.
 *
 * Supports all symbols described in the product spec:
 * at, dot, underscore, dash, plus, slash, exclamation, hash, dollar, star, etc.
 *
 * Exported so emailParser.ts, passwordParser.ts, and the voice hook can all share it.
 */

// ─── Shared symbol vocabulary ─────────────────────────────────────────────────
// Multi-word entries MUST appear before their component single words so the
// longest-match substitution strategy works correctly.
export const SPOKEN_SYMBOL_MAP: Record<string, string> = {
  // ── Multi-word phrases ──────────────────────────────────────────────────────
  'left parenthesis':  '(',
  'right parenthesis': ')',
  'open parenthesis':  '(',
  'close parenthesis': ')',
  'left paren':        '(',
  'right paren':       ')',
  'left bracket':      '[',
  'right bracket':     ']',
  'open bracket':      '[',
  'close bracket':     ']',
  'left brace':        '{',
  'right brace':       '}',
  'open brace':        '{',
  'close brace':       '}',
  'left curly':        '{',
  'right curly':       '}',
  'curly brace':       '{',
  'exclamation mark':  '!',
  'question mark':     '?',
  'number sign':       '#',
  'forward slash':     '/',
  'back slash':        '\\',
  'back tick':         '`',
  'under score':       '_',
  'and sign':          '&',
  'dollar sign':       '$',
  'vertical bar':      '|',
  'double quote':      '"',
  'single quote':      "'",
  // ── Single words ────────────────────────────────────────────────────────────
  'at':          '@',
  'dot':         '.',
  'period':      '.',
  'underscore':  '_',
  'dash':        '-',
  'hyphen':      '-',
  'minus':       '-',
  'plus':        '+',
  'slash':       '/',
  'backslash':   '\\',
  'comma':       ',',
  'colon':       ':',
  'semicolon':   ';',
  'apostrophe':  "'",
  'quote':       '"',
  'exclamation': '!',
  'bang':        '!',
  'hash':        '#',
  'hashtag':     '#',
  'pound':       '#',
  'percent':     '%',
  'caret':       '^',
  'hat':         '^',
  'ampersand':   '&',
  'asterisk':    '*',
  'star':        '*',
  'equal':       '=',
  'equals':      '=',
  'pipe':        '|',
  'tilde':       '~',
  'backtick':    '`',
  'dollar':      '$',
  'question':    '?',
  'space':       ' ',
};

// ─── Number word → digit maps ─────────────────────────────────────────────────
const UNITS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90
};

/**
 * Converts spoken compound number words to digit strings.
 * "twenty three" → "23", "nine" → "9".
 * Operates word-by-word so non-number words pass through unchanged.
 */
export function parseSpokenNumbers(text: string): string {
  const words = text.split(/\s+/);
  const result: string[] = [];
  let i = 0;

  while (i < words.length) {
    const w = words[i].toLowerCase();
    if (TENS[w] !== undefined) {
      const next = words[i + 1]?.toLowerCase();
      if (next && UNITS[next] !== undefined) {
        result.push((TENS[w] + UNITS[next]).toString());
        i += 2;
      } else {
        result.push(TENS[w].toString());
        i++;
      }
    } else if (UNITS[w] !== undefined) {
      result.push(UNITS[w].toString());
      i++;
    } else {
      result.push(words[i]);
      i++;
    }
  }

  return result.join(' ');
}

/**
 * Applies spoken symbol substitutions to text.
 * Multi-word phrases are substituted before their component single words
 * (longest-phrase-first ordering), so "exclamation mark" → "!" before
 * "exclamation" → "!" would double-fire.
 */
export function applySymbolSubstitutions(text: string): string {
  let result = text.toLowerCase();

  // Sort by phrase word-count desc, then length desc → longest match wins
  const entries = Object.entries(SPOKEN_SYMBOL_MAP).sort(([a], [b]) => {
    const wdiff = b.split(' ').length - a.split(' ').length;
    return wdiff !== 0 ? wdiff : b.length - a.length;
  });

  for (const [phrase, symbol] of entries) {
    // Escape any regex special characters inside the phrase itself
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), symbol);
  }

  return result;
}

/**
 * Full normalizer: number words → digits, then spoken symbols → characters.
 * Primarily used for email address parsing.
 */
export function normalizeSpeechText(text: string): string {
  if (!text) return '';
  let normalized = parseSpokenNumbers(text);
  normalized = applySymbolSubstitutions(normalized);
  return normalized;
}
