import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseProductsCursor } from './checkpoint';

describe('parseProductsCursor', () => {
  it('returns null when input is null (fresh sync)', () => {
    expect(parseProductsCursor(null)).toBeNull();
  });

  it('returns null when input is undefined (fresh sync)', () => {
    expect(parseProductsCursor(undefined)).toBeNull();
  });

  it('parses a page-index cursor at the start (n=0)', () => {
    const cursor = { kind: 'page', n: 0 } as const;
    expect(parseProductsCursor(cursor)).toEqual(cursor);
  });

  it('parses a page-index cursor partway through (n=12)', () => {
    const cursor = { kind: 'page', n: 12 } as const;
    expect(parseProductsCursor(cursor)).toEqual(cursor);
  });

  it('parses an opaque-token cursor', () => {
    const cursor = { kind: 'token', token: 'abc123' } as const;
    expect(parseProductsCursor(cursor)).toEqual(cursor);
  });

  it('throws ZodError when page-index n is negative', () => {
    expect(() => parseProductsCursor({ kind: 'page', n: -1 })).toThrow(z.ZodError);
  });

  it('throws ZodError when token is empty string', () => {
    expect(() => parseProductsCursor({ kind: 'token', token: '' })).toThrow(z.ZodError);
  });

  it('throws ZodError when discriminator value is unknown', () => {
    expect(() => parseProductsCursor({ kind: 'unknown' })).toThrow(z.ZodError);
  });

  it('throws ZodError when input is a primitive instead of an object', () => {
    expect(() => parseProductsCursor('not an object')).toThrow(z.ZodError);
  });
});
