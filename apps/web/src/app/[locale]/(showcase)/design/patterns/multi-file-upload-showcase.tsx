'use client';

import { ImageUpload01Icon } from 'hugeicons-react';
import * as React from 'react';

import { MultiFileUpload } from '@/components/patterns/multi-file-upload';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 6;

function makeMockFile(name: string, sizeBytes: number, type: string): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  return new File([blob], name, { type });
}

/**
 * Visible solid-color SVG file for image rows so the multi-file
 * preview demo renders recognizable thumbnails. Pad the SVG body to
 * the desired size budget so the row's tabular `1.3 MB` line still
 * matches what a real upload would show.
 */
function makeMockImageFile(name: string, fillCss: string, sizeBytes: number): File {
  const svgHeader = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="${fillCss}"/>`;
  const svgFooter = '</svg>';
  const padBytes = Math.max(0, sizeBytes - svgHeader.length - svgFooter.length);
  // Pad with an SVG comment so the file size matches the demo claim
  // without changing the rendered visual.
  const padding = `<!--${' '.repeat(padBytes - 7)}-->`;
  const blob = new Blob([svgHeader, padding, svgFooter], { type: 'image/svg+xml' });
  return new File([blob], name, { type: 'image/svg+xml' });
}

const MIXED_BATCH_SEED: { name: string; sizeKB: number; type: string; fill?: string }[] = [
  { name: 'urun-foto-2026-04-12-01.svg', sizeKB: 1280, type: 'image/svg+xml', fill: '#3b82f6' },
  { name: 'urun-foto-2026-04-12-02.svg', sizeKB: 1580, type: 'image/svg+xml', fill: '#0ea5e9' },
  { name: 'paketleme-tutorial.mp3', sizeKB: 1630, type: 'audio/mpeg' },
  { name: 'kargo-acilis-video.mp4', sizeKB: 1250, type: 'video/mp4' },
];

const PROGRESS_MAP: Record<number, number> = {
  0: 44,
  1: 26,
  2: 18,
  3: 47,
};

export function MultiFileUploadShowcase(): React.ReactElement {
  const [emptyBatch, setEmptyBatch] = React.useState<File[]>([]);
  const [seededBatch, setSeededBatch] = React.useState<File[]>(() =>
    MIXED_BATCH_SEED.map((spec) =>
      spec.fill !== undefined
        ? makeMockImageFile(spec.name, spec.fill, spec.sizeKB * 1024)
        : makeMockFile(spec.name, spec.sizeKB * 1024, spec.type),
    ),
  );

  return (
    <div className="gap-md grid lg:grid-cols-2">
      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Boş — çoklu görsel batch (max 6 · 5MB/dosya)
        </span>
        <MultiFileUpload
          value={emptyBatch}
          onChange={setEmptyBatch}
          accept="image/*"
          maxSize={MAX_IMAGE_BYTES}
          maxFiles={MAX_FILES}
          prompt="Görselleri buraya bırak"
          hint={`Max ${MAX_FILES} dosya · 5 MB/dosya`}
          ctaLabel="Görsel seç"
          emptyIcon={<ImageUpload01Icon aria-hidden />}
        />
        <span className="text-2xs text-muted-foreground">
          Birden fazla dosya seçildiğinde aynı anda commit edilir.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Liste — başlık, &quot;Dosya ekle&quot;, &quot;Tümünü kaldır&quot;, per-file progress
        </span>
        <MultiFileUpload
          value={seededBatch}
          onChange={setSeededBatch}
          accept="image/*,audio/*,video/*"
          maxFiles={MAX_FILES}
          progress={PROGRESS_MAP}
        />
        <span className="text-2xs text-muted-foreground">
          MIME-aware ikon: image / audio / video / generic. progress map index → 0-100.
        </span>
      </div>
    </div>
  );
}
