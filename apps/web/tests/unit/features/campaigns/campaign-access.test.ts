import { describe, expect, it } from 'vitest';

import { Platform } from '@pazarsync/db/enums';
import { WORKBOOK_PAGES } from '@pazarsync/utils';

import {
  FULL_CAMPAIGN_ACCESS,
  resolveCampaignAccess,
  UPLOAD_GATES,
} from '@/features/campaigns/lib/campaign-access';

const ALL_PAGES = Object.values(WORKBOOK_PAGES);

describe('resolveCampaignAccess', () => {
  it('hides the upload for a member who cannot write', () => {
    expect(
      resolveCampaignAccess({
        canWrite: false,
        platform: Platform.TRENDYOL,
        page: WORKBOOK_PAGES.COMMISSION_TARIFF,
      }),
    ).toEqual({ canWrite: false, upload: UPLOAD_GATES.HIDDEN });
  });

  it('marks the upload unsupported for a platform with no workbook format', () => {
    expect(
      resolveCampaignAccess({
        canWrite: true,
        platform: Platform.HEPSIBURADA,
        page: WORKBOOK_PAGES.COMMISSION_TARIFF,
      }),
    ).toEqual({ canWrite: true, upload: UPLOAD_GATES.UNSUPPORTED_PLATFORM });
  });

  it('grants full access for a writer on a supported platform', () => {
    expect(
      resolveCampaignAccess({
        canWrite: true,
        platform: Platform.TRENDYOL,
        page: WORKBOOK_PAGES.COMMISSION_TARIFF,
      }),
    ).toEqual(FULL_CAMPAIGN_ACCESS);
  });

  it('shows only the read-only state to a non-writer on an unsupported platform', () => {
    expect(
      resolveCampaignAccess({
        canWrite: false,
        platform: Platform.HEPSIBURADA,
        page: WORKBOOK_PAGES.DISCOUNT_LIST,
      }),
    ).toEqual({ canWrite: false, upload: UPLOAD_GATES.HIDDEN });
  });

  it('treats a missing store as a supported platform', () => {
    expect(
      resolveCampaignAccess({
        canWrite: true,
        platform: null,
        page: WORKBOOK_PAGES.FLASH_PRODUCT_LIST,
      }),
    ).toEqual({ canWrite: true, upload: UPLOAD_GATES.ENABLED });
  });

  it('keeps the full access constant as an enabled writer', () => {
    expect(FULL_CAMPAIGN_ACCESS).toEqual({ canWrite: true, upload: UPLOAD_GATES.ENABLED });
  });

  it.each(ALL_PAGES)('enables the upload for TRENDYOL on %s', (page) => {
    expect(resolveCampaignAccess({ canWrite: true, platform: Platform.TRENDYOL, page })).toEqual(
      FULL_CAMPAIGN_ACCESS,
    );
  });

  it.each(ALL_PAGES)('marks the upload unsupported for HEPSIBURADA on %s', (page) => {
    expect(resolveCampaignAccess({ canWrite: true, platform: Platform.HEPSIBURADA, page })).toEqual(
      { canWrite: true, upload: UPLOAD_GATES.UNSUPPORTED_PLATFORM },
    );
  });
});
