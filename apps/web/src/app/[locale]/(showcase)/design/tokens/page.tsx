'use client';

import { PageHeader } from '@/components/patterns/page-header';
import { Preview } from '@/components/showcase/preview';
import { SEMANTIC_COLORS } from '@/lib/tokens';
import { cn } from '@/lib/utils';

/**
 * Showcase-only exception: iterated token rows use inline styles with
 * `var(--token)` because Tailwind JIT can't extract a dynamic
 * `bg-${token}` class. Every such inline style is annotated with
 * `runtime-dynamic: token iteration` so code review can tell the
 * difference between a violation and an acknowledged exception.
 */

const NEUTRAL_SWATCHES = [
  { token: 'background', label: 'Background', note: 'Sayfa zemini' },
  { token: 'foreground', label: 'Foreground', note: 'Birincil metin' },
  { token: 'muted', label: 'Muted', note: 'Nötr yüzey' },
  { token: 'muted-foreground', label: 'Muted foreground', note: 'İkincil metin' },
  { token: 'muted-foreground-dim', label: 'Muted fg (dim)', note: 'Kapsam dışı metin' },
  { token: 'surface-subtle', label: 'Surface subtle', note: 'Footer / callout / kod bloku' },
  {
    token: 'surface-row-hover',
    label: 'Surface row hover',
    note: 'Tablo / liste satırı hover',
  },
  {
    token: 'surface-trigger-hover',
    label: 'Surface trigger hover',
    note: 'Inactive tab / segment trigger hover',
  },
  { token: 'card', label: 'Card', note: 'Kart zemini' },
  { token: 'border', label: 'Border', note: 'İnce çizgi' },
  { token: 'border-muted', label: 'Border muted', note: 'Hafif iç çizgi / aktif ring' },
  { token: 'border-strong', label: 'Border strong', note: 'Vurgulu çizgi' },
  { token: 'accent', label: 'Accent', note: 'Vurgu yüzey' },
  { token: 'primary', label: 'Primary', note: 'CTA / marka' },
];

const TEXT_SCALE = [
  { size: 'text-2xs', demo: '12/16' },
  { size: 'text-xs', demo: '13/18' },
  { size: 'text-sm', demo: '14/20' },
  { size: 'text-base', demo: '15/22' },
  { size: 'text-md', demo: '16/24' },
  { size: 'text-lg', demo: '18/26' },
  { size: 'text-xl', demo: '20/28' },
  { size: 'text-2xl', demo: '24/30' },
  { size: 'text-3xl', demo: '30/38' },
  { size: 'text-4xl', demo: '38/44' },
  { size: 'text-5xl', demo: '48/56' },
  { size: 'text-6xl', demo: '60/64' },
];

const SPACING_SCALE = [
  { token: '3xs', var: '--space-3xs', px: 2 },
  { token: '2xs', var: '--space-2xs', px: 4 },
  { token: 'xs', var: '--space-xs', px: 8 },
  { token: 'sm', var: '--space-sm', px: 12 },
  { token: 'md', var: '--space-md', px: 16 },
  { token: 'lg', var: '--space-lg', px: 24 },
  { token: 'xl', var: '--space-xl', px: 32 },
  { token: '2xl', var: '--space-2xl', px: 48 },
  { token: '3xl', var: '--space-3xl', px: 64 },
];

const RADIUS_SCALE = [
  { token: 'xs', className: 'rounded-xs' },
  { token: 'sm', className: 'rounded-sm' },
  { token: 'md', className: 'rounded-md' },
  { token: 'lg', className: 'rounded-lg' },
  { token: 'xl', className: 'rounded-xl' },
  { token: '2xl', className: 'rounded-2xl' },
  { token: 'full', className: 'rounded-full' },
];

const SHADOW_SCALE = [
  { token: 'xs', className: 'shadow-xs' },
  { token: 'sm', className: 'shadow-sm' },
  { token: 'md', className: 'shadow-md' },
  { token: 'lg', className: 'shadow-lg' },
  { token: 'xl', className: 'shadow-xl' },
];

const DURATION_SCALE = [
  { token: 'fast', className: 'duration-fast' },
  { token: 'base', className: 'duration-base' },
  { token: 'slow', className: 'duration-slow' },
  { token: 'entrance', className: 'duration-entrance' },
];

