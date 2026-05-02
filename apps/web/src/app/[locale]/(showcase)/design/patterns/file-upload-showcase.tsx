'use client';

import * as React from 'react';

import { FileUpload } from '@/components/patterns/file-upload';

const MAX_CSV_BYTES = 5 * 1024 * 1024;

/**
 * Synthetic File for the "filled" demo state. Real upload flows pass
 * a File object received from the picker / drop event — this stub
 * mirrors the shape so the showcase renders without an actual file
 * pick. ISO date in the filename keeps the showcase deterministic
 * across reloads (no Date.now() drift).
 */
function makeMockFile(name: string, sizeBytes: number): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type: 'text/csv' });
  return new File([blob], name, { type: 'text/csv' });
}

export function FileUploadShowcase(): React.ReactElement {
  const [emptyFile, setEmptyFile] = React.useState<File | null>(null);
  const [filled, setFilled] = React.useState<File | null>(() =>
    makeMockFile('hakedis-2026-04-trendyol.csv', 124 * 1024),
  );
  const [errored, setErrored] = React.useState<File | null>(null);
  const [loadingFile, setLoadingFile] = React.useState<File | null>(() =>
    makeMockFile('hakedis-2026-03-trendyol.csv', 98 * 1024),
  );

  return (
    <div className="gap-md grid sm:grid-cols-2">
      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Boş — sürükle veya seç (CSV · max 5MB)
        </span>
        <FileUpload
          value={emptyFile}
          onChange={setEmptyFile}
          accept="text/csv,.csv"
          maxSize={MAX_CSV_BYTES}
          prompt="Hakediş CSV'sini buraya bırak"
          hint="CSV · max 5 MB"
        />
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Dosya seçili — boyut + kaldır butonu
        </span>
        <FileUpload value={filled} onChange={setFilled} accept="text/csv,.csv" />
        <span className="text-2xs text-muted-foreground">
          Sağdaki X&apos;e tıkla → state null&apos;a döner.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Hatalı (server-side error)
        </span>
        <FileUpload
          value={errored}
          onChange={setErrored}
          accept="text/csv,.csv"
          maxSize={MAX_CSV_BYTES}
          prompt="Hakediş CSV'sini buraya bırak"
          hint="CSV · max 5 MB"
          error="Bu dönem için zaten bir mutabakat dosyası yüklenmiş."
        />
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Yükleniyor (loading)
        </span>
        <FileUpload value={loadingFile} onChange={setLoadingFile} loading />
        <span className="text-2xs text-muted-foreground">
          Async upload — kaldır butonu spinner ile değişir.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Pasif (disabled)
        </span>
        <FileUpload
          value={null}
          onChange={() => undefined}
          accept="text/csv,.csv"
          prompt="Sistem-yönetilen import — manuel yükleme kapalı"
          hint="Otomatik sync aktif"
          disabled
        />
      </div>
    </div>
  );
}
