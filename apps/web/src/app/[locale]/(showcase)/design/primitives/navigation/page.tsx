'use client';

import Link from 'next/link';
import * as React from 'react';

import { PageHeader } from '@/components/patterns/page-header';
import { CategoryNav } from '@/components/showcase/category-nav';
import { Playground, control } from '@/components/showcase/playground';
import { Preview } from '@/components/showcase/preview';
import { ShowcaseSection } from '@/components/showcase/section';
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from '@/components/ui/menubar';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from '@/components/ui/navigation-menu';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SIZE_KEYS } from '@/lib/variants';
import { cn } from '@/lib/utils';

// Sekme tanımları config-driven: sayaç açıkken count prop'u eklenir, kapalıyken
// düz etiket. Aynı dizi her iki durumu da besler — kopyala-yapıştır yok.
const TAB_ITEMS = [
  { value: 'orders', label: 'Siparişler', count: 12, body: 'Aktif siparişler burada listelenir.' },
  { value: 'returns', label: 'İadeler', count: 3, body: 'İade süreçleri burada izlenir.' },
  {
    value: 'settlements',
    label: 'Hakediş',
    count: 48,
    body: 'Pazaryeri hakediş kalemleri burada eşleşir.',
  },
] as const;

export default function NavigationPrimitivePage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Gezinme"
        intent="Tab, breadcrumb, pagination, navigation-menu, menubar. Üç sütunlu dashboard shell'inin dışında kalan her gezinme deseni buradan — kontrol şeritlerinden Tabs prop'larını canlı çevir."
      />
      <CategoryNav section="primitives" />

      <ShowcaseSection
        title="Tabs"
        description="Aynı hiyerarji seviyesindeki kardeş panel'ler arası geçiş. pill (default) = muted track içinde segmented kontrol; underline = tam sayfa bölümü tanıtan, konteynersiz alt çizgi. Aktiflik dolgu değil — beyaz chip + text-primary etiketle gelir. Aktif sekmeyi bileşen yönetir (tıkla); kontroller yalnız görünüm prop'larını çevirir."
      >
        <Playground
          title="Tabs — variant · size · sayaç rozeti"
          description="Tek etkileşimli yüzey; eski pill / count / underline / size statik Preview'larının yerini alır. count açıkken her sekmeye dolu-primary sayaç rozeti (bekleyen / kargoda / teslim metriği) eklenir — rozet aktif ve pasif sekmede aynı okunur."
          controls={{
            variant: control.segment(['pill', 'underline'], 'pill'),
            size: control.segment(SIZE_KEYS, 'md'),
            withCount: control.bool(false, 'withCount'),
          }}
          render={(v) => (
            <Tabs defaultValue="orders" variant={v.variant} size={v.size} className="w-full">
              <TabsList>
                {TAB_ITEMS.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    count={v.withCount ? tab.count : undefined}
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {TAB_ITEMS.map((tab) => (
                <TabsContent
                  key={tab.value}
                  value={tab.value}
                  className="text-muted-foreground text-sm"
                >
                  {tab.body}
                </TabsContent>
              ))}
            </Tabs>
          )}
        />
      </ShowcaseSection>

      <ShowcaseSection
        title="Breadcrumb & Pagination"
        description="Sayfa konumlandırma desenleri — derin hiyerarşi izi ve tablo sayfa gezinmesi. İkisi de yapısal kompozisyon; bir prop'la çevrilmez, kendi Preview'larında kalır."
      >
        <Preview
          title="Breadcrumb"
          description="Derin sayfa hiyerarşisi için. Dashboard'dan uzak sayfalarda (iade detayı, mutabakat alt-kırılımı) kullan. Uzun yollar BreadcrumbEllipsis ile kısalır."
        >
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/dashboard">Panel</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="/orders">Siparişler</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbEllipsis />
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>TY-2948-123</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </Preview>

        <Preview
          title="Pagination"
          description="Tablolarda sayfa gezinmesi. Tabular-nums ile hizalı; isActive aktif sayfayı işaretler, PaginationEllipsis aradaki sayfaları gizler."
        >
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious href="#" />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#">1</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#" isActive>
                  2
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#">3</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationEllipsis />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#">24</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext href="#" />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="NavigationMenu & Menubar"
        description="Overlay-tabanlı gezinme. Dashboard üç sütunlu shell ile değiştirildi — bu ikisi landing navbar'ı ve editör-tarzı içerik içindir. Açılır panel davranışı tek prop'la çevrilmez; kompozisyon Preview'larında kalır."
      >
        <Preview
          title="NavigationMenu"
          description="Mega-menu / üst-seviye gezinme. Landing sayfasının navbar'ı için uygun; trigger üzerine gelince zengin içerikli panel açar."
        >
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuTrigger>Ürün</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="gap-3xs p-sm grid w-72">
                    <li>
                      <NavigationMenuLink asChild>
                        <Link href="#" className="p-xs hover:bg-muted block rounded-md">
                          <p className="text-sm font-medium">Karlılık</p>
                          <p className="text-2xs text-muted-foreground">
                            Sipariş bazında net kar hesabı
                          </p>
                        </Link>
                      </NavigationMenuLink>
                    </li>
                    <li>
                      <NavigationMenuLink asChild>
                        <Link href="#" className="p-xs hover:bg-muted block rounded-md">
                          <p className="text-sm font-medium">Mutabakat</p>
                          <p className="text-2xs text-muted-foreground">
                            Hakediş raporu - sipariş eşleştirme
                          </p>
                        </Link>
                      </NavigationMenuLink>
                    </li>
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink asChild className={cn(navigationMenuTriggerStyle())}>
                  <Link href="#">Fiyatlandırma</Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink asChild className={cn(navigationMenuTriggerStyle())}>
                  <Link href="#">Dokümantasyon</Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
        </Preview>

        <Preview
          title="Menubar"
          description="Desktop app metaforu — bu desenin kanonik evi burası (diğer sayfalardaki overlay'ler buraya yönlendirir). E-ticaret SaaS'ında nadir; editör-tarzı içerik için uygun (ör. kampanya simülatörü)."
        >
          <Menubar>
            <MenubarMenu>
              <MenubarTrigger>Dosya</MenubarTrigger>
              <MenubarContent>
                <MenubarItem>
                  Yeni sipariş <MenubarShortcut>⌘N</MenubarShortcut>
                </MenubarItem>
                <MenubarItem>
                  İçe aktar <MenubarShortcut>⌘I</MenubarShortcut>
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem>
                  Dışa aktar <MenubarShortcut>⌘E</MenubarShortcut>
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger>Görünüm</MenubarTrigger>
              <MenubarContent>
                <MenubarCheckboxItem checked>Yan paneli göster</MenubarCheckboxItem>
                <MenubarCheckboxItem>Etkinlik akışı</MenubarCheckboxItem>
                <MenubarSeparator />
                <MenubarItem>Tam ekran</MenubarItem>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
        </Preview>
      </ShowcaseSection>
    </>
  );
}