export default function TokensShowcasePage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Token"
        intent="Tüm sistem token tabanlı. Değerler buradaki dosyalara ekleniyor, componentler sadece anlamlı adları tüketiyor — [100px] gibi arbitrary Tailwind değerleri projede yasak."
      />

      <Preview
        title="Nötr palet"
        description="Markanın 265° hue'sine doğru hafif tintlenmiş nötrler. Light ve dark ayrı tasarımlar; invert değil."
      >
        <div className="gap-sm grid grid-cols-3 sm:grid-cols-5">
          {NEUTRAL_SWATCHES.map((s) => (
            <div key={s.token} className="gap-3xs flex flex-col">
              <div
                className="border-border h-16 rounded-md border"
                // runtime-dynamic: token iteration (showcase only)
                style={{ backgroundColor: `var(--${s.token})` }}
              />
              <span className="text-2xs text-foreground font-mono">--{s.token}</span>
              <span className="text-2xs text-muted-foreground">{s.note}</span>
            </div>
          ))}
        </div>
      </Preview>

      <Preview
        title="Semantik renkler"
        description="Finansal veri anlamına sahip renkler. Her zaman ikon + işaret + metin ile eşleşir — renk hiçbir zaman tek sinyal değildir."
      >
        <div className="gap-md grid grid-cols-2 sm:grid-cols-4">
          {SEMANTIC_COLORS.map((s) => (
            <div key={s.key} className="gap-xs flex flex-col">
              <div
                className="flex h-16 items-center justify-center rounded-md font-mono text-xs"
                // runtime-dynamic: token iteration (showcase only)
                style={{ backgroundColor: `var(--${s.key})`, color: `var(--${s.foreground})` }}
              >
                --{s.key}
              </div>
              <div
                className="px-sm py-xs text-2xs rounded-md font-mono"
                // runtime-dynamic: token iteration (showcase only)
                style={{ backgroundColor: `var(--${s.surface})`, color: `var(--${s.key})` }}
              >
                surface
              </div>
            </div>
          ))}
        </div>
      </Preview>

      <Preview
        title="Tipografi ölçeği"
        description="Host Grotesk, 1.25 (major third) ratio. Her size için font-size / line-height px olarak sabit."
      >
        <div className="gap-sm flex flex-col">
          {TEXT_SCALE.map(({ size, demo }) => (
            <div key={size} className="gap-md grid grid-cols-[auto_auto_1fr] items-baseline">
              <span className="text-2xs text-muted-foreground font-mono">{size}</span>
              <span className="text-2xs text-muted-foreground font-mono">{demo}</span>
              <span className={cn('text-foreground', size)}>
                Karlılık panelinde gerçek veriyi gösterdik
              </span>
            </div>
          ))}
        </div>
      </Preview>

      <Preview
        title="Spacing ölçeği"
        description="4pt scale. p-md, gap-lg, mt-xl gibi semantic isimler. Asla p-[17px] yazma."
      >
        <div className="gap-sm flex flex-col">
          {SPACING_SCALE.map(({ token, var: v, px }) => (
            <div key={token} className="gap-md grid grid-cols-[auto_auto_1fr] items-center">
              <span className="text-2xs text-muted-foreground font-mono">--space-{token}</span>
              <span className="text-2xs text-muted-foreground font-mono">{px}px</span>
              <div
                className="bg-primary h-3 rounded-full"
                // runtime-dynamic: spacing token iteration (showcase only)
                style={{ width: `var(${v})` }}
              />
            </div>
          ))}
        </div>
      </Preview>

      <Preview
        title="Radius"
        description="rounded-md varsayılan kart köşesi, rounded-full chip ve avatar için."
      >
        <div className="gap-md flex flex-wrap items-end">
          {RADIUS_SCALE.map((r) => (
            <div key={r.token} className="gap-3xs flex flex-col items-center">
              <div className={cn('bg-primary size-16', r.className)} />
              <span className="text-2xs text-muted-foreground font-mono">rounded-{r.token}</span>
            </div>
          ))}
        </div>
      </Preview>

      <Preview
        title="Shadow"
        description="Hairline-first. Kartlar sadece shadow-xs; shadow-lg yalnızca modal/popover için."
      >
        <div className="gap-xl flex flex-wrap">
          {SHADOW_SCALE.map((s) => (
            <div key={s.token} className="gap-xs flex flex-col items-center">
              <div
                className={cn(
                  'border-border bg-card text-2xs flex size-20 items-center justify-center rounded-md border font-mono',
                  s.className,
                )}
              >
                shadow-{s.token}
              </div>
            </div>
          ))}
        </div>
      </Preview>

      <Preview
        title="Motion"
        description="Sadece ease-out tabanlı. transform + opacity. Bounce/elastic YOK — finansal ürün."
      >
        <div className="gap-md flex flex-wrap">
          {DURATION_SCALE.map((d) => (
            <button
              key={d.token}
              type="button"
              className={cn(
                'group border-border bg-background px-md py-xs text-2xs text-foreground rounded-md border font-mono',
                'ease-out-quart transition-transform',
                d.className,
                'hover:-translate-y-1 hover:shadow-md',
              )}
            >
              {d.className}
            </button>
          ))}
        </div>
      </Preview>
    </>
  );
}
