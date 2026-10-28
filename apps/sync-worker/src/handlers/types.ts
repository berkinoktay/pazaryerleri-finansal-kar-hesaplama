import type { SyncLog } from '@pazarsync/db';

export type ChunkResult =
  | {
      kind: 'continue';
      cursor: unknown;
      progress: number;
      total: number | null;
      stage: string;
    }
  | {
      kind: 'done';
      finalCount: number;
    };

export interface ModuleHandler {
  // workerId is the claim holder's id — single-chunk handlers (claims,
  // settlements) thread it into the lease-fenced heartbeat so a peer that
  // reaped a stale claim never has its writes clobbered by the old owner.
  // Chunked handlers get their heartbeat from the dispatcher's tick between
  // chunks; products also heartbeats inside its final chunk's delist pass,
  // which can run long. The other chunked handlers ignore it.
  processChunk(input: {
    syncLog: SyncLog;
    cursor: unknown | null;
    workerId: string;
  }): Promise<ChunkResult>;
}
