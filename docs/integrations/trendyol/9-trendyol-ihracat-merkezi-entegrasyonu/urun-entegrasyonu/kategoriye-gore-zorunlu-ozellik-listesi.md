# Kategoriye Göre Zorunlu Özellik Listesi

> Source: https://developers.trendyol.com/docs/trendyol-autoft/urun-entegrasyonu/kategoriye-gore-urun-ozellik-listesi

# Kategoriye Göre Zorunlu Özellik Listesi

Ürün Oluşturma V2 adımında, request modelde istenen zorunlu özellik listesi bu endpointten alınır.

PROD

**GET** - https://apigw.trendyol.com/integration/ecgw/v1/**{sellerId}**/lookup/product-categories/**{categoryId}**/attributes

STAGE

**GET** - https://stageapigw.trendyol.com/integration/ecgw/v1/**{sellerId}**/lookup/product-categories/**{categoryId}**/attributes

### Örnek Request[​](#örnek-request "Örnek Request doğrudan bağlantı")

GET

**{ROOT\_URL}**/v1/1234/lookup/product-categories/123456/attributes

### Örnek Response[​](#örnek-response "Örnek Response doğrudan bağlantı")

```
{  "categoryId": 123,  "displayName": "Deri Ceket",  "categoryAttributes": [    {      "attributeId": 200,      "attributeName": "Renk",      "required": true,      "customValue": true,      "multipleValues": false,      "attributeValues": []    },    {      "attributeId": 296,      "attributeName": "Cinsiyet",      "required": true,      "allowCustom": false,      "multipleValues": false,      "attributeValues": [        {          "id": 1234,          "name": "Unisex"        },        {          "id": 1235,          "name": "Erkek"        },        {          "id": 1236,          "name": "Kadın"        }      ]    },    {      "attributeId": 294,      "attributeName": "Yaş Grubu",      "required": true,      "allowCustom": false,      "multipleValues": false,      "attributeValues": [        {          "id": 2879,          "name": "Yetişkin"        },        {          "id": 2878,          "name": "Genç"        },        {          "id": 2877,          "name": "Çocuk"        },        {          "id": 2876,          "name": "Bebek"        }      ]    },    {      "attributeId": 59810,      "attributeName": "Menşei",      "required": true,      "allowCustom": false,      "multipleValues": false,      "attributeValues": [        {          "id": 2178083,          "name": "Abd"        },        {          "id": 2178005,          "name": "Almanya"        }        // ...      ]    },    {      "attributeId": 21602,      "attributeName": "Yıkama Talimatı",      "required": true,      "allowCustom": false,      "multipleValues": false,      "attributeValues": [        {          "id": 232837,          "name": "T44"        }        // ...      ]    },    {      "attributeId": 17620,      "attributeName": "Materyal Bileşeni",      "required": true,      "allowCustom": true,      "multipleValues": true,      "attributeValues": [        {          "id": 261340,          "name": "Abaka (manila kendiri)"        },        {          "id": 261348,          "name": "Air Mesh"        },        {          "id": 228690,          "name": "Akrilik"        }        // ...      ]    }  ]}
```
