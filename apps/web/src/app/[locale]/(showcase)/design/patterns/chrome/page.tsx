'use client';

import { RefreshIcon } from 'hugeicons-react';

import { DateRangePicker } from '@/components/patterns/date-range-picker';
import { PageHeader } from '@/components/patterns/page-header';
import { StatStrip } from '@/components/patterns/stat-strip';
import { SubNavList } from '@/components/patterns/sub-nav-list';
import { SyncBadge } from '@/components/patterns/sync-badge';
import { CategoryNav } from '@/components/showcase/category-nav';
import { Preview } from '@/components/showcase/preview';
import { ShowcaseSection } from '@/components/showcase/section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { BottomDockShowcase } from '../bottom-dock-showcase';
import { NavGroupShowcase } from '../nav-group-showcase';
import { OrgStoreSwitcherShowcase } from '../org-store-switcher-showcase';
import { ThemeToggleShowcase } from '../theme-toggle-showcase';

const MOCK_SYNC_REF = new Date('2026-04-20T21:00:00Z');
const MOCK = {
  syncMeta: new Date(MOCK_SYNC_REF.getTime() - 4 * 60 * 1000),
};

export default function ChromePatternsPage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Layout & gezinme pattern'ları"
        intent="Sayfa header'ı, sidebar bileşenleri, switcher chip'i. Bu yüzeyler kompozisyon-bağlamlıdır (SidebarProvider, expanded/collapsed/boş durum, accordion, tema) — tek bir prop kontrolüyle ifade edilemez, bu yüzden Playground değil canlı Preview olarak duruyorlar. Uygulama-seviyesi top bar yok — her sayfa kendi PageHeader'ını taşır."
      />
      <CategoryNav section="patterns" />

      <ShowcaseSection
        title="PageHeader"
        description="Her sayfanın taşıdığı başlık bloğu — başlık + intent + aksiyonlar. intent başlığı tekrarlamaz; bağlam, dönem veya scope verir. Sayfanın en üstündeki başlık (bu showcase'in kendi PageHeader'ı) canlı örnektir; aşağıdaki Preview aksiyon + SyncBadge kompozisyonunu gösterir."
      >
        <Preview
          title="actions + SyncBadge kompozisyonu"
          description="SyncBadge (tazelik) sağdaki `actions` kümesinde aksiyonla birlikte gruplanır; opsiyonel `summary` slotu metrik-yoğun sayfalarda KPI şeridi taşır, metriksiz sayfalarda hiç render edilmez. Tek inline örnek — sayfa başlığı zaten salt başlık + intent halini gösterir."
        >
          <PageHeader
            title="Sipariş mutabakatı"
            intent="Nisan 2026 dönemi · Trendyol Ana Mağaza · Hakediş karşılığını sipariş bazında doğrula."
            actions={
              <>
                <SyncBadge state="fresh" lastSyncedAt={MOCK.syncMeta} source="Trendyol" />
                <Button variant="outline" size="sm">
                  Dışa aktar
                </Button>
                <Button size="sm">Mutabakatı başlat</Button>
              </>
            }
          />
        </Preview>

        <Preview
          title="Çerçeveli — liste"
          description="Başlık ve KPI şeridi tek yükseltilmiş kartta birleşir; sayfa-kapsamı filtre (tarih aralığı) sağ kümede aksiyonun solunda durur."
        >
          <PageHeader
            variant="framed"
            title="Siparişler"
            intent="Bağlı mağazalardan akan siparişler. Filtrele, mutabakat durumunu izle."
            filters={<DateRangePicker />}
            actions={
              <Button size="sm" leadingIcon={<RefreshIcon aria-hidden />}>
                Yenile
              </Button>
            }
            summary={
              <StatStrip
                surface="bare"
                size="md"
                items={[
                  { label: 'Toplam Ciro', value: '₺284.750,00' },
                  { label: 'Net Kâr', value: '₺52.180,40' },
                  { label: 'Ortalama Marj', value: '%18,3' },
                  {
                    label: 'Zarar Eden Sipariş',
                    value: '%4,2',
                    context: '62 / 1.472 sipariş',
                  },
                ]}
              />
            }
          />
        </Preview>

        <Preview
          title="Çerçeveli — rakam-öncelikli (hero)"
          description="Gerçek bir yıldız-rakamı olan sayfada başlık küçük kimliğe iner, rakam öne çıkar. intent yerine caption kullanılır; empty/error durumunda başlık-öncelikli düzene düşer."
        >
          <PageHeader
            variant="framed"
            title="Canlı Performans"
            meta={
              <Badge tone="success" variant="surface" size="sm">
                Canlı
              </Badge>
            }
            hero={{
              value: '₺8.420,50',
              caption: 'Bugünün net kârı · dün aynı saat ₺6.180,00',
            }}
            actions={
              <Button size="sm" leadingIcon={<RefreshIcon aria-hidden />}>
                Yenile
              </Button>
            }
            summary={
              <StatStrip
                surface="bare"
                size="sm"
                items={[
                  { label: 'Toplam Ciro', value: '₺46.900,00' },
                  { label: 'Net Sipariş Adedi', value: '128' },
                  { label: 'Kâr Marjı', value: '%17,9' },
                ]}
              />
            }
          />
        </Preview>

        <Preview
          title="Çerçeveli — hero yükleniyor"
          description="Hero ve şerit yüklenirken kimlik sabit kalır, yalnız veri iskelete döner."
        >
          <PageHeader
            variant="framed"
            title="Canlı Performans"
            meta={
              <Badge tone="success" variant="surface" size="sm">
                Canlı
              </Badge>
            }
            hero={{ value: '₺8.420,50', status: 'loading', loadingLabel: 'Yükleniyor' }}
            actions={
              <Button size="sm" leadingIcon={<RefreshIcon aria-hidden />}>
                Yenile
              </Button>
            }
            summary={
              <StatStrip
                surface="bare"
                size="sm"
                loading
                loadingLabel="Yükleniyor"
                items={[
                  { label: 'Toplam Ciro', value: null },
                  { label: 'Net Sipariş Adedi', value: null },
                  { label: 'Kâr Marjı', value: null },
                ]}
              />
            }
          />
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Sidebar gezinme"
        description="Tek-sidebar tasarımının org/mağaza switcher chip'i, nested feature grupları ve ikincil rail listesi. Hepsi SidebarProvider bağlamına ve durum geçişlerine (expanded/collapsed/active) bağlı — Preview olarak canlı."
      >
        <Preview
          title="OrgStoreSwitcher"
          description="Tek-sidebar başlığındaki birleşik org+mağaza chip'i. ⌘O hotkey'i, sync warning border'ı, daraltılmış sidebar modu, boş durum CTA'ları — üç framing yan yana."
        >
          <OrgStoreSwitcherShowcase />
        </Preview>

        <Preview
          title="NavGroup — isActive + Beta / count / Yeni rozet varyantları"
          description="Nested feature grupları için açılır-kapanır başlık. Animasyon `grid-template-rows: 0fr → 1fr` üzerinden — height transition'ları yasak. Üç satır tüm rozet varyantını (Beta / count / Yeni) ve aktif parent satır (marka metin/ikon, sol kılavuz çizgisi YOK) stilini kapsar."
        >
          <NavGroupShowcase />
        </Preview>

        <Preview
          title="SubNavList"
          description="ContextRail orta slot'u için ikincil gezinme listesi. Aktif satır `bg-accent text-primary` — IconRail nav active state'iyle eşleşir. Opsiyonel count badge tone-driven (warning / info / default)."
        >
          <SubNavListPreview />
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Sidebar alt küme"
        description="Sidebar'ın altına oturan yardımcı küme ve satır-içi tema anahtarı. Yapısal olarak minimal — içerik AppShell üzerinden enjekte edilir."
      >
        <Preview
          title="BottomDock"
          description="Sidebar'ın altına oturan yardımcı küme. Yenilikler / Destek / Ayarlar yardımcı linkleri ve kullanıcı satırını barındırır. Yapısal olarak minimal — içeriği AppShell üzerinden enjekte edilir, pattern i18n-bağımsızdır."
        >
          <BottomDockShowcase />
        </Preview>

        <Preview
          title="ThemeToggleInline"
          description="Sidebar bottom dock için satır-içi tema anahtarı. Sun + Moon ikonları her iki render'da da DOM'da; `dark:` Tailwind varyantı görünürlüğü değiştirir. resolvedTheme yalnızca useIsMounted gate'inin arkasında okunur — SSR çıktısı ilk paint ile byte-eşit kalır."
        >
          <ThemeToggleShowcase />
        </Preview>
      </ShowcaseSection>
    </>
  );
}

/**
 * Use real `nav.*` message keys (the same ones the production AppShell
 * consumes) so the labels read as actual app navigation rather than
 * placeholder strings. Counts pulled from typical Acme A.Ş. dashboard
 * snapshot — realistic order / pending / shipped / returns split.
 */
function SubNavListPreview(): React.ReactElement {
  return (
    <div className="border-border bg-card p-sm w-rail-context rounded-md border">
      <SubNavList
        currentHref="/dashboard/orders"
        items={[
          {
            key: 'orders',
            labelKey: 'nav.orders',
            href: '/dashboard/orders',
            count: 1472,
            tone: 'default',
          },
          {
            key: 'reconciliation',
            labelKey: 'nav.reconciliation',
            href: '/dashboard/reconciliation',
            count: 5,
            tone: 'warning',
          },
          {
            key: 'products',
            labelKey: 'nav.products',
            href: '/dashboard/products',
            count: 1320,
            tone: 'default',
          },
          {
            key: 'expenses',
            labelKey: 'nav.expenses',
            href: '/dashboard/expenses',
            count: 38,
            tone: 'info',
          },
        ]}
      />
    </div>
  );
}
