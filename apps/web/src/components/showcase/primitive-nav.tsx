'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const PRIMITIVE_CATEGORIES = [
  { href: '/design/primitives', label: 'Genel' },
  { href: '/design/primitives/buttons', label: 'Buton & Rozet' },
  { href: '/design/primitives/inputs', label: 'Form alanları' },
  { href: '/design/primitives/forms', label: 'Form (RHF)' },
  { href: '/design/primitives/overlays', label: 'Overlay' },
  { href: '/design/primitives/navigation', label: 'Gezinme' },
  { href: '/design/primitives/feedback', label: 'Geri bildirim' },
  { href: '/design/primitives/data-display', label: 'Veri gösterimi' },
  { href: '/design/primitives/date-time', label: 'Tarih & saat' },
  { href: '/design/primitives/chart', label: 'Grafik' },
];

/**
 * Sticky sub-nav shown across every /design/primitives/* page so the
 * reader can swap categories without going back to the index. Kept
 * visually lightweight — simple pill row.
 */
export function PrimitiveNav(): React.ReactElement {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primitive kategorileri"
      className="top-header-h -mx-lg mb-lg gap-3xs border-border bg-background/90 px-lg py-xs sticky z-30 flex flex-wrap items-center border-b backdrop-blur-md"
    >
      {PRIMITIVE_CATEGORIES.map((cat) => {
        const isActive =
          cat.href === '/design/primitives' ? pathname === cat.href : pathname === cat.href;
        return (
          <Link
            key={cat.href}
            href={cat.href}
            className={cn(
              'px-sm py-3xs text-2xs duration-fast rounded-full font-medium transition-colors',
              'hover:bg-muted hover:text-foreground',
              'focus-visible:outline-none',
              isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
            )}
          >
            {cat.label}
          </Link>
        );
      })}
    </nav>
  );
}
