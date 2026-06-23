import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
} from '@pazarsync/web';

export const Open = () => (
  <NavigationMenu defaultValue="urunler">
    <NavigationMenuList>
      <NavigationMenuItem value="urunler">
        <NavigationMenuTrigger>Ürünler</NavigationMenuTrigger>
        <NavigationMenuContent>
          <div className="p-md gap-2xs grid w-64">
            <NavigationMenuLink>Tüm ürünler</NavigationMenuLink>
            <NavigationMenuLink>Maliyet bekleyenler</NavigationMenuLink>
            <NavigationMenuLink>Kataloğda olmayanlar</NavigationMenuLink>
          </div>
        </NavigationMenuContent>
      </NavigationMenuItem>
      <NavigationMenuItem value="raporlar">
        <NavigationMenuTrigger>Raporlar</NavigationMenuTrigger>
        <NavigationMenuContent>
          <div className="p-md gap-2xs grid w-64">
            <NavigationMenuLink>Kâr/zarar</NavigationMenuLink>
            <NavigationMenuLink>Hakediş karşılaştırma</NavigationMenuLink>
          </div>
        </NavigationMenuContent>
      </NavigationMenuItem>
    </NavigationMenuList>
  </NavigationMenu>
);
