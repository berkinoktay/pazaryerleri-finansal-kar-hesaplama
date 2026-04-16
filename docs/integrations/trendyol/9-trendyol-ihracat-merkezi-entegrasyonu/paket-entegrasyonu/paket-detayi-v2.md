# Paket Detayı V2

> Source: https://developers.trendyol.com/docs/trendyol-autoft/paket-entegrasyonu/paket-detayi-v2

# Paket Detayı V2

İlgili paket içerisinde bulunan ürünlerin detayları buradan alınmalıdır.

Henüz oluşmayan ve bir sonraki gün oluşturulacak olan paketleriniz için bu servisi kullanabilir (status = new) ve tedarik beklenecek olan adetleri önceden görerek stoklarınızı yönetebilirsiniz.

Oluşan her bir trackingNumber’a ait özel olarak paketleme/kolileme yapılmalıdır.

ÖNEMLİ UYARI

Paket içerisindeki **new** durumunda bulunan ürünler iptal edildiğinde, **_newQuantity_** değeri azalır ve **_cancelledQuantity_** değeri değişmez. Paket içerisindeki **pending** durumunda bulunan ürünler iptal edildiğinde, **_pendingQuantity_** değeri azalır ve **_cancelledQuantity_** değeri artar.

PROD

**GET** - https://apigw.trendyol.com/integration/ecgw/v2/**{sellerId}**/packages/items

STAGE

**GET** - https://stageapigw.trendyol.com/integration/ecgw/v2/**{sellerId}**/packages/items

### Request Alan Açıklamaları[​](#request-alan-açıklamaları "Request Alan Açıklamaları doğrudan bağlantı")

Alan Adı

Açıklama

sellerId

Satıcı numarası

packageId

Paket numarası

status

Paketin durumu  
  
`değer` = açıklama  
`new` = Yeni oluşmuş paket, henüz tedarik beklenmeyenler ürünler bulunur. Gün içerisinde paket içerisindeli ürünler değişebilir.  
`pending` = Tedarik beklenen paket (Paket içerisinde en az 1 ürün için tedarik bekleniyorsa)  
`completed` = Paket içerisindeki tüm ürünler için işlemler (tedarik/iptal) tamamlandıysa  
`cancelled` = İptal edilen paket (Paket içerisindeki tüm ürünler iptal edildiyse)

page

Listelenmek istenen paketlerin sayfasını belitir. Default değer **1**, minimum değer **1**'dir

size

Listelenmek istenen paket sayısı. Maksimum **100**'dir

### Response Nesnesi[​](#response-nesnesi "Response Nesnesi doğrudan bağlantı")

Alan Adı

Açıklama

page

Listelenmek istenen paket detay item sayfasını belitir. Default değer **1**, minimum değer **1**'dir

size

Listelenmek istenen paket detay item sayısı. Maksimum **100**

totalItemCount

Toplam öğe sayısı

totalPageCount

Toplam sayfa sayısı

items

Paket itemları içeren dizi

     itemId

     Benzersiz ürün numarası

     name

     Ürün adı

     trackingNumber

     Paketin takip numarası

     sellerBarcode

     Ürünün satıcı sistemlerinde kayıtlı barkodu

     barcode

     Ürünün barkodu (Gönderim Beklenen Barkod, ürün üzerinde fiziksel olarak bulunmalıdır)

     newQuantity

     Yeni oluşmuş ürün sayısı

     pendingQuantity

     Güncel Tedarik beklenen ürün sayısı (Trendyol tarafından hesaplanmaktadır)

     completedQuantity

     Güncel Trendyol tarafından mal kabul yapılan ürün sayısı

     unSuppliedQuantity

     Tedarik edilemeyen ve artık gönderimi beklenmeyen ürün sayısı

     cancelledQuantity

     İptal edilen ürün sayısı (müşteri iptali, sistem iptali)

     unitBuyingPrice

     Ürünün Trendyol'a KDV dahil birim satış fiyatı

     creationDate

     Paket item oluşturulma zaman etiketi (UTC +0 saat dilimi)

     lastModifiedDate

     Paket item son güncellenme zaman etiketi (UTC +0 saat dilimi)

### Örnek Request[​](#örnek-request "Örnek Request doğrudan bağlantı")

GET

**{ROOT\_URL}**/v2/1234/packages/items?packageId=123456&status=pending&page=1&size=20

### Örnek Response[​](#örnek-response "Örnek Response doğrudan bağlantı")

```
{  "totalItemCount": 2,  "totalPageCount": 1,  "size": 20,  "page": 1,  "items": [    {      "itemId": "75243c90-55eb-45a3-a052-e227ca1465f9-816701986",      "name": "product-name-01",      "trackingNumber": null,      "sellerBarcode": "seller-barcode-01",      "barcode": "barcode-01",      "newQuantity": 10,      "pendingQuantity": 20,      "completedQuantity": 5,      "unSuppliedQuantity": 5,      "cancelledQuantity": 10,      "unitBuyingPrice": 10.0,      "creationDate": 1678691613222,      "lastModifiedDate": 1678691613210    },    {      "itemId": "75243c90-55eb-45a3-a052-e227ca1465f9-728609554",      "name": "product-name-02",      "trackingNumber": 3687712,      "sellerBarcode": "seller-barcode-02",      "barcode": "barcode-02",      "newQuantity": 15,      "pendingQuantity": 10,      "completedQuantity": 7,      "unSuppliedQuantity": 6,      "cancelledQuantity": 3,      "unitBuyingPrice": 15.0,      "creationDate": 1678691633736,      "lastModifiedDate": 1678691613210    }  ]}
```
