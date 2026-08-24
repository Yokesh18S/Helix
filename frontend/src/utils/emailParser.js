/**
 * emailParser.js
 *
 * Converts spoken email addresses into valid email strings.
 *
 * Examples:
 *   "yokesh at gmail dot com"               -> yokesh@gmail.com
 *   "john underscore doe at company dot org" -> john_doe@company.org
 *   "user eighteen at outlook dot com"       -> user18@outlook.com
 *   "mary hyphen ann at domain dot co dot in"-> mary-ann@domain.co.in
 */

const NUMBER_WORDS = {
  zero: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14",
  fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19",
  twenty: "20", thirty: "30", forty: "40", fifty: "50",
  sixty: "60", seventy: "70", eighty: "80", ninety: "90",
  hundred: "100", thousand: "1000",
};

function replaceNumberWords(str) {
  return str.split(/\s+/).map(w => NUMBER_WORDS[w.toLowerCase()] ?? w).join(" ");
}

/**
 * Parse a spoken email phrase into a candidate email string.
 * Does not validate � call isValidEmail() after.
 */
export function parseSpokenEmail(text) {
  if (!text) return null;

  let s = text.toLowerCase().trim();

  // Spoken separators -> email characters
  s = s.replace(/\bat\b/g, "@");
  s = s.replace(/\bdot\b/g, ".");
  s = s.replace(/\bunderscore\b/g, "_");
  s = s.replace(/\bhyphen\b/g, "-");
  s = s.replace(/\bdash\b/g, "-");
  s = s.replace(/\bspace\b/g, "");
  s = s.replace(/\bslash\b/g, "");

  // Number words -> digits (must happen after separator replacement)
  s = replaceNumberWords(s);

  // Remove all whitespace (emails have no spaces)
  s = s.replace(/\s+/g, "");

  return s || null;
}

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

export function isValidEmail(email) {
  return EMAIL_RE.test(email);
}

/**
 * Parse spoken text and return a valid email, or null if parsing/validation fails.
 */
export function extractEmailFromSpeech(text) {
  const candidate = parseSpokenEmail(text);
  if (candidate && isValidEmail(candidate)) return candidate;
  return null;
}
