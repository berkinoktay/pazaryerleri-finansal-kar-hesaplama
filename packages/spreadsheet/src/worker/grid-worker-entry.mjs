// The grid worker's bootstrap: tsx registers its loader hooks only on the main thread,
// so a worker inherits none of them (neither through execArgv nor `--import tsx`).
// Registering here lets the TypeScript body and its extensionless imports load.
import { register } from 'tsx/esm/api';
register();
await import('./grid-worker.ts');
