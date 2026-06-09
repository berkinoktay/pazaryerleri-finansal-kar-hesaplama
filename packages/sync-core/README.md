# @pazarsync/sync-core

Sync engine primitives shared by `apps/sync-worker` and `apps/api`: job claim,
checkpoint/cursor, the credential-crypto wrappers, the logger, the sync-log
service, `mapPrismaError`, and the sync error classes.

## Credentials

The AES-256-GCM envelope itself lives in the dependency-free leaf
`@pazarsync/crypto-core`; this package adds the env-keyed wrappers
(`encryptCredentials` / `decryptCredentials`) that read `ENCRYPTION_KEY` at
runtime. Credentials are decrypted only in-memory for the duration of an API
call — never logged, never returned in a response. `EncryptionKeyError` maps to a
500 `SERVER_CONFIG_ERROR`; `validateRequiredEnv()` catches a missing/short key at
boot, so the branch never reaches a live request in practice.

## Errors

Sync error classes carry a `code` from the `SyncErrorCode` DB enum
(`@pazarsync/db/enums`). Keep that enum, the api `problem-details` branches, and
the frontend translations in lockstep — `pnpm audit:errors` (in `check:all`)
fails on drift.

See the root `CLAUDE.md` and `docs/SECURITY.md` for the full credential rules.
