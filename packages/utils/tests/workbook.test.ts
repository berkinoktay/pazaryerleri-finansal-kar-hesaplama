import { describe, expect, it } from 'vitest';

import { WORKBOOK_UPLOAD_MAX_BYTES, WORKBOOK_UPLOAD_MAX_MB } from '../src/index';

const BYTES_PER_MB = 1024 * 1024;

describe('WORKBOOK_UPLOAD_MAX_MB', () => {
  it('is the byte limit expressed in whole megabytes', () => {
    expect(WORKBOOK_UPLOAD_MAX_MB).toBe(WORKBOOK_UPLOAD_MAX_BYTES / BYTES_PER_MB);
    expect(Number.isInteger(WORKBOOK_UPLOAD_MAX_MB)).toBe(true);
  });
});
