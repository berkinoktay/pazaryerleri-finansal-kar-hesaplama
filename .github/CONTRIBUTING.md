# Katkı & Merge Konvansiyonları

> Bu repo **Free-private** planda; GitHub branch protection / ruleset sunucu
> tarafında zorlanamıyor (her ikisi de "Upgrade to Pro" 403 veriyor). Bu yüzden
> aşağıdaki kurallar **disiplinle** uygulanır — koruma şu dört katmandan oluşur:
> yerel husky hook'ları + CI sinyali (`ci-success`) + repo merge ayarları +
> bu doküman. (`docs/SECURITY.md` her zaman önceliklidir.)

## Branch isimlendirme

- `feature/xxx` · `fix/xxx` · `refactor/xxx` · `chore/xxx` · `docs/xxx`
- Her zaman güncel `origin/main`'den aç. **main'e asla doğrudan commit yok.**

## Her PR bir issue'ya bağlanır

- İş kalemleri GitHub Issue'da yaşar (template: bug / enhancement / tech-debt).
- PR açıklamasındaki `Closes #N` satırını doldur (gerçekten bağımsızsa `N/A — standalone`).
- Squash-merge'de `Closes #N` issue'yu otomatik kapatır.

## Merge kuralı (Free planda disiplin)

- **CI yeşil olmadan merge YOK.** `ci-success` job'u tek bakışta toplu durumu verir.
- Yalnız **squash merge** (repo ayarıyla zorlanıyor) → lineer, temiz history.
- PR başlığı **conventional-commits** formatında olmalı — CI `pr-title` job'u denetler; squash-merge'de bu başlık main commit mesajı olur.
- Merge sonrası head branch **otomatik silinir** (repo ayarı) → branch çöpü kalmaz.

## Push öncesi yerel kapı

`pnpm check:all` pre-push hook'unda otomatik koşar (DB'siz, hızlı):

- `typecheck` + `lint` + `test:unit` + **`test:component`** + `format:check` + `audit:boundaries` + `audit:errors`

Yavaş kapılar yalnız CI'da koşar:

- **build** (`pnpm build` — next build + api bundle)
- **integration** testleri (Supabase gerektirir; lokalde `supabase start && pnpm check:full`)

> WIP push gerekiyorsa `git push --no-verify` ile hook atlanabilir — ama CI yine de PR üzerinde tam kapıyı çalıştırır.

## Güvenlik taraması

CI'da `gitleaks` (secret) + `pnpm audit` (bağımlılık) koşar. İlk geçişte
non-blocking (raporlama). Bulgular triaj edilip temizlendikten sonra blocking'e
çevrilecek. Native CodeQL/secret-scanning private+free planda ücretli olduğu
için OSS muadilleri kullanılıyor.

## Dependabot

- Gruplu PR'lar haftalık açılır (`.github/dependabot.yml`).
- **Biriktirme** — haftalık erit. (Ad-hoc `pnpm update` yok; gruplu PR'lar audit trail.)
- Major bump'lar tek tek; pinli major'lar için ayrı migration PR'ı (kök `CLAUDE.md` → Version Pinning & Migration Roadmap).

## Pro'ya geçilirse (gelecek)

Branch protection / ruleset açılınca `ci-success` tek **required check** olarak
işaretlenir; "require PR + linear history + force-push yasak" sunucu tarafında
zorlanır. Auto-merge de o zaman etkinleşir. O ana dek kural disiplinle yaşıyor.
