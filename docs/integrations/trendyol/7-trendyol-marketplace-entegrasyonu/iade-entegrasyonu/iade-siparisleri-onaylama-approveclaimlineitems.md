# İade Siparişleri Onaylama (approveClaimLineItems)

> Source: https://developers.trendyol.com/docs/marketplace/iade-entegrasyonu/iade-siparisleri-onaylama

# İade Siparişleri Onaylama (approveClaimLineItems)

### İade Siparişleri Onaylama[​](#i̇ade-siparişleri-onaylama "İade Siparişleri Onaylama doğrudan bağlantı")

Trendyol Paneli üzerinden iade siparişleri onaylama işlemini, artık Trendyol API servisini kullanarakta yapabilirsiniz. Ekran görüntüsünü aşağıda görebilirsiniz.

Trendyol sisteminde iadesi oluşarak deponuza ulaşan iade siparişleri bu method yardımıyla onaylayabilirsiniz.

-   Sadece "WaitingInAction" statüsündeki siparişleri onaylayabilirsiniz.
-   "claimId" ve "claimLineItemIdList" değerine [**İadesi Oluşturulan Siparişleri Çekme**](/docs/marketplace/iade-entegrasyonu/iade-olusturulan-siparisleri-cekme) servisimizi kullanarak bu değere ulaşabilirsiniz.
-   İadesi onaylanan siparişler, belirli kurallar çerçevesinde fraud kontrolüne girebilmekte olup, İadesi onaylanan siparişler, “Accepted” Statusune geçmeden önce “WaitingFraudCheck” statusunde görüntülenecektir.

### **PUT** approveClaimLineItems[​](#put-approveclaimlineitems "put-approveclaimlineitems doğrudan bağlantı")

PROD

https://apigw.trendyol.com/integration/order/sellers/{sellerId}/claims/{claimId}/items/approve

STAGE

https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/claims/{claimId}/items/approve

**Örnek Servis İsteği**

```
{  "claimLineItemIdList": [   "f9da2317-876b-4b86-b8f7-0535c3b65731"  ],  "params": {}}
```

**Örnek Servis Cevabı**

```
"HTTP 200";
```
