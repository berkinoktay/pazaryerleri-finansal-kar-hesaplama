'use client';

import { ImageUpload01Icon } from 'hugeicons-react';
import * as React from 'react';

import { FileUpload } from '@/components/patterns/file-upload';

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Synthetic File for the "filled" demo state. Real upload flows pass
 * a File object received from the picker / drop event — this stub
 * mirrors the shape so the showcase renders without an actual file
 * pick. ISO date in the filename keeps the showcase deterministic
 * across reloads (no Date.now() drift).
 */
function makeMockFile(name: string, sizeBytes: number, type: string = 'text/csv'): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  return new File([blob], name, { type });
}

/**
 * Generate a visible solid-color SVG file for the image-preview demo.
 * Real upload flows pass a File from the picker; for a showcase that
 * needs to render a recognizable thumbnail without external assets,
 * an inline SVG is the cheapest path that survives URL.createObjectURL.
 */
function makeMockImageFile(name: string, fillCss: string): File {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="${fillCss}"/></svg>`;
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  return new File([blob], name, { type: 'image/svg+xml' });
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
  const [imageFile, setImageFile] = React.useState<File | null>(() =>
    makeMockImageFile('urun-foto-2026-04-12.svg', '#3b82f6'),
  );
  const [progressFile, setProgressFile] = React.useState<File | null>(() =>
    makeMockFile('urunler-katalog.csv', 2.4 * 1024 * 1024),
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
          Görsel yükleme — boş (ImageUpload icon)
        </span>
        <FileUpload
          value={null}
          onChange={() => undefined}
          accept="image/*"
          maxSize={MAX_IMAGE_BYTES}
          prompt="Ürün görselini buraya bırak"
          hint="JPG / PNG · max 5 MB"
          ctaLabel="Görsel seç"
          emptyIcon={<ImageUpload01Icon aria-hidden />}
        />
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Görsel seçili — otomatik thumbnail önizlemesi
        </span>
        <FileUpload
          value={imageFile}
          onChange={setImageFile}
          accept="image/*"
          maxSize={MAX_IMAGE_BYTES}
        />
        <span className="text-2xs text-muted-foreground">
          MIME {`image/*`} ise satır ikonu yerine canlı thumbnail (URL.createObjectURL).
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Progress — 0–100 belirli ilerleme barı
        </span>
        <FileUpload value={progressFile} onChange={setProgressFile} progress={62} />
        <span className="text-2xs text-muted-foreground">
          progress=62 → bar ve % yan yana; spinner gizlenir, kaldır butonu açık kalır.
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
          Yükleniyor (loading, progress yok)
        </span>
        <FileUpload value={loadingFile} onChange={setLoadingFile} loading />
        <span className="text-2xs text-muted-foreground">
          progress yoksa loading=true → spinner. Belirli yüzde varsa progress kullan.
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
