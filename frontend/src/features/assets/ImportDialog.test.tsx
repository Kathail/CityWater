import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportDialog } from "./ImportDialog";

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ImportDialog onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

describe("ImportDialog", () => {
  beforeEach(() => {
    document.cookie = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits multipart with file + conflict mode and renders summary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          summary: { created: 5, updated: 1, skipped: 2, failed: 0 },
          errors: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderDialog();

    const file = new File(["class_code,asset_uid,lon,lat\nWAT_HYD,,1,2\n"], "in.csv", {
      type: "text/csv",
    });
    await userEvent.upload(screen.getByLabelText(/file/i), file);
    await userEvent.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Import complete/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Created: 5/)).toBeInTheDocument();
    expect(screen.getByText(/Skipped: 2/)).toBeInTheDocument();

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    // Don't pre-set Content-Type when body is FormData — browser fills boundary
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBeNull();
  });

  it("expands per-row errors when present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            summary: { created: 0, updated: 0, skipped: 0, failed: 1 },
            errors: [{ row: 2, code: "unknown_class", message: "unknown class_code: NOPE" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    renderDialog();
    const file = new File(["class_code\nNOPE\n"], "in.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText(/file/i), file);
    await userEvent.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Failed: 1/)).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText(/1 error — show/i));
    expect(screen.getByText(/unknown_class/)).toBeInTheDocument();
    expect(screen.getByText(/row 2/)).toBeInTheDocument();
  });
});
