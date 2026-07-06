/**
 * Shared helpers for the tariff binary-download endpoints (commission + Plus). Both
 * export endpoints return a file on success but a JSON ProblemDetails on error, and
 * both name the file (`.xlsx` or `.zip`) in `Content-Disposition`. Keeping the
 * filename parser and the download-file shape here means the two `.api.ts` callers
 * read the header identically.
 */

/** A downloaded export: the file bytes plus the server-chosen name (`.xlsx` or `.zip`). */
export interface TariffExportFile {
  readonly blob: Blob;
  /** From `Content-Disposition`; null if the header is absent (caller falls back). */
  readonly filename: string | null;
}

/**
 * Reads the download filename from a `Content-Disposition` header. Prefers the
 * RFC 5987 `filename*=UTF-8''<pct-encoded>` form (Turkish names, our backend's
 * format), falling back to a plain `filename="..."`. Returns null when neither is
 * present so the caller can supply its own name.
 */
export function filenameFromDisposition(header: string | null): string | null {
  if (header === null) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1] !== undefined) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return null;
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? null;
}
