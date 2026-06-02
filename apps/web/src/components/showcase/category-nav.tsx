'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  SHOWCASE_SECTIONS,
  type ShowcaseSectionKey,
} from '@/components/showcase/showcase-registry';
import { cn } from '@/lib/utils';

export interface CategoryNavProps {
  /** Which section's categories to render — drives both the pills and the aria-label. */
  section: ShowcaseSectionKey;
}

/**
 * Sticky pill sub-nav shown across every `/design/<section>/*` page so the
 * reader can swap categories without returning to the section index. Replaces
 * the byte-identical `PrimitiveNav` + `PatternNav` (they differed only in their
 * category array) with one registry-driven component — adding a category page
 * now means editing `showcase-registry.ts` only, not a hardcoded nav array.
 */
export function CategoryNav({ section }: CategoryNavProps): React.ReactElement {
  const pathname = usePathname();
  const { categories, label } = SHOWCASE_SECTIONS[section];

  return (
    <nav
      aria-label={`${label} kategorileri`}
      className="top-header-h -mx-lg mb-lg gap-3xs border-border bg-background/90 px-lg py-xs sticky z-30 flex flex-wrap items-center border-b backdrop-blur-md"
    >
      {categories.map((category) => {
        const isActive = pathname === category.href;
        return (
          <Link
            key={category.href}
            href={category.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'px-sm py-3xs text-2xs duration-fast rounded-full font-medium transition-colors',
              'hover:bg-muted hover:text-foreground',
              'focus-visible:outline-none',
              isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
            )}
          >
            {category.label}
          </Link>
        );
      })}
    </nav>
  );
}
