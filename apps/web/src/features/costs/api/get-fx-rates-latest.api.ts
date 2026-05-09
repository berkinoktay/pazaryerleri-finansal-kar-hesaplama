/**
 * Fetches the latest FX rates (USD/TRY and EUR/TRY) from the TCMB cron cache.
 *
 * NOTE: This endpoint is added in PR 6 (GET /fx-rates/latest). Until PR 6 is
 * merged into @pazarsync/api-client, this function returns a typed stub.
 * The hook (use-fx-rates-latest.ts) gracefully handles null data.
 */

export interface FxRateEntry {
  rate: string;
  date: string;
  source: string;
}

export interface FxRatesLatestResponse {
  USD: FxRateEntry | null;
  EUR: FxRateEntry | null;
}

/**
 * Returns the latest FX rates for display in the cost-profile form's FX preview.
 * Placeholder until the /fx-rates/latest endpoint lands from PR 6.
 */
export async function getFxRatesLatest(): Promise<FxRatesLatestResponse> {
  // TODO(PR6): replace with apiClient.GET('/v1/fx-rates/latest', ...) once the
  // endpoint lands in @pazarsync/api-client. The hook already wraps this in
  // useQuery so callers handle loading/null states.
  return { USD: null, EUR: null };
}
