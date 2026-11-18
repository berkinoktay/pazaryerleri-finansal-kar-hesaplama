import { describe, expect, it } from 'vitest';

import { UPLOAD_NAME_MAX_LENGTH } from '@pazarsync/utils';

import { isUploadNameTooLong } from '@/features/campaigns/lib/upload-name';

// One code point outside the Basic Multilingual Plane: two UTF-16 units, one character.
const ASTRAL = '\u{1F600}';

describe('isUploadNameTooLong', () => {
  it('accepts a name of exactly the limit in astral code points', () => {
    const name = ASTRAL.repeat(UPLOAD_NAME_MAX_LENGTH);
    // Twice the limit in UTF-16 units: the browser's maxlength would have cut it in half.
    expect(name.length).toBe(UPLOAD_NAME_MAX_LENGTH * 2);
    expect(isUploadNameTooLong(name)).toBe(false);
  });

  it('refuses one astral code point over the limit', () => {
    expect(isUploadNameTooLong(ASTRAL.repeat(UPLOAD_NAME_MAX_LENGTH + 1))).toBe(true);
  });

  it('counts the trimmed text, as the API does', () => {
    expect(isUploadNameTooLong(`   ${'a'.repeat(UPLOAD_NAME_MAX_LENGTH)}   `)).toBe(false);
    expect(isUploadNameTooLong(`  ${'a'.repeat(UPLOAD_NAME_MAX_LENGTH + 1)}  `)).toBe(true);
  });

  it('accepts an empty name', () => {
    expect(isUploadNameTooLong('')).toBe(false);
  });
});
