'use client';

import {
  ArrowRight01Icon,
  Cancel01Icon,
  PlusSignIcon,
  Search01Icon,
  Tick02Icon,
} from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { PageHeader } from '@/components/patterns/page-header';
import { CategoryNav } from '@/components/showcase/category-nav';
import { Playground, control } from '@/components/showcase/playground';
import { Preview } from '@/components/showcase/preview';
import { ShowcaseSection } from '@/components/showcase/section';
import { Badge, BADGE_VARIANTS } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Link } from '@/i18n/navigation';
import { RADIUS_KEYS, SIZE_KEYS, TONE_KEYS } from '@/lib/variants';

export default function ButtonsPrimitivePage(): React.ReactElement {
  const t = useTranslations('common');
  return (
    <>
      <PageHeader
        title="Buton & Rozet"
        intent="Button ve Badge paylaşılan size/radius prop setini kullanır — aynı anahtar (`md`, `lg`) tüm bileşenlerde aynı token'a çözülür. Aşağıdaki kontrol şeritlerinden prop'ları canlı çevir."
      />
      <CategoryNav section="primitives" />

      <ShowcaseSection
        title="Button"
        description="Workhorse tetikleyici — variant hiyerarşiyi taşır (sayfada tek primary). Dolu varyantlar düz (gölgesiz), basışta hafif scale-down. Kontrolleri çevirerek tüm prop matrisini gör."
      >
        <Playground
          title="Button — variant · size · radius · ikon · loading · disabled"
          description="Tek etkileşimli yüzey; eski 'her varyantı statik grid'de tekrar et' bloklarının yerini alır."
          controls={{
            variant: control.select(
              [
                'default',
                'secondary',
                'outline',
                'ghost',
                'link',
                'destructive',
                'success',
                'warning',
              ],
              'default',
            ),
            size: control.segment(SIZE_KEYS, 'md'),
            radius: control.select(RADIUS_KEYS, 'md'),
            leadingIcon: control.bool(true, 'leadingIcon'),
            trailingIcon: control.bool(false, 'trailingIcon'),
            loading: control.bool(false),
            disabled: control.bool(false),
          }}
          render={(v) => (
            <Button
              variant={v.variant}
              size={v.size}
              radius={v.radius}
              loading={v.loading}
              loadingLabel={t('loading')}
              disabled={v.disabled}
              leadingIcon={v.leadingIcon ? <PlusSignIcon /> : undefined}
              trailingIcon={v.trailingIcon ? <ArrowRight01Icon /> : undefined}
            >
              Mağaza ekle
            </Button>
          )}
        />

        <Preview
          title="Icon button'lar"
          description="size='icon' (40px) ve 'icon-sm' (32px) tek-aksiyon butonlar — radius='full' dairesel yapar. Icon-only buton aria-label ister."
        >
          <div className="gap-xs flex flex-wrap items-center">
            <Button size="icon" aria-label="Ekle">
              <PlusSignIcon className="size-icon-sm" />
            </Button>
            <Button size="icon-sm" variant="outline" aria-label="Ara">
              <Search01Icon className="size-icon-sm" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Kapat">
              <Cancel01Icon className="size-icon-sm" />
            </Button>
            <Button size="icon" radius="full" variant="outline" aria-label="Ara (dairesel)">
              <Search01Icon className="size-icon-sm" />
            </Button>
          </div>
        </Preview>

        <Preview
          title="asChild — buton stili bir Link'e"
          description="asChild ile Button stilleri gerçek bir <Link>/<a>'ya uygulanır. variant='link' GÖRÜNÜM içindir; asChild DAVRANIŞ (gerçek bağlantı) içindir — en çok kullanılan kompozisyon."
        >
          <div className="gap-xs flex flex-wrap items-center">
            <Button asChild>
              <Link href="/design">Panoya git</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/design/primitives">{"Primitive'ler"}</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/design/tokens">{"Token'lar"}</Link>
            </Button>
          </div>
        </Preview>

        <Preview
          title="Button — loading (etkileşimli)"
          description="loading=true spinner + aria-busy + auto disabled. Gerçek bir async mutasyonu tetikleyip canlı gör. prefers-reduced-motion altında spinner donar."
        >
          <ButtonLoadingDemo loadingLabel={t('loading')} />
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Badge"
        description="Durum/etiket/filtre çipi — tone (renk) × variant (yüzey/dolu/kenarlık) ortogonal. surface (soluk tint) = 60-30-10'un sakin '30'u; solid = nadir '10' aksan. Yan-şerit border yasak."
      >
        <Playground
          title="Badge — variant · tone · size · radius · leadingIcon"
          description="leadingIcon açıkken ikon tone'a göre renklenir (success → yeşil, destructive → kırmızı). Etiket seçili tone'u gösterir."
          controls={{
            variant: control.segment(BADGE_VARIANTS, 'surface'),
            tone: control.select(TONE_KEYS, 'success'),
            size: control.segment(SIZE_KEYS, 'md'),
            radius: control.select(RADIUS_KEYS, 'md'),
            leadingIcon: control.bool(true, 'leadingIcon'),
          }}
          render={(v) => (
            <Badge
              variant={v.variant}
              tone={v.tone}
              size={v.size}
              radius={v.radius}
              leadingIcon={v.leadingIcon ? <Tick02Icon /> : undefined}
            >
              {v.tone}
            </Badge>
          )}
        />

        <Preview
          title="Badge — removable (onRemove)"
          description="Filter chip / tag kullanımı. Kaldır butonu 44px touch target, aria-label i18n'den. Çipleri kaldırıp boş-durumu gör."
        >
          <BadgeRemovableDemo removeLabel={t('remove')} />
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Toggle & ToggleGroup"
        description="Toggle tek aç/kapa kontrol (on-state accent dolgu); ToggleGroup ilişkili toggle kümesi (connected segment-bar veya plain). Playground'daki Toggle tıklanabilir kalır — kontroller yalnız variant/size/disabled'ı çevirir."
      >
        <Playground
          title="Toggle — variant · size · disabled"
          description="on/off state'i bileşenin kendisi yönetir (tıkla); kontroller görünüm prop'larını çevirir. md=40px Button ile hizalı."
          controls={{
            variant: control.segment(['default', 'outline'], 'default'),
            size: control.segment(SIZE_KEYS, 'md'),
            disabled: control.bool(false),
          }}
          render={(v) => (
            <Toggle variant={v.variant} size={v.size} disabled={v.disabled} defaultPressed>
              Kalın
            </Toggle>
          )}
        />

        <Preview
          title="ToggleGroup — connected (segment-bar) · plain · dikey"
          description="Bitişik segment-bar (default 'connected'): tek çerçeve, seçili = primary-soft (Tabs'taki segmented'dan ayrı). 'plain' ayrık toggle'lar. type=single/multiple, per-item disabled, dikey; gruba aria-label ver."
        >
          <div className="gap-md flex flex-col">
            <ToggleGroup type="single" defaultValue="month" aria-label="Dönem">
              <ToggleGroupItem value="day">Gün</ToggleGroupItem>
              <ToggleGroupItem value="week">Hafta</ToggleGroupItem>
              <ToggleGroupItem value="month">Ay</ToggleGroupItem>
              <ToggleGroupItem value="quarter" disabled>
                Çeyrek
              </ToggleGroupItem>
            </ToggleGroup>

            <ToggleGroup
              type="multiple"
              defaultValue={['trendyol']}
              size="sm"
              aria-label="Platform"
            >
              <ToggleGroupItem value="trendyol">Trendyol</ToggleGroupItem>
              <ToggleGroupItem value="hepsiburada">Hepsiburada</ToggleGroupItem>
              <ToggleGroupItem value="n11">n11</ToggleGroupItem>
            </ToggleGroup>

            <ToggleGroup
              type="single"
              defaultValue="table"
              appearance="plain"
              aria-label="Görünüm modu (plain)"
            >
              <ToggleGroupItem value="table">Tablo</ToggleGroupItem>
              <ToggleGroupItem value="grid">Kart</ToggleGroupItem>
              <ToggleGroupItem value="list">Liste</ToggleGroupItem>
            </ToggleGroup>

            <ToggleGroup
              type="single"
              defaultValue="orta"
              orientation="vertical"
              aria-label="Hizalama (dikey)"
            >
              <ToggleGroupItem value="sol">Sol</ToggleGroupItem>
              <ToggleGroupItem value="orta">Orta</ToggleGroupItem>
              <ToggleGroupItem value="sag">Sağ</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </Preview>
      </ShowcaseSection>
    </>
  );
}

