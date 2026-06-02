'use client';

import {
  Alert02Icon,
  Building03Icon,
  CheckmarkCircle02Icon,
  DatabaseIcon,
  MoreVerticalIcon,
  Refresh01Icon,
} from 'hugeicons-react';
import { useState } from 'react';

import { PageHeader } from '@/components/patterns/page-header';
import { CategoryNav } from '@/components/showcase/category-nav';
import { Playground, control } from '@/components/showcase/playground';
import { Preview } from '@/components/showcase/preview';
import { ShowcaseSection } from '@/components/showcase/section';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Avatar, AvatarFallback, AvatarGroup } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ImageModal } from '@/components/ui/image-modal';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { SoftSquareIcon, SOFT_SQUARE_ICON_VARIANTS } from '@/components/ui/soft-square-icon';
import { StatusDot } from '@/components/ui/status-dot';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SIZE_KEYS, TONE_KEYS } from '@/lib/variants';

const MOCK_ROWS = [
  { id: 'TY-2948123', customer: 'Ayşe Yılmaz', amount: '₺142,50', status: 'Teslim' },
  { id: 'TY-2948124', customer: 'Mehmet Demir', amount: '₺89,90', status: 'Kargoda' },
  { id: 'TY-2948125', customer: 'Fatma Şahin', amount: '₺212,00', status: 'Bekleyen' },
];

