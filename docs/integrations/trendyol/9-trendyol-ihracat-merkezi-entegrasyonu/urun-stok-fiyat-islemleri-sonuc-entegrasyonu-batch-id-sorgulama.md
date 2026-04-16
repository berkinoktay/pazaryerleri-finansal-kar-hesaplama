# Ürün, Stok, Fiyat İşlemleri Sonuç Entegrasyonu (Batch ID Sorgulama)

> Source: https://developers.trendyol.com/docs/trendyol-autoft/islem-sonuc-entegrasyonu/

# Ürün, Stok, Fiyat İşlemleri Sonuç Entegrasyonu (Batch ID Sorgulama)

Response olarak **batchId** aldığınız işlemlerin sonuçlarını bu endpoint üzerinden takip edebilirsiniz.

PROD

**GET** - https://apigw.trendyol.com/integration/ecgw/v1/**{sellerId}**/check-status?batchId=**{batchId}**

STAGE

**GET** - https://stageapigw.trendyol.com/integration/ecgw/v1/**{sellerId}**/check-status?batchId=**{batchId}**

### Örnek Request[​](#örnek-request "Örnek Request doğrudan bağlantı")

GET

**{ROOT\_URL}**/v1/1234/check-status?batchId=57a7229a-e345-4232-88ac-f4169b864293

### Örnek Response[​](#örnek-response "Örnek Response doğrudan bağlantı")

```
{  "batchId": "57a7229a-e345-4232-88ac-f4169b864293",  "batchType": "ProductCreate",  "items": [    {      "requestItem": {        "product": {          "barcode": "BRCD001",          "price": 12.99,          "rrp": 22.0,          "gtip": "2231317",          "origin": "TR",          "stock": 100,          "composition":"95% Cotton, 5% Elastane"        }      },      "status": "SUCCESS",      "failureReasons": []    }  ],  "status": "COMPLETED",  "creationDate": 1529734317090,  "lastModification": 1529734653403,  "itemCount": 1}
```
