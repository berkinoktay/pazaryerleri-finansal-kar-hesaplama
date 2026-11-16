/**
 * Triggers a browser download of a Blob under `filename`. Used for the exported
 * tariff `.xlsx` — the backend returns the file body, this hands it to the
 * browser via a transient object URL + `<a download>`. The URL is revoked on a
 * later task, not right after the click: a browser may start reading the blob only
 * after the click handler returns, and a URL revoked in the same task can cancel
 * the download.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
