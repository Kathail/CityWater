import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AssetListPage } from "./AssetListPage";

function renderList(initialUrl: string = "/acme/assets") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <Routes>
          <Route path="/:slug/assets" element={<AssetListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const FAKE_CLASSES = [
  {
    code: "WAT_HYD",
    domain: "water",
    name: "Hydrant",
    geometry_type: "Point",
    attribute_schema: {},
    default_criticality: null,
    icon: null,
    color: null,
    is_active: true,
  },
];

const FAKE_ASSETS = {
  items: [
    {
      asset_uid: "HYD-00001",
      class_code: "WAT_HYD",
      domain: "water",
      geometry: { type: "Point", coordinates: [0, 0] },
      install_date: "2020-01-01",
      decommission_date: null,
      material: "ductile iron",
      diameter_mm: 150,
      length_m: null,
      depth_m: null,
      manufacturer: null,
      model: null,
      serial_number: null,
      warranty_until: null,
      condition: 2,
      criticality: 3,
      status: "active",
      attrs: {},
      notes: null,
      created_at: "2020-01-01T00:00:00Z",
      updated_at: "2020-01-01T00:00:00Z",
    },
  ],
  page: 1,
  page_size: 50,
  total: 1,
};

describe("AssetListPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.startsWith("/api/v1/asset-classes")) {
          return Promise.resolve(
            new Response(JSON.stringify(FAKE_CLASSES), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(FAKE_ASSETS), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the table with one row", async () => {
    renderList();
    expect(screen.getByText("Assets")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("HYD-00001")).toBeInTheDocument();
    });
    expect(screen.getByText("ductile iron")).toBeInTheDocument();
  });

  it("setting class filter updates URL params and refetches", async () => {
    renderList();
    await waitFor(() => screen.getByText("HYD-00001"));

    const classSelect = screen.getByLabelText(/class/i);
    await userEvent.selectOptions(classSelect, "WAT_HYD");

    await waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      expect(calls.some((u) => String(u).includes("class=WAT_HYD"))).toBe(true);
    });
  });
});
