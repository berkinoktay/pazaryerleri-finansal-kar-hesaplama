import { ConfirmDialog } from '@pazarsync/web';

export const Open = () => (
  <ConfirmDialog
    open
    title="Mağaza bağlantısını kaldır?"
    description="Bu mağazanın tüm senkron verileri silinecek. Bu işlem geri alınamaz."
    confirmLabel="Kaldır"
    cancelLabel="Vazgeç"
    tone="destructive"
    onConfirm={() => {}}
    onOpenChange={() => {}}
  />
);
