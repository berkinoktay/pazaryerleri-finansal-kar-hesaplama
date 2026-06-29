# Library Spike Findings

**Date:** 2026-06-29
**Branch:** feature/spreadsheet-engine-core
**Purpose:** Empirically verify three high-risk library assumptions before Task 1 production code begins.
**Node version:** 25.8.1
**Spike script:** packages/spreadsheet/spike.mjs (deleted after commit)

---

## Package versions resolved

| Package            | Requested | Resolved |
| ------------------ | --------- | -------- |
| `read-excel-file`  | `9.2.0`   | `9.2.0`  |
| `write-excel-file` | `4.1.1`   | `4.1.1`  |
| `fflate`           | `^0.8.3`  | `0.8.3`  |

`fflate` pin decision for Task 1: the lockfile resolves to `0.8.3`; Task 1 may choose to use `catalog:` or pin to `"0.8.3"` explicitly — either is fine.

---

## S1: `read-excel-file/node` split API — `readSheet` + `parseSheetData`

### What was tested

1. Used `write-excel-file/node` to generate a 2-row xlsx (header + data row) as a Node.js `Buffer`.
2. Called `readSheet(buffer)` (no schema) and inspected the return value.
3. Mutated the first-row header in place.
4. Called `parseSheetData(rows, schema)` and inspected the result.

### Actual observed output

```
write-excel-file buffer length: 2824 bytes
readSheet typeof array: true
readSheet result: [["Barkod","Fiyat"],["X1",12.5]]
rows after header mutation: [["BARKOD","Fiyat"],["X1",12.5]]
parseSheetData result: {"objects":[{"code":"X1","price":12.5}]}
```

### Key API facts

