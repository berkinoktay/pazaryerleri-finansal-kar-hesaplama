# Webhook Silme - Content

Bu servis ile daha önce yaratmış olduğunuz webhook methodlarını silebilirsiniz. Entegrasyon servislerine gönderilecek istekler, temel kimlik doğrulama yöntemi olan "basic authentication" ile yetkilendirilmelidir. Basic Authentication için kullanılan sellerId, API KEY ve API SECRET KEY bilgileri satıcı panelinde yer alan "Hesap Bilgilerim" bölümündeki "Entegrasyon Bilgileri" sayfasından alınmalıdır.

## DELETE deleteWebhook

### PROD

https://apigw.trendyol.com/integration/webhook/sellers/{sellerId}/webhooks/{Id}

### STAGE

https://stageapigw.trendyol.com/integration/webhook/sellers/{sellerId}/webhooks/{Id}

## Örnek Servis Cevabı

200 OK
