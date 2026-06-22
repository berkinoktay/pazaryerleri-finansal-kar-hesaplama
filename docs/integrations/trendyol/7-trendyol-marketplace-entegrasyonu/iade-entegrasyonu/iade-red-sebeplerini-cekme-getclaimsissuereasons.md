

> ## Documentation Index
> Fetch the complete documentation index at: https://developers.trendyol.com/llms.txt
> Use this file to discover all available pages before exploring further.

# İade Red Sebeplerini Çekme (getClaimsIssueReasons)

[createClaimIssue](https://integration-documentation-udwy.readme.io/docs/i%CC%87ade-sipari%C5%9Flerinde-ret-talebi-olu%C5%9Fturma-createclaimissue) servisine yapılacak olan isteklerde gönderilecek claimIssueReasonId değerine bu servisi kullanarak ulaşabilirsiniz.

* 1651 numaralı talep nedeni için, iade WaitingInAction statusune geçtikten ilk 24 saat içinde bu reason seçilemez.

### **GET** getClaimsIssueReasons

<NoLinkCallout type="info" title="PROD">
  [https://apigw.trendyol.com/integration/order/claim-issue-reasons](https://apigw.trendyol.com/integration/order/claim-issue-reasons)
</NoLinkCallout>

<NoLinkCallout type="info" title="STAGE">
  [https://stageapigw.trendyol.com/integration/order/claim-issue-reasons](https://stageapigw.trendyol.com/integration/order/claim-issue-reasons)
</NoLinkCallout>

**Örnek Servis Cevabı**

```json
[
    {
        "id": 1,
        "name": "İade gelen ürün sahte"
    },
    ...
    ..
    .
]
```