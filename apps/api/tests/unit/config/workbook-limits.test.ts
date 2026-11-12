import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_BYTES } from '@pazarsync/spreadsheet';
import { WORKBOOK_UPLOAD_MAX_BYTES } from '@pazarsync/utils';

// The client hint, the HTTP body limit and the engine's size gate must all
// enforce the same file limit. If these drift, a file can pass the body limit
// and still be rejected by the engine (or the reverse), with a confusing error.
describe('workbook upload limits', () => {
  it('WORKBOOK_UPLOAD_MAX_BYTES equals the engine DEFAULT_MAX_BYTES', () => {
    expect(WORKBOOK_UPLOAD_MAX_BYTES).toBe(DEFAULT_MAX_BYTES);
  });
});
