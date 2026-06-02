'use client';

import { AlertCircleIcon, Delete02Icon, EditUser02Icon, MailAdd01Icon } from 'hugeicons-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/patterns/page-header';
import { CategoryNav } from '@/components/showcase/category-nav';
import { Playground, control } from '@/components/showcase/playground';
import { Preview } from '@/components/showcase/preview';
import { ShowcaseSection } from '@/components/showcase/section';
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
import { Link } from '@/i18n/navigation';

export default function OverlaysPrimitivePage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Overlay"
        intent="Modal olmayan (popover, hover-card, tooltip) ve modal (dialog, alert-dialog, sheet, drawer) overlay bileşenleri. Modal yalnızca kesintiye uğratılması gereken aksiyonlar için. Sheet'in yön/varyant matrisini kontrol şeridinden canlı çevir."
      />
      <CategoryNav section="primitives" />

      <ShowcaseSection
        title="Modal olmayan overlay'ler"
        description="Altta yatan sayfa context'ini korur — kullanıcı arkayı görür, scrim'e tıklayıp kapatabilir. Tooltip · Popover · HoverCard."
      >
        <Preview
          title="Tooltip"
          description="Kısa açıklama. Icon-only butonlara erişilebilirlik sağlar — overlay'ler içinde Tooltip'in kanonik evi burası."
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
      </ShowcaseSection>

      <ShowcaseSection
        title="Modal overlay'ler"
        description="Odağı yakalar, arkayı scrim'le örter. Dialog · AlertDialog · Sheet · Drawer. Modal yalnızca kesintiye uğratılması gereken aksiyonlar için."
      >
        <Preview
          title="Dialog"
          description="Standart modal. Vazgeç + primary aksiyon — scrim'e tıklayıp kapatılabilir."
        >
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
          description="Sadece geri alınamaz aksiyonlar için (silme, iptal). Dialog'dan farklı: scrim'e tıklayarak kapatılamaz — kapatmak için aksiyon ZORUNLU."
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

        <Playground
          title="Sheet — side · variant"
          description="Tetikleyiciyi açıp yönü (top/right/bottom/left) ve varyantı çevir. docked kenara yapışık + iç-köşe radius (mobil sidebar nav); floating dar boşlukla içeri çekilir + tam radius (detay paneli). Eski 'her yön × varyant için 8 sheet' bloğunun yerini alır."
          controls={{
            side: control.segment(['top', 'right', 'bottom', 'left'], 'right'),
            variant: control.segment(['docked', 'floating'], 'docked'),
          }}
          render={(v) => (
            <Sheet key={`${v.side}-${v.variant}`}>
              <SheetTrigger asChild>
                <Button variant="outline">
                  Sheet aç — {v.side} · {v.variant}
                </Button>
              </SheetTrigger>
              <SheetContent side={v.side} variant={v.variant}>
                <SheetHeader>
                  <SheetTitle>
                    Sheet — {v.variant} ({v.side})
                  </SheetTitle>
                  <SheetDescription>
                    {v.variant === 'docked'
                      ? 'Kenara yapışık, içeri bakan köşeler yuvarlak. Navigasyon / mobil sidebar için doğru seçim.'
                      : 'Dar boşlukla içeri çekilmiş, tüm köşeler yuvarlak. Detay paneli için modern "yüzen kart" görünümü.'}
                  </SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>
          )}
        />

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
      </ShowcaseSection>

      <ShowcaseSection
        title="Menü ailesi"
        description="Aynı seçim sözlüğünü paylaşır: text-primary tik (checkbox), bg-primary nokta (radio), seçili satırda medium ağırlık. Vokabüler bir kez DropdownMenu'de gösterilir; ContextMenu tetikleyicisi farklıdır (sağ tık)."
      >
        <Preview
          title="DropdownMenu"
          description="Sayfanın aksiyon menüsü. Sipariş satırında 'more' butonu, header'da kullanıcı menüsü. Checkbox / radio item sözlüğünün kanonik gösterimi."
        >
          <DropdownMenuVocabularyDemo />
        </Preview>

        <Preview
          title="ContextMenu"
          description="Sağ tık menüsü. Tablo satırlarında power-user aksiyonları — DropdownMenu ile aynı checkbox/radio sözlüğünü paylaşır, tek fark tetikleyici (sağ tık). Aşağıdaki kutuya sağ tıkla."
        >
          <ContextMenuVocabularyDemo />
        </Preview>

        <p className="text-2xs text-muted-foreground">
          Menubar (masaüstü tarzı yatay menü çubuğu) navigasyon ailesine aittir →{' '}
          <Link href="/design/primitives/navigation" className="underline underline-offset-2">
            /design/primitives/navigation
          </Link>
        </p>
      </ShowcaseSection>

      <ShowcaseSection
        title="Komut paleti"
        description="cmdk tabanlı typeahead filtreli aksiyon listesi — CommandDialog ile Cmd+K paletine sarılır, inline olarak Popover/Sheet içinde de yaşar."
      >
        <Preview title="Command" description="Yazarak süz; eşleşen aksiyonlar daralır.">
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
      </ShowcaseSection>
    </>
  );
}

function DropdownMenuVocabularyDemo(): React.ReactElement {
  const [showProfit, setShowProfit] = useState(true);
  const [showDesi, setShowDesi] = useState(false);
  const [sort, setSort] = useState('date');

  return (
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
  );
}

function ContextMenuVocabularyDemo(): React.ReactElement {
  const [pinned, setPinned] = useState(true);
  const [tag, setTag] = useState('normal');

  return (
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
  );
}
