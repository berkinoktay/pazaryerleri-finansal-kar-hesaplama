import Link from 'next/link';
import {
  ChartLineData01Icon,
  Database02Icon,
  DashboardSquare02Icon,
  PaintBoardIcon,
  DropletIcon,
} from 'hugeicons-react';

import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/patterns/page-header';

const CATEGORIES = [
  {
    href: '/design/tokens',
    title: 'Token',
    description:
      'Renk, tipografi, spacing, radius, shadow ve motion değerlerinin tamamı — canlı örneklerle.',
    icon: DropletIcon,
  },
  {
    href: '/design/primitives',
    title: 'Primitive',
    description:
      'Button, input, select, dialog, dropdown gibi shadcn/ui temel bileşenleri — tüm state ve varyantlar.',
    icon: PaintBoardIcon,
  },
  {
    href: '/design/patterns',
    title: 'Pattern',
    description:
      'KPI tile, TrendDelta, Currency, SyncBadge, PageHeader, EmptyState — finansal ürün desenleri.',
    icon: ChartLineData01Icon,
  },
  {
    href: '/design/data',
    title: 'Veri',
    description:
      'DataTable örnekleri: filtreleme, sıralama, seçim, import/export, boş durum, yükleme iskeleti.',
    icon: Database02Icon,
  },
  {
    href: '/design/layout-demo',
    title: 'Layout demo',
    description:
      'Dual-rail workspace layout, store switcher, icon rail, context rail ve activity rail canlı çalışıyor.',
    icon: DashboardSquare02Icon,
  },
];

export default function DesignIndexPage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="PazarSync Design System"
        intent="Projeyi şekillendiren tüm token, bileşen ve kalıpların canlı referansı. Tailwind v4 + shadcn/ui + OKLCH paleti üzerine."
      />
      <div className="gap-md grid sm:grid-cols-2">
        {CATEGORIES.map(({ href, title, description, icon: Icon }) => (
          <Link key={href} href={href} className="group focus-visible:outline-none">
            <Card className="duration-fast group-hover:border-border-strong h-full transition-colors">
              <CardContent className="gap-sm p-lg flex flex-col">
                <div className="size-icon-xl bg-muted text-foreground flex items-center justify-center rounded-md">
                  <Icon className="size-icon" />
                </div>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
