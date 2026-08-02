import { normalizeSpeechText } from './speechNormalizer';

/**
 * Validates that a string looks like a well-formed email address.
 */
export function isValidEmail(email: string): boolean {
  // Must have exactly one @, a domain, and a TLD of at least 2 chars
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/**
 * Converts a spoken email transcript into a formatted email address.
 *
 * Rules:
 *  1. Apply full symbol normalizer (at → @, dot → ., underscore → _, dash → -, etc.)
 *  2. Apply spoken number words → digits (e.g. "john twenty three" → "john23")
 *  3. Collapse all whitespace.
 *  4. If the result does NOT contain "@" (user only spoke a username),
 *     return '' — the caller must prompt the user to say the full address.
 *     We NEVER silently append a default domain like @gmail.com.
 *
 * Examples:
 *   "john dot smith at gmail dot com"  → "john.smith@gmail.com"
 *   "john underscore smith at yahoo dot com" → "john_smith@yahoo.com"
 *   "john at company dot co dot in"    → "john@company.co.in"
 *   "john dash dev at proton dot me"   → "john-dev@proton.me"
 *   "john twenty three at gmail dot com" → "john23@gmail.com"
 *   "john"                             → ""   (incomplete — no domain)
 *   "john at gmail"                    → ""   (no TLD → invalid)
 */
export function parseSpokenEmail(text: string): string {
  if (!text) return '';

  let parsed = normalizeSpeechText(text.trim());

  // Remove all whitespace so "john . smith @ gmail . com" → "john.smith@gmail.com"
  parsed = parsed.replace(/\s+/g, '');

  // Reject incomplete addresses (no @ symbol, or no dot after @)
  if (!parsed.includes('@')) return '';
  const atIdx = parsed.indexOf('@');
  const domain = parsed.slice(atIdx + 1);
  if (!domain.includes('.')) return '';

  return parsed;
}
