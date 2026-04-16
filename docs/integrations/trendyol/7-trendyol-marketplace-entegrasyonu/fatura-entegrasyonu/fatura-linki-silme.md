# Fatura Linki Silme

> Source: https://developers.trendyol.com/docs/marketplace/fatura-entegrasyonu/fatura-linki-silme

# Fatura Linki Silme

### Fatura Linki Silme[​](#fatura-linki-silme-1 "Fatura Linki Silme doğrudan bağlantı")

Daha önce hatalı beslenen faturalar bu servis üzerinden silinip, fatura linki gönderme servisi ile tekrar beslenebilmektedir.

### **METHOD: POST**[​](#method-post "method-post doğrudan bağlantı")

PROD

https://apigw.trendyol.com/integration/sellers/{sellerId}/seller-invoice-links/delete

STAGE

https://stageapigw.trendyol.com/integration/sellers/{sellerId}/seller-invoice-links/delete

**Örnek Servis İsteği**

```
{  "serviceSourceId": 88787, // shipmentPackageId  "channelId": 1, // her zaman 1 olarak gönderilmelidir.  "customerId": 167878 // sipariş paketleri çekme servisinden kontrol edilmelidir.}
```

**Örnek Servis Cevabı**

```
"HTTP 202";
```
