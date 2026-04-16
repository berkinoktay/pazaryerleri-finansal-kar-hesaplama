# Menşei

> Source: https://developers.trendyol.com/docs/trendyol-autoft/urun-entegrasyonu/mensei

# Menşei

Ürün yaratma adımında, request modelde istenen origin değerleri bu endpointten liste olarak alınır.

PROD

**GET** - https://apigw.trendyol.com/integration/ecgw/v1/**{sellerId}**/lookup/origins

STAGE

**GET** - https://stageapigw.trendyol.com/integration/ecgw/v1/**{sellerId}**/lookup/origins

### Örnek Request[​](#örnek-request "Örnek Request doğrudan bağlantı")

GET

**{ROOT\_URL}**/v1/1234/lookup/origins

### Örnek Response[​](#örnek-response "Örnek Response doğrudan bağlantı")

```
{  "items": [    {      "name": "Almanya"    },    {      "name": "Türkiye"    }    //....  ]}
```
