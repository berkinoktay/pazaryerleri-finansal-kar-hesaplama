'use client';

import {
  Alert02Icon,
  AlertCircleIcon,
  Building03Icon,
  CheckmarkCircle02Icon,
  DatabaseIcon,
  InformationCircleIcon,
  MoreVerticalIcon,
  Refresh01Icon,
} from 'hugeicons-react';

import { PageHeader } from '@/components/patterns/page-header';
import { PrimitiveNav } from '@/components/showcase/primitive-nav';
import { Preview } from '@/components/showcase/preview';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { SoftSquareIcon } from '@/components/ui/soft-square-icon';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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
        intent="Table, Avatar, Accordion, Collapsible, Separator, AspectRatio."
      />
      <PrimitiveNav />

      <Preview
        title="Table"
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

      <Preview
        title="Avatar"
        description="Profil fotoğrafı / inisyalli fallback. Button/Input ile paylaşılan size ailesi (sm/md/lg)."
      >
        <div className="gap-md flex flex-col">
          <div className="gap-md flex flex-wrap items-center">
            <Avatar size="sm">
              <AvatarFallback>BO</AvatarFallback>
            </Avatar>
            <Avatar size="md">
              <AvatarFallback>BO</AvatarFallback>
            </Avatar>
            <Avatar size="lg">
              <AvatarFallback>BO</AvatarFallback>
            </Avatar>
          </div>
          <div className="flex items-center -space-x-2">
            <Avatar className="ring-card ring-2">
              <AvatarFallback>BO</AvatarFallback>
            </Avatar>
            <Avatar className="ring-card ring-2">
              <AvatarFallback>AY</AvatarFallback>
            </Avatar>
            <Avatar className="ring-card ring-2">
              <AvatarFallback>MK</AvatarFallback>
            </Avatar>
            <Avatar className="ring-card ring-2">
              <AvatarFallback>+3</AvatarFallback>
            </Avatar>
          </div>
        </div>
      </Preview>

      <Preview
        title="Accordion"
        description="FAQ, ayarlar panelleri gibi birden fazla bölümün seçerek açılıp kapanması için."
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
              Burada gelişmiş senkronizasyon ayarları yer alır. Özel tarih aralığı, hangi statüdeki
              siparişlerin çekileceği, retry politikası…
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

      <Preview
        title="SoftSquareIcon"
        description="Semantic-dolu yuvarlak kare ikon chip'i — KPI durum satırı / kota tile'ı / panel öğesinin önünde. solid = doygun dolgu + foreground ikon; soft = soluk yüzey + tonlu ikon (nötr soft = monokrom). Dekoratif (aria-hidden); anlam yan etiketten gelir. Gölgesiz — kart içinde düz durur."
      >
        <div className="gap-lg flex flex-col">
          <div className="gap-sm flex flex-wrap items-center">
            <SoftSquareIcon tone="success">
              <CheckmarkCircle02Icon />
            </SoftSquareIcon>
            <SoftSquareIcon tone="warning">
              <Alert02Icon />
            </SoftSquareIcon>
            <SoftSquareIcon tone="destructive">
              <AlertCircleIcon />
            </SoftSquareIcon>
            <SoftSquareIcon tone="info">
              <InformationCircleIcon />
            </SoftSquareIcon>
            <SoftSquareIcon tone="primary">
              <Building03Icon />
            </SoftSquareIcon>
            <span className="text-muted-foreground text-sm">solid</span>
          </div>
          <div className="gap-sm flex flex-wrap items-center">
            <SoftSquareIcon tone="neutral" variant="soft">
              <DatabaseIcon />
            </SoftSquareIcon>
            <SoftSquareIcon tone="success" variant="soft">
              <CheckmarkCircle02Icon />
            </SoftSquareIcon>
            <SoftSquareIcon tone="warning" variant="soft">
              <Alert02Icon />
            </SoftSquareIcon>
            <SoftSquareIcon tone="info" variant="soft">
              <InformationCircleIcon />
            </SoftSquareIcon>
            <span className="text-muted-foreground text-sm">soft</span>
          </div>
          <div className="gap-sm flex flex-wrap items-center">
            <SoftSquareIcon size="sm" tone="neutral" variant="soft">
              <DatabaseIcon />
            </SoftSquareIcon>
            <SoftSquareIcon size="md" tone="neutral" variant="soft">
              <DatabaseIcon />
            </SoftSquareIcon>
            <SoftSquareIcon size="lg" tone="neutral" variant="soft">
              <DatabaseIcon />
            </SoftSquareIcon>
            <span className="text-muted-foreground text-sm">sm · md · lg</span>
          </div>
        </div>
      </Preview>
    </>
  );
}
