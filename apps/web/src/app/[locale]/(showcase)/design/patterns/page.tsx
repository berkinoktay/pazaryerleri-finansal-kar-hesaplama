import {
  ChartLineData01Icon,
  DatabaseIcon,
  Layout02Icon,
  Pen01Icon,
  Pulse01Icon,
} from 'hugeicons-react';

import { PageHeader } from '@/components/patterns/page-header';
import { PatternNav } from '@/components/showcase/pattern-nav';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

interface CategoryCard {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  description: string;
  components: string;
}

const CATEGORIES: CategoryCard[] = [
  {
    href: '/design/patterns/display',
    icon: ChartLineData01Icon,
    label: 'Görsel & sayısal',
    count: 7,
    description:
      'Veri-okuma yüzeyleri: KPI tile, sayı/yüzde delta, currency, badge stack, marketplace logosu, boş durum.',
    components:
      'KpiTile · StatGroup · TrendDelta · Currency · BadgeWithOverflow · MarketplaceLogo · EmptyState',
  },
  {
    href: '/design/patterns/forms',
    icon: Pen01Icon,
    label: 'Form girdileri',
    count: 8,
    description:
      'Veri girişi molekülleri. Hepsi Decimal / Date kontratı, locale-aware (tr-TR), display-buffer ile typing korunuyor.',
    components:
      'MoneyInput · PercentageInput · SearchInput · Combobox · InlineEdit · DateInput · FileUpload · DateRangePicker',
  },
  {
    href: '/design/patterns/status',
    icon: Pulse01Icon,
    label: 'Durum & sync',
    count: 6,
    description:
      'Veri güncelliği, çalışan iş takibi, hata bildirimleri, ContextRail uyarıları, app-spanning sistem mesajları, çok-adımlı akış göstergesi.',
    components: 'SyncBadge · SyncCenter · NotificationBell · Banner · Stepper · RailWarningCard',
  },
  {
    href: '/design/patterns/chrome',
    icon: Layout02Icon,
    label: 'Layout & gezinme',
    count: 6,
    description:
      'Sayfa header, sidebar bileşenleri, switcher chip, tema anahtarı. Uygulama-seviyesi top bar yok.',
    components:
      'PageHeader · OrgStoreSwitcher · NavGroup · SubNavList · BottomDock · ThemeToggleInline',
  },
  {
    href: '/design/data',
    icon: DatabaseIcon,
    label: 'Tablolar',
    count: 2,
    description:
      'TanStack Table v8 wrapper + standart toolbar. Filtreleme, sıralama, seçim, kolon görünürlüğü, import/export, boş durum, yükleme iskeleti.',
    components: 'DataTable · DataTableToolbar',
  },
];

export default function PatternsIndexPage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Pattern katmanı"
        intent="shadcn primitive'leri üstüne bindirilen PazarSync-özel finansal desenler. Kategoriye göre gruplandırılmış — her pattern'in tüm varyantları kendi sayfasında."
      />
      <PatternNav />

      <div className="gap-md grid sm:grid-cols-2">
        {CATEGORIES.map((cat) => (
          <Link
            key={cat.href}
            href={cat.href}
            className={cn(
              'group border-border bg-card p-lg gap-md rounded-lg border shadow-xs',
              'duration-fast hover:border-border-strong flex flex-col transition-all hover:shadow-sm',
              'focus-visible:outline-none',
            )}
          >
            <div className="gap-sm flex items-start">
              <div className="size-icon-xl bg-muted text-foreground flex shrink-0 items-center justify-center rounded-md">
                <cat.icon className="size-icon" />
              </div>
              <div className="gap-3xs flex flex-1 flex-col">
                <div className="gap-xs flex items-baseline">
                  <h3 className="text-foreground text-md font-semibold tracking-tight">
                    {cat.label}
                  </h3>
                  <span className="text-2xs text-muted-foreground tabular-nums">
                    {cat.count} pattern
                  </span>
                </div>
                <p className="text-muted-foreground text-sm leading-snug">{cat.description}</p>
              </div>
            </div>
            <p className="text-2xs text-muted-foreground border-border pt-sm border-t font-mono leading-relaxed">
              {cat.components}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
