import Link from 'next/link';
import {
  Calendar01Icon,
  ChartLineData01Icon,
  CheckmarkSquare01Icon,
  DashboardSquare02Icon,
  MessageMultiple01Icon,
  Notification01Icon,
  RoadIcon,
  StickyNote02Icon,
  TaskAdd01Icon,
  TextAlignLeftIcon,
} from 'hugeicons-react';

import { PageHeader } from '@/components/patterns/page-header';
import { CategoryNav } from '@/components/showcase/category-nav';
import { PRIMITIVES_SECTION } from '@/components/showcase/showcase-registry';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';

/** Icon per category, keyed by href. Presentation only — structure + copy live in the registry. */
const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  '/design/primitives/buttons': CheckmarkSquare01Icon,
  '/design/primitives/inputs': TextAlignLeftIcon,
  '/design/primitives/forms': TaskAdd01Icon,
  '/design/primitives/overlays': StickyNote02Icon,
  '/design/primitives/navigation': RoadIcon,
  '/design/primitives/feedback': Notification01Icon,
  '/design/primitives/data-display': DashboardSquare02Icon,
  '/design/primitives/date-time': Calendar01Icon,
  '/design/primitives/chart': ChartLineData01Icon,
};

// Skip the "Genel" overview (the section root links to this page itself).
const CARDS = PRIMITIVES_SECTION.categories.filter(
  (category) => category.href !== PRIMITIVES_SECTION.href,
);

export default function PrimitivesIndex(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Primitive bileşenler"
        intent="shadcn/ui primitive'leri PazarSync token setiyle yeniden yazıldı — her sayfada aynı bileşen, aynı stil, aynı davranış. Varyant ve state'ler etkileşimli kontrollerle gösterilir."
      />
      <CategoryNav section="primitives" />
      <div className="gap-md grid sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map(({ href, label, description }) => {
          const Icon = CATEGORY_ICONS[href];
          return (
            <Link key={href} href={href} className="group focus-visible:outline-none">
              <Card className="duration-fast group-hover:border-border-strong h-full transition-colors">
                <CardContent className="gap-sm p-lg flex flex-col">
                  <div className="size-icon-xl bg-muted text-foreground flex items-center justify-center rounded-md">
                    {Icon !== undefined ? <Icon className="size-icon" /> : null}
                  </div>
                  <CardTitle>{label}</CardTitle>
                  {description !== undefined ? (
                    <CardDescription>{description}</CardDescription>
                  ) : null}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
      <aside className="gap-sm border-border bg-surface-subtle p-md flex items-start rounded-md border text-sm">
        <MessageMultiple01Icon className="size-icon-sm text-muted-foreground shrink-0" />
        <p className="text-muted-foreground">
          <strong className="text-foreground">Tek kaynak, her yer:</strong> Feature kodları asla
          shadcn primitive&apos;ini &quot;customize&quot; etmek için fork etmemeli. Style
          değişikliği gerekiyorsa token katmanından geçmelidir; davranış değişikliği gerekiyorsa{' '}
          <code className="bg-background px-3xs rounded-sm font-mono text-xs">
            components/patterns/
          </code>{' '}
          altında bir wrapper bileşen olmalıdır.
        </p>
      </aside>
    </>
  );
}
