# Ürün Entegrasyonu V2 - Dokümantasyon


## Ürün Varyantlama

> 🚧 **ÖNEMLİ**
>
> **NOT :** Bir ürünün birden fazla variant'ı olması durumunda `productMainId` değeri aynı olacak şekilde (Ürünün XL ve L bedeni gibi) isteğin gönderilmesi beklenmektedir. Ürünün sadece `attributes` bölümü farklılaştırılmalıdır.

Ürün varyantlama işlemi `"productMainId"` değerine göre yapılmaktadır. İlgili kategori özelliği üzerinden `"slicer"` ve `"varianter"` değeri kontrol edilmelidir.

`"slicer"` (ürün renk değeri, ürün hafıza değeri vb.)

Ürünü ayrı contentlerde açar, sistem üzerinde en fazla Slicer olarak kullanılan değer renktir, ancak elektronik kategorilerinde ürünün ayrı contentlerde açılabilmesi için (dahili hafıza gibi) slicer değeri olarak kullanılabilir. (kategori özelliği servisi üzerinden `slicer=true` dönmelidir.)

- Bir kategoride birden fazla slicer değeri olabilir.
- Slicer değer ürünü ayrı contentlerde açtığı için, variant olarak kullanılabilir.

> 📷 **[RESİM](slicer.png)**
> Görsel URL: `https://developers.trendyol.com/docs/assets/slicer.png`

---

`"varianter"` (ürün beden değeri vb.)

Aynı content üzerinde yer alan ürünün ayrı bedenleridir. Ürünü farklı contentlerde açmaz. Her kategoride bir tane varianter seçilebilir. Birden fazla seçime izin verilmemektedir.

> 📷 **[RESİM](varianter.png)**
> Görsel URL: `https://developers.trendyol.com/docs/assets/varianter.png`



---

## 1. Ürün Filtreleme - Temel Bilgiler v2

Bu servis ile Trendyol mağazanızdaki ürününüzün durumunu listeleyebilirsiniz.

### GET filterProducts

**PROD**

```
https://apigw.trendyol.com/integration/product/sellers/{sellerId}/product/{barcode}
```

**STAGE**

```
https://stageapigw.trendyol.com/integration/product/sellers/{sellerId}/product/{barcode}
```

**Örnek Servis Cevabı**

```json
{
  "barcode": "smoketest-250049",
  "approved": true,
  "approvedDate": 1763622556000,
  "archived": false,
  "listingId": "a089a30ed1632032913b28099e49d948",
  "contentId": 9511264
}
```

---

## Ürün Filtreleme - Onaylı Ürün v2

Bu servis ile Trendyol mağazanızdaki onaylı ürünlerinizi listeleyebilirsiniz.

