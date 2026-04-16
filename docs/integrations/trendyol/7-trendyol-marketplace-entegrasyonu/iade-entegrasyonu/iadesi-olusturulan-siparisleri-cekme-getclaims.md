# İadesi Oluşturulan Siparişleri Çekme (getClaims)

> Source: https://developers.trendyol.com/docs/marketplace/iade-entegrasyonu/iade-olusturulan-siparisleri-cekme

# İadesi Oluşturulan Siparişleri Çekme (getClaims)

Trendyol sisteminde iadesi oluşan siparişleri bu metot yardımıyla çekebilirsiniz.

**Red Edilen Paket Bilgileri:**

-   İade red paketi bilgileri, response içerisinde "rejectedpackageinfo" alanına eklenmiştir.
-   Eğer müşterinin iade talebi reddedildiyse ve geri gönderilmek üzere iade red paketi oluşturulmuşsa, bu paket bilgileri "rejectedpackageinfo" alanından tarafınıza dönecektir.Iade red paketi oluşmamışsa, bu alan görünmeyecektir.
-   "rejectedpackageinfo.packageId" bilgisi, iade red paketine ait benzersiz bir ID'yi temsil eder. Bu Id'yi kullanarak kendi kargo anlaşmanız (kendi kargo kodlarınız) ile çıkış yaparak, kargo kodu besleme servisinden tarafımıza bildirebilirsiniz.

**Kullanılabilen Statüler ve Statü Güncellemeleri:**

-   Kullanılabilinecek statüler şunlardır; Created, WaitingInAction, Accepted, Cancelled, Rejected, Unresolved, InAnalysis.
-   suppliers/{supplierid}/claims?claimItemStatus=Created gibi bir query ile de paket statülerine göre sorgulama yapılabilir.
-   İade servislerinde statüsü güncellenen iade paketleriniz, servis üzerinden tarafınıza **lastModifiedDate** sırasına göre dönecektir.
-   Yeni oluşmuş paketleri çekmek için **Created** olarak sorgulama yapılmalıdır.

**Tarih Bilgisi:**

-   **claimDate** bilgisi, Timestamp (milliseconds) formatında GMT olarak iletilmektedir.
-   Tarih bilgisini satıcı paneli ile eşlemek için GMT+3 olarak işlem yapmanız gerekmektedir.

**İade Kargo Takip Linki:**

-   **rejectedpackageinfo.cargoTrackingLink** alanı, iade kargo paketi yola çıktığında dönen bilgidir.
-   Kendi kargo anlaşmasıyla çalışan satıcılar, kargo sürecini bu link üzerinden kontrol edebilirler.

### **GET** getShipmentPackages[​](#get-getshipmentpackages "get-getshipmentpackages doğrudan bağlantı")

PROD

https://apigw.trendyol.com/integration/order/sellers/{sellerId}/claims

STAGE

https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/claims

**Servis Parametreleri**

-   claimIds parametresi verildiği zaman diğer tüm parametreler işleme alınmayarak sadece ilgili claimId'ye ait değerler dönecektir.
-   "orderShipmentPackageId" değeri iade paketinin id değeridir.

Parametre

Açıklama

Tip

claimIds

Tekil veya çoğul olarak ilgili iade paketlerinin detaylarına ulaşabilirsiniz.

string

claimItemStatus

İade itemin statüsüdür.

string

endDate

İade paketinin oluşturulma tarihine göre çalışır.

integer

startDate

İade paketinin oluşturulma tarihine göre çalışır.

integer

orderNumber

İade paketinin sipariş numarasıdır.

string

size

Bir sayfada listelenecek maksimum adeti belirtir.

integer

page

Sadece belirtilen sayfadaki bilgileri döndürür.

integer

### Örnek Servis Cevabı[​](#örnek-servis-cevabı "Örnek Servis Cevabı doğrudan bağlantı")

