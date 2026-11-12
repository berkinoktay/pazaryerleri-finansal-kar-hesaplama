// Setup for the `unit-node` project: pure `.ts` unit tests that need neither a
// DOM nor MSW. Anything that renders React or talks HTTP belongs in a `.tsx`
// file, which runs in the happy-dom project with tests/setup.ts.

// Module-scope factories (api-client/browser, auth hooks) read these at import
// time; placeholders keep them from throwing. Same values as tests/setup.ts.
process.env['NEXT_PUBLIC_SUPABASE_URL'] ??= 'http://localhost:54321';
process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] ??= 'sb_publishable_test';

// No MSW server runs in this project. Fail loudly instead of letting a
// misclassified test reach a real socket.
globalThis.fetch = (): never => {
  throw new Error(
    'fetch() called from a node-environment unit test. Tests that make HTTP requests (MSW) or render React must be .tsx files so they run in the happy-dom project with tests/setup.ts.',
  );
};
