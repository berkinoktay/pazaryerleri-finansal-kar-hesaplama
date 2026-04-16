# Ortak Etiket Barkod Talebi (createCommonLabel)

> Source: https://developers.trendyol.com/docs/marketplace/teslimat-entegrasyonu/ortak-etiket-barkod-talebi

# Ortak Etiket Barkod Talebi (createCommonLabel)

### Ortak Etiket Barkod Talebi[​](#ortak-etiket-barkod-talebi "Ortak Etiket Barkod Talebi doğrudan bağlantı")

![](https://user-images.githubusercontent.com/63308712/183641956-41fd0811-53ed-493d-83f7-330961bde1bf.jpg)

Ortak barkod süreci TEX ,Aras Kargo için trendyol öder gönderilerde kullanılabilmektedir.

Bu servis ile ortak etiket sürecindeki siparişler için ilgili kargo numarasına ait barkod talebi yapabilirsiniz. Barkod oluştuktan sonra sizlere ZPL formatında Ortak Etiket Oluşan Barkodun Alınması Servisinden dönecektir.

-   Barkod talebini ilgili sipariş paketine picking veya invoiced statüsü besledikten sonra yapmanız tavsiye edilmektedir.
-   Format olarak şu an için sadece ZPL formatı bulunmaktadır.

### **POST** createCommonLabel[​](#post-createcommonlabel "post-createcommonlabel doğrudan bağlantı")

PROD

https://apigw.trendyol.com/integration/sellers/{sellerId}/common-label/{cargoTrackingNumber}

STAGE

https://stageapigw.trendyol.com/integration/sellers/{sellerId}/common-label/{cargoTrackingNumber}

**Örnek Servis İsteği**

```
{        "format": ""ZPL"", //required        "boxQuantity": 5,        "volumetricHeight": 3.5}
```

**Örnek Servis Cevapları**

Status Code

Açıklama

**200**

Success - No response body

**400**

Error - İletmiş olduğunuz cargoTrackingNumber değerini kontrol ediniz

**401**

Error - Girdiğiniz API bilgilerini kontrol etmeniz gerekmektedir
