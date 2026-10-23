import { describe, expect, it } from 'vitest';

import { campaignConfigFormSchema } from '@/features/campaigns/lib/marketplace-campaign-config';

// A valid NET + percent campaign with its window — the minimum a submit needs.
const BASE = {
  discountType: 'NET',
  valueKind: 'PERCENT',
  value: '10',
  startsAt: '2026-08-01T10:00:00+03:00',
  endsAt: '2026-08-07T23:59:00+03:00',
} as const;

/** The validation codes (issue messages) a config produces; empty when it parses. */
function issueCodes(input: unknown): string[] {
  const result = campaignConfigFormSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('campaignConfigFormSchema', () => {
  it('resolves an empty funding rate to an explicit "0"', () => {
    expect(campaignConfigFormSchema.parse(BASE).trendyolFundingPct).toBe('0');
  });

  it('reads a CLEARED funding rate (the input keeps "") as "0" as well', () => {
    expect(
      campaignConfigFormSchema.parse({ ...BASE, trendyolFundingPct: '' }).trendyolFundingPct,
    ).toBe('0');
  });

  it('treats a cleared value as not given — the requirement speaks, not the format', () => {
    const codes = issueCodes({ ...BASE, value: '' });
    expect(codes).toContain('VALUE_REQUIRED');
    expect(codes).not.toContain('INVALID_DISCOUNT_VALUE');
  });

  it('keeps an entered funding rate', () => {
    const parsed = campaignConfigFormSchema.parse({ ...BASE, trendyolFundingPct: '60' });
    expect(parsed.trendyolFundingPct).toBe('60');
  });

  it('accepts a fully funded discount (100) but nothing above it', () => {
    expect(issueCodes({ ...BASE, trendyolFundingPct: '100' })).toEqual([]);
    expect(issueCodes({ ...BASE, trendyolFundingPct: '100.01' })).toContain('FUNDING_PCT_OVER_100');
  });

  it('rejects a funding rate that is not a number with up to 2 decimals', () => {
    expect(issueCodes({ ...BASE, trendyolFundingPct: '12,5' })).toContain('INVALID_FUNDING_PCT');
  });

  it('applies the shared kurgu rules (a NET campaign needs its value kind and value)', () => {
    expect(
      issueCodes({ discountType: 'NET', startsAt: BASE.startsAt, endsAt: BASE.endsAt }),
    ).toEqual(expect.arrayContaining(['VALUE_KIND_REQUIRED', 'VALUE_REQUIRED']));
  });

  it('does not accept the coupon kurgu (CODE is not a campaign type)', () => {
    expect(campaignConfigFormSchema.safeParse({ ...BASE, discountType: 'CODE' }).success).toBe(
      false,
    );
  });
});
