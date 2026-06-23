import { RailWarningCard } from '@pazarsync/web';

export const Default = () => (
  <div className="max-w-sheet w-full">
    <RailWarningCard
      tone="warning"
      title="3 ürün maliyet bekliyor"
      description="Bu ürünlerin kârı hesaplanamıyor. Maliyet girilene kadar kâr hesabı dışında tutulur."
      ctaLabel="Maliyetleri gir"
      ctaHref="#"
    />
  </div>
);
