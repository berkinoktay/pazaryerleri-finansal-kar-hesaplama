import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { WORKBOOK_PAGES, type WorkbookPage } from '@pazarsync/utils';

import { useExportWorkbook } from '@/features/campaigns/hooks/use-export-workbook';
import { ApiError } from '@/lib/api-error';

import { HttpResponse, http, server } from '../../helpers/msw';
import { createTestQueryClient } from '../../helpers/render';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const RECORD_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const STORE_BASE = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}`;

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// xlsx files are zip archives: "PK\x03\x04" is the ZIP local-file-header magic.
const XLSX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
// A name with a non-ASCII letter, percent-encoded in the RFC 8187 `filename*` form; the expected
// name is built from its code point so this file stays ASCII.
const ENCODED_DISPOSITION = "attachment; filename*=UTF-8''%C4%B0ndirimler.xlsx";
const DECODED_NAME = `${String.fromCodePoint(0x130)}ndirimler.xlsx`;
const CONFLICT_CODE = 'STORED_FILE_MISSING';
const CONFLICT_DETAIL = 'The record has no stored source file';
const BAD_GATEWAY = 502;

interface PageRow {
  readonly page: WorkbookPage;
  /** The page's route segment under the store. */
  readonly segment: string;
  /** The root segment of the page's query keys. */
  readonly keyRoot: string;
}

// Written out here rather than read from the code under test, so a wrong segment or key root
// in the shared config fails this file.
const PAGES: readonly PageRow[] = [
  {
    page: WORKBOOK_PAGES.COMMISSION_TARIFF,
    segment: 'commission-tariffs',
    keyRoot: 'commission-tariffs',
  },
  {
    page: WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF,
    segment: 'plus-commission-tariffs',
    keyRoot: 'plus-commission-tariffs',
  },
  {
    page: WORKBOOK_PAGES.ADVANTAGE_TARIFF,
    segment: 'advantage-tariffs',
    keyRoot: 'advantage-tariffs',
  },
  {
    page: WORKBOOK_PAGES.FLASH_PRODUCT_LIST,
    segment: 'flash-products',
    keyRoot: 'flash-products',
  },
  {
    page: WORKBOOK_PAGES.DISCOUNT_LIST,
    segment: 'discount-lists',
    keyRoot: 'discount-lists',
  },
  {
    page: WORKBOOK_PAGES.MARKETPLACE_CAMPAIGN_LIST,
    segment: 'marketplace-campaigns',
    keyRoot: 'marketplace-campaigns',
  },
];

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function exportUrl(row: PageRow): string {
  return `${STORE_BASE}/${row.segment}/${RECORD_ID}/export`;
}

function xlsxResponse(headers: Record<string, string> = {}): HttpResponse<Uint8Array> {
  return new HttpResponse(XLSX_BYTES, {
    status: 200,
    headers: { 'content-type': XLSX_TYPE, ...headers },
  });
}

function renderExport(page: WorkbookPage, client: QueryClient = createTestQueryClient()) {
  return renderHook(() => useExportWorkbook(page, ORG_ID, STORE_ID), {
    wrapper: makeWrapper(client),
  });
}

describe('useExportWorkbook', () => {
  it('covers every workbook page', () => {
    expect(PAGES.map((row) => row.page).sort()).toEqual(Object.values(WORKBOOK_PAGES).sort());
  });

  describe.each(PAGES)('$page', (row) => {
    it('posts to the export path and resolves the bytes and the decoded filename* name', async () => {
      let requests = 0;
      server.use(
        http.post(exportUrl(row), () => {
          requests += 1;
          return xlsxResponse({ 'content-disposition': ENCODED_DISPOSITION });
        }),
      );

      const { result } = renderExport(row.page);
      result.current.mutate(RECORD_ID);

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(requests).toBe(1);
      expect(result.current.data?.blob).toBeInstanceOf(Blob);
      expect(result.current.data?.blob.size).toBe(XLSX_BYTES.byteLength);
      expect(result.current.data?.filename).toBe(DECODED_NAME);
    });

    it('resolves a null filename when Content-Disposition is absent (the caller falls back)', async () => {
      server.use(http.post(exportUrl(row), () => xlsxResponse()));

      const { result } = renderExport(row.page);
      result.current.mutate(RECORD_ID);

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.filename).toBeNull();
    });

    it('rejects a 409 JSON problem as an ApiError with its code and detail', async () => {
      server.use(
        http.post(exportUrl(row), () =>
          HttpResponse.json(
            {
              type: 'about:blank',
              title: 'Conflict',
              status: 409,
              code: CONFLICT_CODE,
              detail: CONFLICT_DETAIL,
            },
            { status: 409, headers: { 'content-type': 'application/problem+json' } },
          ),
        ),
      );

      const { result } = renderExport(row.page);
      result.current.mutate(RECORD_ID);

      await waitFor(() => expect(result.current.isError).toBe(true));
      const error = result.current.error;
      expect(error).toBeInstanceOf(ApiError);
      if (!(error instanceof ApiError)) throw new Error('expected ApiError');
      expect(error.status).toBe(409);
      expect(error.code).toBe(CONFLICT_CODE);
      expect(error.detail).toBe(CONFLICT_DETAIL);
    });

    it('invalidates the store list and the detail of that record on success', async () => {
      server.use(http.post(exportUrl(row), () => xlsxResponse()));
      const client = createTestQueryClient();
      const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

      const { result } = renderExport(row.page, client);
      result.current.mutate(RECORD_ID);

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: [row.keyRoot, 'list', ORG_ID, STORE_ID],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: [row.keyRoot, 'detail', ORG_ID, STORE_ID, RECORD_ID],
      });
    });
  });

  it('rejects a failure with an empty body instead of handing it out as the file', async () => {
    // openapi-fetch answers an empty failure body with `error: undefined`, so only the status
    // tells it apart from a file.
    const [row] = PAGES;
    if (row === undefined) throw new Error('empty page table');
    server.use(
      http.post(
        exportUrl(row),
        () => new HttpResponse(null, { status: BAD_GATEWAY, headers: { 'content-length': '0' } }),
      ),
    );

    const { result } = renderExport(row.page);
    result.current.mutate(RECORD_ID);

    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error;
    if (!(error instanceof ApiError)) throw new Error('expected ApiError');
    expect(error.status).toBe(BAD_GATEWAY);
    expect(error.code).toBe('UNKNOWN_ERROR');
  });
});
