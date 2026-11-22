// Every Turkish and ASCII capital/dotless I (U+0130, U+0049, U+0131), folded to a plain i.
const TURKISH_I_VARIANTS = /[\u{0130}I\u{0131}]/gu;
// A lowercase i followed by combining dots above (U+0307): what a non-Turkish lowercase of
// U+0130 yields, and a pair NFC never composes (there is no precomposed dotted small i).
const I_WITH_COMBINING_DOT = /i\u{0307}+/gu;
// Any run of characters that is neither a letter nor a digit.
const NON_ALPHANUMERIC_RUN = /[^\p{L}\p{N}]+/gu;

/**
 * The key a cargo provider name is compared by: an order's `cargoProviderName` and a
 * carrier's display name / `orderCargoNames` match when their keys are equal. The key
 * ignores Unicode composition, Turkish I spellings, letter case, spacing and punctuation:
 *
 * 1. NFC, so a decomposed letter (`C` + U+0327, `I` + U+0307) equals its composed form.
 * 2. Every I spelling (U+0130, ASCII `I`, U+0131) folds to `i` BEFORE lowercasing.
 * 3. `toLowerCase()` (locale-independent), then a lowercase `i` + U+0307 folds to `i`.
 * 4. Every run of non-letter, non-digit characters becomes a single space; then trim.
 *
 * The `tr-TR` locale is deliberately NOT used: `toLocaleLowerCase('tr-TR')` turns an ASCII
 * `I` into a dotless i (U+0131), so "DHL" style English names and Turkish names typed with
 * an ASCII `I` would no longer match their canonical spelling. Folding first also avoids
 * the root-locale lowercase of U+0130 (`i` + U+0307, two code points).
 *
 * A blank or punctuation-only name yields `''`, which callers treat as "no name".
 */
export function normalizeCargoProviderName(name: string): string {
  return name
    .normalize('NFC')
    .replace(TURKISH_I_VARIANTS, 'i')
    .toLowerCase()
    .replace(I_WITH_COMBINING_DOT, 'i')
    .replace(NON_ALPHANUMERIC_RUN, ' ')
    .trim();
}