- Bu servise yapılan isteklere `"nextPageToken"` bilgisi eklenmiştir. Yapmış olduğunuz istekte `request?page=10&size=100` yazmanız halinde 10. sayfadaki 100 content response olarak döner. Sonraki isteğinizde `request?size=100&nextPageToken=TOKEN` yazmanız halinde sonraki sayfa olan 11. sayfadaki 100 content response olarak döner. (`nextPageToken` isteği 10.000'den fazla onaylı content olması halinde kullanılabilir.)
- Page x size maksimum 10.000 değerini alabilir.

---

### GET filterProducts

**PROD**
`https://apigw.trendyol.com/integration/product/sellers/{sellerId}/products/approved`

**STAGE**
`https://stageapigw.trendyol.com/integration/product/sellers/{sellerId}/products/approved`

---

#### Giriş Parametreleri

| Parametre | Açıklama | Tip |
|-----------|----------|-----|
| barcode | Tekil barkod sorgulamak için gönderilmelidir | string |
| startDate | Belirli bir tarihten sonraki ürünleri getirir. Timestamp olarak gönderilmelidir. | long |
| endDate | Belirli bir tarihten sonraki önceki getirir. Timestamp olarak gönderilmelidir. | long |
| page | Sadece belirtilen sayfadaki bilgileri döndürür. | int |
| dateQueryType | Tarih filtresinin çalışacağı tarih `VARIANT_CREATED_DATE`, `VARIANT_MODIFIED_DATE`, `CONTENT_MODIFIED_DATE` olarak gönderilebilir. `VARIANT_CREATED_DATE`: Satıcının kendi barkoduyla ürünü açtığı tarih. Response body'deki `"sellerCreatedDate"`e denk gelmektedir. `VARIANT_MODIFIED_DATE`: Barkodun satıcı tarafından en son güncellendiği tarih. Response body'deki `"sellerModifiedDate"`e denk gelmektedir. `CONTENT_MODIFIED_DATE`: Content üzerine yapılan en son değişikliğin tarihi. Response body'deki `"lastModifiedDate"`e denk gelmektedir. | string |
| size | Bir sayfada listelenecek maksimum adeti belirtir. Maksimum 100 değerini alabilir. | int |
| supplierId | İlgili tedarikçinin ID bilgisi gönderilmelidir | long |
| stockCode | İlgili tedarikçinin stock code bilgisi gönderilmelidir | string |
| productMainId | İlgili tedarikçinin productMainId bilgisi gönderilmelidir | string |
| brandIds | Belirtilen brandId'ye sahip ürünleri listelemek için kullanılmalıdır. | array |
| status | Status alanı `archived`, `blacklisted`, `locked`, `onSale`, `notOnSale` değerlerini alabilir | string |
| nextPageToken | 10.000 adet content'den sonraki contentleri almak için kullanılmalıdır | string |
| contentId | Tekil contentId sorgulamak için gönderilmelidir | string |
| orderByDirection | `"SellerCreatedDate"` alanına göre `ASC`/`DESC` olarak gönderilebilir. `ASC`: Eskiden yeniye doğru sıralar. `DESC`: Yeniden eskiye doğru sıralar. | string |

---

#### Örnek Servis Cevabı

```json
{
  "totalElements": 1,
  "totalPages": 1,
  "page": 0,
  "size": 20,
  "nextPageToken": "eyJzb3J0IjpbMTI3MTU4MTVdfQ==",
  "content": [
    {
      "contentId": 12715815,
      "productMainId": "12613876842A60",
      "brand": {
        "id": 315675,
        "name": "GUEYA"
      },
      "category": {
        "id": 91266,
        "name": "DOKUNMAYIN Attribute Attribute"
      },
      "creationDate": 1760531038063,
      "lastModifiedDate": 1760938781669,
      "lastModifiedBy": "anilcan.gul@trendyol.com",
      "title": "Açık Gri T-",
      "description": "değişti değişti2",
      "images": [
        {
          "url": "/mediacenter-stage3/stage/QC_PREP/20250731/11/f63d6503-ab94-3567-adbc-8f26a5cdaac6/1.jpg"
        }
      ],
      "attributes": [
        {
          "attributeId": 47,
          "attributeName": "Renk",
          "attributeValue": "Black"
        },
        {
          "attributeId": 295,
          "attributeName": "Web Color",
          "attributeValueId": 2886,
          "attributeValue": "Kırmızı"
        },
        {
          "attributeId": 294,
          "attributeName": "Yaş Grubu",
          "attributeValueId": 2879,
          "attributeValue": "Yetişkin"
        },
        {
          "attributeId": 296,
          "attributeName": "Cinsiyet",
          "attributeValueId": 2873,
          "attributeValue": "Erkek"
        }
      ],
      "variants": [
        {
          "variantId": 70228905,
          "supplierId": 2748,
          "barcode": "12613876842A60",
          "attributes": [
            {
              "attributeId": 293,
              "attributeName": "Beden",
              "attributeValueId": 4602,
              "attributeValue": "77 x 200 cm"
            }
          ],
          "productUrl": "https://stage.trendyol.com/abc/xyz-p-12715815?&merchantId=2748&filterOverPriceListings=false",
          "onSale": false,
          "deliveryOptions": {
            "deliveryDuration": 1,
            "isRushDelivery": true,
            "fastDeliveryOptions": [
              {
                "deliveryOptionType": "SAME_DAY_SHIPPING",
                "deliveryDailyCutOffHour": "15:00"
              }
            ]
          },
          "stock": {
            "quantity": 0,
            "lastModifiedDate": 1774948958844
          },
          "price": {
            "salePrice": 222,
            "listPrice": 222
          },
          "stockCode": "STK-stokum-1",
          "vatRate": 0,
          "sellerCreatedDate": 1760534152000,
          "sellerModifiedDate": 1761041127000,
          "locked": false,
          "lockReason": null,
          "lockDate": null,
          "archived": false,
          "archivedDate": null,
          "docNeeded": false,
          "hasViolation": false,
          "blacklisted": false
        },
        {
          "variantId": 70229505,
          "supplierId": 2748,
          "barcode": "12613876842A61",
          "attributes": [
            {
              "attributeId": 293,
              "attributeName": "Beden",
              "attributeValueId": 4603,
              "attributeValue": "77 x 300 cm"
            }
          ],
          "productUrl": "https://stage.trendyol.com/abc/xyz-p-12715815?&merchantId=2748&filterOverPriceListings=false",
          "onSale": false,
          "deliveryOptions": {
            "deliveryDuration": 1,
            "isRushDelivery": true,
            "fastDeliveryOptions": [
              {
                "deliveryOptionType": "SAME_DAY_SHIPPING",
                "deliveryDailyCutOffHour": "15:00"
              }
            ]
          },
          "stock": {
            "lastModifiedDate": null
          },
          "price": {
            "salePrice": 222,
            "listPrice": 222
          },
          "stockCode": "STK-stokum-1",
          "vatRate": 0,
          "sellerCreatedDate": 1760534320000,
          "sellerModifiedDate": 1761041127000,
          "locked": false,
          "lockReason": null,
          "lockDate": null,
          "archived": false,
          "archivedDate": null,
          "docNeeded": false,
          "hasViolation": false,
          "blacklisted": false
        }
      ]
    }
  ]
}
```

---

## 3. Ürün Filtreleme - Onaylı Ürün v2

Bu servis ile Trendyol mağazanızdaki onaylı ürünlerinizi listeleyebilirsiniz.

Bu servise yapılan isteklere `nextPageToken` bilgisi eklenmiştir.

- Yapmış olduğunuz istekte `request?page=10&size=100` yazmanız halinde 10. sayfadaki 100 content response olarak döner.
- Sonraki isteğinizde `request?size=100&nextPageToken=TOKEN` yazmanız halinde sonraki sayfa olan 11. sayfadaki 100 content response olarak döner.
- (`nextPageToken` isteği 10.000'den fazla onaylı content olması halinde kullanılabilir.)
- `Page x size` maksimum 10.000 değerini alabilir.

### GET filterProducts

**PROD**

```
https://apigw.trendyol.com/integration/product/sellers/{sellerId}/products/approved
```

**STAGE**

```
https://stageapigw.trendyol.com/integration/product/sellers/{sellerId}/products/approved
```

### Giriş Parametreleri

| Parametre     | Açıklama                                                                                                                            | Tip    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| barcode       | Tekil barkod sorgulamak için gönderilmelidir                                                                                        | string |
| startDate     | Belirli bir tarihten sonraki ürünleri getirir. Timestamp olarak gönderilmelidir.                                                    | long   |
| endDate       | Belirli bir tarihten önceki ürünleri getirir. Timestamp olarak gönderilmelidir.                                                     | long   |
| page          | Sadece belirtilen sayfadaki bilgileri döndürür.                                                                                     | int    |
| dateQueryType | Tarih filtresinin çalışacağı tarih. `VARIANT_CREATED_DATE`, `VARIANT_MODIFIED_DATE`, `CONTENT_MODIFIED_DATE` olarak gönderilebilir. | string |
| size          | Bir sayfada listelenecek maksimum adeti belirtir. Maksimum 100 değerini alabilir.                                                   | int    |
| supplierId    | İlgili tedarikçinin ID bilgisi gönderilmelidir.                                                                                     | long   |
| stockCode     | İlgili tedarikçinin stock code bilgisi gönderilmelidir.                                                                             | string |
| productMainId | İlgili tedarikçinin productMainId bilgisi gönderilmelidir.                                                                          | string |
| brandIds      | Belirtilen brandId'ye sahip ürünleri listelemek için kullanılmalıdır.                                                               | array  |
| status        | Status alanı `archived`, `blacklisted`, `locked`, `onSale` değerlerini alabilir.                                                    | string |
| nextPageToken | 10.000 adet content'den sonraki contentleri almak için kullanılmalıdır.                                                             | string |

**Örnek Servis Cevabı**

```json
{
  "totalElements": 1,
  "totalPages": 1,
  "page": 0,
  "size": 20,
  "nextPageToken": "eyJzb3J0IjpbMTI3MTU4MTVdfQ==",
  "content": [
    {
      "contentId": 12715815,
      "productMainId": "12613876842A60",
      "brand": {
        "id": 315675,
        "name": "GUEYA"
      },
      "category": {
        "id": 91266,
        "name": "DOKUNMAYIN Attribute Attribute"
      },
      "creationDate": 1760531038063,
      "lastModifiedDate": 1760938781669,
      "lastModifiedBy": "anilcan.gul@trendyol.com",
      "title": "Açık Gri T-",
      "description": "değişti değişti2",
      "images": [
        {
          "url": "/mediacenter-stage3/stage/QC_PREP/20250731/11/f63d6503-ab94-3567-adbc-8f26a5cdaac6/1.jpg"
        }
      ],
      "attributes": [
        {
          "attributeId": 47,
          "attributeName": "Renk",
          "attributeValue": "Black"
        },
        {
          "attributeId": 295,
          "attributeName": "Web Color",
          "attributeValueId": 2886,
          "attributeValue": "Kırmızı"
        },
        {
          "attributeId": 294,
          "attributeName": "Yaş Grubu",
          "attributeValueId": 2879,
          "attributeValue": "Yetişkin"
        },
        {
          "attributeId": 296,
          "attributeName": "Cinsiyet",
          "attributeValueId": 2873,
          "attributeValue": "Erkek"
        }
      ],
      "variants": [
        {
          "variantId": 70228905,
          "supplierId": 2748,
          "barcode": "12613876842A60",
          "attributes": [
            {
              "attributeId": 293,
              "attributeName": "Beden",
              "attributeValueId": 4602,
              "attributeValue": "77 x 200 cm"
            }
          ],
          "productUrl": "https://stage.trendyol.com/abc/xyz-p-12715815?&merchantId=2748&filterOverPriceListings=false",
          "onSale": false,
          "deliveryOptions": {
            "deliveryDuration": 1,
            "isRushDelivery": true,
            "fastDeliveryOptions": [
              {
                "deliveryOptionType": "SAME_DAY_SHIPPING",
                "deliveryDailyCutOffHour": "15:00"
              }
            ]
          },
          "stock": {
            "lastModifiedDate": null
          },
          "price": {
            "salePrice": 222,
            "listPrice": 222
          },
          "stockCode": "STK-stokum-1",
          "vatRate": 0,
          "sellerCreatedDate": 1760534152000,
          "sellerModifiedDate": 1761041127000,
          "locked": false,
          "lockReason": null,
          "lockDate": null,
          "archived": false,
          "archivedDate": null,
          "docNeeded": false,
          "hasViolation": false,
          "blacklisted": false
        },
        {
          "variantId": 70229505,
          "supplierId": 2748,
          "barcode": "12613876842A61",
          "attributes": [
            {
              "attributeId": 293,
              "attributeName": "Beden",
              "attributeValueId": 4603,
              "attributeValue": "77 x 300 cm"
            }
          ],
          "productUrl": "https://stage.trendyol.com/abc/xyz-p-12715815?&merchantId=2748&filterOverPriceListings=false",
          "onSale": false,
          "deliveryOptions": {
            "deliveryDuration": 1,
            "isRushDelivery": true,
            "fastDeliveryOptions": [
              {
                "deliveryOptionType": "SAME_DAY_SHIPPING",
                "deliveryDailyCutOffHour": "15:00"
              }
            ]
          },
          "stock": {
            "lastModifiedDate": null
          },
          "price": {
            "salePrice": 222,
            "listPrice": 222
          },
          "stockCode": "STK-stokum-1",
          "vatRate": 0,
          "sellerCreatedDate": 1760534320000,
          "sellerModifiedDate": 1761041127000,
          "locked": false,
          "lockReason": null,
          "lockDate": null,
          "archived": false,
          "archivedDate": null,
          "docNeeded": false,
          "hasViolation": false,
          "blacklisted": false
        }
      ]
    }
  ]
}
```

---

## 4. Ürün Güncelleme - Onaylı Ürün v2

Trendyol mağazanızda bulunan onaylı ürünlerin content, varyant ve teslimat bilgilerini güncelleme yöntemleri.

### Tab 1: Content Güncelleme

Bu method ile Trendyol mağazanızda bulunan onaylı ürünlerin contentlerini güncelleyebilirsiniz.

- Bu servis üzerinden sadece ürüne ait content bilgileri güncellenmektedir.
- Yeni kategori ve kategori özellik değerleri eklenebileceği sebebiyle ürün güncellemelerinizden önce kullandığınız kategori, kategori özellik ve kategori özellik değerlerinin güncel olup olmadığını `getCategoryTree`, `getCategoryAttributes`, `getCategoryAttributesValues` servislerinden kontrol etmenizi öneririz.
- Her bir istek içerisinde gönderilebilecek maksimum item sayısı 1.000'dir.
- Onaylı ürünlerde `barcode`, `productMainId`, `brandId`, `categoryId` ve slicer veya varianter olan attribute value değerleri güncellenememektedir.
- Attribute değerleri hariç **partial update** desteklenmektedir. (Örneğin, sadece description güncellenmek isteniyorsa `"contentId": 9510902` ve `"description": "string"` yollanması yeterlidir.)
- Attribute'lardan herhangi biri güncellenmek isteniyorsa ürünün altındaki tüm attribute ve değerleri istek body'sinde gönderilmelidir.

> **TOPLU İŞLEM KONTROLÜ**
> Ürün güncelleme işlemi sonrasında response içerisinde yer alan `batchRequestId` ile ürünlerinizin ve aktarım işleminin durumunu `getBatchRequestResult` servisi üzerinden kontrol etmelisiniz.

#### POST updateProducts

**PROD**

```
https://apigw.trendyol.com/integration/product/sellers/{sellerId}/products/content-bulk-update
```

**STAGE**

```
https://stageapigw.trendyol.com/integration/product/sellers/{sellerId}/products/content-bulk-update
```

**Örnek Servis İsteği**

```json
{
  "items": [
    {
      "contentId": 9510902,
      "title": "string",
      "description": "string",
      "images": [
        {
          "url": "string"
        }
      ],
      "attributes": [
        {
          "attributeId": 1,
          "attributeValueIds": [1]
        },
        {
          "attributeId": 2,
          "attributeValue": "String"
        }
      ]
    }
  ]
}
```

### Tab 2: Varyant Güncelleme

Bu method ile Trendyol mağazanızda bulunan onaylı ürünlerin varyantlarını güncelleyebilirsiniz.

- Bu servis üzerinden sadece ürüne ait varyant bilgileri güncellenmektedir.
- Her bir istek içerisinde gönderilebilecek maksimum item sayısı 1.000'dir.
- `barcode` alanı hariç bütün alanlar güncellenebilmektedir.
- Request body'deki field'lar için partial istek yapılabilir. İsteklerinizde barcode ve değiştirmek istediğiniz field'ı yollarsanız partial update uygulanacaktır.

> **TOPLU İŞLEM KONTROLÜ**
> Ürün güncelleme işlemi sonrasında response içerisinde yer alan `batchRequestId` ile ürünlerinizin ve aktarım işleminin durumunu `getBatchRequestResult` servisi üzerinden kontrol etmelisiniz.

#### POST updateProducts

**PROD**

```
https://apigw.trendyol.com/integration/product/sellers/{sellerId}/products/variant-bulk-update
```

**STAGE**

```
https://stageapigw.trendyol.com/integration/product/sellers/{sellerId}/products/variant-bulk-update
```

**Örnek Servis İsteği**

```json
{
  "items": [
    {
      "barcode": "test1",
      "stockCode": "test",
      "vatRate": 123,
      "shipmentAddressId": 123,
      "returningAddressId": 122,
      "dimensionalWeight": 1.1,
      "lotNumber": "test",
      "locationBasedDelivery": "string" //"ENABLED", "DISABLED" yada null değerlerini alabilir
    }
  ]
}
```

> `locationBasedDelivery` alanı `"ENABLED"`, `"DISABLED"` yada `null` değerlerini alabilir.

### Tab 3: Teslimat Bilgisi Güncelleme

Bu method ile Trendyol mağazanızda bulunan onaylı ürünlerin teslimat bilgilerini güncelleyebilirsiniz.

- Her bir istek içerisinde gönderilebilecek maksimum item sayısı 1.000'dir.
- `barcode` alanı hariç bütün alanlar güncellenebilmektedir.

> **TOPLU İŞLEM KONTROLÜ**
> Ürün güncelleme işlemi sonrasında response içerisinde yer alan `batchRequestId` ile ürünlerinizin ve aktarım işleminin durumunu `getBatchRequestResult` servisi üzerinden kontrol etmelisiniz.

#### POST updateProducts

**PROD**

```
https://apigw.trendyol.com/integration/product/sellers/{sellerId}/products/delivery-info-bulk-update
```

**STAGE**

```
https://stageapigw.trendyol.com/integration/product/sellers/{sellerId}/products/delivery-info-bulk-update
```

**Örnek Servis İsteği**

```json
{
  "items": [
    {
      "barcode": "string",
      "deliveryOptions": {
        "deliveryDuration": 0,
        "fastDeliveryType": "string" //"SAME_DAY_SHIPPING" / "FAST_DELIVERY" değerlerini alabilir
      }
    }
  ]
}
```

> `fastDeliveryType` alanı `"SAME_DAY_SHIPPING"` / `"FAST_DELIVERY"` değerlerini alabilir.

---

## 5. Ürün Güncelleme - Onaysız Ürün v2

Bu servis ile Trendyol mağazanızda bulunan onaysız ürünleri güncelleyebilirsiniz.

- Bu servis üzerinden sadece ürün bilgileri güncellenmektedir.
- Yeni kategori ve kategori özellik değerleri eklenebileceği sebebiyle ürün güncellemelerinizden önce kullandığınız kategori, kategori özellik ve kategori özellik değerlerinin güncel olup olmadığını `getCategoryTree`, `getCategoryAttributes`, `getCategoryAttributesValues` servislerinden kontrol etmenizi öneririz.
- Her bir istek içerisinde gönderilebilecek maksimum item sayısı 1.000'dir.

> ❗️ **TOPLU İŞLEM KONTROLÜ**
> Ürün güncelleme işlemi sonrasında response içerisinde yer alan `batchRequestId` ile ürünlerinizin ve aktarım işleminin durumunu `getBatchRequestResult` servisi üzerinden kontrol etmelisiniz.

### POST updateProducts

**PROD**

```
https://apigw.trendyol.com/integration/product/sellers/{sellerId}/products/unapproved-bulk-update
```

**STAGE**

```
https://stageapigw.trendyol.com/integration/product/sellers/{sellerId}/products/unapproved-bulk-update
```

**Örnek Servis İsteği**

```json
{
  "items": [
    {
      "barcode": "barcodelarrtest1",
      "title": "string",
      "description": "string",
      "productMainId": "string",
      "brandId": 1,
      "categoryId": 1,
      "stockCode": "string",
      "dimensionalWeight": 0,
      "vatRate": 0,
      "deliveryOption": {
        "deliveryDuration": 0,
        "fastDeliveryType": "string"
      },
      "locationBasedDelivery": "string", //"ENABLED", "DISABLED" yada null değerlerini alabilir
      "lotNumber": "string",
      "shipmentAddressId": 0,
      "returningAddressId": 0,
      "images": [
        {
          "url": "trendyol.com/test.jpeg"
        }
      ],
      "attributes": [
        {
          "attributeId": 1,
          "attributeValueIds": [1]
        },
        {
          "attributeId": 2,
          "attributeValue": "String"
        }
      ]
    }
  ]
}
```

> `locationBasedDelivery` alanı `"ENABLED"`, `"DISABLED"` yada `null` değerlerini alabilir.

---

## 6. Kategori Özellik Değerleri Listesi v2

Ürün Yaratma servisine yapılacak isteklerde gönderilecek attributes values bilgileri bu servis kullanılarak alınacaktır. Yeni kategorileri özellik değerleri eklenebileceği sebebiyle güncel kategori özellik listesini haftalık olarak almanızı öneririz.

> 🚧 **İPUCU**
> Ürün kategori ağacı belirli aralıklarla güncellenmektedir. Güncel olmayan bir kategori ağacı kullanmanız durumunda eksik veya hatalı veri girişi yapabilirsiniz. Bu sebep ile her işlem öncesinde en güncel kategori ağacını kullanmanız gerekmektedir.

### GET getCategoryAttributes

**PROD**

```
https://apigw.trendyol.com/integration/product/categories/{categoryId}/attributes/{attributeId}/values
```

**STAGE**

```
https://stageapigw.trendyol.com/integration/product/categories/{categoryId}/attributes/{attributeId}/values
```

**Örnek Servis Cevabı**

```json
{
  "totalElements": 1,
  "totalPages": 1,
  "page": 0,
  "size": 10,
  "content": [
    {
      "“attributeValueId": 4872,
      "“attributeValueName”": "Tek Ebat"
    }
  ]
}
```

### Filtre Parametreleri

| Parametre        | Açıklama                                                                           |
| ---------------- | ---------------------------------------------------------------------------------- |
| size             | Bir sayfada listelenecek maksimum adeti belirtir. Maksimum 1000 değerini alabilir. |
| page             | Sadece belirtilen sayfadaki bilgileri döndürür. Maksimum 1000 değerini alabilir.   |
| attributeValueId | Kategorideki özelliği için girilebilecek değer ID bilgisi.                         |
| attributeValue   | Kategorideki özelliği için girilebilecek değer adı.                                |

---

## 7. Kategori Özellik Listesi v2

`createProduct` yapmak için en alt seviyedeki kategori ID bilgisi kullanılmalıdır. Seçtiğiniz kategorinin alt kategorileri var ise bu kategori bilgisi ile ürün aktarımı yapamazsınız.

Yeni kategorileri özellikleri eklenebileceği sebebiyle güncel kategori özellik listesini haftalık olarak almanızı öneririz.

> 🚧 **İPUCU**
> Ürün kategori ağacı belirli aralıklarla güncellenmektedir. Güncel olmayan bir kategori ağacı kullanmanız durumunda eksik veya hatalı veri girişi yapabilirsiniz. Bu sebep ile her işlem öncesinde en güncel kategori ağacını kullanmanız gerekmektedir.

### GET getCategoryAttributes

**PROD**

```
https://apigw.trendyol.com/integration/product/categories/{categoryId}/attributes
```

**STAGE**

```
https://stageapigw.trendyol.com/integration/product/categories/{categoryId}/attributes
```

**Örnek Servis Cevabı**

```json
{
  "id": 14609,
  "name": "Muay Thai Kaskı",
  "displayName": "Muay Thai Kaskı",
  "categoryAttributes": [
    {
      "allowCustom": false,
      "attribute": {
        "id": 293,
        "name": "Beden"
      },
      "categoryId": 14609,
      "required": true,
      "varianter": true,
      "slicer": false,
      "allowMultipleAttributeValues": false
    },
    {
      "allowCustom": false,
      "attribute": {
        "id": 294,
        "name": "Yaş Grubu"
      },
      "categoryId": 14609,
      "required": false,
      "varianter": false,
      "slicer": false,
      "allowMultipleAttributeValues": false
    },
    {
      "allowCustom": false,
      "attribute": {
        "id": 296,
        "name": "Cinsiyet"
      },
      "categoryId": 14609,
      "required": false,
      "varianter": false,
      "slicer": false,
      "allowMultipleAttributeValues": false
    },
    {
      "allowCustom": false,
      "attribute": {
        "id": 295,
        "name": "Web Color"
      },
      "categoryId": 14609,
      "required": true,
      "varianter": false,
      "slicer": false,
      "allowMultipleAttributeValues": false
    },
    {
      "allowCustom": true,
      "attribute": {
        "id": 47,
        "name": "Renk"
      },
      "categoryId": 14609,
      "required": true,
      "varianter": false,
      "slicer": true,
      "allowMultipleAttributeValues": false
    }
  ]
}
```

### Filtre Parametreleri

| Parametre                    | Açıklama                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| name                         | Kategorinin Trendyol sistemindeki adı                                                                       |
| displayName                  | Kategorinin Trendyol sistemindeki adı - Önyüzde görünen                                                     |
| attribute.id                 | Kategorideki özellik ID bilgisi                                                                             |
| attribute.name               | Kategorideki özellik adı                                                                                    |
| allowCustom                  | `true` ise createProduct yapılırken ID yerine freetext-string gönderim yapılmalıdır.                        |
| required                     | `true` ise createProduct yapılırken ilgili attributes, attributeValues alanında gönderilmesi gerekmektedir. |
| slicer                       | `true` ise trendyol.com üzerinde ayrı bir ürün kartı oluşturulur.                                           |
| varianter                    | Trendyol.com'da ürünü görünürken bu özellik bilgisi bir varyant bilgisi olup olmadığını ifade eder.         |
| allowMultipleAttributeValues | `true` olması durumunda, ilgili attribute birden fazla value alabilmektedir.                                |
