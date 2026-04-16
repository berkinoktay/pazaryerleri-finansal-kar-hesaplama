# Stok Entegrasyonu

> Source: https://developers.trendyol.com/docs/trendyol-autoft/stok-entegrasyonu/

# Stok Entegrasyonu

## Ürün Stok Bilgisi Güncelleme[​](#ürün-stok-bilgisi-güncelleme "Ürün Stok Bilgisi Güncelleme doğrudan bağlantı")

İhracata açık olan ürünlerin stok bilgilerinin güncellenmesi ve geri beslenmesi için kullanılır.

Ürünlerin öncelikle 3.2 Ürün Oluşturma adımda oluşturulduğundan emin olunmalıdır. Eğer talep edilirse stok yönetimi Trendyol Satıcı Panel ile ortak yapılabilir. Bu seçenek satıcıya başvuru esnasından sorulmaktadır. Ortak stok yönetimi yapan satıcılar bu endpointi kullanamazlar.

Ortak stok yönetimi yapan ancak daha sonradan İhracat Merkezi’ne açtığını ürünü kapatmak isteyen ve sıfır stok besleyemeyen satıcılarımız İhracat Merkezi paneli üzerinden ürün arşivleme özelliğini kullanabilirler.

**Her bir işlem sonucunda size bir batch ID response olarak dönmektedir. Stok güncelleme isteğinizin doğru yansıdığına emin olmanız için sonucu mutlaka kontrol etmeniz tavsiye edilir.**

PROD

**POST** - https://apigw.trendyol.com/integration/ecgw/v1/**{sellerId}**/stocks

STAGE

**POST** - https://stageapigw.trendyol.com/integration/ecgw/v1/**{sellerId}**/stocks

### Request alan açıklamaları[​](#request-alan-açıklamaları "Request alan açıklamaları doğrudan bağlantı")

Alan Adı

Açıklama

stocks

Stok bilgilerini içeren ana dizi. Maksimum **5000** ürün stock bilgisi alınabilir.

barcode **\***

Ürünün benzersiz bir tanımlayıcısı olan barkod numarası

stock **\***

Ürünün mevcut stok miktarı

> (**\***) Zorunlu Alanlar

### Örnek Request[​](#örnek-request "Örnek Request doğrudan bağlantı")

```
{  "stocks": [    {      "barcode": "brcd123",      "stock": 223    },    {      "barcode": "brcd1235",      "stock": 1    }  ]}
```

### Örnek Response[​](#örnek-response "Örnek Response doğrudan bağlantı")

```
{  "batchId": "example-batch-id-0"}
```

not

İşlem sonucunu response'da dönen **'batchId'** alanının değeri ile [buradan](/docs/trendyol-autoft/islem-sonuc-entegrasyonu) sorgulamanız gerekmektedir. Teknik nedenlerden dolayı işlenemeyen sorguların kontrol edilmesinde Trendyol’un sorumluluğu bulunmamaktadır.
