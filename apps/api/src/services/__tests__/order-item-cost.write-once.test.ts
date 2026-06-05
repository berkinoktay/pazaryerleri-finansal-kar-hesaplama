import { describe, expect, it } from 'vitest';

import { isWriteOnceViolation } from '../order-item-cost.service';

describe('isWriteOnceViolation', () => {
  it('detects a top-level pg SQLSTATE 42501', () => {
    expect(isWriteOnceViolation({ code: '42501' })).toBe(true);
  });
  it('detects 42501 nested under .cause (Prisma adapter wrap)', () => {
    expect(isWriteOnceViolation({ cause: { code: '42501' } })).toBe(true);
  });
  it('detects 42501 in meta.code', () => {
    expect(isWriteOnceViolation({ meta: { code: '42501' } })).toBe(true);
  });
  it('detects the write-once message text', () => {
    expect(isWriteOnceViolation(new Error('unit_cost_snapshot_net is write-once'))).toBe(true);
  });
  it('returns false for an unrelated error', () => {
    expect(isWriteOnceViolation(new Error('boom'))).toBe(false);
    expect(isWriteOnceViolation({ code: 'P2002' })).toBe(false);
    expect(isWriteOnceViolation(null)).toBe(false);
  });
});
