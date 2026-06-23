import { Badge, Tick02Icon } from '@pazarsync/web';

export const Tones = () => (
  <div className="gap-xs flex flex-wrap items-center">
    <Badge tone="neutral">Taslak</Badge>
    <Badge tone="primary">Yeni</Badge>
    <Badge tone="success">Teslim Edildi</Badge>
    <Badge tone="info">Kargoda</Badge>
    <Badge tone="warning">Beklemede</Badge>
    <Badge tone="destructive">İptal</Badge>
  </div>
);

export const Variants = () => (
  <div className="gap-xs flex flex-wrap items-center">
    <Badge tone="success" variant="surface">
      Surface
    </Badge>
    <Badge tone="success" variant="solid">
      Solid
    </Badge>
    <Badge tone="success" variant="outline">
      Outline
    </Badge>
  </div>
);

export const Sizes = () => (
  <div className="gap-xs flex flex-wrap items-center">
    <Badge size="sm" tone="info">
      Küçük
    </Badge>
    <Badge size="md" tone="info">
      Orta
    </Badge>
    <Badge size="lg" tone="info">
      Büyük
    </Badge>
  </div>
);

export const IconAndRemovable = () => (
  <div className="gap-xs flex flex-wrap items-center">
    <Badge tone="success" leadingIcon={<Tick02Icon />}>
      Onaylı
    </Badge>
    <Badge tone="neutral" radius="full" onRemove={() => {}} removeLabel="Kaldır">
      Trendyol
    </Badge>
  </div>
);
