import { describe, expect, it } from 'vitest';

import { ConflictError, InvalidReferenceError, NotFoundError } from '@/lib/errors';
import { mapPrismaError } from '@pazarsync/sync-core';

function fakePrismaError(code: string, meta?: Record<string, unknown>): Error {
  const err = Object.assign(new Error(`Prisma ${code}`), {
    code,
    meta: meta ?? {},
    clientVersion: 'test',
  });
  err.name = 'PrismaClientKnownRequestError';
  return err;
}

describe('mapPrismaError', () => {
  it('maps P2002 (unique constraint) to ConflictError', () => {
    const err = fakePrismaError('P2002', { target: ['slug'] });
    expect(() => mapPrismaError(err)).toThrow(ConflictError);
  });

  it('maps P2025 (record not found) to NotFoundError', () => {
    const err = fakePrismaError('P2025', { cause: 'Record to delete does not exist' });
    expect(() => mapPrismaError(err)).toThrow(NotFoundError);
  });

  it('maps P2003 (foreign key constraint) to InvalidReferenceError', () => {
    const err = fakePrismaError('P2003', { field_name: 'Order_storeId_fkey (index)' });
    expect(() => mapPrismaError(err)).toThrow(InvalidReferenceError);
  });

  it('rethrows an unknown Prisma code as-is', () => {
    const err = fakePrismaError('P9999');
    expect(() => mapPrismaError(err)).toThrow(/P9999/);
  });

  it('rethrows a non-Prisma error as-is', () => {
    const err = new Error('network down');
    expect(() => mapPrismaError(err)).toThrow('network down');
  });
});
