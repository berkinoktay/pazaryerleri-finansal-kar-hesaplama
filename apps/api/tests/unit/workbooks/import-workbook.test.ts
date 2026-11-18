// The generic import's catch side, with the database and the engine mocked and a fake
// adapter: what `persist` throws inside the transaction leaves as a file rejection, a
// conflict or a mapped transaction error, never as a raw rejection or a 500; and the
// quota pre-check, which refuses a store at its quota before the file is read.

import { z } from '@hono/zod-openapi';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import { Platform } from '@pazarsync/db/enums';
import { defineLayout, has, header, type SheetData } from '@pazarsync/spreadsheet';
import { syncLog } from '@pazarsync/sync-core';
import { WORKBOOK_PAGES } from '@pazarsync/utils';

import { ValidationError, WorkbookConflictError } from '@/lib/errors';
import type { WorkbookImportAdapter } from '@/workbooks/adapter';
import { VALUE_NOT_STORABLE_REASON } from '@/workbooks/column-range';
import { defineFormat } from '@/workbooks/format';
import { importWorkbook, type ImportWorkbookInput } from '@/workbooks/import-workbook';
import { assertUploadQuota } from '@/workbooks/upload-quota';
import { WorkbookFileRejection } from '@/workbooks/workbook-errors';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  findVariants: vi.fn(),
  readWorkbookGrid: vi.fn(),
  patchWorkbook: vi.fn(),
}));

vi.mock('@pazarsync/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pazarsync/db')>()),
  prisma: { $transaction: mocks.transaction, productVariant: { findMany: mocks.findVariants } },
}));

vi.mock('@pazarsync/spreadsheet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pazarsync/spreadsheet')>()),
  readWorkbookGrid: mocks.readWorkbookGrid,
  patchWorkbook: mocks.patchWorkbook,
}));

// The lock and the quota are pinned by their own integration file.
vi.mock('@/workbooks/upload-quota', () => ({
  acquireImportLock: vi.fn(async () => undefined),
  assertUploadQuota: vi.fn(async () => undefined),
}));

const PAGE = WORKBOOK_PAGES.COMMISSION_TARIFF;

const layout = defineLayout({
  headerLookahead: 0,
  required: { barcode: header('Barcode'), price: header('Price') },
  optional: { selection: header('Selection') },
  blocks: {},
});

const FORMAT = defineFormat({
  id: 'TRENDYOL:COMMISSION_TARIFF:v1',
  platform: Platform.TRENDYOL,
  page: PAGE,
  sheet: { by: 'name', name: 'Products' },
  layout,
  keep: has('barcode', 'text'),
  anchor: 'barcode',
  fingerprint: ['Barcode', 'Price', 'Selection'],
  mapRow: (_reader, anchor) => ({ barcode: anchor }),
  writeBack: {
    selection: {
      target: { kind: 'column', key: 'selection' },
      value: { kind: 'number', scale: 2 },
      overwritesFormula: true,
      seededFromSource: false,
      clearWhenUnselected: false,
    },
  },
  exportRequires: [['selection']],
  prefilled: 'ignore',
  defaultName: 'Synthetic tariff',
  filename: { kind: 'fixed', base: 'synthetic' },
});

const WITH_SELECTION: SheetData = [
  ['Barcode', 'Price', 'Selection'],
  ['B-1', 10, null],
];
const WITHOUT_SELECTION: SheetData = [
  ['Barcode', 'Price'],
  ['B-1', 10],
];

const UNIQUE_VIOLATION = new Error('a unique violation the adapter recognises');

const ResponseSchema = z.object({ parentId: z.string() });
type Response = z.infer<typeof ResponseSchema>;

function fakeAdapter(
  persist: () => Promise<{ parentId: string; itemCount: number }>,
): WorkbookImportAdapter<typeof layout, { barcode: string }, null, null, Response, 'selection'> {
  return {
    page: PAGE,
    parentTable: 'commission_tariffs',
    countLists: async () => 0,
    align: 'anchor-map',
    http: {
      segment: 'synthetic',
      idParam: 'id',
      tag: 'Synthetic',
      storePathSchema: z.object({}),
      itemPathSchema: z.object({}),
      importSummary: '',
      importDescription: '',
      importCreated: '',
      import422: '',
      exportSummary: '',
      exportDescription: '',
      exportOk: '',
      export404: '',
      export409: '',
      exportMimes: ['application/octet-stream'],
    },
    formSchema: z.object({}),
    responseSchema: ResponseSchema,
    readForm: () => {
      throw new Error('not used by importWorkbook');
    },
    formats: [FORMAT],
    inspect: async () => null,
    nameFallback: () => null,
    persist,
    rejectionForUniqueViolation: (err) => (err === UNIQUE_VIOLATION ? 'DUPLICATE_WEEK' : null),
    toResponse: (outcome) => ({ parentId: outcome.parentId }),
  };
}