- `readSheet` and `parseSheetData` ARE exported from `read-excel-file/node`. Both are named exports alongside the default `readXlsxFile`.
- `readSheet(buffer: Buffer)` returns `Promise<SheetData>` where `SheetData = (string | number | boolean | Date | null)[][]` — a plain 2D array with no schema applied. Headers appear in `rows[0]`.
- Mutating `rows[0][n]` before calling `parseSheetData` works exactly as planned (the column lookup is by header string value in row 0).
- `parseSheetData(rows, schema)` returns `{ objects: T[], errors: ParseSheetDataError[] }`. When there are no validation errors the `errors` key is omitted from the JSON serialization (empty array, but `errors` is still in the object — JSON.stringify omits it because it serializes as `[]`).
- `readSheet` accepts a Node.js `Buffer` directly. A raw `Uint8Array` (e.g., from fflate's `zipSync`) is NOT accepted — wrap it with `Buffer.from(uint8array)` first.

### Decision

**Split API confirmed. Task 6 proceeds as planned.** The two-step `readSheet` → `parseSheetData` pipeline is available and works. Guards (header normalisation, row filtering) can be applied to the raw 2D array between the two calls.

---

## S2: XXE and billion-laughs attack safety

### What was tested

Built two malicious xlsx files using fflate's `zipSync` over a minimal xlsx skeleton:

1. **Billion-laughs**: `xl/sharedStrings.xml` contains a DTD with exponential entity expansion (`&bomb;` → 10^6 × `"AAAAAAAAAA"`).
2. **External entity (XXE)**: `xl/sharedStrings.xml` contains `<!ENTITY x SYSTEM "file:///etc/hostname">`.

Both were fed to `readSheet(Buffer.from(maliciousBuf))`.

### Actual observed output

```
billion-laughs xlsx size: 1972 bytes
[xmldom error]  entity not found:&bomb;
@#[line:11,col:7]
billion-laughs readSheet succeeded in 4 ms
heap delta: 1.21 MB
result rows: [["&bomb;"]]

XXE xlsx size: 1942 bytes
[xmldom error]  entity not found:&x;
@#[line:6,col:7]
XXE readSheet succeeded in 2 ms
XXE result rows: [["&x;"]]
XXE cell value (check for hostname leak): "&x;"
```

### Key API facts

- `read-excel-file` uses `@xmldom/xmldom@0.9.10` as its XML parser.
- `@xmldom/xmldom` **does NOT expand DTD entities**. Both `&bomb;` and `&x;` are logged as `entity not found` (to stderr) and passed through literally — the DTD declaration is parsed but entity bodies are not expanded.
- **No memory blowup**: heap delta was only 1.21 MB for the billion-laughs file (file body ~1.9 KB; the 1.21 MB is normal parse overhead, not entity expansion).
- **No file-system access**: `&x;` referencing `file:///etc/hostname` was not fetched. The cell value is the literal string `"&x;"`, not the hostname.
- Timing: both attacks were absorbed in ≤ 4 ms.

### Caveat: error is logged, not thrown

`@xmldom/xmldom` prints `[xmldom error] entity not found:…` to stderr but does not throw. The caller receives the raw entity reference as a string cell value. This means **a production parser guard must strip/reject cells that contain raw entity patterns** (e.g., `/&\w+;/`) rather than relying on an exception being thrown.

### Decision

**Safe by default — no DTD expansion, no external entity fetching.** `@xmldom/xmldom` is not vulnerable to billion-laughs or file-based XXE for these inputs. However, `guards.ts` SHOULD strip or reject cell values that match `/&[a-zA-Z#]\w*;/` as a defence-in-depth measure, since the parser passes them through as literal strings rather than erroring loudly.

---

## S3: fflate streaming `Unzip` — byte ceiling

### What was tested

Built a test zip (two text entries, DEFLATE compressed, compression type 8) with `zipSync`. Streamed it through `Unzip`, accumulated a cumulative byte counter across all `ondata` callbacks, and confirmed the abort logic fires when the ceiling is crossed.

### Actual observed output

```
test zip size: 275 bytes
onfile: file-a.txt | size: 36 | compression: 8
ondata chunk for file-a.txt | chunk bytes: 36 | total so far: 36 | final: true
CEILING 30 exceeded at 36 bytes — aborting
onfile: file-b.txt | size: 25 | compression: 8
ondata chunk for file-b.txt | chunk bytes: 25 | total so far: 61 | final: true
files seen: ["file-a.txt","file-b.txt"]
total bytes accumulated before abort: 61
aborted: true
```

### Key API facts — exact shape for Task 5

```js
import { Unzip, UnzipInflate } from 'fflate';

const unzipper = new Unzip();
unzipper.register(UnzipInflate); // REQUIRED for DEFLATE (compression type 8)

unzipper.onfile = (file) => {
  // file: UnzipFile
  // file.name: string — entry path inside zip
  // file.size: number | undefined — compressed byte count (present for standard zip)
  // file.compression: number — 0 = store, 8 = DEFLATE
  file.ondata = (err, data, final) => {
    // err: Error | null
    // data: Uint8Array — decompressed chunk
    // final: boolean — true on the last chunk for this entry
  };
  file.start(); // begins decompression; MUST be called to receive ondata events
};

unzipper.push(chunk, isFinal); // pump compressed bytes in
```

### Important nuance: single-push vs chunked streaming

When the entire zip is passed to `push(data, true)` as one call, fflate processes all files **synchronously within that call**. The `resolve()` inside the ceiling check fires as a microtask, but the synchronous `onfile`/`ondata` for subsequent files still executes in the same call stack before the microtask runs. That is why file-b.txt was seen even after the ceiling was exceeded.

**For the real guard implementation (Task 5):**

- The xlsx blob will be fed to `Unzip` **in chunks** (e.g., reading from a `Buffer` in slices). When `totalBytes > CEILING`, simply stop calling `push()` — no further `ondata` events will fire.
- Alternatively, set the `aborted` flag and guard `file.start()` behind it so files discovered after the ceiling is hit are never started.
- The cumulative byte counter across all entries (not per-file) is the correct metric for a zip-bomb check.

### Decision

**Streaming Unzip confirmed. Task 5 proceeds as planned with one adjustment:** the decoder for DEFLATE (compression type 8) must be registered as `unzipper.register(UnzipInflate)` (NOT `Inflate` — that is the general-purpose inflater and does NOT implement the `UnzipDecoder` interface). This is the single non-obvious gotcha; all other aspects of the streaming API behave as documented.

---

## Summary table

| Probe | Status                  | Key finding                                                                                                                                                     |
| ----- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1    | CONFIRMED               | `readSheet` + `parseSheetData` both exported; split API works; `Buffer.from()` required for fflate-built xlsx bytes                                             |
| S2    | CONFIRMED SAFE          | `@xmldom/xmldom` neither expands DTD entities nor fetches external URIs; logs to stderr but does not throw; guard should strip raw entity refs from cell values |
| S3    | CONFIRMED (with nuance) | Streaming `Unzip` works; must `register(UnzipInflate)` for DEFLATE; ceiling abort requires chunked push, not single-buffer push                                 |
