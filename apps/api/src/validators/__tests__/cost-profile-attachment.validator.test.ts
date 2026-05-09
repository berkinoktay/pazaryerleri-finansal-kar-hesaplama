import { describe, expect, it } from 'vitest';

import { attachmentBodySchema, replaceBodySchema } from '../cost-profile-attachment.validator';

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const ANOTHER_UUID = 'b4e2c1a0-9d3f-47e5-8a1b-6c5d4e3f2a1b';

// ─── attachmentBodySchema ─────────────────────────────────────────────────────

describe('attachmentBodySchema', () => {
  it('accepts a valid body with one profileId and one variantId', () => {
    const result = attachmentBodySchema.safeParse({
      profileIds: [VALID_UUID],
      variantIds: [ANOTHER_UUID],
    });
    expect(result.success).toBe(true);
  });

  it('accepts multiple profileIds and variantIds up to the limits', () => {
    const profileIds = Array.from({ length: 100 }, () => VALID_UUID);
    const variantIds = Array.from({ length: 500 }, () => ANOTHER_UUID);
    const result = attachmentBodySchema.safeParse({ profileIds, variantIds });
    expect(result.success).toBe(true);
  });

  it('rejects empty profileIds (min 1)', () => {
    const result = attachmentBodySchema.safeParse({
      profileIds: [],
      variantIds: [ANOTHER_UUID],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const hasProfileIdsError = result.error.issues.some((i) => i.path.includes('profileIds'));
      expect(hasProfileIdsError).toBe(true);
    }
  });

  it('rejects empty variantIds (min 1)', () => {
    const result = attachmentBodySchema.safeParse({
      profileIds: [VALID_UUID],
      variantIds: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const hasVariantIdsError = result.error.issues.some((i) => i.path.includes('variantIds'));
      expect(hasVariantIdsError).toBe(true);
    }
  });

  it('rejects profileIds array exceeding max (100)', () => {
    const profileIds = Array.from({ length: 101 }, () => VALID_UUID);
    const result = attachmentBodySchema.safeParse({
      profileIds,
      variantIds: [ANOTHER_UUID],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const hasProfileIdsError = result.error.issues.some((i) => i.path.includes('profileIds'));
      expect(hasProfileIdsError).toBe(true);
    }
  });

  it('rejects variantIds array exceeding max (500)', () => {
    const variantIds = Array.from({ length: 501 }, () => ANOTHER_UUID);
    const result = attachmentBodySchema.safeParse({
      profileIds: [VALID_UUID],
      variantIds,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const hasVariantIdsError = result.error.issues.some((i) => i.path.includes('variantIds'));
      expect(hasVariantIdsError).toBe(true);
    }
  });

  it('rejects non-UUID strings in profileIds', () => {
    const result = attachmentBodySchema.safeParse({
      profileIds: ['not-a-uuid'],
      variantIds: [ANOTHER_UUID],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID strings in variantIds', () => {
    const result = attachmentBodySchema.safeParse({
      profileIds: [VALID_UUID],
      variantIds: ['not-a-uuid'],
    });
    expect(result.success).toBe(false);
  });
});

// ─── replaceBodySchema ────────────────────────────────────────────────────────

describe('replaceBodySchema', () => {
  it('accepts a valid body with profileIds and variantIds', () => {
    const result = replaceBodySchema.safeParse({
      variantIds: [ANOTHER_UUID],
      profileIds: [VALID_UUID],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty profileIds (clear semantics)', () => {
    // Replace with empty profileIds = clear all profiles for the listed variants
    const result = replaceBodySchema.safeParse({
      variantIds: [ANOTHER_UUID],
      profileIds: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty variantIds (min 1)', () => {
    const result = replaceBodySchema.safeParse({
      variantIds: [],
      profileIds: [VALID_UUID],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const hasVariantIdsError = result.error.issues.some((i) => i.path.includes('variantIds'));
      expect(hasVariantIdsError).toBe(true);
    }
  });

  it('rejects profileIds array exceeding max (100)', () => {
    const profileIds = Array.from({ length: 101 }, () => VALID_UUID);
    const result = replaceBodySchema.safeParse({
      variantIds: [ANOTHER_UUID],
      profileIds,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const hasProfileIdsError = result.error.issues.some((i) => i.path.includes('profileIds'));
      expect(hasProfileIdsError).toBe(true);
    }
  });

  it('rejects variantIds array exceeding max (500)', () => {
    const variantIds = Array.from({ length: 501 }, () => ANOTHER_UUID);
    const result = replaceBodySchema.safeParse({
      variantIds,
      profileIds: [VALID_UUID],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID strings in profileIds', () => {
    const result = replaceBodySchema.safeParse({
      variantIds: [ANOTHER_UUID],
      profileIds: ['not-a-uuid'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID strings in variantIds', () => {
    const result = replaceBodySchema.safeParse({
      variantIds: ['not-a-uuid'],
      profileIds: [VALID_UUID],
    });
    expect(result.success).toBe(false);
  });
});
