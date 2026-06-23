import { ImageCell } from '@pazarsync/web';

const IMG =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="%23dbeafe"/><text x="40" y="46" font-size="12" text-anchor="middle" fill="%231e40af" font-family="sans-serif">Ürün</text></svg>';

export const Default = () => (
  <div className="gap-md flex items-center">
    <ImageCell src={IMG} alt="Ürün görseli" size="lg" />
    <ImageCell src={IMG} alt="Ürün görseli" size="md" shape="circle" />
    <ImageCell src={null} alt="Görsel yok" size="md" />
  </div>
);
