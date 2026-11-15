// A stable text form of a parsed row list, and its SHA-256: the golden digests of
// tests/fixtures/workbook-golden/legacy-rows.json compare a row mapper's full output
// without storing it. Object keys are sorted at every level and a Date is its ISO text,
// so the digest does not depend on key order or on how a date prints.

import { createHash } from 'node:crypto';

function canonicalValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, inner]) => [key, canonicalValue(inner)]));
  }
  return value;
}

/** `value` as JSON with its object keys sorted at every level and every Date as ISO text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

/** The SHA-256 of `text` (UTF-8), as lower-case hex. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
