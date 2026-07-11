import { describe, expect, it } from 'vitest';

import type { SkippedPageEntry } from '@pazarsync/sync-core';

import {
  shouldRunDelistPass,
  type DelistDoneReason,
  type DelistScanContext,
} from '../../../src/handlers/products';

// Pure decision — no DB. Gates the absence-from-feed delist pass: it may run
// ONLY when the full-scan reached a complete AND trustworthy terminal state.
function skippedPage(page: number): SkippedPageEntry {
  return {
    page,
    attemptedAt: new Date().toISOString(),
    errorCode: 'MARKETPLACE_UNREACHABLE',
    httpStatus: 500,
  };
}

// A scan that walked real pages this run — the emptiness (if any) is trustworthy.
const WALKED_PAGES: DelistScanContext = { progressCurrent: 250, observedTotalElements: 250 };

// The empty-terminal reasons whose trust depends on the scan context.
const EMPTY_REASONS: DelistDoneReason[] = ['empty-page', 'empty-batch'];

describe('shouldRunDelistPass', () => {
  it('runs on reached-end when no pages were skipped, regardless of progress', () => {
    // reached-end only fires after upserting a non-empty batch, so it is
    // trustworthy even on a single-page catalog where progressCurrent started 0.
    expect(shouldRunDelistPass([], 'reached-end', WALKED_PAGES)).toEqual({ run: true });
    expect(
      shouldRunDelistPass([], 'reached-end', { progressCurrent: 0, observedTotalElements: 1 }),
    ).toEqual({ run: true });
  });

  it('runs on an empty terminal that followed real pages this run (progressCurrent > 0)', () => {
    for (const reason of EMPTY_REASONS) {
      expect(shouldRunDelistPass([], reason, WALKED_PAGES)).toEqual({ run: true });
    }
  });

  it('runs on an empty terminal when the vendor confirmed an empty catalog (totalElements === 0)', () => {
    // A first-chunk empty response is trustworthy IF the vendor reports the
    // catalog itself is empty — there is nothing listed to (mis)delist.
    expect(
      shouldRunDelistPass([], 'empty-batch', { progressCurrent: 0, observedTotalElements: 0 }),
    ).toEqual({ run: true });
  });

  it('SKIPS an empty first response over a nonzero catalog — a transient blip, not proof of absence', () => {
    // empty-page: generator returned done/undefined before yielding, so no page
    // was observed (observedTotalElements = null) and progress is still 0.
    expect(
      shouldRunDelistPass([], 'empty-page', { progressCurrent: 0, observedTotalElements: null }),
    ).toEqual({ run: false, reason: 'untrusted-empty-scan' });

    // empty-batch: a page was observed but the vendor claims a nonzero catalog
    // while handing back an empty batch on the very first chunk — untrusted.
    expect(
      shouldRunDelistPass([], 'empty-batch', { progressCurrent: 0, observedTotalElements: 200 }),
    ).toEqual({ run: false, reason: 'untrusted-empty-scan' });
  });

  it('never runs on a truncated-past-cap done — absence past the 10k cap is unknowable', () => {
    expect(shouldRunDelistPass([], 'truncated-past-cap', WALKED_PAGES)).toEqual({
      run: false,
      reason: 'truncated-past-cap',
    });
  });

  it('never runs when a page was skipped, even on an otherwise complete/trustworthy done', () => {
    for (const reason of ['reached-end', ...EMPTY_REASONS] satisfies DelistDoneReason[]) {
      expect(shouldRunDelistPass([skippedPage(24)], reason, WALKED_PAGES)).toEqual({
        run: false,
        reason: 'skipped-pages',
      });
    }
  });

  it('reports skipped-pages first when both a skipped page AND truncation hold', () => {
    expect(shouldRunDelistPass([skippedPage(99)], 'truncated-past-cap', WALKED_PAGES)).toEqual({
      run: false,
      reason: 'skipped-pages',
    });
  });
});
