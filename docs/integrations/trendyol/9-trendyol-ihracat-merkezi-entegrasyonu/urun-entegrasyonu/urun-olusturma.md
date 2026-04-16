# Ürün Oluşturma

> Source: https://developers.trendyol.com/docs/trendyol-autoft/urun-entegrasyonu/urun-olusturma

# Ürün Oluşturma

KAPATILACAK

31 Mart 2025 tarihinde bu endpoint yeni [Ürün Oluşturma V2](/docs/trendyol-autoft/urun-olusturma-v2) entegrasyonu kapsamında kapatılacaktır.

Trendyol Pazaryeri’nde onaylanmış ürünleri ihracata açmak için kullanılır. Satıcı Paneli’nde oluşturulmayan ürünler, İhracat Merkezi’nde oluşturulamaz.

> Barkod bazında günde **1** kez fiyat güncelleme işlemi yapılmaktadır.

PROD

**POST** - https://apigw.trendyol.com/integration/ecgw/v1/**{sellerId}**/products

STAGE

**POST** - https://stageapigw.trendyol.com/integration/ecgw/v1/**{sellerId}**/products

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

compositionDetails **\***

Ürünün bileşenleri hakkında bilgiler içeren bir alt nesnedir. Girilen ürünlerin yüzdesel toplamları **100** olmalıdır. Composition listesine [buradan](/docs/trendyol-autoft/urun-entegrasyonu/materyal-bilesenleri) ulaşabilirsiniz. (Örnek Pamuk %90, Polyester %10)

careInstructions

Ürünün yıkama talimatlarını içeren değerdir. Yıkama talimatları listesine [buradan](/docs/trendyol-autoft/urun-entegrasyonu/yikama-talimatlari) ulaşabilirsiniz.

> (**\***) Zorunlu Alanlar

### Örnek Request[​](#örnek-request "Örnek Request doğrudan bağlantı")

```
{  "products": [    {      "barcode": "barcode-0",      "buyingPrice": 6.95,      "rrp": 30.99,      "gtip": "gtip-0123",      "origin": "Türkiye",      "stock": 100,      "careInstructions": "T102",      "compositionDetails": {        "pamuk": 95,        "plastik": 5      }    }  ]}
```

### Örnek Response[​](#örnek-response "Örnek Response doğrudan bağlantı")

```
{  "batchId": "example-batch-id-0"}
```

not

İşlem sonucunu response'da dönen **'batchId'** alanının değeri ile [buradan](/docs/trendyol-autoft/islem-sonuc-entegrasyonu) sorgulamanız gerekmektedir. Teknik nedenlerden dolayı işlenemeyen sorguların kontrol edilmesinde Trendyol’un sorumluluğu bulunmamaktadır.