function BadgeRemovableDemo({ removeLabel }: { removeLabel: string }): React.ReactElement {
  const [filters, setFilters] = React.useState<string[]>([
    'Trendyol',
    'Teslim edildi',
    '2026 Nisan',
  ]);

  if (filters.length === 0) {
    return (
      <span className="text-muted-foreground text-sm">
        Tüm filtreler kaldırıldı. Yenilemek için sayfayı reload edin.
      </span>
    );
  }

  return (
    <div className="gap-xs flex flex-wrap items-center">
      {filters.map((label) => (
        <Badge
          key={label}
          tone="neutral"
          radius="full"
          onRemove={() => setFilters((prev) => prev.filter((x) => x !== label))}
          removeLabel={`${removeLabel}: ${label}`}
        >
          {label}
        </Badge>
      ))}
    </div>
  );
}

function ButtonLoadingDemo({ loadingLabel }: { loadingLabel: string }): React.ReactElement {
  const [busy, setBusy] = React.useState(false);

  const kickLoading = (): void => {
    setBusy(true);
    window.setTimeout(() => setBusy(false), 1800);
  };

  return (
    <div className="gap-xs flex flex-wrap items-center">
      <Button
        onClick={kickLoading}
        loading={busy}
        loadingLabel={loadingLabel}
        loadingText="Gönderiliyor…"
        leadingIcon={<PlusSignIcon />}
      >
        Denemek için tıkla
      </Button>
      <span className="text-2xs text-muted-foreground">
        1.8 sn süren senkron mutasyonu taklit eder.
      </span>
    </div>
  );
}
