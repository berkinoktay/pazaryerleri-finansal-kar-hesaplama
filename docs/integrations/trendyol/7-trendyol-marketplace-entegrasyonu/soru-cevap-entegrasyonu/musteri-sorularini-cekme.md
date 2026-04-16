# Müşteri Sorularını Çekme

> Source: https://developers.trendyol.com/docs/marketplace/soru-cevap-entegrasyonu/musteri-sorularini-cekme

# Müşteri Sorularını Çekme

### Müşteri Sorularının Alınması[​](#müşteri-sorularının-alınması "Müşteri Sorularının Alınması doğrudan bağlantı")

Trendyol üzerinden müşterilerin iş ortaklarımıza sormuş olduğu soruların tümünü bu servis aracılığı ile çekebilirsiniz.

### **GET** questionsFilter[​](#get-questionsfilter "get-questionsfilter doğrudan bağlantı")

Herhangi bir tarih parametresi vermeden aşağıdaki endpoint ile istek atmanız halinde son bir hafta içerisindeki sorularınız sizlere gösterilecektir. startDate ve endDate parametrelerini eklemeniz halinde verilebilecek maksimum aralık iki hafta olacaktır.

PROD

https://apigw.trendyol.com/integration/qna/sellers/{sellerId}/questions/filter

STAGE

https://stageapigw.trendyol.com/integration/qna/sellers/{sellerId}/questions/filter

**Önerilen Endpoint**

PROD

https://apigw.trendyol.com/integration/qna/sellers/{sellerId}/questions/filter?startDate={startDate}&endDate={endDate}&status=WAITING\_FOR\_ANSWER

**Servis Parametreleri**

-   **supplierId** zorunlu alan olarak istekte gönderilmelidir

Parametre

Parametre Değer

Açıklama

Tip

barcode

Belirli barcode değerine ait olan sorular için kullanılabilir.

long

page

Sadece belirtilen sayfadaki bilgileri döndürür

int

size

Maksimum 50

Bir sayfada listelenecek maksimum adeti belirtir.

int

**supplierId**

İlgili tedarikçinin ID bilgisi gönderilmelidir

long

endDate

Belirtilen tarihe kadar olan soruları getirir. Timestamp(millisecond) olarak gönderilmelidir.

long

startDate

Belirtilen tarihten sonraki soruları getirir. Timestamp(millisecond) olarak gönderilmelidir.

long

status

WAITING\_FOR\_ANSWER, WAITING\_FOR\_APPROVE, ANSWERED, REPORTED, REJECTED

Soruların statülerine göre bilgilerini getirir.

string

orderByField

LastModifiedDate

Son güncellenme tarihini baz alır.

string

orderByField

CreatedDate

Sorunun oluşma tarihini baz alır

string

orderByDirection

ASC

Eskiden yeniye doğru sıralar.

string

orderByDirection

DESC

Yeniden eskiye doğru sıralar.

string

### Örnek Servis Cevabı[​](#örnek-servis-cevabı "Örnek Servis Cevabı doğrudan bağlantı")

```
{  "content": [    {      "answer": {        "creationDate": 0, //Cevabın verildiği tarih        "hasPrivateInfo": true,        "id": 0,        "reason": "string",        "text": "string"      },      "answeredDateMessage": "string",      "creationDate": 0,      "customerId": 0,      "id": 0, //Sorunun id'si      "imageUrl": "string",      "productName": "string",      "public": true,      "reason": "string",      "rejectedAnswer": {        "creationDate": 0, //En son red edilen cevabın oluşturulma tarihi        "id": 0,        "reason": "string",        "text": "string"      },      "rejectedDate": 0,      "reportReason": "string",      "reportedDate": 0,      "showUserName": true,      "status": "string",      "text": "string",      "userName": "string",      "webUrl": "string",      "productMainId": "1234567"    }  ],  "page": 10,  "size": 2,  "totalElements": 864,  "totalPages": 432}
```

### **GET** questionsFilterById[​](#get-questionsfilterbyid "get-questionsfilterbyid doğrudan bağlantı")

Yukarıdaki servisten dönen sorunun id değeri ile soruları tekil olarak çekip işlem yapabilirsiniz.

PROD

https://apigw.trendyol.com/integration/qna/sellers/{sellerId}/questions/{id}

STAGE

https://stageapigw.trendyol.com/integration/qna/sellers/{sellerId}/questions/{id}

Field İsmi

Açıklama

**customerId**

Müşterinin trendyol.com üzerinde kayıtlı id değeridir.

**answeredDateMessage**

Sorunun cevaplanma süresidir.

**creationDate**

Müşterinin trendyol.com üzerinde soruyu sorduğu tarih.

**imageUrl**

Sorusu sorulan ürünün görsel linki değeridir.

**productName**

Sorusu sorulan ürünün isim değeridir.

**public**

Sorunun trendyol.com'da gösterilip gösterilmeyeceğine gösteren değerdir.

**reason**

Eğer soru red edilmiş ise dönen değerdir.

**rejectedAnswer**

Sorunun en son rededilmiş cevabının detaylarıdır.

**rejectedDate**

Sorunun rededilme tarihidir.

**reportReason**

Satıcının soruyu raporlarken yazılan açıklamadır. Bu işlem sadece Trendyol Satıcı Panelinden yapılmaktadır.

**reportedDate**

Satıcının soruyu raporladığı tarihtir.

**showUserName**

Müşterinin adının trendyol.com üzerinden görünüp görünmediğini ileten parametredir.

**status**

Sorunun statüsüdür.

**text**

Müşterinin sorduğu soru metnidir.

**userName**

Müşterinin adıdır.
