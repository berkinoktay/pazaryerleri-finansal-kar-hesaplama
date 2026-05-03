import {
  CheckmarkCircle02Icon,
  CodeIcon,
  Database02Icon,
  EyeIcon,
  GlobalIcon,
  KeyboardIcon,
  Layers01Icon,
  PaintBrush01Icon,
  PuzzleIcon,
  TaskDone01Icon,
  TestTube02Icon,
} from 'hugeicons-react';
import * as React from 'react';

import { PageHeader } from '@/components/patterns/page-header';
import { cn } from '@/lib/utils';

interface ChecklistItem {
  title: string;
  description: string;
  examples?: string[];
}

interface ChecklistSection {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  intent: string;
  items: ChecklistItem[];
}

const SECTIONS: ChecklistSection[] = [
  {
    id: 'visual',
    icon: PaintBrush01Icon,
    title: 'Visual',
    intent: 'Token-clean, dark-mode safe, no arbitrary values.',
    items: [
      {
        title: 'Token-only kullanım',
        description:
          "Sadece tokens/* altındaki değerlere bağlı. Ne `bg-[#…]` ne `p-[13px]` ne raw `oklch(…)` çağrısı; ESLint zaten arbitrary-value'leri bloke ediyor.",
      },
      {
        title: 'Dark mode dört kuralı',
        description:
          'Raised surface dış shadow + inset top highlight; semantic tone kontratı (text-tone vs text-tone-foreground); chart serileri --color-<key> üzerinden; alpha shortcut yasağı (yeni semantic surface gerekirse token ekle).',
      },
    ],
  },
  {
    id: 'props',
    icon: PuzzleIcon,
    title: 'Props',
    intent: 'Stateful endişeleri bileşen sahipler.',
    items: [
      {
        title: 'loading / disabled / error / empty',
        description:
          'Uygulanabilir olduğunda hepsi bileşenin sözleşmesinde — yoksa PR açıklamasında "N/A çünkü …" diye not düş.',
      },
      {
        title: "Explicit return type, 'use client' sadece gerektiğinde",
        description:
          'export edilen tüm fonksiyonlarda dönüş tipi açık. Server Component varsayılan; etkileşim varsa "use client".',
      },
    ],
  },
  {
    id: 'a11y',
    icon: KeyboardIcon,
    title: 'A11y',
    intent: 'Klavye + ekran okuyucu + dokunmatik birinci sınıf.',
    items: [
      {
        title: 'Keyboard nav',
        description: 'Tab + Arrow + Esc/Enter sözleşmeli. Roving tabindex bileşen içi gezinmede.',
      },
      {
        title: 'ARIA roller + etiketler',
        description:
          "Doğru role + aria-label (Türkçe i18n'lı). aria-current, aria-expanded, aria-busy bileşene uygun.",
      },
      {
        title: ':focus-visible ring',
        description:
          'Global :focus-visible kuralı (3px brand-blue glow) varsayılan; sadece bilinçli özelleştir.',
      },
      {
        title: 'Touch target ≥ 44px',
        description:
          'pointer-coarse: utility ile parmakta büyür. Masaüstünde 32–36px ikon-button kabul, mobilde 44.',
      },
      {
        title: 'prefers-reduced-motion',
        description:
          'Dekoratif animasyon honor edilir; fonksiyonel motion (spinner, progress) çalışmaya devam eder.',
      },
    ],
  },
  {
    id: 'responsive',
    icon: Layers01Icon,
    title: 'Responsive',
    intent: 'Container queries bileşene, viewport queries sayfaya.',
    items: [
      {
        title: 'Bileşen içi → @container',
        description: 'Bileşen kendi konteynerine reaksiyon verir. Sayfa enine değil, slot enine.',
      },
      {
        title: 'Sayfa düzeni → @media',
        description: 'Sayfa-seviyesi kırılma noktaları içerik-driven; cihaz-driven değil.',
      },
    ],
  },
  {
    id: 'ssr',
    icon: GlobalIcon,
    title: 'SSR-safe',
    intent: 'Sunucu + istemci render byte-eşit.',
    items: [
      {
        title: 'Date.now() / new Date() yasak (render path)',
        description:
          "Mock data'larda hard-coded ISO string. Relative time için mount gate ya da deterministic fallback.",
      },
      {
        title: 'theme okuma yasak (render)',
        description:
          "CSS-only swap (Sun + Moon her ikisi DOM'da, dark: ile gizle/göster) ya da useIsMounted gate.",
      },
      {
        title: 'Nested <button> yok',
        description:
          'Radix triggers BUTTON\'dur; içine başka button koyma. role="button" span kullan.',
      },
      {
        title: 'next-intl format preset',
        description: "formatter'a inline options değil; formats.ts'teki named preset.",
      },
    ],
  },
  {
    id: 'i18n',
    icon: CodeIcon,
    title: 'i18n',
    intent: 'Hardcoded Türkçe yok.',
    items: [
      {
        title: 'next-intl üzerinden tüm copy',
        description:
          'Kullanıcıya görünen tüm metin t() çağrısı arkasında ya da prop olarak dışarıdan veriliyor. JSX içine inline Türkçe yasak.',
      },
      {
        title: 'formats.ts named presets',
        description:
          "Tarih, sayı, currency, yüzde — tüm format çağrıları named preset'lerden (short, long, currency, percentDelta).",
      },
    ],
  },
  {
    id: 'test',
    icon: TestTube02Icon,
    title: 'Test',
    intent: 'Etkileşimli bileşenler RTL + MSW + userEvent ile.',
    items: [
      {
        title: 'Component test (interaktif)',
        description:
          'tests/component/<component>.test.tsx; render helper + getByRole + userEvent. Snapshot test yasak; getByTestId son çare.',
      },
      {
        title: 'Pure presentational → atla',
        description: "Card, Badge, Spinner gibi sade primitive'ler test'siz; iş mantığı yok.",
      },
    ],
  },
  {
    id: 'showcase',
    icon: EyeIcon,
    title: 'Showcase',
    intent: 'Her bileşenin tüm varyantları /design altında.',
    items: [
      {
        title: '/design/primitives veya /design/patterns altında',
        description:
          "Atom → primitives kategorisi; pattern → patterns kategorisi. Tüm anlamlı state'ler demoed.",
      },
      {
        title: 'Production-realistic content',
        description:
          "Wireframe placeholder yasak. Gerçek Trendyol kategorileri, gerçek hakediş dosya isimleri, gerçek sipariş numaraları. Emoji yasak — ikonlar hugeicons-react'tan.",
      },
    ],
  },
  {
    id: 'manifest',
    icon: Database02Icon,
    title: 'Manifest',
    intent: 'components.manifest.json güncel, @useWhen ipucu var.',
    items: [
      {
        title: '@useWhen JSDoc tag',
        description:
          "Bileşenin TSDoc bloğunda @useWhen <bir cümle> — gelecek Claude session'larının bu bileşeni doğru zamanda seçebilmesi için.",
      },
      {
        title: 'pnpm emit:components-manifest',
        description:
          "Bileşen ekleyince/silince çalıştır; commit'e dahil et. CI bu dosyayı doğrular.",
      },
    ],
  },
  {
    id: 'gate',
    icon: TaskDone01Icon,
    title: 'Gate',
    intent: 'pnpm check:all yeşil olmadan PR açma.',
    items: [
      {
        title: 'typecheck + lint + test:unit + format + audits',
        description:
          "Tüm 6 adım yeşil. Boundaries audit feature-cross import'ları (warn olarak bile) yakalar; error-codes audit RFC 7807 contract'ı doğrular.",
      },
      {
        title: 'DevTools doğrulaması',
        description:
          "UI-yüzeyli değişiklikler /design rotasında dev server'da gerçekten görüldü; sadece tip kontrolü yetmez.",
      },
    ],
  },
];

