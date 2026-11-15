// The web client's reading of a download name, mirrored from `filenameFromDisposition`
// in apps/web/src/features/campaigns/api/binary-download.ts (the api cannot import from
// the web app). It takes the FIRST `filename*=UTF-8''` anywhere in the header, inside a
// quoted value or not, so a test can prove that the name a header carries is the name
// the seller's browser saves. Keep it in step with the web function.

const UTF8_FILENAME_RE = /filename\*=UTF-8''([^;]+)/i;
const PLAIN_FILENAME_RE = /filename="?([^";]+)"?/i;

export function webClientFilename(header: string | null): string | null {
  if (header === null) return null;
  const utf8 = UTF8_FILENAME_RE.exec(header);
  if (utf8?.[1] !== undefined) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return null;
    }
  }
  const plain = PLAIN_FILENAME_RE.exec(header);
  return plain?.[1] ?? null;
}
