# Ürün Oluşturma V2

> Source: https://developers.trendyol.com/docs/trendyol-autoft/urun-entegrasyonu/urun-olusturma-v2

# Ürün Oluşturma V2

Trendyol Pazaryeri’nde onaylanmış ürünleri ihracata açmak için kullanılır. Satıcı Paneli’nde oluşturulmayan ürünler, İhracat Merkezi’nde oluşturulamaz.

> Barkod bazında günde **1** kez fiyat güncelleme işlemi yapılmaktadır.

PROD

**POST** - https://apigw.trendyol.com/integration/ecgw/v2/**{sellerId}**/products

STAGE

**POST** - https://stageapigw.trendyol.com/integration/ecgw/v2/**{sellerId}**/products

### Request Alan Açıklamaları[​](#request-alan-açıklamaları "Request Alan Açıklamaları doğrudan bağlantı")

Alan Adı

Açıklama

products

Ürünlerin listesini içeren ana dizi.Maksimum **5000** ürün girişi olabilir

barcode **\***

Ürünün benzersiz bir tanımlayıcısı olan barkod numarası

buyingPrice **\***

Ürünün Trendyol tarafından KDV dahil satın alındığı fiyat

rrp

Ürünün tavsiye edilen perakende satış fiyatı. Opsiyonel bir alandır. Eğer gönderimi yapılıyorsa, **buyingPrice** değerinden büyük veya eşit gönderilmesi gerekmektedir. **buyingPrice** değerinden küçük gönderilen RRP değeri, hata dönecektir.

gtip

Ürünün GTIP (Türk Gümrük ve Ticaret Bakanlığı tarafından tanımlanan bir ürün kodu) numarası. Minimum **4**, maksimum **12** hane olabilir. Ürünlerinize ait Trendyol’un önerdiği GTIP kodunu İhracat Merkezi panelinden görüntüleyebilirsiniz.

origin **\***

Ürünün üretildiği ülke. Origin değerlerini [buradan](/docs/trendyol-autoft/urun-entegrasyonu/menseiler) alabilirsiniz.

stock **\***

Ürünün mevcut stok miktarı

categoryId **\***

Ürünün Pazaryerindeki kategori bilgisi. Barkoda göre ürün kategorisine [buradan](/docs/trendyol-autoft/urun-entegrasyonu/barkod-ile-kategori-bilgisi-listeleme) ulaşabilirsiniz.

attributes **\***

Zorunlu ürün özellikleri. Kategoriye göre zorunlu özellik listesine [buradan](/docs/trendyol-autoft/urun-entegrasyonu/kategoriye-gore-urun-ozellik-listesi) ulaşabilirsiniz.

> (**\***) Zorunlu Alanlar

### Örnek Request[​](#örnek-request "Örnek Request doğrudan bağlantı")

```
{  "products": [    {      "barcode": "barcode-0",      "buyingPrice": 6.95,      "rrp": 30.99,      "gtip": "gtip-0123",      "stock": 100,      "origin": "Türkiye",      "categoryId": 123,      "attributes": [        // attribute.allowCustom = false ve attribute.multipleValues = false durumunda        {          "attributeId": 100,          "attributeValueId": 1        },        // attribute.allowCustom = true ve attribute.multipleValues = false durumunda        {          "attributeId": 101,          "customAttributeValue": "Custom-Value"        },        // attribute.allowCustom = true ve attribute.multipleValues = true, şu anda çoklu         // değer destekleyen tek özellik 'Materyal Bileşeni' özelliğidir         // bu özelliği beslemek için aşağıdaki gibi istek gönderebilirsiniz.        {          "attributeId": 102,          "customAttributeValues": {            // Örn: "1" Pamuk bileşeninin 'attributeValueId''sidir, "95" ise bileşenin yüzdesidir.            "1": "95",            // Örn: "2" Elastan bileşeninin 'attributeValueId''sidir, "5" ise bileşenin yüzdesidir.            "2": "5"          }        }      ]    }  ]}
```

### Örnek Response[​](#örnek-response "Örnek Response doğrudan bağlantı")

```
{  "batchId": "example-batch-id-0"}
```

not

İşlem sonucunu response'da dönen **'batchId'** alanının değeri ile [buradan](/docs/trendyol-autoft/islem-sonuc-entegrasyonu) sorgulamanız gerekmektedir. Teknik nedenlerden dolayı işlenemeyen sorguların kontrol edilmesinde Trendyol’un sorumluluğu bulunmamaktadır.
