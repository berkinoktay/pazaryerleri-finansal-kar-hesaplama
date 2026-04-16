# Fiyat Entegrasyonu

> Source: https://developers.trendyol.com/docs/trendyol-autoft/fiyat-entegrasyonu/

# Fiyat Entegrasyonu

İhracata açık olan ürünlerin fiyat bilgilerinin güncellenmesi ve geri beslenmesi için kullanılır. Burada belirlenen fiyat KDV dahil Trendyol’a satış fiyatı olmalıdır.

> Barkod bazında günde **1** kez fiyat güncelleme işlemi yapılmaktadır.

PROD

**POST** - https://apigw.trendyol.com/integration/ecgw/v1/**{sellerId}**/prices

STAGE

**POST** - https://stageapigw.trendyol.com/integration/ecgw/v1/**{sellerId}**/prices

### Request alan açıklamaları[​](#request-alan-açıklamaları "Request alan açıklamaları doğrudan bağlantı")

Alan Adı

Açıklama

priceInfos

Fiyat bilgilerini içeren ana dizi.Maksimum 5000 ürün fiyat bilgisi gönderilebilir

barcode **\***

Ürünün benzersiz bir tanımlayıcısı olan barkod numarası

rrp

Ürünün tavsiye edilen perakende satış fiyatı. Opsiyonel bir alandır. Eğer gönderimi yapılıyorsa, **buyingPrice** değerinden büyük veya eşit gönderilmesi gerekmektedir. **buyingPrice** değerinden küçük gönderilen RRP değeri, hata alacaktır

buyingPrice **\***

Ürünün Trendyol tarafından KDV dahil satın alındığı fiyat

> (**\***) Zorunlu Alanlar

### Örnek Request[​](#örnek-request "Örnek Request doğrudan bağlantı")

```
{  "priceInfos": [    {      "barcode": "brcd123",      "rrp": 22.00,      "buyingPrice": 5.0    },    {      "barcode": "brcd1235",      "rrp": 33.00,      "buyingPrice": 5.0    }  ]}
```

### Örnek Response[​](#örnek-response "Örnek Response doğrudan bağlantı")

```
{  "batchId": "example-batch-id-0"}
```

not

İşlem sonucunu response'da dönen **'batchId'** alanının değeri ile [buradan](/docs/trendyol-autoft/islem-sonuc-entegrasyonu) sorgulamanız gerekmektedir
