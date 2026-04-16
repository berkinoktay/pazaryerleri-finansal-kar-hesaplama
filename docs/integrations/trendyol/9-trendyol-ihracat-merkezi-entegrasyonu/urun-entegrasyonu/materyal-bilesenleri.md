# Materyal Bileşenleri

> Source: https://developers.trendyol.com/docs/trendyol-autoft/urun-entegrasyonu/materyal-bilesenleri

# Materyal Bileşenleri

KAPATILACAK

31 Mart 2025 tarihinde bu endpoint yeni [Ürün Oluşturma V2](/docs/trendyol-autoft/urun-olusturma-v2) entegrasyonu kapsamında kapatılacaktır. Bu endpointten elde edilen tüm bilgiler [Kategoriye Göre Zorunlu Özellikler](/docs/trendyol-autoft/urun-entegrasyonu/kategoriye-gore-urun-ozellik-listesi) endpointinden elde edilmelidir.

Ürün yaratma adımında, request modelde istenen composition değerleri bu endpointten liste olarak alınır.

PROD

**GET** - https://apigw.trendyol.com/integration/ecgw/v1/**{sellerId}**/lookup/compositions

STAGE

**GET** - https://stageapigw.trendyol.com/integration/ecgw/v1/**{sellerId}**/lookup/compositions

### Örnek Request[​](#örnek-request "Örnek Request doğrudan bağlantı")

GET

**{ROOT\_URL}**/v1/1234/lookup/compositions

### Örnek Response[​](#örnek-response "Örnek Response doğrudan bağlantı")

```
{  "items": [    {      "name": "Ahşap"    },    {      "name": "Pamuk"    }    // ....  ]}
```
