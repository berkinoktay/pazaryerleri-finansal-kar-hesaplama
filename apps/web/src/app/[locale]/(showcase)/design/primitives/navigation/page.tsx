'use client';

import Link from 'next/link';

import { PageHeader } from '@/components/patterns/page-header';
import { PrimitiveNav } from '@/components/showcase/primitive-nav';
import { Preview } from '@/components/showcase/preview';
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
import { cn } from '@/lib/utils';

export default function NavigationPrimitivePage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Gezinme"
        intent="Tab, breadcrumb, pagination, navigation-menu, menubar. Üç sütunlu layout dışındaki her gezinme deseni buradan."
      />
      <PrimitiveNav />

      <Preview
        title="Tabs — pill (default)"
        description="Muted konteyner içinde segmented kontrol. Kart veya toolbar içinde kullanın."
      >
        <Tabs defaultValue="orders">
          <TabsList>
            <TabsTrigger value="orders">Siparişler</TabsTrigger>
            <TabsTrigger value="returns">İadeler</TabsTrigger>
            <TabsTrigger value="settlements">Hakediş</TabsTrigger>
          </TabsList>
          <TabsContent value="orders" className="text-muted-foreground text-sm">
            Aktif siparişler burada listelenir.
          </TabsContent>
          <TabsContent value="returns" className="text-muted-foreground text-sm">
            İade süreçleri burada izlenir.
          </TabsContent>
          <TabsContent value="settlements" className="text-muted-foreground text-sm">
            Pazaryeri hakediş kalemleri burada eşleşir.
          </TabsContent>
        </Tabs>
      </Preview>

      <Preview
        title="Tabs — underline"
        description="Tam sayfa bölümünü tanıtan tablar için. Konteyner yok, sadece alt çizgi ile aktif state."
      >
        <Tabs defaultValue="overview" variant="underline">
          <TabsList>
            <TabsTrigger value="overview">Genel bakış</TabsTrigger>
            <TabsTrigger value="orders">Siparişler</TabsTrigger>
            <TabsTrigger value="profitability">Karlılık</TabsTrigger>
            <TabsTrigger value="settings">Ayarlar</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="text-muted-foreground text-sm">
            Bu mağazanın genel özeti.
          </TabsContent>
          <TabsContent value="orders" className="text-muted-foreground text-sm">
            Tüm siparişlerin listesi ve durum filtresi.
          </TabsContent>
          <TabsContent value="profitability" className="text-muted-foreground text-sm">
            Sipariş bazında net kar hesabı.
          </TabsContent>
          <TabsContent value="settings" className="text-muted-foreground text-sm">
            Mağaza senkronizasyon ayarları.
          </TabsContent>
        </Tabs>
      </Preview>

      <Preview
        title="Tabs — size (sm / md / lg)"
        description="Paylaşılan size prop'u. Tabs, Button, Input, Select hepsi aynı anahtarı kullanır."
      >
        <div className="gap-lg flex flex-col">
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <Tabs key={size} defaultValue="orders" size={size}>
              <TabsList>
                <TabsTrigger value="orders">Siparişler</TabsTrigger>
                <TabsTrigger value="returns">İadeler</TabsTrigger>
                <TabsTrigger value="settlements">Hakediş</TabsTrigger>
              </TabsList>
            </Tabs>
          ))}
        </div>
      </Preview>

      <Preview
        title="Breadcrumb"
        description="Derin sayfa hiyerarşisi için. Dashboard'dan uzak sayfalarda (iade detayı, mutabakat alt-kırılımı) kullan."
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
        description="Tablolarda sayfa gezinmesi. Tabular-nums ile hizalı."
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

      <Preview
        title="NavigationMenu"
        description="Mega-menu / top-level navigation. Dashboard'un üç sütunlu shell'i ile değiştirdik ama landing sayfasının navbar'ı için uygun."
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
        description="Desktop app metaforu. E-ticaret SaaS'ında nadir; editor tarzı içerik için uygun (ör. kampanya simülatörü)."
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
    </>
  );
}
