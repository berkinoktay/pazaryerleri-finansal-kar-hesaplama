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

// ANSI escape codes — minimal set, only used in pretty-mode TTY output.
// Production JSON output never carries them (JSON consumers like
// log-aggregators would have to strip the bytes). Pipes / file redirects
// also skip them: we gate on `process.stdout.isTTY` so `worker > log.txt`
// produces a clean text file.
const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
} as const;

const LEVEL_STYLE: Record<LogLevel, { glyph: string; color: string }> = {
  info: { glyph: '·', color: ANSI.cyan },
  warn: { glyph: '!', color: ANSI.yellow },
  error: { glyph: '✗', color: ANSI.red },
};

function colorsEnabled(): boolean {
  // Honor NO_COLOR (https://no-color.org/) and FORCE_COLOR conventions.
  if (process.env['NO_COLOR'] !== undefined && process.env['NO_COLOR'] !== '') return false;
  if (process.env['FORCE_COLOR'] !== undefined && process.env['FORCE_COLOR'] !== '') return true;
  return process.stdout.isTTY === true;
}

function emit(level: LogLevel, event: string, ctx: LogContext = {}): void {
  if (process.env['NODE_ENV'] === 'production') {
    const record = { timestamp: new Date().toISOString(), level, event, ...ctx };
    console.log(JSON.stringify(record));
    return;
  }
  const ctxStr = Object.entries(ctx)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');

  if (!colorsEnabled()) {
    const { glyph } = LEVEL_STYLE[level];
    console.log(`${glyph} [sync] ${event}${ctxStr.length > 0 ? ' ' + ctxStr : ''}`);
    return;
  }

  // Glyph + level + event are colored by severity; context is dimmed so
  // it reads as supporting detail rather than competing with the event.
  const { glyph, color } = LEVEL_STYLE[level];
  const head = `${color}${glyph} [sync] ${ANSI.bold}${event}${ANSI.reset}`;
  const tail = ctxStr.length > 0 ? ` ${ANSI.dim}${ctxStr}${ANSI.reset}` : '';
  console.log(`${head}${tail}`);
}

export const syncLog = {
  info: (event: string, ctx?: LogContext): void => emit('info', event, ctx),
  warn: (event: string, ctx?: LogContext): void => emit('warn', event, ctx),
  error: (event: string, ctx?: LogContext): void => emit('error', event, ctx),
};
