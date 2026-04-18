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
import { PrimitiveNav } from '@/components/showcase/primitive-nav';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';

const CATEGORIES = [
  {
    href: '/design/primitives/buttons',
    title: 'Buton & Rozet',
    description: 'Button (6 varyant × 4 boyut), Badge tonları, Toggle & ToggleGroup.',
    icon: CheckmarkSquare01Icon,
    count: 3,
  },
  {
    href: '/design/primitives/inputs',
    title: 'Form alanları',
    description: 'Input, Textarea, Select, Checkbox, Switch, Radio, Slider, InputOTP.',
    icon: TextAlignLeftIcon,
    count: 8,
  },
  {
    href: '/design/primitives/forms',
    title: 'Form (React Hook Form)',
    description: 'RHF + Zod resolver + FormField wrappers — kuralları tek tip tutar.',
    icon: TaskAdd01Icon,
    count: 1,
  },
  {
    href: '/design/primitives/overlays',
    title: 'Overlay',
    description:
      'Dialog, AlertDialog, Sheet, Drawer, Popover, HoverCard, Dropdown, ContextMenu, Tooltip.',
    icon: StickyNote02Icon,
    count: 9,
  },
  {
    href: '/design/primitives/navigation',
    title: 'Gezinme',
    description: 'Tabs, Breadcrumb, Pagination, NavigationMenu, Menubar.',
    icon: RoadIcon,
    count: 5,
  },
  {
    href: '/design/primitives/feedback',
    title: 'Geri bildirim',
    description: 'Alert, Toast (Sonner), Progress, Skeleton, Loader.',
    icon: Notification01Icon,
    count: 5,
  },
  {
    href: '/design/primitives/data-display',
    title: 'Veri gösterimi',
    description: 'Table, Avatar, Accordion, Collapsible, Separator, AspectRatio.',
    icon: DashboardSquare02Icon,
    count: 6,
  },
  {
    href: '/design/primitives/date-time',
    title: 'Tarih & saat',
    description: 'Calendar (tr-TR), DateRangePicker kompozit.',
    icon: Calendar01Icon,
    count: 2,
  },
  {
    href: '/design/primitives/chart',
    title: 'Grafik',
    description: 'Recharts + token-aware ChartContainer & ChartTooltip.',
    icon: ChartLineData01Icon,
    count: 1,
  },
];

export default function PrimitivesIndex(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Primitive bileşenler"
        intent="Projede kullanılabilecek 40+ shadcn/ui primitive'i PazarSync token setiyle yeniden yazıldı. Tüm sayfalarda aynı bileşen, aynı stil, aynı davranış."
      />
      <PrimitiveNav />
      <div className="gap-md grid sm:grid-cols-2 lg:grid-cols-3">
        {CATEGORIES.map(({ href, title, description, icon: Icon, count }) => (
          <Link key={href} href={href} className="group focus-visible:outline-none">
            <Card className="duration-fast group-hover:border-border-strong h-full transition-colors">
              <CardContent className="gap-sm p-lg flex flex-col">
                <div className="flex items-center justify-between">
                  <div className="size-icon-xl bg-muted text-foreground flex items-center justify-center rounded-md">
                    <Icon className="size-icon" />
                  </div>
                  <span className="bg-accent px-xs py-3xs text-2xs text-accent-foreground rounded-full font-medium">
                    {count}
                  </span>
                </div>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardContent>
            </Card>
          </Link>
        ))}
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
