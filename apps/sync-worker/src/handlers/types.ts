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
  processChunk(input: { syncLog: SyncLog; cursor: unknown | null }): Promise<ChunkResult>;
}
