'use client';

import * as React from 'react';

import { ImageCell } from '@/components/patterns/image-cell';
import { Playground, control } from '@/components/showcase/playground';
import { Preview } from '@/components/showcase/preview';
import { SIZE_KEYS } from '@/lib/variants';

const SAMPLE_REAL = '/brands/trendyol.svg';
const SAMPLE_BROKEN = 'https://cdn.example.invalid/missing.jpg';
// ImageCell adds an `xl` step beyond the shared sm/md/lg scale.
const IMAGE_CELL_SIZES = [...SIZE_KEYS, 'xl'] as const;

export function ImageCellShowcase(): React.ReactElement {
  return (
    <div className="gap-lg flex flex-col">
      <Playground
        title="ImageCell — size · shape · fallback · brokenSrc"
        description="brokenSrc=true geçerli bir src yerine yüklenemeyen URL verir; tarayıcı onError tetikleyince wrapper fallback'a düşer (icon ya da initials — alt'tan AY üretilir). shape='circle' + fallback='initials' kanonik avatar primitive."
        controls={{
          size: control.segment(IMAGE_CELL_SIZES, 'md'),
          shape: control.segment(['square', 'circle'], 'square'),
          fallback: control.segment(['icon', 'initials'], 'icon'),
          brokenSrc: control.bool(false, 'brokenSrc'),
        }}
        render={(v) => (
          <ImageCell
            src={v.brokenSrc ? SAMPLE_BROKEN : SAMPLE_REAL}
            alt="Ayşe Yılmaz"
            size={v.size}
            shape={v.shape}
            fallback={v.fallback}
          />
        )}
      />

      <Preview
        title="Eksik src — fallback varyantları yan yana"
        description="src=null doğrudan fallback'a düşer (broken yüklemeyi beklemeden). fallback='initials' alt'tan baş harfleri üretir: çok kelime → ilk+son, tek kelime → ilk 2 karakter. ProductImageCell bu pattern'i sarar — PR #130 promotion idiomu."
      >
        <div className="gap-md flex flex-wrap items-end">
          <div className="gap-3xs flex flex-col items-center">
            <ImageCell src={null} alt="Eksik ürün" />
            <span className="text-2xs text-muted-foreground font-mono">{'icon'}</span>
          </div>
          <div className="gap-3xs flex flex-col items-center">
            <ImageCell src={null} alt="Ayşe Yılmaz" fallback="initials" shape="circle" />
            <span className="text-2xs text-muted-foreground font-mono">
              {'initials → AY (Ayşe Yılmaz)'}
            </span>
          </div>
          <div className="gap-3xs flex flex-col items-center">
            <ImageCell src={null} alt="Single" fallback="initials" />
            <span className="text-2xs text-muted-foreground font-mono">
              {'tek kelime → SI (Single)'}
            </span>
          </div>
        </div>
      </Preview>
    </div>
  );
}
