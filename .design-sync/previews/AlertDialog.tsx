import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@pazarsync/web';

export const Open = () => (
  <AlertDialog open>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Siparişi kâr hesabı dışına al?</AlertDialogTitle>
        <AlertDialogDescription>
          Bu sipariş kâr/zarar toplamlarına dahil edilmeyecek. İşlem daha sonra geri alınabilir.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Vazgeç</AlertDialogCancel>
        <AlertDialogAction>Dışarı Al</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
