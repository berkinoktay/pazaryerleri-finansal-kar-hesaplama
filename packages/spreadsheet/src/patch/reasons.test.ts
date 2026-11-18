import { describe, expect, it } from 'vitest';

import { isUnsafeContentDetail, UNSAFE_CONTENT_DETAILS } from './reasons';

// A detail is logged as is: a fixed rule name, lower-case kebab-case, one per check.
const KEBAB_CASE = /^[a-z]+(-[a-z]+)*$/;

describe('UNSAFE_CONTENT_DETAILS', () => {
  const details = Object.values(UNSAFE_CONTENT_DETAILS);

  it('holds unique values', () => {
    expect(new Set(details).size).toBe(details.length);
  });

  it.each(details)('writes %s in lower-case kebab-case', (detail) => {
    expect(detail).toMatch(KEBAB_CASE);
  });

  it.each(details)('accepts %s as a detail', (detail) => {
    expect(isUnsafeContentDetail(detail)).toBe(true);
  });

  it.each(['x', 7, null, undefined, 'CSS-LOAD', ' css-load'])('refuses %s', (value) => {
    expect(isUnsafeContentDetail(value)).toBe(false);
  });
});
