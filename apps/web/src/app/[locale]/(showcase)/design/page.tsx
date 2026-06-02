import Link from 'next/link';
import {
  ChartLineData01Icon,
  Database02Icon,
  DashboardSquare02Icon,
  DropletIcon,
  PackageIcon,
  PaintBoardIcon,
  TaskDone01Icon,
} from 'hugeicons-react';

import { DESIGN_LANDING } from '@/components/showcase/showcase-registry';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/patterns/page-header';

/**
 * Icon per landing card, keyed by the registry card `key`. Icons are
 * presentation, kept out of the (pure-data) registry; the structural nav lives
 * in `showcase-registry.ts` so this map only has to supply a glyph per key.
 */
const CARD_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  tokens: DropletIcon,
  primitives: PaintBoardIcon,
  patterns: ChartLineData01Icon,
  data: Database02Icon,
  'layout-demo': DashboardSquare02Icon,
  manifest: PackageIcon,
  checklist: TaskDone01Icon,
};

export default function DesignIndexPage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="PazarSync Design System"
        intent="Projeyi şekillendiren tüm token, bileşen ve kalıpların canlı referansı. Tailwind v4 + shadcn/ui + OKLCH paleti üzerine."
      />
      <div className="gap-md grid sm:grid-cols-2">
        {DESIGN_LANDING.map(({ key, href, label, description }) => {
          const Icon = CARD_ICONS[key];
          return (
            <Link key={href} href={href} className="group focus-visible:outline-none">
              <Card className="duration-fast group-hover:border-border-strong h-full transition-colors">
                <CardContent className="gap-sm p-lg flex flex-col">
                  <div className="size-icon-xl bg-muted text-foreground flex items-center justify-center rounded-md">
                    {Icon !== undefined ? <Icon className="size-icon" /> : null}
                  </div>
                  <CardTitle>{label}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}
