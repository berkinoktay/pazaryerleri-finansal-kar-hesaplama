# Yıkama Talimatları

> Source: https://developers.trendyol.com/docs/trendyol-autoft/urun-entegrasyonu/yikama-talimatlari

# Yıkama Talimatları

KAPATILACAK

31 Mart 2025 tarihinde bu endpoint yeni [Ürün Oluşturma V2](/docs/trendyol-autoft/urun-olusturma-v2) entegrasyonu kapsamında kapatılacaktır. Bu endpointten elde edilen tüm bilgiler [Kategoriye Göre Zorunlu Özellikler](/docs/trendyol-autoft/urun-entegrasyonu/kategoriye-gore-urun-ozellik-listesi) endpointinden elde edilmelidir.

Ürün yaratma adımında, request modelde istenen yıkama talimatları değerleri bu endpointten liste olarak alınır.

PROD

**GET** - https://apigw.trendyol.com/integration/ecgw/v1/**{sellerId}**/lookup/care-instructions

STAGE

**GET** - https://stageapigw.trendyol.com/integration/ecgw/v1/**{sellerId}**/lookup/care-instructions

### Örnek Request[​](#örnek-request "Örnek Request doğrudan bağlantı")

GET

**{ROOT\_URL}**/v1/1234/lookup/care-instructions

### Örnek Response[​](#örnek-response "Örnek Response doğrudan bağlantı")

```
{  "items": [    {      "name": "Type 1",      "description": "Maksimum 30 °C sıcaklıkta hassas yıkayınız. Ağartıcı kullanmayınız. Tamburlu kurutma yapmayınız. Düşük sıcaklıkta ütüleyiniz. Kuru temizleme yapılamaz.",      "value": "T44"    }    // ...  ]}
```
