import { FileUpload } from '@pazarsync/web';

export const Empty = () => (
  <div className="max-w-form w-full">
    <FileUpload
      accept=".csv"
      prompt="CSV dosyasını buraya sürükleyin"
      hint="En fazla 10 MB · yalnızca .csv"
      ctaLabel="Dosya Seç"
    />
  </div>
);
