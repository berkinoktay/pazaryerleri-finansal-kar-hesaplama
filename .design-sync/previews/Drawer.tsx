import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  Button,
} from '@pazarsync/web';

export const Open = () => (
  <Drawer open>
    <DrawerContent>
      <DrawerHeader>
        <DrawerTitle>Hızlı maliyet girişi</DrawerTitle>
        <DrawerDescription>
          Bu ürünün birim maliyetini girin; kâr anında hesaplansın.
        </DrawerDescription>
      </DrawerHeader>
      <DrawerFooter>
        <Button>Kaydet</Button>
        <Button variant="ghost">Vazgeç</Button>
      </DrawerFooter>
    </DrawerContent>
  </Drawer>
);
