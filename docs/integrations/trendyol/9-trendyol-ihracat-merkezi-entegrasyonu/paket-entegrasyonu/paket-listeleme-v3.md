# Paket Listeleme V3

> Source: https://developers.trendyol.com/docs/trendyol-autoft/paket-entegrasyonu/paket-listeleme-v3

# Paket Listeleme V3

Paket Listeleme ve Paket Detay için iki ayrı API kullanmak istemeyen iş ortaklarımız tek endpoint olarak kullanabilir.

ÖNEMLİ UYARI

Paket içerisindeki **new** durumunda bulunan ürünler iptal edildiğinde, **_newQuantity_** değeri azalır ve **_cancelledQuantity_** değeri değişmez. Paket içerisindeki **pending** durumunda bulunan ürünler iptal edildiğinde, **_pendingQuantity_** değeri azalır ve **_cancelledQuantity_** değeri artar.

PROD

**GET** - https://apigw.trendyol.com/integration/ecgw/v3/**{sellerId}**/packages

STAGE

**GET** - https://stageapigw.trendyol.com/integration/ecgw/v3/**{sellerId}**/packages

### Request Alan Açıklamaları[​](#request-alan-açıklamaları "Request Alan Açıklamaları doğrudan bağlantı")

Alan Adı

Açıklama

sellerId **\***

Satıcı numarası

status

Paket ürün durumu  
  
`değer` = açıklama  
`new` = Yeni oluşmuş paketteki ürün, henüz tedarik beklenmez. Gün içerisinde ürünün durumu değişebilir.  
`pending` = Tedarik beklenen ürün.  
`completed` =Ürünün tedariği ve iptali tamamlanmıştır.  
`cancelled` = İptal edilen ürün.

page

Listelenmek istenen paketlerin sayfasını belitir. Default değer **1**, minimum değer **1**'dir.

size

Listelenmek istenen paket sayısı. Maksimum **100**'dir.

creationStartDate

Başlangıç tarihi (UTC +0 millisecond olarak timestamp değeri - `Örnek: 1712014519618`).

creationEndDate

Bitiş tari (UTC +0 millisecond olarak timestamp değeri - `Örnek: 1712014519618`).

> (**\***) Zorunlu Alan

### Response Nesnesi[​](#response-nesnesi "Response Nesnesi doğrudan bağlantı")

Alan Adı

Açıklama

page

Listelenmek istenen ürün sayfasını belitir. Default değer **1**, minimum değer **1**'dir

size

Listelenmek istenen ürün sayısı. Maksimum **50**

totalItemCount

Toplam öğe sayısı

totalPageCount

Toplam sayfa sayısı

items

Ürünleri içeren dizi

     trackingNumber

      Tedarik beklenen ürünler için oluşturulan takip numarası. `new` statusü hariç diğer statülerde dolu gelmektedir.

     boutiqueId

     Butik numarası

     status

     Paketin durumu

     currency

     Para birimi

     platformId

     Platform (partner) numarası

     packageId

     Paket numarası (Pending statusune geçen paketler için trackingNumber kullanılmalıdır)

     creationDate

     Ürünün sipariş gelme tarihi ve saati (UTC +0 saat dilimi)

     lastModifiedDate

     Ürünün son değiştirilme tarihi ve saati (UTC +0 saat dilimi)

     cargos

     Eğer İhracat Merkezi paneli üzerinden satıcı tarafından girildi ise ürünün kargo bilgilerini içeren dizi

          codes

          Kargo takip numaralarını içeren dizi

          provider

          Kargo firması

     itemId

     Benzersiz ürün numarası

     name

     Ürün adı

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

### Örnek Request[​](#örnek-request "Örnek Request doğrudan bağlantı")

GET

**{ROOT\_URL}**/v3/1234/packages?status=pending&page=1&size=20&creationStartDate=1712014519618&creationEndDate=1712014519618

### Örnek Response[​](#örnek-response "Örnek Response doğrudan bağlantı")

```
{  "totalItemCount": 2465,  "totalPageCount": 2465,  "size": 1,  "page": 1,  "items": [    {      "itemId": "0c8f8c74-38f3-493f-8a05-5d1dcddd",      "trackingNumber": 2584135020123481600,      "packageId": "0c8f8c74-38f3-493f-8a05-5d1dcddd52ef",      "boutiqueId": 0,      "currency": "EUR",      "platformId": 150,      "barcode": "cb08addb-3d82-4d0a-89d8-d4eb841290e4",      "sellerBarcode": "5a4a8217-39da-4f1f-ac49-6b1c06e44869",      "creationDate": 1711359070376,      "lastModifiedDate": 1711359070376,      "name": "5d679332-159a-41d2-8918-f928276a2421",      "newQuantity": 0,      "pendingQuantity": 0,      "unSuppliedQuantity": 0,      "cancelledQuantity": 0,      "completedQuantity": 1,      "unitBuyingPrice": 26214301,      "status": "completed",      "cargos": [        {          "codes": [            "3ac32647-20aa-4a0b-97bc-f80de06c1692"          ],          "provider": "Trendyol Express"        }      ]    }  ]}
```
