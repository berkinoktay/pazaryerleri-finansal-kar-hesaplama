/**
 * Triggers a browser download of a Blob under `filename`. Used for the exported
 * tariff `.xlsx` — the backend returns the file body, this hands it to the
 * browser via a transient object URL + `<a download>` (revoked immediately after
 * the synchronous click).
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
