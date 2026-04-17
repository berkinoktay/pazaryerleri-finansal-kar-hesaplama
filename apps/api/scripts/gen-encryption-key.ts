// Generates a 32-byte AES-256 key, hex-encoded, for the ENCRYPTION_KEY env var.
// Printed to stdout so it can be piped into a secret manager or copied by hand;
// never write it to disk (even temporarily) to avoid leaking via shell history
// or editor backups.
//
// Usage:
//   pnpm gen:encryption-key                     (from repo root)
//   pnpm --filter @pazarsync/api gen:encryption-key
import { randomBytes } from 'node:crypto';

process.stdout.write(randomBytes(32).toString('hex') + '\n');
