import { SpreadsheetFileError } from '../../src/errors';

// Error helpers shared by the engine's tests. Define them here only, never in a test file.

/** The SpreadsheetFileError `run` throws; any other error is re-thrown, and a return fails. */
export function fileErrorOf(run: () => unknown): SpreadsheetFileError {
  try {
    run();
  } catch (error) {
    if (error instanceof SpreadsheetFileError) return error;
    throw error;
  }
  throw new Error('Expected a SpreadsheetFileError');
}
