# Ortak Etiket Oluşan Barkodun Alınması (getCommonLabel)

> Source: https://developers.trendyol.com/docs/category/ortak-etiket-entegrasyonu

# Ortak Etiket Oluşan Barkodun Alınması (getCommonLabel)

### Ortak Etiket Oluşan Barkodun Alınması[​](#ortak-etiket-oluşan-barkodun-alınması "Ortak Etiket Oluşan Barkodun Alınması doğrudan bağlantı")

Ortak barkod süreci TEX, Aras Kargo için Trendyol öder gönderilerde kullanılabilmektedir.

Bu servis ile createCommonLabel servisinden talep edilen barkodu alabilirsiniz.

-   Tarafınıza çoklu koliler için birden fazla etiket dönecektir. Tek koli olması durumunda tek ZPL dönecektir.

### **GET** getCommonLabel[​](#get-getcommonlabel "get-getcommonlabel doğrudan bağlantı")

PROD

https://apigw.trendyol.com/integration/sellers/{sellerId}/common-label/{cargoTrackingNumber}

STAGE

https://stageapigw.trendyol.com/integration/sellers/{sellerId}/common-label/{cargoTrackingNumber}

**Örnek Servis Cevabı**

```
{    "data": [        {            "label": "^XA.......^XZ",            "format": "ZPL"        }    ]}
```

**Servis Hata Mesajları**

Status Code

Açıklama

**400**

Error - İletmiş olduğunuz cargoTrackingNumber değerini kontrol ediniz

**401**

Error - Girdiğiniz API bilgilerini kontrol etmeniz gerekmektedir
