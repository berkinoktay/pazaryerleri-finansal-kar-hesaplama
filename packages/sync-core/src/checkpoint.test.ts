import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  nextProductsChangesPhase,
  parseProductsChangesCursor,
  parseProductsCursor,
  PRODUCTS_CHANGES_PHASES,
  type ProductsChangesPhase,
} from './checkpoint';

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

describe('PRODUCTS_CHANGES_PHASES', () => {
  it('walks variant edits, then content edits, then late-approved creations', () => {
    // Order is an owner decision; a reorder must show up as a test change.
    expect(PRODUCTS_CHANGES_PHASES).toEqual([
      'VARIANT_MODIFIED_DATE',
      'CONTENT_MODIFIED_DATE',
      'VARIANT_CREATED_DATE',
    ]);
  });
});

describe('nextProductsChangesPhase', () => {
  it('returns the following phase in tuple order', () => {
    expect(nextProductsChangesPhase('VARIANT_MODIFIED_DATE')).toBe('CONTENT_MODIFIED_DATE');
    expect(nextProductsChangesPhase('CONTENT_MODIFIED_DATE')).toBe('VARIANT_CREATED_DATE');
  });

  it('returns null after the last phase (the run is done)', () => {
    expect(nextProductsChangesPhase('VARIANT_CREATED_DATE')).toBeNull();
  });

  it('visits every phase exactly once when walked from the first', () => {
    const visited: string[] = [];
    let phase: ProductsChangesPhase | null = PRODUCTS_CHANGES_PHASES[0];
    while (phase !== null) {
      visited.push(phase);
      phase = nextProductsChangesPhase(phase);
    }
    expect(visited).toEqual([...PRODUCTS_CHANGES_PHASES]);
  });
});

describe('parseProductsChangesCursor', () => {
  const WINDOW_END_MS = Date.UTC(2026, 9, 29, 12, 0, 0);
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const WINDOW_START_MS = WINDOW_END_MS - ONE_HOUR_MS;

  function validCursor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      phase: 'VARIANT_MODIFIED_DATE',
      page: 0,
      windowStart: WINDOW_START_MS,
      windowEnd: WINDOW_END_MS,
      ...overrides,
    };
  }

  it('returns null when input is null (first chunk)', () => {
    expect(parseProductsChangesCursor(null)).toBeNull();
  });

  it('returns null when input is undefined (first chunk)', () => {
    expect(parseProductsChangesCursor(undefined)).toBeNull();
  });

  it.each(PRODUCTS_CHANGES_PHASES)('parses a cursor in phase %s', (phase) => {
    const cursor = validCursor({ phase });
    expect(parseProductsChangesCursor(cursor)).toEqual(cursor);
  });

  it('parses a cursor partway through a phase (page 7)', () => {
    const cursor = validCursor({ phase: 'CONTENT_MODIFIED_DATE', page: 7 });
    expect(parseProductsChangesCursor(cursor)).toEqual(cursor);
  });

  it('parses a 1 ms window (the narrowest valid one)', () => {
    const cursor = validCursor({ windowStart: WINDOW_END_MS - 1 });
    expect(parseProductsChangesCursor(cursor)).toEqual(cursor);
  });

  it('throws ZodError when windowStart equals windowEnd (empty window)', () => {
    expect(() => parseProductsChangesCursor(validCursor({ windowStart: WINDOW_END_MS }))).toThrow(
      z.ZodError,
    );
  });

  it('throws ZodError when windowStart is after windowEnd', () => {
    expect(() =>
      parseProductsChangesCursor(validCursor({ windowStart: WINDOW_END_MS + 1 })),
    ).toThrow(z.ZodError);
  });

  it('throws ZodError when the phase is not a known dateQueryType', () => {
    expect(() => parseProductsChangesCursor(validCursor({ phase: 'ORDER_DATE' }))).toThrow(
      z.ZodError,
    );
  });

  it('throws ZodError when page is negative', () => {
    expect(() => parseProductsChangesCursor(validCursor({ page: -1 }))).toThrow(z.ZodError);
  });

  it('throws ZodError when page is not an integer', () => {
    expect(() => parseProductsChangesCursor(validCursor({ page: 1.5 }))).toThrow(z.ZodError);
  });

  it('throws ZodError when windowStart is missing', () => {
    expect(() => parseProductsChangesCursor(validCursor({ windowStart: undefined }))).toThrow(
      z.ZodError,
    );
  });

  it('throws ZodError when a bound is an ISO string instead of ms epoch', () => {
    expect(() =>
      parseProductsChangesCursor(validCursor({ windowEnd: new Date(WINDOW_END_MS).toISOString() })),
    ).toThrow(z.ZodError);
  });

  it('throws ZodError when a bound is negative', () => {
    expect(() => parseProductsChangesCursor(validCursor({ windowStart: -1 }))).toThrow(z.ZodError);
  });

  it('throws ZodError for a products page-index cursor (wrong sync type shape)', () => {
    expect(() => parseProductsChangesCursor({ kind: 'page', n: 0 })).toThrow(z.ZodError);
  });

  it('throws ZodError when input is a primitive instead of an object', () => {
    expect(() => parseProductsChangesCursor('not an object')).toThrow(z.ZodError);
  });
});
