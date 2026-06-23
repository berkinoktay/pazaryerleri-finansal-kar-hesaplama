import { NavGroup, PackageIcon } from '@pazarsync/web';

export const Default = () => (
  <div className="max-w-sheet w-full">
    <NavGroup label="Ürünler" icon={<PackageIcon />} href="#" defaultExpanded>
      <a href="#" className="text-muted-foreground hover:text-foreground block py-1 text-sm">
        Tüm ürünler
      </a>
      <a href="#" className="text-muted-foreground hover:text-foreground block py-1 text-sm">
        Maliyet bekleyenler
      </a>
      <a href="#" className="text-muted-foreground hover:text-foreground block py-1 text-sm">
        Kataloğda olmayanlar
      </a>
    </NavGroup>
  </div>
);
