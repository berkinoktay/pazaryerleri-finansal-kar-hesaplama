# İade Red Sebeplerini Çekme (getClaimsIssueReasons)

> Source: https://developers.trendyol.com/docs/marketplace/iade-entegrasyonu/iade-red-sebeplerini-cekme

# İade Red Sebeplerini Çekme (getClaimsIssueReasons)

### İade Red Sebeplerini Çekme[​](#i̇ade-red-sebeplerini-çekme "İade Red Sebeplerini Çekme doğrudan bağlantı")

[createClaimIssue](/docs/marketplace/iade-entegrasyonu/iade-siparislerinde-red-talebi-olusturma) servisine yapılacak olan isteklerde gönderilecek claimIssueReasonId değerine bu servisi kullanarak ulaşabilirsiniz.

-   1651 numaralı talep nedeni için, iade WaitingInAction statusune geçtikten ilk 24 saat içinde bu reason seçilemez.

### **GET** getClaimsIssueReasons[​](#get-getclaimsissuereasons "get-getclaimsissuereasons doğrudan bağlantı")

PROD

https://apigw.trendyol.com/integration/order/claim-issue-reasons

STAGE

https://stageapigw.trendyol.com/integration/order/claim-issue-reasons

**Örnek Servis Cevabı**

```
[    {        "id": 1,        "name": "İade gelen ürün sahte"    },    ...    ..    .]
```
