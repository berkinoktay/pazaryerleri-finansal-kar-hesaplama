# Barkod ile Kategori Bilgisi Listeleme

> Source: https://developers.trendyol.com/docs/trendyol-autoft/urun-entegrasyonu/barkod-ile-kategori-bilgisi-listeleme

# Barkod ile Kategori Bilgisi Listeleme

Ürün Oluşturma V2 adımında, zorunlu özellik listesini elde etmek için gerekli olan **categoryId** bilgisi barkod bilgisi ile bu endpoitten listelenebilir.

PROD

**POST** - https://apigw.trendyol.com/integration/ecgw/v1/**{sellerId}**/lookup/product-categories/by-barcodes

STAGE

**POST** - https://stageapigw.trendyol.com/integration/ecgw/v1/**{sellerId}**/lookup/product-categories/by-barcodes

### Örnek Request[​](#örnek-request "Örnek Request doğrudan bağlantı")

POST

**{ROOT\_URL}**/v1/1234/lookup/product-categories/by-barcodes

```
{    "barcodes": [        "barcode-1",        "barcode-2",        "barcode-3",        "barcode-4",        "barcode-5"    ]}
```

### Örnek Response[​](#örnek-response "Örnek Response doğrudan bağlantı")

```
{  "barcodeCategories": {    "barcode-1": {      "id": 123,      "displayName": "Etek"    },    "barcode-2": {      "id": 124,      "displayName": "Deri Ceket"    },    "barcode-3": {      "id": 125,      "displayName": "Kot Pantolon"    }  },  // Barkodun kategorisi bulunamadığı durumda bu dizi içerisinde barkod bilgisi dönecektir  "notFound": [     "barcode-4",    "barcode-5"  ]}
```
