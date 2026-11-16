import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { WORKBOOK_PAGES, type WorkbookPage } from '@pazarsync/utils';

import { useImportWorkbook } from '@/features/campaigns/hooks/use-import-workbook';
import { extractFileIssue } from '@/features/campaigns/lib/upload-error';
import { ApiError } from '@/lib/api-error';

import { problemApiError, validationApiError } from '../../helpers/api-error';
import { HttpResponse, http, server } from '../../helpers/msw';
import { createTestQueryClient } from '../../helpers/render';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const NEW_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const STORE_BASE = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}`;

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FILE_NAME = 'upload.xlsx';
const LIST_NAME = 'July list';
const PREFILLED_ROWS = 3;
const PROBLEM_HEADERS = { 'content-type': 'application/problem+json' };
const MISSING_DISCOUNT_TYPE = 'importFile: discountType is missing';

interface PageRow {
  readonly page: WorkbookPage;
  /** The page's route segment under the store. */
  readonly segment: string;
  /** The key the page's import response names the new record under. */
  readonly idKey: 'tariffId' | 'listId' | 'campaignId';
  /** The root segment of the page's query keys. */
  readonly keyRoot: string;
  /** Fields the page's form always sends: the two config pages need their discount type. */
  readonly requiredFields: Readonly<Record<string, string>>;
}

// Written out here rather than read from the code under test, so a wrong segment, id key or
// key root in the shared config fails this file.
const PAGES: readonly PageRow[] = [
  {
    page: WORKBOOK_PAGES.COMMISSION_TARIFF,
    segment: 'commission-tariffs',
    idKey: 'tariffId',
    keyRoot: 'commission-tariffs',
    requiredFields: {},
  },
  {
    page: WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF,
    segment: 'plus-commission-tariffs',
    idKey: 'tariffId',
    keyRoot: 'plus-commission-tariffs',
    requiredFields: {},
  },
  {
    page: WORKBOOK_PAGES.ADVANTAGE_TARIFF,
    segment: 'advantage-tariffs',
    idKey: 'tariffId',
    keyRoot: 'advantage-tariffs',
    requiredFields: {},
  },
  {
    page: WORKBOOK_PAGES.FLASH_PRODUCT_LIST,
    segment: 'flash-products',
    idKey: 'listId',
    keyRoot: 'flash-products',
    requiredFields: {},
  },
  {
    page: WORKBOOK_PAGES.DISCOUNT_LIST,
    segment: 'discount-lists',
    idKey: 'listId',
    keyRoot: 'discount-lists',
    requiredFields: { discountType: 'NET' },
  },
  {
    page: WORKBOOK_PAGES.MARKETPLACE_CAMPAIGN_LIST,
    segment: 'marketplace-campaigns',
    idKey: 'campaignId',
    keyRoot: 'marketplace-campaigns',
    requiredFields: { discountType: 'NET' },
  },
];

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function importUrl(row: PageRow): string {
  return `${STORE_BASE}/${row.segment}/import`;
}

function importResponse(row: PageRow): Record<string, unknown> {
  return {
    [row.idKey]: NEW_ID,
    itemCount: 2,
    matched: 2,
    unmatched: 0,
    skippedRows: 0,
    prefilledRows: PREFILLED_ROWS,
  };
}

function xlsxFile(): File {
  return new File(['barcode'], FILE_NAME, { type: XLSX_TYPE });
}

function renderImport(page: WorkbookPage, client: QueryClient = createTestQueryClient()) {
  return renderHook(() => useImportWorkbook(page, ORG_ID, STORE_ID), {
    wrapper: makeWrapper(client),
  });
}

function stringEntries(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    [...formData.entries()].flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [],
    ),
  );
}

describe('useImportWorkbook', () => {
  it('covers every workbook page', () => {
    expect(PAGES.map((row) => row.page).sort()).toEqual(Object.values(WORKBOOK_PAGES).sort());
  });

  describe.each(PAGES)('$page', (row) => {
    it('posts the file as multipart/form-data under `file` and resolves the id and prefilled count', async () => {
      let contentType: string | null = null;
      let fileName: string | null = null;
      server.use(
        http.post(importUrl(row), async ({ request }) => {
          contentType = request.headers.get('content-type');
          const file = (await request.formData()).get('file');
          fileName = file instanceof File ? file.name : null;
          return HttpResponse.json(importResponse(row), { status: 201 });
        }),
      );

      const { result } = renderImport(row.page);
      result.current.mutate({ file: xlsxFile(), fields: row.requiredFields });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(contentType).toMatch(/^multipart\/form-data/);
      expect(fileName).toBe(FILE_NAME);
      expect(result.current.data).toEqual({ id: NEW_ID, prefilledRows: PREFILLED_ROWS });
    });

    it('sends each non-empty field and omits undefined and empty fields', async () => {
      let fields: Record<string, string> = {};
      let rawBody = '';
      server.use(
        http.post(importUrl(row), async ({ request }) => {
          // The parsed form of the test environment drops an empty part, so the raw body is
          // where a sent empty field would show.
          rawBody = await request.clone().text();
          fields = stringEntries(await request.formData());
          return HttpResponse.json(importResponse(row), { status: 201 });
        }),
      );

      const { result } = renderImport(row.page);
      result.current.mutate({
        file: xlsxFile(),
        fields: { ...row.requiredFields, name: LIST_NAME, blank: '', missing: undefined },
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(fields).toEqual({ ...row.requiredFields, name: LIST_NAME });
      expect(rawBody).toContain('name="name"');
      expect(rawBody).not.toContain('name="blank"');
      expect(rawBody).not.toContain('name="missing"');
    });

    it('invalidates the store list of the page on success', async () => {
      server.use(
        http.post(importUrl(row), () => HttpResponse.json(importResponse(row), { status: 201 })),
      );
      const client = createTestQueryClient();
      const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

      const { result } = renderImport(row.page, client);
      result.current.mutate({ file: xlsxFile(), fields: row.requiredFields });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: [row.keyRoot, 'list', ORG_ID, STORE_ID],
      });
    });

    it('rejects a 422 with a file issue as an ApiError the dialog reads the issue from', async () => {
      const issue = {
        field: 'file',
        code: 'WRONG_FILE_FOR_PAGE',
        meta: { detectedPage: WORKBOOK_PAGES.FLASH_PRODUCT_LIST },
      };
      server.use(
        http.post(importUrl(row), () =>
          HttpResponse.json(validationApiError([issue]).problem, {
            status: 422,
            headers: PROBLEM_HEADERS,
          }),
        ),
      );

      const { result } = renderImport(row.page);
      result.current.mutate({ file: xlsxFile(), fields: row.requiredFields });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeInstanceOf(ApiError);
      expect(extractFileIssue(result.current.error)).toEqual({
        code: issue.code,
        meta: issue.meta,
      });
    });

    it.each([
      [409, 'IMPORT_IN_PROGRESS'],
      [413, 'PAYLOAD_TOO_LARGE'],
    ])('rejects a %i with the code %s', async (status, code) => {
      server.use(
        http.post(importUrl(row), () =>
          HttpResponse.json(problemApiError(status, code).problem, {
            status,
            headers: PROBLEM_HEADERS,
          }),
        ),
      );

      const { result } = renderImport(row.page);
      result.current.mutate({ file: xlsxFile(), fields: row.requiredFields });

      await waitFor(() => expect(result.current.isError).toBe(true));
      const error = result.current.error;
      if (!(error instanceof ApiError)) throw new Error('expected ApiError');
      expect(error.status).toBe(status);
      expect(error.code).toBe(code);
    });
  });

  describe.each([WORKBOOK_PAGES.DISCOUNT_LIST, WORKBOOK_PAGES.MARKETPLACE_CAMPAIGN_LIST])(
    '%s without a discount type',
    (page) => {
      it('rejects with the explicit error and sends no request', async () => {
        const row = PAGES.find((candidate) => candidate.page === page);
        if (row === undefined) throw new Error('page missing from the table');
        let requests = 0;
        server.use(
          http.post(importUrl(row), () => {
            requests += 1;
            return HttpResponse.json(importResponse(row), { status: 201 });
          }),
        );

        const { result } = renderImport(page);
        result.current.mutate({ file: xlsxFile(), fields: { name: LIST_NAME } });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).not.toBeInstanceOf(ApiError);
        expect(result.current.error?.message).toBe(MISSING_DISCOUNT_TYPE);
        expect(requests).toBe(0);
      });
    },
  );
});
