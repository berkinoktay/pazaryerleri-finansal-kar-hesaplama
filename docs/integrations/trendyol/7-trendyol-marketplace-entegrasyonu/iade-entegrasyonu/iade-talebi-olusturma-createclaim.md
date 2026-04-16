# İade Talebi Oluşturma (createClaim)

> Source: https://developers.trendyol.com/docs/marketplace/iade-entegrasyonu/iade-talebi-olusturma

# İade Talebi Oluşturma (createClaim)

### İade Talebi Oluşturma (createClaim)[​](#i̇ade-talebi-oluşturma-createclaim-1 "İade Talebi Oluşturma (createClaim) doğrudan bağlantı")

İade kodu olmadan gelen sipariş paketleri için iade talebi oluşturmak için bu servisi kullanabilirsiniz. Bu servisle bir paket oluşturduktan sonra,İade Edilen Siparişleri Alma servisi ile iade paketlerini alabilirsiniz.

-   Oluşturacağınız iade talebi **"Created"** statüsünde oluşturulacaktır. **"createClaim"** servisini sadece **"Approved"** iade talepleriniz için kullanabilirsiniz.

### **POST** createClaim[​](#post-createclaim "post-createclaim doğrudan bağlantı")

PROD

https://apigw.trendyol.com/integration/order/sellers/{sellerId}/claims/create

STAGE

https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/claims/create

**Örnek Servis İsteği**

```
{  "claimItems": [    {      "barcode": "string",      "customerNote": "string",      "quantity": 0,      "reasonId": 401    }  ],  "customerId": 0,  "excludeListing": true,  "forcePackageCreation": true,  "orderNumber": "string",  "shipmentCompanyId": 4}
```

**Örnek Servis Cevabı**

```
{    "claimId": "string",    "cargoTrackingNumber": 733xxxxxxx,    "claimItemIds": [        "string"    ]}
```

Parametre

Açıklama

barcode

Siparişteki ürünün barkod bilgisidir.

customerNote

Müşterilerin yazdığı alandır. İsterseniz bu alanı "İade kodu olmadan iade" gibi bir metinle besleyebilirsiniz.

quantity

İade talebi oluşturmak istediğiniz ürünün adet bilgisidir.

reasonId

trendyol.com'da müşterilerin seçtiği iade nedenleridir. Bu id değerini şimdilik 401 id değeriyle "vazgeçtim" olarak besleyebilirsiniz.

customerId

Trendyol üzerinden sipariş alan müşterinin id değeridir.

orderNumber

Siparişin numarası.

shipmentCompanyId

Çalıştığınız kargo firmasının id değerini kullanabilirsiniz.
