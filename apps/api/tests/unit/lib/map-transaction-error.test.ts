import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { syncLog } from '@pazarsync/sync-core';

import { IMPORT_BUSY_RETRY_AFTER_SECONDS } from '@/config/workbook-limits';
import { ConflictError, ImportBusyError } from '@/lib/errors';
import {
  isForeignKeyViolationOn,
  isUniqueViolationOn,
  mapTransactionError,
} from '@/lib/map-transaction-error';

function fakePrismaError(code: string, meta?: Record<string, unknown>): Error {
  const err = Object.assign(new Error(`Prisma ${code}`), {
    code,
    meta: meta ?? {},
    clientVersion: 'test',
  });
  err.name = 'PrismaClientKnownRequestError';
  return err;
}

function captureThrow(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the function to throw');
}

/** Swallows the busy warning so it neither clutters the run nor escapes the spy. */
function silenceWarn(): MockInstance<typeof syncLog.warn> {
  return vi.spyOn(syncLog, 'warn').mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mapTransactionError', () => {
  it('maps P2028 (transaction API error / timeout) to ImportBusyError', () => {
    silenceWarn();
    const thrown = captureThrow(() => mapTransactionError(fakePrismaError('P2028')));
    expect(thrown).toBeInstanceOf(ImportBusyError);
    if (!(thrown instanceof ImportBusyError)) return;
    expect(thrown.retryAfterSeconds).toBe(IMPORT_BUSY_RETRY_AFTER_SECONDS);
  });

  it('maps P2024 (connection pool wait timeout) to ImportBusyError', () => {
    silenceWarn();
    const thrown = captureThrow(() => mapTransactionError(fakePrismaError('P2024')));
    expect(thrown).toBeInstanceOf(ImportBusyError);
    if (!(thrown instanceof ImportBusyError)) return;
    expect(thrown.retryAfterSeconds).toBe(IMPORT_BUSY_RETRY_AFTER_SECONDS);
  });

  // Shape of Prisma 7's expired-transaction P2028: `operation` is a string, the
  // timing hints are numbers. Only the code and the numeric fields are logged,
  // never the error message or a string field.
  it('logs the P2028 code and the numeric timing hints before mapping', () => {
    const warnSpy = silenceWarn();
    const err = fakePrismaError('P2028', { operation: 'query', timeout: 5000, timeTaken: 5012 });

    expect(captureThrow(() => mapTransactionError(err))).toBeInstanceOf(ImportBusyError);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('import.transaction-busy', {
      prismaCode: 'P2028',
      numericMeta: { timeout: 5000, timeTaken: 5012 },
    });
  });

  it('logs the P2024 code and the numeric pool hints before mapping', () => {
    const warnSpy = silenceWarn();
    const err = fakePrismaError('P2024', { connection_limit: 10, timeout: 10 });

    expect(captureThrow(() => mapTransactionError(err))).toBeInstanceOf(ImportBusyError);
    expect(warnSpy).toHaveBeenCalledWith('import.transaction-busy', {
      prismaCode: 'P2024',
      numericMeta: { connection_limit: 10, timeout: 10 },
    });
  });

  it('maps P2002 to ConflictError via mapPrismaError', () => {
    const warnSpy = silenceWarn();
    const err = fakePrismaError('P2002', { target: ['slug'] });
    expect(() => mapTransactionError(err)).toThrow(ConflictError);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('rethrows a non-Prisma error as is', () => {
    const err = new Error('network down');
    expect(captureThrow(() => mapTransactionError(err))).toBe(err);
  });
});

describe('isUniqueViolationOn', () => {
  function uniqueViolation(fields: unknown): Error {
    return fakePrismaError('P2002', {
      modelName: 'CommissionTariff',
      driverAdapterError: { cause: { constraint: { fields } } },
    });
  }

  it('is true for a P2002 whose violated columns include the column', () => {
    const err = uniqueViolation(['store_id', 'week_starts_at']);
    expect(isUniqueViolationOn(err, 'week_starts_at')).toBe(true);
  });

  it('is false for a P2002 on other columns', () => {
    expect(isUniqueViolationOn(uniqueViolation(['slug']), 'week_starts_at')).toBe(false);
  });

  it('is false for another Prisma code carrying the same columns', () => {
    const err = fakePrismaError('P2003', {
      driverAdapterError: { cause: { constraint: { fields: ['week_starts_at'] } } },
    });
    expect(isUniqueViolationOn(err, 'week_starts_at')).toBe(false);
  });

  it('is false for a non-Prisma error', () => {
    expect(isUniqueViolationOn(new Error('boom'), 'week_starts_at')).toBe(false);
  });
});

describe('isForeignKeyViolationOn', () => {
  const TARGET = {
    constraint: 'advantage_tariffs_commission_source_tariff_id_fkey',
    column: 'commission_source_tariff_id',
  };

  function foreignKeyViolation(code: string, constraint: unknown): Error {
    return fakePrismaError(code, {
      modelName: 'AdvantageTariff',
      driverAdapterError: { cause: { constraint } },
    });
  }

  it('is true for a P2003 that names the constraint (the shape a real insert produces)', () => {
    const err = foreignKeyViolation('P2003', { index: TARGET.constraint });
    expect(isForeignKeyViolationOn(err, TARGET)).toBe(true);
  });

  it('is true for a P2003 that names the column instead', () => {
    const err = foreignKeyViolation('P2003', { fields: ['store_id', TARGET.column] });
    expect(isForeignKeyViolationOn(err, TARGET)).toBe(true);
  });

  it('is false for a P2003 on another key', () => {
    expect(
      isForeignKeyViolationOn(foreignKeyViolation('P2003', { index: 'other_fkey' }), TARGET),
    ).toBe(false);
    expect(
      isForeignKeyViolationOn(foreignKeyViolation('P2003', { fields: ['store_id'] }), TARGET),
    ).toBe(false);
  });

  it('does not match the column against the constraint name, or the reverse', () => {
    expect(
      isForeignKeyViolationOn(foreignKeyViolation('P2003', { index: TARGET.column }), TARGET),
    ).toBe(false);
    expect(
      isForeignKeyViolationOn(
        foreignKeyViolation('P2003', { fields: [TARGET.constraint] }),
        TARGET,
      ),
    ).toBe(false);
  });

  it('is false for another Prisma code carrying the same key', () => {
    expect(
      isForeignKeyViolationOn(foreignKeyViolation('P2002', { index: TARGET.constraint }), TARGET),
    ).toBe(false);
    expect(
      isForeignKeyViolationOn(foreignKeyViolation('P2002', { fields: [TARGET.column] }), TARGET),
    ).toBe(false);
  });

  it('is false when the cause names no key', () => {
    expect(isForeignKeyViolationOn(foreignKeyViolation('P2003', undefined), TARGET)).toBe(false);
  });

  it('is false for a non-Prisma error', () => {
    expect(isForeignKeyViolationOn(new Error('boom'), TARGET)).toBe(false);
  });
});
