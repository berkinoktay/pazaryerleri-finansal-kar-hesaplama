# Ürün Entegrasyonu V2 - Dokümantasyon

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

## 2. Ürün Filtreleme - Onaysız Ürün v2

Bu servis ile Trendyol mağazanızdaki onaysız (draft) ürünlerinizi listeleyebilirsiniz.

Bu servis ile ürün onay süreci devam eden ve kontrol sonrası reddedilen ürünlerinizi listeleyebilirsiniz. Reddedilen ürün için reddetme sebebini kontrol edip, gerekli güncellemeleri yapmanız halinde, ürününüz tekrar onay sürecine girecektir.

Bu servise yapılan isteklere `nextPageToken` bilgisi eklenmiştir.

- Yapmış olduğunuz istekte `request?page=10&size=1000` yazmanız halinde 10. sayfadaki 1000 ürün response olarak döner.
- Sonraki isteğinizde `request?size=1000&nextPageToken=TOKEN` yazmanız halinde sonraki sayfa olan 11. sayfadaki 1000 ürün response olarak döner.
- (`nextPageToken` isteği 10.000'den fazla onaysız barcode olması halinde kullanılabilir.)
- `Page x size` maksimum 10.000 değerini alabilir.

### GET filterProducts

**PROD**

```
https://apigw.trendyol.com/integration/product/sellers/{sellerId}/products/unapproved
```

**STAGE**

```
https://stageapigw.trendyol.com/integration/product/sellers/{sellerId}/products/unapproved
```

### Giriş Parametreleri

| Parametre     | Açıklama                                                                                      | Tip    |
| ------------- | --------------------------------------------------------------------------------------------- | ------ |
| barcode       | Tekil barkod sorgulamak için gönderilmelidir                                                  | string |
| startDate     | Belirli bir tarihten sonraki ürünleri getirir. Timestamp olarak gönderilmelidir.              | long   |
| endDate       | Belirli bir tarihten önceki ürünleri getirir. Timestamp olarak gönderilmelidir.               | long   |
| page          | Sadece belirtilen sayfadaki bilgileri döndürür.                                               | int    |
| dateQueryType | Tarih filtresinin çalışacağı tarih. `CREATED_DATE` ya da `LAST_MODIFIED_DATE` gönderilebilir. | string |
| size          | Bir sayfada listelenecek maksimum adeti belirtir. Maksimum 1000 değerini alabilir.            | int    |
| supplierId    | İlgili tedarikçinin ID bilgisi gönderilmelidir.                                               | long   |
| stockCode     | İlgili tedarikçinin stock code bilgisi gönderilmelidir.                                       | string |
| productMainId | İlgili tedarikçinin productMainId bilgisi gönderilmelidir.                                    | string |
| brandIds      | Belirtilen brandId'ye sahip ürünleri listelemek için kullanılmalıdır.                         | array  |
| status        | Status alanı `rejected` ve `pendingApproval` değerlerini alabilir.                            | string |
| nextPageToken | 10.000 adet ürün'den sonraki ürünleri almak için kullanılmalıdır.                             | string |

**Örnek Servis Cevabı**

```json
{
  "totalElements": 1,
  "totalPages": 1,
  "page": 0,
  "size": 1,
  "nextPageToken": "eyJzb3J0IjpbMTI3MTU4MTVdfQ==",
  "content": [
    {
      "supplierId": 2748,
      "productMainId": "smoketest-114333a11",
      "createDateTime": 1763964757705,
      "lastUpdateDate": 1764059908901,
      "lastPriceChangeDate": 1763964757656,
      "lastStockChangeDate": 1763964757656,
      "brand": {
        "id": 317259,
        "name": "Trendyol Üyelik"
      },
      "category": {
        "id": 129332,
        "name": "Üyelik Servisi"
      },
      "barcode": "smoketest-114333a11",
      "title": "Test Product",
      "description": "Test Product Description",
      "quantity": 1,
      "listPrice": 25000,
      "salePrice": 20000,
      "vatRate": 20,
      "dimensionalWeight": null,
      "stockCode": "TEST-STOCK",
      "media": [
        {
          "url": "https://marketplace-supplier-media-center.oss-eu-central-1.aliyuncs.com/prod/431929/3bda8d78-00e8-4bbf-abb7-f7a13297d2f3/A_TABLO1148.jpg?x-oss-process=style/resized"
        }
      ],
      "attributes": [],
      "rejectReasonDetails": [
        {
          "rejectReason": "Sakıncalı Görsel Değişt",
          "rejectReasonDetail": "Ürün görselleriniz  platform kurallarımız uyarınca sakıncalı olarak kabul edilen görselleri içermektedir. Ürün görselleri ile kelepçe, bağlama ipleri vb. ürünlerin canlı mankenler üzerinde gösterimi, cinsel oyuncak kullanımının gösterimi, cinsel pozisyonun veya cinsel organların gösterimi ve çocuk manken üzerinde iç çamaşırı/plaj giyimi sunumu platform kurallarımız uyarınca yasaktır. Lütfen ürün görsellerinizi platform kurallarımıza uygun hale getirecek şekilde değiştiriniz. https://akademi.trendyol.com/ELearning?TrainingId=23555 Değişti"
        },
        {
          "rejectReason": "Zorunlu Ürün Özellik Değeri Eksik/Yanlış",
          "rejectReasonDetail": "Zorunlu özellik değeri hatalı ya da eksiktir. Lütfen zorunlu özellik bilgilerinizi doldurun ya da değiştiriniz."
        },
        {
          "rejectReason": "Hatalı Marka Bilgisi",
          "rejectReasonDetail": "Ürün markasındaki, ismindeki, görselindeki, barkodundaki ve/veya açıklamasındaki marka ile ürünün asıl markası uyuşmamaktadır. Lütfen ürünün markasını ve ürün listeleme kurallarına/içerik kalitesine uygunluğunu kontrol ediniz."
        },
        {
          "rejectReason": "Satış Kurallarına Aykırı Ürün",
          "rejectReasonDetail": "Bu ürün Trendyol Platformu satış kurallarıyla uyumlu değildir. Kuralları görmek için tıklayınız. https://tymp.mncdn.com/prod/documents/engagement/yasal_surecler/satisa_uygun_olmayan_urunler.pdf"
        }
      ],
      "locationBasedDelivery": "DISABLED",
      "lotNumber": "PartiNo:011220,SeriNo:M00A59153,SKT:12/12/2012,LotNo:0301A79"
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
