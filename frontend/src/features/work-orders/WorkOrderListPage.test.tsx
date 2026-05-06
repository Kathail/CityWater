import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { WorkOrderListPage } from "./WorkOrderListPage";

function renderList(initialUrl: string = "/acme/work-orders") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <Routes>
          <Route path="/:slug/work-orders" element={<WorkOrderListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const FAKE_WOS = {
  items: [
    {
      wo_number: "WO-2026-00001",
      type: "reactive",
      category: "repair",
      priority: "high",
      status: "open",
      title: "Fix the leak",
      asset_uid: "HYD-00042",
      assigned_to: null,
      crew_id: null,
      due_by: null,
      created_at: "2026-05-05T00:00:00Z",
    },
  ],
  page: 1,
  page_size: 50,
  total: 1,
};

describe("WorkOrderListPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(FAKE_WOS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the table with one row in list view", async () => {
    renderList();
    expect(screen.getByText("Work orders")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("WO-2026-00001")).toBeInTheDocument();
    });
    expect(screen.getByText("Fix the leak")).toBeInTheDocument();
    expect(screen.getByText("HYD-00042")).toBeInTheDocument();
  });

  it("kanban view renders the column headers", async () => {
    renderList("/acme/work-orders?view=kanban");
    await waitFor(() => {
      expect(screen.getByText("Open")).toBeInTheDocument();
    });
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("On hold")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });
});
