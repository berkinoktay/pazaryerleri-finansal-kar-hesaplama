import { ImageModal } from '@pazarsync/web';

const IMG =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="%23dbeafe"/><text x="240" y="185" font-size="22" text-anchor="middle" fill="%231e40af" font-family="sans-serif">Ürün görseli</text></svg>';

export const Open = () => <ImageModal open src={IMG} alt="Ürün görseli" onOpenChange={() => {}} />;
