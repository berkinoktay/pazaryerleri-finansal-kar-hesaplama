import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";

import { useOrganizations } from "@/features/organization/hooks/use-organizations";
import { createTestQueryClient } from "../../helpers/render";
import { server, http, HttpResponse } from "../../helpers/msw";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe("useOrganizations", () => {
  it("returns organizations on success", async () => {
    const { result } = renderHook(() => useOrganizations(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toMatchObject({
      id: "00000000-0000-0000-0000-000000000001",
      name: "Test Organization",
      slug: "test-org",
    });
  });

  it("returns an error when the API responds 500", async () => {
    // Override the default handler for this test only
    server.use(
      http.get("http://localhost:3001/v1/organizations", () => {
        return HttpResponse.json(
          {
            type: "https://api.pazarsync.com/errors/internal",
            title: "Internal Server Error",
            status: 500,
            code: "INTERNAL_ERROR",
            detail: "Something went wrong",
          },
          { status: 500 },
        );
      }),
    );

    const { result } = renderHook(() => useOrganizations(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/500|INTERNAL_ERROR/);
  });
});
