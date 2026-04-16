# İade ve Sevkiyat Adres Bilgileri (getSuppliersAddresses)

> Source: https://developers.trendyol.com/docs/marketplace/sat%C4%B1c%C4%B1-bilgileri-entegrasyonu/iade-ve-sevkiyat-adres-bilgileri

# İade ve Sevkiyat Adres Bilgileri (getSuppliersAddresses)

[createProduct V2](/docs/marketplace/urun-entegrasyonu/urun-aktarma-v2) servisine yapılacak isteklerde gönderilecek sipariş ve sevkiyat kargo firma bilgileri ve bu bilgilere ait ID değerleri bu servis kullanılarak alınacaktır.

-   **"SATICI BAŞVURU SÜRECİM"** tam olarak tamamlanmadı ise bu servisi kullanmamanız gerekir.

### **GET** getSuppliersAddresses[​](#get-getsuppliersaddresses "get-getsuppliersaddresses doğrudan bağlantı")

PROD

https://apigw.trendyol.com/integration/sellers/{sellerId}/addresses

STAGE

https://stageapigw.trendyol.com/integration/sellers/{sellerId}/addresses

**Örnek Servis Cevabı**

```
{    "supplierAddresses": [        {            "id": 1,            "addressType": "Shipment",            "country": "Country-0",            "city": "Kocaeli",            "cityCode": 0,            "district": "Gebze",            "districtId": 0,            "postCode": "post-code-0",            "address": "Address-0",            "isReturningAddress": false,            "fullAddress": "Address-0 Gebze post-code-0 Kocaeli Country-0",            "isShipmentAddress": true,            "isInvoiceAddress": false,            "isDefault": true        },        {            "id": 2,            "addressType": "Invoice",            "country": "Country-2",            "city": "Ankara",            "cityCode": 0,            "district": "Mamak",            "districtId": 0,            "postCode": "post-code-2",            "address": "Address-2",            "isReturningAddress": false,            "fullAddress": "Address-2 Mamak post-code-2 Ankara Country-2",            "isShipmentAddress": false,            "isInvoiceAddress": true,            "isDefault": true        },        {            "id": 3,            "addressType": "Returning",            "country": "Country-3",            "city": "Bursa",            "cityCode": 0,            "district": "Teleferik",            "districtId": 0,            "postCode": "post-code-3",            "address": "Address-3",            "isReturningAddress": true,            "fullAddress": "Address-3 Teleferik post-code-3 Bursa Country-3",            "isShipmentAddress": false,            "isInvoiceAddress": false,            "isDefault": true        },        {            "id": 4,            "addressType": "Returning",            "country": "Country-4",            "city": "İzmir",            "cityCode": 0,            "district": "Bornova",            "districtId": 0,            "postCode": "post-code-4",            "address": "Address-4",            "isReturningAddress": true,            "fullAddress": "Address-4 Bornova post-code-4 İzmir Country-4",            "isShipmentAddress": false,            "isInvoiceAddress": false,            "isDefault": false        }    ],    "defaultShipmentAddress": {        "id": 0,        "addressType": "Shipment",        "country": "Country-0",        "city": "Kocaeli",        "cityCode": 0,        "district": "Gebze",        "districtId": 0,        "postCode": "post-code-0",        "address": "Address-0",        "isReturningAddress": false,        "fullAddress": "Address-0 Gebze post-code-0 Kocaeli Country-0",        "isShipmentAddress": true,        "isInvoiceAddress": false,        "isDefault": true    },    "defaultInvoiceAddress": {        "id": 2,        "addressType": "Invoice",        "country": "Country-2",        "city": "Ankara",        "cityCode": 0,        "district": "Mamak",        "districtId": 0,        "postCode": "post-code-2",        "address": "Address-2",        "isReturningAddress": false,        "fullAddress": "Address-2 Mamak post-code-2 Ankara Country-2",        "isShipmentAddress": false,        "isInvoiceAddress": true,        "isDefault": true    },    "defaultReturningAddress": {        "present": true    }}
```