export default function ChecklistPage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Per-component definition of done"
        intent="Her tasarım sistemi PR'ında geçilmesi gereken kontrol listesi. Plan dokümanından buraya satır-içi okunabilir hale getirildi — yeni bir bileşen yazıyorsan ya da review yapıyorsan tek kaynak burası."
      />

      <div className="gap-md grid lg:grid-cols-2">
        {SECTIONS.map((section) => (
          <ChecklistCard key={section.id} section={section} />
        ))}
      </div>
    </>
  );
}

function ChecklistCard({ section }: { section: ChecklistSection }): React.ReactElement {
  const Icon = section.icon;
  return (
    <article
      id={section.id}
      className={cn('border-border bg-card p-lg gap-md flex flex-col rounded-lg border shadow-xs')}
    >
      <header className="gap-sm flex items-start">
        <span className="bg-muted text-foreground [&_svg]:size-icon flex size-10 shrink-0 items-center justify-center rounded-md">
          <Icon className="size-icon" />
        </span>
        <div className="gap-3xs flex flex-col">
          <h2 className="text-foreground text-md font-semibold tracking-tight">{section.title}</h2>
          <p className="text-muted-foreground text-sm leading-snug">{section.intent}</p>
        </div>
      </header>
      <ul className="gap-sm flex flex-col">
        {section.items.map((item) => (
          <li key={item.title} className="gap-xs flex items-start">
            <CheckmarkCircle02Icon
              className="size-icon-sm text-success mt-3xs shrink-0"
              aria-hidden
            />
            <div className="gap-3xs flex flex-col">
              <span className="text-foreground text-sm font-medium">{item.title}</span>
              <span className="text-muted-foreground text-2xs leading-snug">
                {item.description}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}
