import { SoftSquareIcon, PackageIcon, Store01Icon, ShoppingBag01Icon } from '@pazarsync/web';

export const Variants = () => (
  <div className="gap-md flex items-center">
    <SoftSquareIcon tone="info">
      <PackageIcon />
    </SoftSquareIcon>
    <SoftSquareIcon tone="success" variant="solid">
      <Store01Icon />
    </SoftSquareIcon>
    <SoftSquareIcon tone="warning" variant="outline">
      <ShoppingBag01Icon />
    </SoftSquareIcon>
  </div>
);
