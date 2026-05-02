'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const PATTERN_CATEGORIES = [
  { href: '/design/patterns', label: 'Genel' },
  { href: '/design/patterns/display', label: 'Görsel & sayısal' },
  { href: '/design/patterns/forms', label: 'Form girdileri' },
  { href: '/design/patterns/status', label: 'Durum & sync' },
  { href: '/design/patterns/chrome', label: 'Layout & gezinme' },
  { href: '/design/data', label: 'Tablolar' },
];

/**
 * Sticky sub-nav shown across every /design/patterns/* page so the
 * reader can swap categories without going back to the index. Mirrors
 * `PrimitiveNav` — same pill geometry, same active-state styling, same
 * sticky header offset. The "Tablolar" link is a cross-route to
 * /design/data (DataTable showcase still lives there) so the user can
 * jump between table and pattern surfaces without going through
 * the top nav.
 */
export function PatternNav(): React.ReactElement {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Pattern kategorileri"
      className="top-header-h -mx-lg mb-lg gap-3xs border-border bg-background/90 px-lg py-xs sticky z-30 flex flex-wrap items-center border-b backdrop-blur-md"
    >
      {PATTERN_CATEGORIES.map((cat) => {
        const isActive = pathname === cat.href;
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
