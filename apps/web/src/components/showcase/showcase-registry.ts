/**
 * Showcase navigation — single source of truth.
 *
 * One module describes the `/design/*` nav tree. Everything that used to keep
 * its own hand-maintained copy now derives from here:
 *   - the top-level header nav (showcase layout),
 *   - the `/design` landing card grid (incl. Manifest + Checklist),
 *   - the `/design/primitives` and `/design/patterns` category-card grids,
 *   - the sticky `CategoryNav` sub-navs on every section page.
 *
 * Before this, three definitions disagreed (the layout nav, the index cards,
 * and PrimitiveNav/PatternNav) and the index cards hardcoded per-category
 * counts + component-name strings that had already drifted from reality. Counts
 * shown anywhere are now DERIVED (never typed by hand); descriptions are
 * role-level (what the category is for), not authoritative component lists.
 *
 * Pure data — no `'use client'`, no icon imports — so it is importable from
 * server components (layout, index pages) and client components (CategoryNav)
 * alike. Icons for the landing cards live next to the page that renders them.
 */

export type ShowcaseSectionKey = 'primitives' | 'patterns';

export interface ShowcaseCategory {
  /** Route href. The first category of a section is its "Genel" overview (the section root). */
  href: string;
  label: string;
  /** Role-level card copy on the section index grid. */
  description?: string;
}

export interface ShowcaseSection {
  key: ShowcaseSectionKey;
  href: string;
  label: string;
  description: string;
  categories: ShowcaseCategory[];
}

export const PRIMITIVES_SECTION: ShowcaseSection = {
  key: 'primitives',
  href: '/design/primitives',
  label: 'Primitive',
  description: 'shadcn/ui temel bileşenleri — tüm varyant ve state’ler etkileşimli kontrollerle.',
  categories: [
    { href: '/design/primitives', label: 'Genel' },
    {
      href: '/design/primitives/buttons',
      label: 'Buton & Rozet',
      description:
        'Aksiyon tetikleyiciler ve durum/etiket çipleri — variant, size, radius, ikon, loading.',
    },
    {
      href: '/design/primitives/inputs',
      label: 'Form alanları',
      description:
        'Metin ve seçim girdileri — Input, Textarea, Select, Checkbox, Switch, Radio, Slider, OTP.',
    },
    {
      href: '/design/primitives/forms',
      label: 'Form (RHF)',
      description:
        'React Hook Form + Zod kompozisyonu — label/açıklama/hata bağlama, durum matrisi.',
    },
    {
      href: '/design/primitives/overlays',
      label: 'Overlay',
      description:
        'Modal ve açılır yüzeyler — Dialog, Sheet, Drawer, Popover, Dropdown, Command, Menubar.',
    },
    {
      href: '/design/primitives/navigation',
      label: 'Gezinme',
      description: 'Sekme, breadcrumb, sayfalama ve gezinme menüsü primitifleri.',
    },
    {
      href: '/design/primitives/feedback',
      label: 'Geri bildirim',
      description:
        'Durum ve geri bildirim — Alert, Toast, Progress, Spinner, Skeleton, StatusDot, CountBadge.',
    },
    {
      href: '/design/primitives/data-display',
      label: 'Veri gösterimi',
      description:
        'Yapı ve veri gösterimi — Table, Avatar, Accordion, Collapsible, Card, ScrollArea, ImageModal.',
    },
    {
      href: '/design/primitives/date-time',
      label: 'Tarih & saat',
      description: 'Takvim primitifi — tek ve aralık seçimi, Türkçe yerelleştirilmiş.',
    },
    {
      href: '/design/primitives/chart',
      label: 'Grafik',
      description:
        'Token-duyarlı recharts sarmalayıcı — ChartContainer, ChartTooltip, ChartLegend.',
    },
  ],
};

