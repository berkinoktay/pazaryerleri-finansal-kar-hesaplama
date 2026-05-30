'use client';

import { AlertCircleIcon, Delete02Icon, EditUser02Icon, MailAdd01Icon } from 'hugeicons-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/patterns/page-header';
import { PrimitiveNav } from '@/components/showcase/primitive-nav';
import { Preview } from '@/components/showcase/preview';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from '@/components/ui/menubar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export default function OverlaysPrimitivePage(): React.ReactElement {
  // Local state so the checkbox / radio menu demos toggle live — showing the
  // selection vocabulary (text-primary tick, bg-primary radio dot, checked-row
  // medium weight) across the menu family.
  const [showProfit, setShowProfit] = useState(true);
  const [showDesi, setShowDesi] = useState(false);
  const [sort, setSort] = useState('date');
  const [pinned, setPinned] = useState(true);
  const [tag, setTag] = useState('normal');
  const [statusBar, setStatusBar] = useState(true);
  const [density, setDensity] = useState('comfortable');

  return (
    <>
      <PageHeader
        title="Overlay"
        intent="Modal olmayan (popover, hover-card, tooltip) ve modal (dialog, alert-dialog, sheet, drawer) overlay bileşenleri. Modal yalnızca kesintiye uğratılması gereken aksiyonlar için."
      />
      <PrimitiveNav />

      <Preview title="Dialog" description="Standart modal. Vazgeç + primary aksiyon.">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Mağaza bağla</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Yeni mağaza bağla</DialogTitle>
              <DialogDescription>
                Pazaryeri API bilgilerini girerek mağazanı PazarSync&apos;e bağla.
              </DialogDescription>
            </DialogHeader>
            <div className="gap-md flex flex-col">
              <div className="gap-3xs flex flex-col">
                <Label htmlFor="api-key">API Anahtarı</Label>
                <Input id="api-key" type="password" placeholder="*****" />
              </div>
              <div className="gap-3xs flex flex-col">
                <Label htmlFor="api-secret">API Secret</Label>
                <Input id="api-secret" type="password" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost">Vazgeç</Button>
              <Button>Bağlantıyı test et</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Preview>

      <Preview
        title="AlertDialog"
        description="Sadece geri alınamaz aksiyonlar için (silme, iptal). Dialog'dan farklı: kapatmak için aksiyon ZORUNLU."
      >
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">
              <Delete02Icon className="size-icon-sm" />
              Mağazayı sil
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Bu mağazayı silmek istediğine emin misin?</AlertDialogTitle>
              <AlertDialogDescription>
                Bu işlem geri alınamaz. Mağazanın senkronizasyonu durur ve geçmiş veri de silinir.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Vazgeç</AlertDialogCancel>
              <AlertDialogAction onClick={() => toast.success('Mağaza silindi (mock)')}>
                Evet, sil
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Preview>

      <Preview
        title="Sheet"
        description="Yan taraftan kayan panel. 4 yön: top, bottom, left, right. Mağaza detayı, filtre paneli gibi uzun içerikler için."
      >
        <div className="gap-xs flex flex-wrap">
          {(['right', 'left', 'bottom', 'top'] as const).map((side) => (
            <Sheet key={side}>
              <SheetTrigger asChild>
                <Button variant="outline">{side}</Button>
              </SheetTrigger>
              <SheetContent side={side}>
                <SheetHeader>
                  <SheetTitle>Sheet ({side})</SheetTitle>
                  <SheetDescription>
                    Yan taraftan kayar. ContextRail&apos;in mobil karşılığı olarak da
                    kullanılabilir.
                  </SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>
          ))}
        </div>
      </Preview>

      <Preview
        title="Drawer"
        description="Mobil için özellikle uygun alttan kayan panel. Vaul ile hareket jest desteği — sürükleyerek kapatılabilir."
      >
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline">Drawer aç</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Hızlı sipariş detayı</DrawerTitle>
              <DrawerDescription>
                Bu panel mobil görünümde yukarı kayar. Desktop&apos;ta Sheet daha uygundur.
              </DrawerDescription>
            </DrawerHeader>
            <div className="px-lg pb-md text-muted-foreground text-sm">Mock içerik…</div>
            <DrawerFooter>
              <Button>Onayla</Button>
              <Button variant="ghost">Vazgeç</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </Preview>

      <Preview
        title="Popover"
        description="Fine-grained kontrol — filtre, kısa form, yardımcı açıklama."
      >
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">Filtre</Button>
          </PopoverTrigger>
          <PopoverContent>
            <div className="gap-sm flex flex-col">
              <h4 className="text-sm font-semibold">Filtre</h4>
              <p className="text-2xs text-muted-foreground">
                Tablodaki kayıtları seçili kriterlere göre süz.
              </p>
              <Button size="sm" className="self-end">
                Uygula
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </Preview>

      <Preview
        title="HoverCard"
        description="Kullanıcı avatar'ı, ürün kodu gibi hover'da ek context sunmak için. Link metadata preview."
      >
        <HoverCard>
          <HoverCardTrigger asChild>
            <Button variant="link" className="px-0">
              @berkin-oktay
            </Button>
          </HoverCardTrigger>
          <HoverCardContent>
            <div className="gap-sm flex items-center">
              <Avatar>
                <AvatarFallback>BO</AvatarFallback>
              </Avatar>
              <div>
                <p className="text-foreground text-sm font-semibold">Berkin Oktay</p>
                <p className="text-2xs text-muted-foreground">İşletme sahibi · Trendyol</p>
              </div>
            </div>
          </HoverCardContent>
        </HoverCard>
      </Preview>

      <Preview
        title="DropdownMenu"
        description="Sayfanın aksiyon menüsü. Sipariş satırında 'more' butonu, header'da kullanıcı menüsü."
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">Aksiyonlar</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Sipariş işlemleri</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <EditUser02Icon className="size-icon-sm" /> Müşteri bilgisini düzenle
              <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <MailAdd01Icon className="size-icon-sm" /> E-posta gönder
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Dışa aktar</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>CSV</DropdownMenuItem>
                <DropdownMenuItem>Excel</DropdownMenuItem>
                <DropdownMenuItem>PDF</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Görünür sütunlar</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={showProfit} onCheckedChange={setShowProfit}>
              Kâr sütunu
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={showDesi} onCheckedChange={setShowDesi}>
              Desi sütunu
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Sıralama</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
              <DropdownMenuRadioItem value="date">Tarihe göre</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="amount">Tutara göre</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="profit">Kâra göre</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive">Siparişi iptal et</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Preview>

      <Preview
        title="ContextMenu"
        description="Sağ tık menüsü. Tablo satırlarında power-user aksiyonları. (Aşağıdaki kutuya sağ tıkla.)"
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="border-border bg-surface-subtle text-muted-foreground flex h-24 w-full items-center justify-center rounded-md border border-dashed text-sm">
              Sağ tıkla
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuLabel>Sipariş</ContextMenuLabel>
            <ContextMenuSeparator />
            <ContextMenuItem>
              Detayı aç
              <ContextMenuShortcut>↵</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem>
              Kopyala
              <ContextMenuShortcut>⌘C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuCheckboxItem checked={pinned} onCheckedChange={setPinned}>
              Sabitle
            </ContextMenuCheckboxItem>
            <ContextMenuSeparator />
            <ContextMenuLabel>Etiket</ContextMenuLabel>
            <ContextMenuRadioGroup value={tag} onValueChange={setTag}>
              <ContextMenuRadioItem value="urgent">Acil</ContextMenuRadioItem>
              <ContextMenuRadioItem value="normal">Normal</ContextMenuRadioItem>
              <ContextMenuRadioItem value="low">Düşük öncelik</ContextMenuRadioItem>
            </ContextMenuRadioGroup>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive">İptal et</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Preview>

      <Preview
        title="Menubar"
        description="Masaüstü tarzı yatay menü çubuğu (Dosya · Düzen · Görünüm). SaaS panellerinde nadir — çoğu yerde sidebar + dropdown daha iyi erişim sunar; düzenleyici/IDE tarzı uygulamalar için."
      >
        <Menubar>
          <MenubarMenu>
            <MenubarTrigger>Dosya</MenubarTrigger>
            <MenubarContent>
              <MenubarItem>
                Yeni sekme
                <MenubarShortcut>⌘T</MenubarShortcut>
              </MenubarItem>
              <MenubarItem>
                Yeni pencere
                <MenubarShortcut>⌘N</MenubarShortcut>
              </MenubarItem>
              <MenubarSub>
                <MenubarSubTrigger>Paylaş</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem>E-posta</MenubarItem>
                  <MenubarItem>Bağlantı kopyala</MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSeparator />
              <MenubarItem>
                Yazdır
                <MenubarShortcut>⌘P</MenubarShortcut>
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>
          <MenubarMenu>
            <MenubarTrigger>Görünüm</MenubarTrigger>
            <MenubarContent>
              <MenubarCheckboxItem checked={statusBar} onCheckedChange={setStatusBar}>
                Durum çubuğu
              </MenubarCheckboxItem>
              <MenubarSeparator />
              <MenubarRadioGroup value={density} onValueChange={setDensity}>
                <MenubarRadioItem value="comfortable">Ferah yoğunluk</MenubarRadioItem>
                <MenubarRadioItem value="compact">Yoğun</MenubarRadioItem>
              </MenubarRadioGroup>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
      </Preview>

      <Preview
        title="Command"
        description="cmdk tabanlı komut paleti — typeahead filtreli aksiyon listesi. CommandDialog ile Cmd+K paletine sarılır; inline olarak Popover/Sheet içinde de yaşar. (Yazarak süz.)"
      >
        <div className="border-border max-w-input w-full overflow-hidden rounded-md border">
          <Command>
            <CommandInput placeholder="Komut ara…" />
            <CommandList>
              <CommandEmpty>Sonuç bulunamadı.</CommandEmpty>
              <CommandGroup heading="Hızlı işlemler">
                <CommandItem>
                  Yeni mağaza bağla
                  <CommandShortcut>⌘N</CommandShortcut>
                </CommandItem>
                <CommandItem>
                  Siparişleri ara
                  <CommandShortcut>⌘F</CommandShortcut>
                </CommandItem>
                <CommandItem>
                  Maliyet düzenle
                  <CommandShortcut>⌘⇧E</CommandShortcut>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Gezinme">
                <CommandItem>Panele git</CommandItem>
                <CommandItem>Ayarlar</CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      </Preview>

      <Preview
        title="Tooltip"
        description="Kısa açıklama. Icon-only butonlara erişilebilirlik sağlar."
      >
        <div className="gap-md flex flex-wrap">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Tooltip üzerine gel</Button>
            </TooltipTrigger>
            <TooltipContent>Son senkronizasyon 2 dk önce</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="Yardım">
                <AlertCircleIcon className="size-icon-sm" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Komisyon oranı kategoriye göre değişir</TooltipContent>
          </Tooltip>
        </div>
      </Preview>
    </>
  );
}
