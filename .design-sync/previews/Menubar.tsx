import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
} from '@pazarsync/web';

export const Open = () => (
  <Menubar value="rapor">
    <MenubarMenu value="rapor">
      <MenubarTrigger>Rapor</MenubarTrigger>
      <MenubarContent>
        <MenubarItem>Özet indir</MenubarItem>
        <MenubarItem>Kâr/zarar dökümü</MenubarItem>
        <MenubarSeparator />
        <MenubarItem>Hakediş karşılaştırma</MenubarItem>
      </MenubarContent>
    </MenubarMenu>
    <MenubarMenu value="ayarlar">
      <MenubarTrigger>Ayarlar</MenubarTrigger>
      <MenubarContent>
        <MenubarItem>Mağaza bağlantıları</MenubarItem>
        <MenubarItem>Bildirimler</MenubarItem>
      </MenubarContent>
    </MenubarMenu>
  </Menubar>
);
