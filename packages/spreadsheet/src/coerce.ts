const CURRENCY_AND_NOISE = /[ \s%₺$]/g; // NBSP, space, %, ₺, $

export function normalizeDecimalString(raw: string): string {
  let s = raw.trim().replace(/TL$/i, '').replace(CURRENCY_AND_NOISE, '');
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    s = s.replace(/\./g, '').replace(',', '.'); // '.' is thousands separator, ',' is decimal
  } else if (hasComma) {
    s = s.replace(',', '.'); // lone ',' is the decimal separator
  }
  return s;
}
