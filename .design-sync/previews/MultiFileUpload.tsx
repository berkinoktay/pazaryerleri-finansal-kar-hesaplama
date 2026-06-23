import { MultiFileUpload } from '@pazarsync/web';

export const Empty = () => (
  <div className="max-w-form w-full">
    <MultiFileUpload
      accept="image/*"
      maxFiles={5}
      prompt="Ürün görsellerini buraya sürükleyin"
      hint="En fazla 5 dosya · PNG / JPG · her biri 10 MB"
      ctaLabel="Dosya Seç"
    />
  </div>
);