export default function DataDisplayPrimitivePage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Veri gösterimi"
        intent="Table, Avatar, Accordion, Collapsible, Separator, AspectRatio, Card, SoftSquareIcon, ScrollArea, ImageModal. Prop matrisi olan bileşenler tek Playground'a indirgendi — kontrol şeridinden prop'ları canlı çevir; davranış/yapı gösteren bileşenler Preview kalır."
      />
      <CategoryNav section="primitives" />

      <ShowcaseSection
        title="Table"
        description="Ham tablo primitive'i — başlık, satır, sayısal hücre hizası. Sort/filter/pagination buraya değil DataTable pattern'ine (Veri sekmesi) ait; bu yüzey yalnız yapıyı gösterir."
      >
        <Preview
          title="Table — yapı"
          description="Ham tablo primitive'i. Sort/filter/pagination DataTable pattern'inde (Veri sekmesinde) canlı gösteriliyor."
        >
          <div className="border-border overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sipariş No</TableHead>
                  <TableHead>Müşteri</TableHead>
                  <TableHead data-numeric>Tutar</TableHead>
                  <TableHead>Durum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MOCK_ROWS.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.id}</TableCell>
                    <TableCell>{row.customer}</TableCell>
                    <TableCell data-numeric className="tabular-nums">
                      {row.amount}
                    </TableCell>
                    <TableCell>{row.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Avatar"
        description="Profil fotoğrafı / inisyalli fallback. Paylaşılan size ailesi (sm/md/lg = 32/40/48px) Button ile hizalı; tone fallback yüzeyini tonlar; indicator köşeye işaret iliştirir. AvatarGroup üst üste yığın + +N taşma."
      >
        <Playground
          title="Avatar — size · tone · indicator"
          description="size/tone görünüm prop'ları; indicator açıkken köşeye StatusDot iliştirir (StatusDot'un tek yetkili kullanımı — kendi yüzeyi Feedback'te). Fallback inisyali Root size'a göre ölçeklenir."
          controls={{
            size: control.segment(SIZE_KEYS, 'md'),
            tone: control.select(TONE_KEYS, 'primary'),
            indicator: control.bool(false, 'indicator'),
          }}
          render={(v) => (
            <Avatar
              size={v.size}
              indicator={v.indicator ? <StatusDot tone="success" size="lg" /> : undefined}
            >
              <AvatarFallback tone={v.tone}>BO</AvatarFallback>
            </Avatar>
          )}
        />

        <Preview
          title="AvatarGroup — max + taşma"
          description="Üye yığını / mağaza ortakları. Negatif marjla üst üste binen diskler, her biri arka plana ringlenmiş. max görünür sayısı; tail tek +N çipine düşer. overflowLabel taşma çipinin erişilebilir adını verir."
        >
          <div className="gap-lg flex flex-col">
            <div className="gap-md flex flex-wrap items-center">
              <AvatarGroup max={3} overflowLabel={(n) => `+${n} kişi daha`}>
                <Avatar>
                  <AvatarFallback>BO</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback tone="primary">AY</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback tone="success">MK</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback>DK</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback>EŞ</AvatarFallback>
                </Avatar>
              </AvatarGroup>
              <span className="text-muted-foreground text-sm">max=3 → +2</span>
            </div>
            <div className="gap-md flex flex-wrap items-center">
              <AvatarGroup size="sm">
                <Avatar>
                  <AvatarFallback>BO</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback tone="primary">AY</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback tone="success">MK</AvatarFallback>
                </Avatar>
              </AvatarGroup>
              <span className="text-muted-foreground text-sm">max yok → hepsi görünür</span>
            </div>
          </div>
        </Preview>
        <p className="text-2xs text-muted-foreground">
          StatusDot tek başına (tone × size × pulse): /design/primitives/feedback
        </p>
      </ShowcaseSection>

      <ShowcaseSection
        title="Accordion & Collapsible"
        description="Accordion birden fazla bölümün seçerek açılıp kapanması (FAQ, ayar panelleri); Collapsible tek seferlik show/hide. İkisi de açık/kapalı state'i kendi yönetir — Preview davranışı canlı gösterir."
      >
        <Preview
          title="Accordion"
          description="FAQ, ayarlar panelleri gibi birden fazla bölümün seçerek açılıp kapanması için. type=single + collapsible: aynı anda tek bölüm açık."
        >
          <Accordion type="single" collapsible className="max-w-form w-full">
            <AccordionItem value="1">
              <AccordionTrigger>Komisyon oranı nasıl hesaplanıyor?</AccordionTrigger>
              <AccordionContent>
                Kategori bazında Trendyol komisyon oranını pazaryerinin kendi API&apos;sinden
                çekiyoruz. İlave servis bedeli ve KDV ayrı ayrı ayrıştırılıyor.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="2">
              <AccordionTrigger>Kargo maliyeti sabit mi?</AccordionTrigger>
              <AccordionContent>
                Hayır — desi bazlı hesaplanıyor. Sen tarife tablosunu sisteme tanımlıyorsun, biz
                siparişin desi&apos;sine göre otomatik eşleştiriyoruz.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="3">
              <AccordionTrigger>Hakediş mutabakatını nasıl yapıyorsunuz?</AccordionTrigger>
              <AccordionContent>
                Pazaryerinin hakediş raporunu sipariş ID ile eşleştiriyoruz. Fark varsa (kesinti,
                iade, kampanya indirimi) anlık olarak uyarıyoruz.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Preview>

        <Preview
          title="Collapsible"
          description="Tek seferlik show/hide. Styled trigger (chevron + nötr surface hover) + height-animasyonlu içerik (collapsible-down/up). asChild ile tamamen özel tetikleyici de verilebilir."
        >
          <div className="gap-lg flex flex-col">
            <Collapsible className="max-w-form">
              <CollapsibleTrigger>Gelişmiş ayarlar</CollapsibleTrigger>
              <CollapsibleContent className="text-muted-foreground px-sm pt-2xs pb-sm text-sm">
                Burada gelişmiş senkronizasyon ayarları yer alır. Özel tarih aralığı, hangi
                statüdeki siparişlerin çekileceği, retry politikası…
              </CollapsibleContent>
            </Collapsible>

            <Collapsible className="max-w-form">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">asChild — özel tetikleyici</span>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm">
                    Aç / kapa
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent className="border-border mt-sm p-md text-muted-foreground rounded-md border border-dashed text-sm">
                asChild pass-through: tetikleyici tamamen senin (Button), chevron enjekte edilmez.
              </CollapsibleContent>
            </Collapsible>
          </div>
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Separator & AspectRatio"
        description="Separator ince yatay/dikey ayraç (variant ağırlığı ayarlar); AspectRatio resim/embed için sabit oran (layout shift'i önler). Küçük yapısal primitive'ler."
      >
        <Preview
          title="Separator"
          description="İnce yatay / dikey ayraç. variant ağırlığı bağlama göre ayarlar: muted (kart-içi ince) · default · strong (ana bölümler arası) — hepsi border token ailesinden."
        >
          <div className="gap-md flex flex-col">
            <div>
              <span className="text-sm">Üst içerik</span>
              <Separator className="my-sm" />
              <span className="text-sm">Alt içerik</span>
            </div>
            <div className="gap-md flex h-6 items-center">
              <span className="text-sm">Sol</span>
              <Separator orientation="vertical" />
              <span className="text-sm">Orta</span>
              <Separator orientation="vertical" />
              <span className="text-sm">Sağ</span>
            </div>
            <div className="gap-xs flex flex-col">
              {(['muted', 'default', 'strong'] as const).map((variant) => (
                <div key={variant} className="gap-sm flex items-center">
                  <span className="text-2xs text-muted-foreground w-12 font-mono">{variant}</span>
                  <Separator variant={variant} className="flex-1" />
                </div>
              ))}
            </div>
          </div>
        </Preview>

        <Preview
          title="AspectRatio"
          description="Resim/embed için sabit oran. Görsel CDN entegrasyonunda layout shift'i önler."
        >
          <div className="max-w-form">
            <AspectRatio ratio={16 / 9}>
              <div className="bg-muted text-muted-foreground flex size-full items-center justify-center rounded-md text-sm">
                16 / 9
              </div>
            </AspectRatio>
          </div>
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Card"
        description="Yüzey kapsayıcı — CardHeader varsayılan dikey stack; leadingIcon + actions ile yatay akışa geçer. Kompozisyon bağlamını gösterir; Preview kalır."
      >
        <Preview
          title="Card — basit"
          description="CardHeader varsayılan dikey stack (Title + Description)."
        >
          <Card className="max-w-form">
            <CardHeader>
              <CardTitle>Genel Bakış</CardTitle>
              <CardDescription>Son 7 güne ait özet.</CardDescription>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">İçerik bölümü.</CardContent>
          </Card>
        </Preview>

        <Preview
          title="CardHeader — leadingIcon + actions"
          description="Header'a ikon ve sağ aksiyon slot'u eklenir. Layout yatay akışa geçer, title/description ortada daralmayan bir kolon olur."
        >
          <Card className="max-w-form">
            <CardHeader
              leadingIcon={<Building03Icon />}
              actions={
                <>
                  <Badge tone="success" size="sm">
                    Aktif
                  </Badge>
                  <Button variant="ghost" size="icon-sm" aria-label="Senkronize et">
                    <Refresh01Icon />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Menü">
                    <MoreVerticalIcon />
                  </Button>
                </>
              }
            >
              <CardTitle>Trendyol — Ana Mağaza</CardTitle>
              <CardDescription>Son senkron: 3 dk önce · GMT+3</CardDescription>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">
              Son 7 günde 142 sipariş, ₺18.240 brüt ciro. Net kâr marjı %22.
            </CardContent>
          </Card>
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="SoftSquareIcon"
        description="Semantic-dolu yuvarlak kare ikon chip'i — KPI durum satırı / kota tile'ı / panel öğesinin önünde. Dekoratif (aria-hidden); anlam yan etiketten gelir. Gölgesiz — kart içinde düz durur. Kontrolleri çevirerek fill × tone × size × shape matrisini gör."
      >
        <Playground
          title="SoftSquareIcon — variant · tone · size · shape"
          description="solid = doygun dolgu + foreground ikon; soft = soluk yüzey + tonlu ikon (nötr soft = monokrom); outline = kenarlık + tonlu ikon, dolgusuz. shape=circle dashboard stat-card ikon kelimesi."
          controls={{
            variant: control.segment(SOFT_SQUARE_ICON_VARIANTS, 'solid'),
            tone: control.select(TONE_KEYS, 'success'),
            size: control.segment(SIZE_KEYS, 'md'),
            shape: control.segment(['square', 'circle'], 'square'),
          }}
          render={(v) => (
            <SoftSquareIcon variant={v.variant} tone={v.tone} size={v.size} shape={v.shape}>
              <CheckmarkCircle02Icon />
            </SoftSquareIcon>
          )}
        />

        <Preview
          title="Bağlam içinde — durum satırı"
          description="Pratikte SoftSquareIcon bir etiketin önünde durur (anlamı etiket taşır, ikon dekoratif). Farklı tone'lar bir KPI/durum listesini fronts eder."
        >
          <div className="gap-md flex flex-col">
            <div className="gap-sm flex items-center">
              <SoftSquareIcon tone="success" variant="soft">
                <CheckmarkCircle02Icon />
              </SoftSquareIcon>
              <span className="text-sm">142 sipariş kârlı kapandı</span>
            </div>
            <div className="gap-sm flex items-center">
              <SoftSquareIcon tone="warning" variant="soft">
                <Alert02Icon />
              </SoftSquareIcon>
              <span className="text-sm">7 siparişte maliyet eksik</span>
            </div>
            <div className="gap-sm flex items-center">
              <SoftSquareIcon tone="neutral" variant="soft">
                <DatabaseIcon />
              </SoftSquareIcon>
              <span className="text-sm">Son senkron 3 dk önce tamamlandı</span>
            </div>
          </div>
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="ScrollArea & ImageModal"
        description="ScrollArea sabit-yükseklikli bölge için OS-bağımsız ince scrollbar; ImageModal görsel lightbox'ı (tıkla → tam çözünürlük). İkisi de etkileşim/kompozisyon — Preview kalır."
      >
        <Preview
          title="ScrollArea"
          description="Sabit-yükseklikli bölge için OS-bağımsız ince scrollbar (thumb hover'da parlar). Overlay / panel içinde kullanılır — sayfa gövdesinde değil (o zaten globals'ta tokenli)."
        >
          <ScrollArea className="border-border h-44 w-64 rounded-md border">
            <div className="p-sm gap-2xs flex flex-col">
              {Array.from({ length: 18 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-surface-subtle text-foreground px-sm py-xs rounded-sm text-sm tabular-nums"
                >
                  Sipariş #{(2948120 + i).toLocaleString('tr-TR')}
                </div>
              ))}
            </div>
          </ScrollArea>
        </Preview>

        <Preview
          title="ImageModal"
          description="Görsel lightbox'ı. Küçük resme tıkla → tam çözünürlükte açılır (sinema scrim + her fotoğrafta okunan sabit-koyu kapat chip'i). Esc / arka plan / chip ile kapanır."
        >
          <ImageModalDemo />
        </Preview>
      </ShowcaseSection>
    </>
  );
}

function ImageModalDemo(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const src = 'https://picsum.photos/seed/pazarsync/1000/700';
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Görseli büyüt"
        className="border-border focus-visible:ring-ring ring-offset-background size-20 overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Örnek ürün görseli" className="size-full object-cover" />
      </button>
      <ImageModal src={src} alt="Örnek ürün görseli" open={open} onOpenChange={setOpen} />
    </>
  );
}
