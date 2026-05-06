import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddAssetDialog } from "./AddAssetDialog";

const FAKE_CLASSES = [
  {
    code: "WAT_HYD",
    domain: "water",
    name: "Hydrant",
    geometry_type: "Point",
    attribute_schema: {},
    default_criticality: null,
    icon: null,
    color: "#1e88e5",
    is_active: true,
  },
  {
    code: "WAT_MAIN",
    domain: "water",
    name: "Water main",
    geometry_type: "LineString",
    attribute_schema: {},
    default_criticality: null,
    icon: null,
    color: "#1e88e5",
    is_active: true,
  },
];

function renderDialog(props: { onClose?: () => void; onCreated?: (a: unknown) => void }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AddAssetDialog
        coords={[-76.5, 39.3]}
        onClose={props.onClose ?? (() => undefined)}
        onCreated={props.onCreated ?? (() => undefined)}
      />
    </QueryClientProvider>,
  );
}

describe("AddAssetDialog", () => {
  beforeEach(() => {
    document.cookie = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("only lists Point classes (Lines/Polygons hidden)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(FAKE_CLASSES), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    renderDialog({});

    await waitFor(() => {
      const opts = screen.getAllByRole("option").map((o) => o.textContent);
      expect(opts.some((t) => t?.includes("Hydrant"))).toBe(true);
      expect(opts.some((t) => t?.includes("Water main"))).toBe(false);
    });
  });

  it("submits createAsset with class + Point geometry", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/v1/asset-classes")) {
        return Promise.resolve(
          new Response(JSON.stringify(FAKE_CLASSES), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            asset_uid: "HYD-00001",
            class_code: "WAT_HYD",
            domain: "water",
            geometry: { type: "Point", coordinates: [-76.5, 39.3] },
            install_date: null,
            decommission_date: null,
            material: null,
            diameter_mm: null,
            length_m: null,
            depth_m: null,
            manufacturer: null,
            model: null,
            serial_number: null,
            warranty_until: null,
            condition: null,
            criticality: null,
            status: "active",
            attrs: {},
            notes: null,
            created_at: "",
            updated_at: "",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const onCreated = vi.fn();
    renderDialog({ onCreated });

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /hydrant/i })).toBeInTheDocument();
    });
    await userEvent.selectOptions(screen.getByLabelText(/asset class/i), "WAT_HYD");
    await userEvent.click(screen.getByRole("button", { name: /create asset/i }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
    const postCall = fetchMock.mock.calls.find(
      (c) => c[0] === "/api/v1/assets" && (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.class_code).toBe("WAT_HYD");
    expect(body.geometry).toEqual({ type: "Point", coordinates: [-76.5, 39.3] });
  });
});
