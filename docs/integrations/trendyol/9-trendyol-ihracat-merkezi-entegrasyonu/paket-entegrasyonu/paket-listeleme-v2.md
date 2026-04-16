# Paket Listeleme V2

> Source: https://developers.trendyol.com/docs/trendyol-autoft/paket-entegrasyonu/paket-listeleme-v2

# Paket Listeleme V2

Gün içerisinde oluşan yeni paketlerinizi buradan takip edebilirsiniz. Sipariş almanız durumunda her gün 08:00 - 08:15 saatleri arasında yeni bir paketiniz oluşacaktır. Paketleri günlük olarak takip etmeniz ve gün içerisinde Trendyol’a göndermeniz gerekmektedir.

Paket listeme adımında yeni bir paketiniz olduğunu sorguladığınızda, paket içerisinde tedarik beklenen ürün bilgisine erişmek için [Paket Detayı V2](/docs/trendyol-autoft/paket-entegrasyonu/paket-detayi-v2) servisi kullanılmalıdır.

PROD

**GET** - https://apigw.trendyol.com/integration/ecgw/v2/**{sellerId}**/packages

STAGE

**GET** - https://stageapigw.trendyol.com/integration/ecgw/v2/**{sellerId}**/packages

### Request Alan Açıklamaları[​](#request-alan-açıklamaları "Request Alan Açıklamaları doğrudan bağlantı")

Alan Adı

Açıklama

sellerId **\***

Satıcı numarası

trackingNumber

Tedarik beklenen ürünler için oluşturulan takip numarası (paket numarası), paketin üzerindeki fiziksel olarak yazılı bulunmalıdır

status

Paketin ana statusunu ifade etmektedir.  
  
`değer` = açıklama  
`new` = Yeni oluşmuş paket, henüz tedarik beklenmeyenler ürünler bulunur. Gün içerisinde paket içerisindeli ürünler değişebilir.  
`pending` = Tedarik beklenen paket (Paket içerisinde en az 1 ürün için tedarik bekleniyorsa)  
`completed` = Paket içerisindeki tüm ürünler için işlemler (tedarik/iptal) tamamlandıysa  
`cancelled` = İptal edilen paket (Paket içerisindeki tüm ürünler iptal edildiyse)

page

Listelenmek istenen paketlerin sayfasını belitir. Default değer **1**, minimum değer **1**'dir

size

Listelenmek istenen paket sayısı. Maksimum **100**'dir

approvedStartDate

Paketin onaylandığı ilk tarih. (UTC +0 millisecond olarak timestamp değeri - `Örnek: 1712014519618`)

approvedEndDate

Paketin onaylandığı son tarih.(UTC +0 millisecond olarak timestamp değeri - `Örnek: 1712014519618`)

creationStartDate

Paketin oluşturulduğu ilk tarih. (UTC +0 millisecond olarak timestamp değeri - `Örnek: 1712014519618`)

creationEndDate

Paketin oluşturulduğu son tarih.(UTC +0 millisecond olarak timestamp değeri - `Örnek: 1712014519618`)

boutiqueId

İlgili trackingNumber’ın ait olduğu butik numarası

> (**\***) Zorunlu Alan

### Response Nesnesi[​](#response-nesnesi "Response Nesnesi doğrudan bağlantı")

Alan Adı

Açıklama

page

Listelenmek istenen paket sayfasını belitir. Default değer **1**, minimum değer **1**'dir

size

Listelenmek istenen paket sayısı. Maksimum **100**

totalItemCount

Toplam ürün sayısı

totalPageCount

Toplam sayfa sayısı

items

Paketleri içeren dizi

     trackingNumber

     Tedarik beklenen ürünler için oluşturulan takip numarası. `new` statusü hariç diğer statülerde dolu gelmektedir.

     boutiqueId

     İlgili trackingNumber’ın ait olduğu butik numarası

     status

     Paketin durumu  
  
     `değer` = açıklama  
     `new` = Yeni oluşmuş paket, henüz tedarik beklenmeyenler ürünler bulunur. Gün içerisinde paket içerisindeli ürünler değişebilir.  
     `pending` = Tedarik beklenen paket (Paket içerisinde en az 1 ürün için tedarik bekleniyorsa)  
     `completed` = Paket içerisindeki tüm ürünler için işlemler (tedarik/iptal) tamamlandıysa  
     `cancelled` = İptal edilen paket (Paket içerisindeki tüm ürünler iptal edildiyse)

     totalBuyingPrice

     Pakette yer alan ürünlerin, Trendyol tarafından KDV dahil satın alındığı fiyat toplamı

     currency

     Para birimi

     platformId

     Platform (partner) numarası

     packageId

     Paket numarası

     totalQuantity

     Pakette bulunan toplam item sayısı

     creationDate

     Paketin oluşturulma tarihi ve saati (UTC +0 saat dilimi)

     approved

     Paketin onaylanma tarihi ve saati (UTC +0 saat dilimi)

     lastModifiedDate

     Paketin son değiştirilme tarihi ve saati (UTC +0 saat dilimi)

     cargos

     Eğer İhracat Merkezi paneli üzerinden satıcı tarafından girildi ise paketin kargo bilgilerini içeren dizi

          codes

          Kargo takip numaralarını içeren dizi

          provider

          Kargo firması

### Örnek Request[​](#örnek-request "Örnek Request doğrudan bağlantı")

GET

**{ROOT\_URL}**/v2/1234/packages?trackingNumber=514805&status=pending&page=1&size=20&approvedStartDate=1712014519618&approvedEndDate=1712014519618&creationStartDate=1712014519618&creationEndDate=1712014519618&boutiqueId=1234

### Örnek Response[​](#örnek-response "Örnek Response doğrudan bağlantı")

```
{  "totalItemCount": 2465,  "totalPageCount": 2465,  "size": 1,  "page": 1,  "items": [    {      "trackingNumber": 518315,      "packageId": "75243c90-55eb-45a3-a052-e227ca1465f9",      "totalQuantity": 13,      "totalBuyingPrice": 3802,      "currency": "EUR",      "status": "pending",      "boutiqueId": "6783",      "platformId": 150,      "creationDate": 1678691613208,      "approvedDate": 1678691614208,      "lastModifiedDate": 1678691614208,      "cargos": [        {          "codes": [            "3ac32647-20aa-4a0b-97bc-f80de06c1692"          ],          "provider": "Trendyol Express"        }      ]    }  ]}
```
