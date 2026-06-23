import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
} from '@pazarsync/web';

export const Open = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Mağaza bağlantısını kes</DialogTitle>
        <DialogDescription>
          Trendyol — Ana Mağaza bağlantısı kesilecek. Senkronize edilmiş veriler korunur, yeni
          senkronizasyon durur.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost">Vazgeç</Button>
        <Button variant="destructive">Bağlantıyı Kes</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