```
{    "totalElements": 2099,    "totalPages": 2099,    "page": 0,    "size": 1,    "content": [        {            "id": "f9da2317-876b-4b86-b8f7-0535c3b65731", //claimId            "claimId": "f9da2317-876b-4b86-b8f7-0535c3b65731",            "orderNumber": "65745805",            "orderDate": 1524826343886,            "customerFirstName": "Trendyol",            "customerLastName": "Müşterisi",            "claimDate": 1525844162827,            "cargoTrackingNumber": 72602420957047272632,            "cargoTrackingLink": "https://kargotakip.araskargo.com.tr/mainpage.aspx?code=90909090909",            "cargoSenderNumber": "8106459254413",            "cargoProviderName": "Aras Kargo Marketplace",            "orderShipmentPackageId": 3853354,           "replacementOutboundpackageinfo":            {                "cargoTrackingNumber":72602420957047272632,                "cargoProviderName":"Aras Kargo Marketplace",                "cargoSenderNumber": "733861966410",                "cargoTrackingLink": "https//..." //kargotakip.araskargo.com.tr/mainpage.aspx?code=90909090909",                "packageid": 28717254, //değişim paket id bilgisidir                "items": [                    b71461e3-d1a0-4c1d-9a6d-18ecbcb5432d //claimItem.Id                    ]            },            "rejectedpackageinfo":            {                "cargoTrackingNumber": 72602420957047272632,                "cargoSenderNumber": "12345754875355",                "cargoProviderName":"Aras Kargo Marketplace",                "cargoTrackingLink": "https://kargotakip.araskargo.com.tr/mainpage.aspx?code=90909090909",                "packageid": 28717254, //reddedilen iade paket id bilgisidir                "items": [                    b71461e3-d1a0-4c1d-9a6d-18ecbcb5432d //claimItem.Id                    ]            },    },            "items": [                {                    "orderLine": {                        "id": 28717254,                        "productName": "Erkek Bebek Sandalet 8S5280Z1/GREEN CS4, 21",                        "barcode": "99999999999",                        "merchantSku": "2083667",                        "productColor": "GREEN CS4",                        "productSize": " 21",                        "price": 12.95,                        "vatBaseAmount": 8,                        "vatRate": 8,                        "salesCampaignId": 183631,                        "productCategory": "Sandalet"                    },                    "claimItems": [                        {                            "id": "b71461e3-d1a0-4c1d-9a6d-18ecbcb5158c", //claimLineItemIdList                            "orderLineItemId": 29815493,                            "customerClaimItemReason": {                                "id":"451",  //claimIssueReasonId                                "name": "Diğer",                                "externalReasonId": 23,                                "code": "UNFIT"                            },                            "trendyolClaimItemReason": {                                "id":"451",                                "name": "Diğer",                                "externalReasonId": 23,                                "code": "UNFIT"                            },                            "claimItemStatus": {                                "name": "Created"                            },                            "note": "",                            "customerNote":"Müşteri notu",                            "resolved": false,                            "autoAccepted": false,                            "acceptedBySeller": true                        }                    ]                },                {                    "orderLine": {                        "id": 28717255,                        "productName": "Erkek Bebek Soket Çorap 4'lü 8S7346Z1/MIX YARN DYED K00, 6-12 Ay",                        "barcode": "99999999999",                        "merchantSku": "2052551",                        "productColor": "MIX YARN DYED K00",                        "productSize": " 17-18 (6-12 Ay)",                        "price": 9.95,                        "vatBaseAmount": 8,                         "vatRate": 8,                        "salesCampaignId": 183631,                        "productCategory": "Çorap"                    },                    "claimItems": [                        {                            "id": "b71461e3-d1a0-4c1d-9a6d-18ecbcb5432d", //claimLineItemIdList                            "orderLineItemId": 29815494,                            "customerClaimItemReason": {                                "id":"451",                                "name": "Diğer",                                "externalReasonId": 23,                                "code": "UNFIT"                            },                            "trendyolClaimItemReason": {                                "id":"451",                                "name": "Diğer",                                "externalReasonId": 23,                                "code": "UNFIT"                            },                            "claimItemStatus": {                                "name": "Rejected"                            },                            "note": "",                            "customerNote":"Müşteri notu",                            "resolved": false,                            "autoAccepted": false, //48 saat boyunca aksiyon alınmayan iadeler, otomatik olarak kabul edilir, ve bu alandan kontrol edilebilir.                            "acceptedBySeller": true //Satıcı tarafından kabul edilen iadeler, bu alandan kontrol edilebilir.                        }                    ]                }            ],            "lastModifiedDate": 1723275767111,            "orderOutboundPackageId": 58835111        }    ]}
```

Servis

Açıklama

**Created**

İadesi oluşan siparişlerin ilk statüsüdür. Bu aşamada müşteri iade butonuna bastığı zaman oluşmaktadır.

**WaitingInAction**

İadesi oluşturulan sipariş tedarikçimize ulaştığı zaman bu statü dönmektedir.

**WaitingFraudCheck**

İadesi onaylanan sipariş fraud kontrolune uğradığı durumda bu statü dönmektedir.

**Unresolved**

İhtilaflı statüsündeki iade siparişleridir. Sorun bildir işlemi yapıldıktan sonra sipariş ihtilaflı statüsüne geçmektedir.

**Rejected**

İadesi reddedilen siparişler için kullanılır.

**Accepted**

İadesi kabul edilen siparişler için kullanılır.

**Cancelled**

İadesi iptal edilmiş siparişler için kullanılır.

**InAnalysis**

Analizde olan siparişler için kullanılır.
