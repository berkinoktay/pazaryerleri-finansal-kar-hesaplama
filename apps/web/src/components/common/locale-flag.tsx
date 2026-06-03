import Image from 'next/image';

import type { Locale } from '@/i18n/config';
import { cn } from '@/lib/utils';

/**
 * Small rounded country flag for the locale switcher. Loaded from
 * `public/flags/<code>.svg` (unoptimized, like MarketplaceLogo) so the
 * national colors stay vendor-/country-correct and outside the dashboard
 * token palette. English maps to the UK flag — the conventional "English"
 * marker in i18n switchers.
 *
 * Rendered in a fixed rounded box with `object-cover` so both flags read as
 * uniform chips regardless of their differing official aspect ratios. A
 * hairline ring keeps a light flag (no white-on-white edge) legible on the
 * card surface. Decorative by default — the control's `aria-label` carries
 * the language name.
 *
 * @useWhen showing a language/locale as a country flag chip (locale switcher); pass the language name via the parent control's aria-label
 */
const FLAG_SRC: Record<Locale, string> = {
  tr: '/flags/tr.svg',
  en: '/flags/gb.svg',
};

const INTRINSIC = { width: 24, height: 16 } as const;

export interface LocaleFlagProps {
  locale: Locale;
  /** Accessible label; pass `''` when an adjacent label or the control carries the name. */
  alt?: string;
  className?: string;
}

export function LocaleFlag({ locale, alt = '', className }: LocaleFlagProps): React.ReactElement {
  return (
    <span
      className={cn(
        'ring-border inline-block h-3.5 w-5 shrink-0 overflow-hidden rounded-xs ring-1',
        className,
      )}
    >
      <Image
        src={FLAG_SRC[locale]}
        alt={alt}
        width={INTRINSIC.width}
        height={INTRINSIC.height}
        unoptimized
        className="h-full w-full object-cover"
      />
    </span>
  );
}
