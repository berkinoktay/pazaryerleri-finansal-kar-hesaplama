import {
  ChartLineData01Icon,
  DatabaseIcon,
  Layout02Icon,
  Pen01Icon,
  Pulse01Icon,
} from 'hugeicons-react';

import { PageHeader } from '@/components/patterns/page-header';
import { CategoryNav } from '@/components/showcase/category-nav';
import { PATTERNS_SECTION } from '@/components/showcase/showcase-registry';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/** Icon per category, keyed by href. Presentation only — structure + copy live in the registry. */
const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  '/design/patterns/display': ChartLineData01Icon,
  '/design/patterns/forms': Pen01Icon,
  '/design/patterns/status': Pulse01Icon,
  '/design/patterns/chrome': Layout02Icon,
  '/design/data': DatabaseIcon,
};

// Skip the "Genel" overview (the section root links to this page itself).
const CARDS = PATTERNS_SECTION.categories.filter(
  (category) => category.href !== PATTERNS_SECTION.href,
);

export default function PatternsIndexPage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Pattern katmanı"
        intent="shadcn primitive'leri üstüne bindirilen PazarSync-özel finansal desenler. Kategoriye göre gruplandırılmış — her pattern'in tüm varyantları kendi sayfasında."
      />
      <CategoryNav section="patterns" />

      <div className="gap-md grid sm:grid-cols-2">
        {CARDS.map(({ href, label, description }) => {
          const Icon = CATEGORY_ICONS[href];
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'group border-border bg-card p-lg gap-sm rounded-lg border shadow-xs',
                'duration-fast hover:border-border-strong flex items-start transition-all hover:shadow-sm',
                'focus-visible:outline-none',
              )}
            >
              <div className="size-icon-xl bg-muted text-foreground flex shrink-0 items-center justify-center rounded-md">
                {Icon !== undefined ? <Icon className="size-icon" /> : null}
              </div>
              <div className="gap-3xs flex flex-1 flex-col">
                <h3 className="text-foreground text-md font-semibold tracking-tight">{label}</h3>
                {description !== undefined ? (
                  <p className="text-muted-foreground text-sm leading-snug">{description}</p>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
