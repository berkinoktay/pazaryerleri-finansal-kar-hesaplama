import Link from 'next/link';
import {
  ArrowRight01Icon,
  ChartLineData01Icon,
  InvoiceIcon,
  ReceiptDollarIcon,
} from 'hugeicons-react';

import { Wordmark } from '@/components/brand/wordmark';
import { Button } from '@/components/ui/button';

const VALUE_PROPS = [
  {
    icon: ChartLineData01Icon,
    title: 'Sipariş bazında gerçek kar',
    description:
      'Komisyon, kargo, platform bedeli ve KDV ayrıştırmasıyla her siparişten ne kazandığını saniyeler içinde gör.',
  },
  {
    icon: InvoiceIcon,
    title: 'Otomatik mutabakat',
    description:
      'Hakediş raporlarını, kargo faturalarını ve sipariş verisini eşleştirip, "pazaryeri doğru mu ödedi?" sorusunu cevapla.',
  },
  {
    icon: ReceiptDollarIcon,
    title: 'Gider yönetimi',
    description:
      'Ürün maliyetleri, reklam, paketleme — tüm operasyonel giderleri sisteme ekle, kârı gerçekten doğru hesapla.',
  },
];

export default function HomePage(): React.ReactElement {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="border-border border-b">
        <div className="max-w-content-max px-lg py-md mx-auto flex items-center justify-between">
          <Wordmark />
          <nav className="gap-sm flex items-center">
            <Link
              href="/design"
              className="px-sm py-3xs text-muted-foreground hover:text-foreground rounded-md text-sm font-medium transition-colors focus-visible:outline-none"
            >
              Design system
            </Link>
            <Button asChild variant="outline" size="sm">
              <Link href="/login">Giriş</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Başla</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="max-w-content-max gap-4xl px-lg py-4xl mx-auto flex flex-col">
        <section className="gap-lg flex flex-col items-start">
          <span className="border-border bg-muted px-sm py-3xs text-2xs text-muted-foreground rounded-full border font-medium tracking-wide uppercase">
            Türkiye pazaryerleri için
          </span>
          <h1 className="text-foreground max-w-headline text-5xl font-bold tracking-tight">
            Ciro değil, <span className="text-primary">gerçek kârı</span> gör.
          </h1>
          <p className="max-w-prose-max text-muted-foreground text-lg">
            Trendyol ve Hepsiburada mağazanı bağla; komisyon, kargo, platform bedeli ve KDV
            ayrıştırılmış halde her siparişin net kârını saniyeler içinde gör.
          </p>
          <div className="gap-xs flex items-center">
            <Button asChild size="lg">
              <Link href="/signup">
                Ücretsiz başla <ArrowRight01Icon className="size-icon-sm" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="lg">
              <Link href="/design/layout-demo">Paneli gör</Link>
            </Button>
          </div>
        </section>

        <section className="gap-lg grid sm:grid-cols-3">
          {VALUE_PROPS.map(({ icon: Icon, title, description }) => (
            <div key={title} className="gap-sm flex flex-col">
              <div className="size-icon-xl bg-muted text-primary flex items-center justify-center rounded-md">
                <Icon className="size-icon" />
              </div>
              <h2 className="text-foreground text-lg font-semibold">{title}</h2>
              <p className="text-muted-foreground text-sm">{description}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-border border-t">
        <div className="max-w-content-max px-lg py-lg text-2xs text-muted-foreground mx-auto flex items-center justify-between">
          <span>© 2026 PazarSync</span>
          <span>Made in Turkey</span>
        </div>
      </footer>
    </div>
  );
}
