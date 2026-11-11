# Marka yazı tipleri

Bu klasördeki iki yazı tipi uygulamanın kendi sunucusundan servis edilir; `app/layout.tsx` bunları `next/font/local` ile yükler. Daha önce `next/font/google` kullanılıyordu. Google Fonts ara sıra yazı tipi dosyasını uzantısız bir adresle (`/l/font?kit=...&skey=...`) döndürüyor ve Turbopack bu adresi çözümleyemiyor (vercel/next.js#99114). Bu yüzden geliştirme sunucusu ve derleme rastgele kırılıyordu. Dosyaları depoda tutmak hem bu hatayı hem de derleme sırasındaki ağ bağımlılığını ortadan kaldırır.

| Dosya                       | Aile           | Ağırlık ekseni | Kaynak                                                           |
| --------------------------- | -------------- | -------------- | ---------------------------------------------------------------- |
| `host-grotesk-wght.woff2`   | Host Grotesk   | 300–800        | google/fonts deposu, `ofl/hostgrotesk/HostGrotesk[wght].ttf`     |
| `jetbrains-mono-wght.woff2` | JetBrains Mono | 100–800        | google/fonts deposu, `ofl/jetbrainsmono/JetBrainsMono[wght].ttf` |

İki yazı tipi de SIL Open Font License 1.1 ile dağıtılır; lisans metinleri `OFL-host-grotesk.txt` ve `OFL-jetbrains-mono.txt` dosyalarındadır.

## Dosyalar nasıl üretildi

Kaynak TTF dosyaları Google Fonts'un `latin` ve `latin-ext` alt kümelerinin birleşimine indirgenip woff2 biçimine çevrildi. Türkçe karakterler (ğ, ş, ı, İ) ve lira işareti (₺) bu aralığın içindedir. JetBrains Mono'nun kaynak dosyasında lira işareti yoktur; bu durum Google üzerinden yüklendiği zamanda da aynıydı.

Yeniden üretmek için `fonttools` ve `brotli` paketleri yeterlidir:

```bash
pyftsubset 'HostGrotesk[wght].ttf' \
  --unicodes='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD,U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' \
  --layout-features='*' --flavor=woff2 --no-hinting --desubroutinize \
  --output-file=host-grotesk-wght.woff2
```

JetBrains Mono için aynı komut kaynak dosya ve çıktı adı değiştirilerek çalıştırılır.
