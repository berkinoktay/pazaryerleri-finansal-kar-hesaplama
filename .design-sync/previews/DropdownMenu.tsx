import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Button,
} from '@pazarsync/web';

export const Open = () => (
  <DropdownMenu open>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" size="sm">
        İşlemler
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuLabel>Sipariş işlemleri</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem>Detayları gör</DropdownMenuItem>
      <DropdownMenuItem>Maliyet düzenle</DropdownMenuItem>
      <DropdownMenuItem>Faturayı indir</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem>Kâr hesabı dışına al</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
