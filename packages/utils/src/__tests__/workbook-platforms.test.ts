import { Platform } from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { WORKBOOK_PAGES } from '../workbook-pages';
import { hasWorkbookFormat, WORKBOOK_PAGE_PLATFORMS } from '../workbook-platforms';

// The web disables the upload button for a store whose platform has no workbook format
// on the page, so every page needs an entry and today only Trendyol has a format.

describe('WORKBOOK_PAGE_PLATFORMS', () => {
  it('has one entry per workbook page, in WORKBOOK_PAGES order', () => {
    expect(Object.keys(WORKBOOK_PAGE_PLATFORMS)).toEqual(Object.values(WORKBOOK_PAGES));
  });
});

describe('hasWorkbookFormat', () => {
  it.each(Object.values(WORKBOOK_PAGES))('knows the Trendyol format of %s', (page) => {
    expect(hasWorkbookFormat(page, Platform.TRENDYOL)).toBe(true);
  });

  it.each(Object.values(WORKBOOK_PAGES))('has no Hepsiburada format for %s', (page) => {
    expect(hasWorkbookFormat(page, Platform.HEPSIBURADA)).toBe(false);
  });
});
