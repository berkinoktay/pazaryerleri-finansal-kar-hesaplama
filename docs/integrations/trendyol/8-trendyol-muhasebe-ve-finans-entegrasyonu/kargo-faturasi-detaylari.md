

> ## Documentation Index
> Fetch the complete documentation index at: https://developers.trendyol.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Kargo Faturası Detayları

**Trendyol tarafından satıcılara kesilen kargo faturalarını detayına bu servis üzerinden ulaşabilirsiniz.**

<Callout icon="❗️" theme="error">
  **DİKKAT**
  Mevcut entegrasyon servislerimizde **api.trendyol.com** olarak kullandığımız base URL, **9 Ocak 2025 Perşembe** günü itibarıyla **api.tgoapis.com** üzerinden çalışacak şekilde güncellenecektir. Sistemlerinizde bu değişikliği belirtilen tarihe kadar yapmanızı önemle rica ederiz.

  Değişiklik yapılan tüm entegrasyon servislerine ise **[developers.tgoapps.com](https://developers.tgoapps.com)** adresinden ulaşabilirsiniz.
</Callout>

-**Kargo Faturasının seri numarasını nasıl bulurum ?**

Cari Hesap Ekstresi Entegrasyonu üzerinden transactionType='DeductionInvoices' responsundan dönen data içerisinde ki alanlardan transactionType değeri "Kargo Faturası" yada "Kargo Fatura" olan kayıtların "Id" değeri "invoiceSerialNumber" değeridir.

### **GET** cargo-invoice

<NoLinkCallout type="info" title="PROD">
  [https://apigw.trendyol.com/integration/finance/che/sellers/\{sellerId}/cargo-invoice/\{invoiceSerialNumber}/items](https://apigw.trendyol.com/integration/finance/che/sellers/\{sellerId}/cargo-invoice/\{invoiceSerialNumber}/items)
</NoLinkCallout>

<NoLinkCallout type="info" title="STAGE">
  [https://stageapigw.trendyol.com/integration/finance/che/sellers/\{sellerId}/cargo-invoice/\{invoiceSerialNumber}/items](https://stageapigw.trendyol.com/integration/finance/che/sellers/\{sellerId}/cargo-invoice/\{invoiceSerialNumber}/items)
</NoLinkCallout>

**Örnek Servis Cevabı**

```json
{
    "page": 0,
    "size": 500,
    "totalPages": 1,
    "totalElements": 25,
    "content": [
        {
            "shipmentPackageType": "Gönderi Kargo Bedeli",
            "parcelUniqueId": 7260001151141191,
            "orderNumber": "2111681160",
            "amount": 34.24,
            "desi": 1
        },
        {
            "shipmentPackageType": "İade Kargo Bedeli",
            "parcelUniqueId": 7265609146531138,
            "orderNumber": "2111161312",
            "amount": 34.24,
            "desi": 1
        }
    ]
}
```