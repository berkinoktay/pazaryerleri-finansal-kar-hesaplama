# Müşteri Sorularını Cevaplama

> Source: https://developers.trendyol.com/docs/marketplace/soru-cevap-entegrasyonu/musteri-sorularini-cevaplama

# Müşteri Sorularını Cevaplama

### Müşteri Sorularına Cevaplanması[​](#müşteri-sorularına-cevaplanması "Müşteri Sorularına Cevaplanması doğrudan bağlantı")

[Trendyol Müşteri Sorularını Çekme Servisi](/docs/marketplace/soru-cevap-entegrasyonu/musteri-sorularini-cekme) üzerinden çekmiş olduğunuz sorulara bu servis aracılığı ile cevap verebilirsiniz.

-   Cevap mesajı minimum 10, maksimum 2000 karakter aralığında olmalıdır.

### **POST** createAnswer[​](#post-createanswer "post-createanswer doğrudan bağlantı")

PROD

https://apigw.trendyol.com/integration/qna/sellers/{sellerId}/questions/{id}/answers

STAGE

https://stageapigw.trendyol.com/integration/qna/sellers/{sellerId}/questions/{id}/answers

**Örnek Servis İsteği**

```
{  "text": "string"}
```

**Örnek Servis Cevabı**

```
"HTTP 200";
```