export const PATTERNS_SECTION: ShowcaseSection = {
  key: 'patterns',
  href: '/design/patterns',
  label: 'Pattern',
  description:
    'PazarSync’e özel composite desenler — finansal ürün diline göre, ui/ üstüne kurulu.',
  categories: [
    { href: '/design/patterns', label: 'Genel' },
    {
      href: '/design/patterns/display',
      label: 'Görsel & sayısal',
      description:
        'İstatistik kartları, para/yüzde hücreleri, trend delta, dağılım — finansal görsel/sayısal desenler.',
    },
    {
      href: '/design/patterns/forms',
      label: 'Form girdileri',
      description:
        'Para/yüzde girdisi, arama, combobox, inline edit, dosya yükleme — domain form bileşenleri.',
    },
    {
      href: '/design/patterns/status',
      label: 'Durum & sync',
      description:
        'Senkron rozeti, bildirim, banner, stepper, wizard, aktivite akışı, onay diyaloğu.',
    },
    {
      href: '/design/patterns/chrome',
      label: 'Layout & gezinme',
      description:
        'PageHeader, org/store switcher, nav grupları, bottom dock — uygulama kabuğu desenleri.',
    },
    {
      href: '/design/patterns/charts',
      label: 'Grafikler',
      description: 'Chart kit arketipleri — Line, Bar, Ranking, Donut, Combo (ChartFrame kabuğu).',
    },
    {
      // Cross-route: the DataTable family lives at /design/data (a de-facto pattern sub-category).
      href: '/design/data',
      label: 'Tablolar',
      description:
        'DataTable ailesi — filtreleme, sıralama, seçim, durumlar, pinning, sunucu modu.',
    },
  ],
};

export const SHOWCASE_SECTIONS: Record<ShowcaseSectionKey, ShowcaseSection> = {
  primitives: PRIMITIVES_SECTION,
  patterns: PATTERNS_SECTION,
};

export interface ShowcaseNavLink {
  href: string;
  label: string;
}

/**
 * Top-level header nav — the canonical entry points. References the section
 * consts so the Primitive/Pattern entries cannot drift from their roots.
 */
export const SHOWCASE_TOP_NAV: ShowcaseNavLink[] = [
  { href: '/design', label: 'Genel' },
  { href: '/design/tokens', label: 'Token' },
  { href: PRIMITIVES_SECTION.href, label: PRIMITIVES_SECTION.label },
  { href: PATTERNS_SECTION.href, label: PATTERNS_SECTION.label },
  { href: '/design/data', label: 'Veri' },
  { href: '/design/layout-demo', label: 'Layout' },
  { href: '/design/manifest', label: 'Manifest' },
  { href: '/design/checklist', label: 'Checklist' },
];

export interface ShowcaseLandingCard {
  /** Stable key → icon lookup at the render site (icons are presentation, kept out of this data module). */
  key: string;
  href: string;
  label: string;
  description: string;
}

/**
 * `/design` landing card grid. Now includes Manifest + Checklist — the old
 * index grid omitted both, so the two pages were invisible from the documented
 * entry point even though the header nav reached them.
 */
export const DESIGN_LANDING: ShowcaseLandingCard[] = [
  {
    key: 'tokens',
    href: '/design/tokens',
    label: 'Token',
    description:
      'Renk, tipografi, spacing, radius, shadow ve motion değerleri — canlı swatch’larla.',
  },
  {
    key: 'primitives',
    href: PRIMITIVES_SECTION.href,
    label: 'Primitive',
    description: PRIMITIVES_SECTION.description,
  },
  {
    key: 'patterns',
    href: PATTERNS_SECTION.href,
    label: 'Pattern',
    description: PATTERNS_SECTION.description,
  },
  {
    key: 'data',
    href: '/design/data',
    label: 'Veri',
    description: 'DataTable örnekleri — filtre, sıralama, seçim, durumlar, pinning, sunucu modu.',
  },
  {
    key: 'layout-demo',
    href: '/design/layout-demo',
    label: 'Layout demo',
    description: 'Üç sütunlu workspace layout, store switcher, icon rail ve context rail canlı.',
  },
  {
    key: 'manifest',
    href: '/design/manifest',
    label: 'Manifest',
    description: 'Tüm bileşenlerin aranabilir kataloğu — her biri @useWhen ipucuyla.',
  },
  {
    key: 'checklist',
    href: '/design/checklist',
    label: 'Checklist',
    description:
      'Bileşen-başına definition-of-done — her tasarım sistemi PR’ında geçilmesi gereken liste.',
  },
];
