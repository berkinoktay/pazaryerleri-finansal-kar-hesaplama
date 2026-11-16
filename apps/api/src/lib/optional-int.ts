/**
 * A config field the request sends as a digit string (its schema has already checked
 * the digits), as its Int column holds it: null when the field was not sent.
 */
export function intOrNull(value: string | undefined): number | null {
  return value === undefined ? null : Number(value);
}
