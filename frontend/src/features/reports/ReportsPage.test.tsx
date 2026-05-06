import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportsPage } from "./ReportsPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/acme/reports"]}>
        <Routes>
          <Route path="/:slug/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const FAKE_CATALOG = [
  {
    slug: "break-history",
    title: "Main break history",
    description: "Reactive WOs categorized as main break.",
    filters: [{ name: "from", type: "date" }],
  },
  {
    slug: "wo-summary",
    title: "Work order summary",
    description: "Counts by status and category.",
    filters: [],
  },
];

describe("ReportsPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(FAKE_CATALOG), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the catalog with cards linking into each report", async () => {
    renderPage();
    expect(screen.getByText("Reports")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Main break history")).toBeInTheDocument();
    });
    expect(screen.getByText("Work order summary")).toBeInTheDocument();
    const link = screen.getByText("Main break history").closest("a");
    expect(link).toHaveAttribute("href", "/acme/reports/break-history");
  });
});
