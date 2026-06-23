import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@pazarsync/web';

export const Palette = () => (
  <Command className="border-border max-w-input w-full rounded-md border">
    <CommandInput placeholder="Komut ya da sayfa ara…" />
    <CommandList>
      <CommandEmpty>Sonuç bulunamadı.</CommandEmpty>
      <CommandGroup heading="Sayfalar">
        <CommandItem>Özet</CommandItem>
        <CommandItem>Siparişler</CommandItem>
        <CommandItem>Ürünler</CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="İşlemler">
        <CommandItem>Yeni mağaza bağla</CommandItem>
        <CommandItem>Şimdi senkronize et</CommandItem>
      </CommandGroup>
    </CommandList>
  </Command>
);