const INPUT: ImportWorkbookInput<null> = {
  organizationId: '0b0f8a52-1c1e-4b8f-9d1a-7e2f4c5b6a70',
  storeId: '1c1f8a52-1c1e-4b8f-9d1a-7e2f4c5b6a71',
  platform: Platform.TRENDYOL,
  file: Buffer.from('synthetic workbook bytes'),
  filename: 'tariff.xlsx',
  createdBy: null,
  name: undefined,
  config: null,
  now: new Date('2026-11-15T10:00:00.000Z'),
};

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the import to reject');
}

function fileIssues(err: unknown): unknown {
  if (!(err instanceof ValidationError))
    throw new Error(`expected a ValidationError: ${String(err)}`);
  return err.issues;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readWorkbookGrid.mockResolvedValue(WITH_SELECTION);
  mocks.patchWorkbook.mockImplementation(async (file: Buffer) => [file]);
  mocks.findVariants.mockResolvedValue([]);
  mocks.transaction.mockImplementation(async (run: (tx: object) => Promise<unknown>) => run({}));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('importWorkbook: what persist throws', () => {
  it('turns a DUPLICATE_WEEK rejection into a DUPLICATE_WEEK file issue', async () => {
    const adapter = fakeAdapter(async () => {
      throw new WorkbookFileRejection('DUPLICATE_WEEK');
    });

    const err = await rejection(importWorkbook(adapter, INPUT));

    expect(fileIssues(err)).toEqual([{ field: 'file', code: 'DUPLICATE_WEEK' }]);
  });

  it('turns a unique violation the adapter claims into the same DUPLICATE_WEEK file issue', async () => {
    const adapter = fakeAdapter(async () => {
      throw UNIQUE_VIOLATION;
    });

    const err = await rejection(importWorkbook(adapter, INPUT));

    expect(fileIssues(err)).toEqual([{ field: 'file', code: 'DUPLICATE_WEEK' }]);
  });

  it('lets a WorkbookConflictError through unchanged', async () => {
    const conflict = new WorkbookConflictError('UPLOAD_QUOTA_EXCEEDED');
    const adapter = fakeAdapter(async () => {
      throw conflict;
    });

    expect(await rejection(importWorkbook(adapter, INPUT))).toBe(conflict);
  });

  it('turns a value out of range for its column (P2020) into MALFORMED_SHEET on file', async () => {
    const warn = vi.spyOn(syncLog, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(syncLog, 'info').mockImplementation(() => undefined);
    // The driver's message quotes the cell value; no log line may carry it.
    const cellValue = '3000000000';
    const outOfRange = Object.assign(
      new Error(`value "${cellValue}" is out of range for type integer`),
      { code: 'P2020', meta: { modelName: 'CommissionTariffItem' } },
    );
    const adapter = fakeAdapter(async () => {
      throw outOfRange;
    });

    const err = await rejection(importWorkbook(adapter, INPUT));

    expect(fileIssues(err)).toEqual([{ field: 'file', code: 'MALFORMED_SHEET' }]);
    expect(warn.mock.calls).toEqual([
      ['workbook.import.value-out-of-range', { page: PAGE, prismaCode: 'P2020' }],
    ]);
    expect(JSON.stringify([warn.mock.calls, info.mock.calls])).not.toContain(cellValue);
  });

  describe('a Postgres data exception (SQLSTATE class 22) the insert raises', () => {
    // The driver's message quotes the cell value; no log line may carry it.
    const MESSAGE = 'invalid byte sequence for encoding "UTF8": 0x00 near the cell value';

    /**
     * A database error as Prisma 7 + @prisma/adapter-pg raise it from a typed write that
     * no Prisma code covers (measured for 22021, 22007 and 22009): a DriverAdapterError
     * with no `code` of its own and the SQLSTATE in `cause.originalCode` and `cause.code`.
     */
    function driverAdapterError(sqlState: string): Error {
      const err = new Error(MESSAGE, {
        cause: {
          originalCode: sqlState,
          originalMessage: MESSAGE,
          kind: 'postgres',
          code: sqlState,
          severity: 'ERROR',
          message: MESSAGE,
        },
      });
      err.name = 'DriverAdapterError';
      return Object.assign(err, { clientVersion: '7.8.0' });
    }

    /**
     * The same failure when Prisma maps it to a code of its own (measured: 22001 as
     * P2000): the driver adapter error sits under `meta.driverAdapterError`.
     */
    function wrappedDriverAdapterError(prismaCode: string, sqlState: string): Error {
      return Object.assign(new Error(MESSAGE), {
        name: 'PrismaClientKnownRequestError',
        code: prismaCode,
        meta: {
          modelName: 'DiscountListItem',
          driverAdapterError: new Error(MESSAGE, {
            cause: { originalCode: sqlState, originalMessage: MESSAGE, kind: 'LengthMismatch' },
          }),
        },
        clientVersion: '7.8.0',
      });
    }

    it.each([
      ['22021 (U+0000 in a text column)', driverAdapterError('22021'), '22021'],
      ['22007 (a date the driver formats badly)', driverAdapterError('22007'), '22007'],
      ['22001 wrapped as P2000', wrappedDriverAdapterError('P2000', '22001'), '22001'],
    ])(
      'turns %s into MALFORMED_SHEET value-not-storable on file',
      async (_name, thrown, sqlState) => {
        const warn = vi.spyOn(syncLog, 'warn').mockImplementation(() => undefined);
        const info = vi.spyOn(syncLog, 'info').mockImplementation(() => undefined);
        const adapter = fakeAdapter(async () => {
          throw thrown;
        });

        const err = await rejection(importWorkbook(adapter, INPUT));

        expect(fileIssues(err)).toEqual([{ field: 'file', code: 'MALFORMED_SHEET' }]);
        expect(warn.mock.calls).toEqual([
          ['workbook.import.value-not-storable', { page: PAGE, sqlState }],
        ]);
        expect(info.mock.calls).toEqual([
          [
            'workbook.upload-rejected',
            { page: PAGE, code: 'MALFORMED_SHEET', reason: VALUE_NOT_STORABLE_REASON },
          ],
        ]);
        expect(VALUE_NOT_STORABLE_REASON).toBe('value-not-storable');
        expect(JSON.stringify([warn.mock.calls, info.mock.calls])).not.toContain('cell value');
      },
    );

    it.each([
      ['40001 (a serialization failure)', '40001'],
      ['23505 (a unique violation no adapter claims)', '23505'],
    ])('rethrows %s unchanged', async (_name, sqlState) => {
      const thrown = driverAdapterError(sqlState);
      const adapter = fakeAdapter(async () => {
        throw thrown;
      });

      expect(await rejection(importWorkbook(adapter, INPUT))).toBe(thrown);
    });
  });

  it('leaves another Prisma code to the transaction mapper', async () => {
    // A write conflict: mapPrismaError rethrows it untouched.
    const conflict = Object.assign(new Error('write conflict'), { code: 'P2034' });
    const adapter = fakeAdapter(async () => {
      throw conflict;
    });

    expect(await rejection(importWorkbook(adapter, INPUT))).toBe(conflict);
  });
});

describe('importWorkbook: a file without a write-back column', () => {
  it('refuses it with NO_WRITEBACK_COLUMN on file, logs once with the page only, writes nothing', async () => {
    mocks.readWorkbookGrid.mockResolvedValue(WITHOUT_SELECTION);
    const warn = vi.spyOn(syncLog, 'warn').mockImplementation(() => undefined);
    vi.spyOn(syncLog, 'info').mockImplementation(() => undefined);
    const persist = vi.fn(async () => ({ parentId: 'list-1', itemCount: 1 }));
    const adapter = fakeAdapter(persist);

    const err = await rejection(importWorkbook(adapter, INPUT));

    expect(fileIssues(err)).toEqual([{ field: 'file', code: 'NO_WRITEBACK_COLUMN' }]);
    const lines = warn.mock.calls.filter(
      ([event]) => event === 'workbook.import.no-writeback-column',
    );
    expect(lines).toEqual([['workbook.import.no-writeback-column', { page: PAGE }]]);
    // Refused before the rehearsal and the transaction.
    expect(persist).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.patchWorkbook).not.toHaveBeenCalled();
  });

  it('does not log it when the write-back column is there, and rehearses once', async () => {
    const warn = vi.spyOn(syncLog, 'warn').mockImplementation(() => undefined);
    const adapter = fakeAdapter(async () => ({ parentId: 'list-1', itemCount: 1 }));

    await importWorkbook(adapter, INPUT);

    expect(warn.mock.calls.map(([event]) => event)).not.toContain(
      'workbook.import.no-writeback-column',
    );
    expect(mocks.patchWorkbook).toHaveBeenCalledTimes(1);
  });
});

describe('importWorkbook: the quota pre-check', () => {
  it('refuses a store at its quota before it reads the file', async () => {
    const conflict = new WorkbookConflictError('UPLOAD_QUOTA_EXCEEDED', {
      limit: 'lists',
      maxLists: 50,
    });
    vi.mocked(assertUploadQuota).mockRejectedValueOnce(conflict);
    const adapter = fakeAdapter(async () => ({ parentId: 'list-1', itemCount: 1 }));

    expect(await rejection(importWorkbook(adapter, INPUT))).toBe(conflict);
    expect(mocks.readWorkbookGrid).not.toHaveBeenCalled();
    expect(mocks.patchWorkbook).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('checks the quota before the parse, then again inside the transaction', async () => {
    const tx = {};
    mocks.transaction.mockImplementation(async (run: (client: object) => Promise<unknown>) =>
      run(tx),
    );
    const adapter = fakeAdapter(async () => ({ parentId: 'list-1', itemCount: 1 }));

    await importWorkbook(adapter, INPUT);

    const quota = vi.mocked(assertUploadQuota).mock;
    expect(quota.calls).toHaveLength(2);
    const [preCheckOrder] = quota.invocationCallOrder;
    const [firstReadOrder] = mocks.readWorkbookGrid.mock.invocationCallOrder;
    expect(preCheckOrder).toBeDefined();
    expect(firstReadOrder).toBeDefined();
    expect(preCheckOrder ?? Infinity).toBeLessThan(firstReadOrder ?? -Infinity);
    expect(quota.calls[0]?.[0]).toBe(prisma);
    expect(quota.calls[1]?.[0]).toBe(tx);
  });
});
