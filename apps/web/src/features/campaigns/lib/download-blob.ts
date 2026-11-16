/**
 * How long the object URL of a download is held before it is revoked. A browser may read the
 * blob after the click's task (Safari, Firefox), so a revoke after 0 ms only moves the race;
 * the URL is held a little longer, never leaked.
 */
const OBJECT_URL_REVOKE_DELAY_MS = 40_000;

/**
 * Triggers a browser download of a Blob under `filename`. Used for the exported
 * tariff `.xlsx` — the backend returns the file body, this hands it to the
 * browser via a transient object URL + `<a download>`. The URL is revoked after
 * {@link OBJECT_URL_REVOKE_DELAY_MS}, not right after the click: a URL revoked
 * while the browser still reads the blob can cancel the download.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS);
}
