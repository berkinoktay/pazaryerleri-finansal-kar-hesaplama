import { describe, it, expect } from "vitest";
import { encodeCursor, decodeCursor, CursorSortMismatchError, InvalidCursorError } from "../src/cursor";

describe("encodeCursor / decodeCursor", () => {
  it("round-trips a cursor with the same sort", () => {
    const sort = "order_date:desc";
    const values = { order_date: "2026-04-15T14:30:00Z", id: "abc-123" };
    const encoded = encodeCursor({ sort, values });
    const decoded = decodeCursor(encoded, sort);
    expect(decoded).toEqual({ sort, values });
  });

  it("throws CursorSortMismatchError when sort param differs from cursor sort", () => {
    const encoded = encodeCursor({ sort: "order_date:desc", values: { order_date: "2026-04-15T14:30:00Z", id: "abc-123" } });
    expect(() => decodeCursor(encoded, "profit:desc")).toThrow(CursorSortMismatchError);
  });

  it("throws InvalidCursorError when cursor is malformed base64", () => {
    expect(() => decodeCursor("not-valid-base64!@#", "order_date:desc")).toThrow(InvalidCursorError);
  });

  it("throws InvalidCursorError when cursor JSON is missing required fields", () => {
    const malformed = Buffer.from(JSON.stringify({ values: { id: "x" } })).toString("base64");
    expect(() => decodeCursor(malformed, "order_date:desc")).toThrow(InvalidCursorError);
  });

  it("throws InvalidCursorError when cursor version is unsupported", () => {
    const futureVersion = Buffer.from(
      JSON.stringify({ v: 99, sort: "order_date:desc", values: { order_date: "x", id: "y" } }),
    ).toString("base64");
    expect(() => decodeCursor(futureVersion, "order_date:desc")).toThrow(InvalidCursorError);
  });

  it("includes id as a deterministic tiebreaker in encoded cursor", () => {
    const encoded = encodeCursor({ sort: "order_date:desc", values: { order_date: "2026-04-15T14:30:00Z", id: "abc-123" } });
    const decoded = JSON.parse(Buffer.from(encoded, "base64").toString());
    expect(decoded.values.id).toBe("abc-123");
  });
});
