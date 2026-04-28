// Tiny structured logger for the sync engine. Uses console.log
// (Hono and the worker both write to stdout in dev/prod). Formats as
// JSON when NODE_ENV=production, pretty-prints otherwise. No deps.

export interface LogContext {
  syncLogId?: string;
  storeId?: string;
  organizationId?: string;
  syncType?: string;
  workerId?: string;
  [key: string]: unknown;
}

export type LogLevel = 'info' | 'warn' | 'error';

function emit(level: LogLevel, event: string, ctx: LogContext = {}): void {
  if (process.env['NODE_ENV'] === 'production') {
    const record = { timestamp: new Date().toISOString(), level, event, ...ctx };
    console.log(JSON.stringify(record));
    return;
  }
  const prefix = level === 'error' ? '✗' : level === 'warn' ? '!' : '·';
  const ctxStr = Object.entries(ctx)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  console.log(`${prefix} [sync] ${event}${ctxStr.length > 0 ? ' ' + ctxStr : ''}`);
}

export const syncLog = {
  info: (event: string, ctx?: LogContext): void => emit('info', event, ctx),
  warn: (event: string, ctx?: LogContext): void => emit('warn', event, ctx),
  error: (event: string, ctx?: LogContext): void => emit('error', event, ctx),
};
