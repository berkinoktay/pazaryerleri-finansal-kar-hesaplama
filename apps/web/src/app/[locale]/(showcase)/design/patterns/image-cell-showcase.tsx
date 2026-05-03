'use client';

import * as React from 'react';

import { ImageCell } from '@/components/patterns/image-cell';

const SAMPLE_REAL = '/brands/trendyol.svg';
const SAMPLE_BROKEN = 'https://cdn.example.invalid/missing.jpg';

export function ImageCellShowcase(): React.ReactElement {
  return (
    <div className="gap-lg flex flex-col">
      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Boyut presetleri — sm 32, md 40, lg 56
        </span>
        <div className="gap-md flex flex-wrap items-end">
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <div key={size} className="gap-3xs flex flex-col items-center">
              <ImageCell src={SAMPLE_REAL} alt="Trendyol" size={size} />
              <span className="text-2xs text-muted-foreground font-mono">size={size}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Şekil — kare (default) ve daire
        </span>
        <div className="gap-md flex flex-wrap items-end">
          <div className="gap-3xs flex flex-col items-center">
            <ImageCell src={SAMPLE_REAL} alt="Trendyol kare" shape="square" />
            <span className="text-2xs text-muted-foreground font-mono">square</span>
          </div>
          <div className="gap-3xs flex flex-col items-center">
            <ImageCell src={SAMPLE_REAL} alt="Trendyol daire" shape="circle" />
            <span className="text-2xs text-muted-foreground font-mono">circle</span>
          </div>
        </div>
        <span className="text-2xs text-muted-foreground">
          `shape=&quot;circle&quot;` + `fallback=&quot;initials&quot;` kanonik avatar primitive
          olarak okunur.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Eksik src — fallback varyantları
        </span>
        <div className="gap-md flex flex-wrap items-end">
          <div className="gap-3xs flex flex-col items-center">
            <ImageCell src={null} alt="Eksik ürün" />
            <span className="text-2xs text-muted-foreground font-mono">
              fallback=&quot;icon&quot;
            </span>
          </div>
          <div className="gap-3xs flex flex-col items-center">
            <ImageCell src={null} alt="Ayşe Yılmaz" fallback="initials" shape="circle" />
            <span className="text-2xs text-muted-foreground font-mono">
              fallback=&quot;initials&quot; (Ayşe Yılmaz → AY)
            </span>
          </div>
          <div className="gap-3xs flex flex-col items-center">
            <ImageCell src={null} alt="Single" fallback="initials" />
            <span className="text-2xs text-muted-foreground font-mono">
              tek kelime → ilk 2 karakter (Single → SI)
            </span>
          </div>
        </div>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Kırık URL — onError sonrası icon fallback
        </span>
        <div className="gap-md flex flex-wrap items-end">
          <ImageCell src={SAMPLE_BROKEN} alt="Yüklenemedi" />
        </div>
        <span className="text-2xs text-muted-foreground">
          Tarayıcı `onError` tetiklediğinde wrapper otomatik icon fallback&apos;a geçer.
          ProductImageCell PR #130 öncesindeki davranışla birebir aynı; sadece pattern artık
          paylaşılan.
        </span>
      </div>
    </div>
  );
}
