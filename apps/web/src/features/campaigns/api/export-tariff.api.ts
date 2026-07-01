import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

/**
 * POST /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/export
 *
 * Returns the ORIGINAL Trendyol `.xlsx` with the seller's band choices patched
 * in, ready to re-upload verbatim. Resolves to the file `Blob`.
 *
 * Binary-download convention (first in this codebase): the endpoint returns an
 * xlsx on success but a JSON ProblemDetails on error, so a blanket `parseAs`
 * would misparse one of them. We use `parseAs: 'stream'` (openapi-fetch does NOT
 * consume or JSON-parse the body), then branch on `response.ok`: on success read
 * the `Blob`; on failure re-read the JSON problem from a clone so `throwApiError`
 * keeps full fidelity (`code`, `detail`).
 */
export async function exportTariff(
  orgId: string,
  storeId: string,
  tariffId: string,
): Promise<Blob> {
  const { response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/export',
    { params: { path: { orgId, storeId, tariffId } }, parseAs: 'stream' },
  );

  if (response === undefined || !response.ok) {
    const problem: unknown =
      response !== undefined
        ? await response
            .clone()
            .json()
            .catch(() => undefined)
        : undefined;
    throwApiError(problem, response);
  }

  return response.blob();
}
