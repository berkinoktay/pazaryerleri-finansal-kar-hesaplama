import { NavGroup } from '@/components/patterns/nav-group';

export function NavGroupShowcase(): React.ReactElement {
  return (
    <div
      className="border-border bg-card gap-3xs p-md flex flex-col rounded-md border"
      style={{ width: 240 }}
    >
      <NavGroup
        label="Karlılık Analizi"
        icon="📈"
        badge={{ variant: 'beta', label: 'Beta' }}
        defaultExpanded
      >
        <a className="text-muted-foreground hover:text-foreground px-xs py-3xs text-xs" href="#">
          Sipariş Karlılığı
        </a>
        <a className="text-muted-foreground hover:text-foreground px-xs py-3xs text-xs" href="#">
          Ürün Karlılığı
        </a>
      </NavGroup>
      <NavGroup label="Maliyet & Araçlar" icon="🛠">
        <a className="text-muted-foreground hover:text-foreground px-xs py-3xs text-xs" href="#">
          Komisyon Hesaplama
        </a>
      </NavGroup>
    </div>
  );
}
