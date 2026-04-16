# İade Siparişlerinde Ret Talebi Oluşturma (createClaimIssue)

> Source: https://developers.trendyol.com/docs/marketplace/iade-entegrasyonu/iade-siparislerinde-red-talebi-olusturma

# İade Siparişlerinde Ret Talebi Oluşturma (createClaimIssue)

### İade Siparişlerinde Ret Talebi Oluşturma[​](#i̇ade-siparişlerinde-ret-talebi-oluşturma "İade Siparişlerinde Ret Talebi Oluşturma doğrudan bağlantı")

Trendyol Paneli üzerinden iade siparişlerine ret talebi oluşturma işlemini, artık Trendyol API servisini kullanarakta yapabilirsiniz. Ekran görüntüsünü aşağıda görebilirsiniz.

Trendyol sisteminde iadesi oluşarak deponuza ulaşan iade siparişleri bu method yardımıyla ret talebi oluşturabilirsiniz.

-   Sadece "WaitingInAction" statüsündeki siparişleri için Ret Talebi oluşturabilirsiniz.
    
-   İadeye ait ekleri (pdf, jpeg vb.) "form-data (file)" olarak eklemeniz gerekmektedir.
    
-   "claimId" ve "claimLineItemIdList" değerine [**İadesi Oluşturulan Siparişleri Çekme**](/docs/marketplace/iade-entegrasyonu/iade-olusturulan-siparisleri-cekme) servisimizi kullanarak bu değerlere ulaşabilirsiniz ve sadece "WaitingInAction" statüsündeki iade siparişlerine ret talebi oluşturabilirsiniz.
    
-   "claimIssueReasonId" değerine İade Red Sebeplerini Çekme servisimizi kullanarak ilgili ID değerlerine ulaşabilirsiniz.
    
-   "description" değerini freetext olarak maksimum 500 karakter olarak yazabilirsiniz.
    
-   Aşağıda ki iade sebepleri için file yüklemenize gerek bulunmamaktadır. Bu iki iade sebebi dışında bütün sebepler için file yüklemek zorunludur.
    
    -   1651: “Müşterinin yolladığı iade paketi elime ulaşmadı”
    -   451: “Müşteriden gelen ürünü analize göndereceğim”
    -   2101: "Sipariş sorusundan gelen değişim talebi (müşterinin talebi yoksa kullanılmamalı)"

### **POST** createClaimIssue[​](#post-createclaimissue "post-createclaimissue doğrudan bağlantı")

PROD

https://apigw.trendyol.com/integration/order/sellers/{sellerId}/claims/{claimId}/issue?claimIssueReasonId={claimIssueReasonId}&claimItemIdList={claimItemIdList}&description={test}

STAGE

https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/claims/{claimId}/issue?claimIssueReasonId={claimIssueReasonId}&claimItemIdList={claimItemIdList}&description={test}

**Örnek Servis Cevabı**

```
"HTTP 200";
```
