/**
 * Parses spoken phone numbers (10 digits, any grouping or digit-word mix).
 * Supports: "nine three three two five six seven eight five four"
 *           "double nine three two five six seven eight five"
 *           "trible eight triple nine"
 *           "double 8 triple 9"
 *           "9332567854" (already numeric)
 */
export function parseSpokenPhone(text: string): string {
  if (!text) return '';

  const digitMap: Record<string, string> = {
    zero: '0', oh: '0',
    one: '1',
    two: '2', to: '2', too: '2',
    three: '3',
    four: '4', for: '4',
    five: '5',
    six: '6',
    seven: '7',
    eight: '8', ate: '8',
    nine: '9'
  };

  // First: strip out formatting characters
  const rawOnlyDigits = text.replace(/\D/g, '');
  if (/^\d{10}$/.test(rawOnlyDigits)) {
    return rawOnlyDigits;
  }

  // Split attached words: "trible8" -> "trible 8", "doubleeight" -> "double eight"
  const cleanedText = text.replace(/\b(double|triple|trible)(\d|[a-z]+)\b/gi, '$1 $2');

  const words = cleanedText.toLowerCase().trim().split(/[\s,\-]+/);
  let result = '';

  const getDigit = (wordStr: string): string | null => {
    if (!wordStr) return null;
    if (digitMap[wordStr] !== undefined) {
      return digitMap[wordStr];
    }
    if (/^\d$/.test(wordStr)) {
      return wordStr;
    }
    return null;
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    if (word === 'double') {
      const next = words[i + 1];
      const nextDigit = getDigit(next);
      if (nextDigit !== null) {
        result += nextDigit.repeat(2);
        i++;
      }
    } else if (word === 'triple' || word === 'trible') {
      const next = words[i + 1];
      const nextDigit = getDigit(next);
      if (nextDigit !== null) {
        result += nextDigit.repeat(3);
        i++;
      }
    } else if (digitMap[word] !== undefined) {
      result += digitMap[word];
    } else {
      // Grab any raw numeric digits embedded in the word
      const digits = word.replace(/\D/g, '');
      result += digits;
    }
  }

  return result;
}

/**
 * Returns true only if the number is exactly 10 digits.
 */
export function isValid10DigitPhone(digits: string): boolean {
  return /^\d{10}$/.test(digits);
}

/**
 * Formats a 10-digit string into spoken digit-by-digit form for TTS.
 * e.g. "9332567854" → "9 3 3 2 5 6 7 8 5 4"
 */
export function phoneToSpokenDigits(digits: string): string {
  return digits.split('').join(' ');
}
