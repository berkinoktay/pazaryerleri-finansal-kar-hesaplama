import type { WorkbookPage } from '@pazarsync/utils';

import { throwApiError } from '@/lib/api-error';

import { filenameFromDisposition, type WorkbookExportFile } from './binary-download';
import {
  WORKBOOK_ENDPOINTS,
  type WorkbookImportInput,
  type WorkbookImportResult,
} from './workbook-endpoints';

/**
 * The multipart body of an upload: the file, then every field whose value is neither
 * `undefined` nor `''`. Returning `FormData` from openapi-fetch's `bodySerializer` makes it omit
 * `Content-Type`, so the browser sets it with the right multipart boundary.
 */
function toFormData(input: WorkbookImportInput): FormData {
  const formData = new FormData();
  formData.append('file', input.file);
  for (const [key, value] of Object.entries(input.fields)) {
    if (value !== undefined && value !== '') formData.append(key, value);
  }
  return formData;
}

/**
 * POST /v1/organizations/{orgId}/stores/{storeId}/<page segment>/import
 *
 * Uploads a marketplace workbook of one campaign page as `multipart/form-data` and resolves the
 * new record's id with the count of rows that arrived already filled in. A refused upload
 * throws the API's error as an `ApiError` (a `422` with field issues, the `413`, a `409`).
 */
export async function importWorkbook(
  page: WorkbookPage,
  orgId: string,
  storeId: string,
  input: WorkbookImportInput,
): Promise<WorkbookImportResult> {
  const call = await WORKBOOK_ENDPOINTS[page].importFile(orgId, storeId, input, () =>
    toFormData(input),
  );
  // A success without a body (no result) is an answer this client cannot use either.
  if (call.error !== undefined || call.result === undefined) {
    throwApiError(call.error, call.response);
  }
  return call.result;
}

/**
 * POST /v1/organizations/{orgId}/stores/{storeId}/<page segment>/{id}/export
 *
 * Returns the page's ORIGINAL marketplace file with the seller's choices patched in (or a
 * `.zip` of window files for a split tariff week), plus the server-chosen filename.
 *
 * Binary-download convention: the endpoint returns a file on success but a JSON
 * ProblemDetails on error, so a blanket `parseAs` would misparse one of them. With
 * `parseAs: 'stream'` openapi-fetch leaves a successful body unread, so the status decides: on
 * success the `Blob` is read; on failure openapi-fetch has already read the body and parsed the
 * JSON problem into `error`, which `throwApiError` takes as it is (`code`, `detail`). The
 * consumed body is never read again: a `clone()` of it throws. A failure with an empty body
 * leaves `error` undefined, which is why the status, not `error`, is checked.
 */
export async function exportWorkbook(
  page: WorkbookPage,
  orgId: string,
  storeId: string,
  id: string,
): Promise<WorkbookExportFile> {
  const call = await WORKBOOK_ENDPOINTS[page].exportFile(orgId, storeId, id);
  if (call.error !== undefined || call.response === undefined || !call.response.ok) {
    throwApiError(call.error, call.response);
  }
  const blob = await call.response.blob();
  return {
    blob,
    filename: filenameFromDisposition(call.response.headers.get('Content-Disposition')),
  };
}
