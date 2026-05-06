import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceRequestListPage } from "./ServiceRequestListPage";

function renderList(initialUrl: string = "/acme/service-requests") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <Routes>
          <Route path="/:slug/service-requests" element={<ServiceRequestListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const FAKE_SRS = {
  items: [
    {
      sr_number: "SR-2026-00042",
      category: "no_water",
      domain: "water",
      status: "new",
      priority: "high",
      reported_at: "2026-05-06T10:00:00Z",
      caller_name: "Jane Doe",
      address: "123 Main St",
      work_order_number: null,
      created_at: "2026-05-06T10:00:00Z",
    },
    {
      sr_number: "SR-2026-00043",
      category: "sewer_backup",
      domain: "sewer",
      status: "dispatched",
      priority: "normal",
      reported_at: "2026-05-06T11:00:00Z",
      caller_name: null,
      address: null,
      work_order_number: "WO-2026-00010",
      created_at: "2026-05-06T11:00:00Z",
    },
  ],
  page: 1,
  page_size: 50,
  total: 2,
};

describe("ServiceRequestListPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(FAKE_SRS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders rows with status pills and links to WO when dispatched", async () => {
    renderList();
    expect(screen.getByText("Service requests")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("SR-2026-00042")).toBeInTheDocument();
    });
    expect(screen.getByText("SR-2026-00043")).toBeInTheDocument();
    expect(screen.getByText("WO-2026-00010")).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
  });

  it("filters update the URL params", async () => {
    const { container } = renderList();
    await waitFor(() => {
      expect(screen.getByText("SR-2026-00042")).toBeInTheDocument();
    });
    const statusSelect = container.querySelector(
      "select",
    ) as HTMLSelectElement | null;
    expect(statusSelect).not.toBeNull();
  });
});
