import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Button,
  Store01Icon,
} from '@pazarsync/web';

export const Default = () => (
  <Card>
    <CardHeader>
      <CardTitle>Mağaza Özeti</CardTitle>
      <CardDescription>Son 30 günün performansı</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-muted-foreground text-sm">
        Trendyol mağazanızın net kâr ve ciro özetini tek bakışta görüntüleyin.
      </p>
    </CardContent>
  </Card>
);

export const WithHeaderSlots = () => (
  <Card>
    <CardHeader
      leadingIcon={<Store01Icon />}
      actions={
        <Button size="sm" variant="outline">
          Düzenle
        </Button>
      }
    >
      <CardTitle>Trendyol — Ana Mağaza</CardTitle>
      <CardDescription>Bağlı · son senkron 2 saat önce</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-muted-foreground text-sm">
        API anahtarları şifreli saklanır ve yalnızca senkron sırasında bellekte çözülür.
      </p>
    </CardContent>
    <CardFooter>
      <Button size="sm">Şimdi Senkronize Et</Button>
      <Button size="sm" variant="ghost">
        Bağlantıyı Kes
      </Button>
    </CardFooter>
  </Card>
);
