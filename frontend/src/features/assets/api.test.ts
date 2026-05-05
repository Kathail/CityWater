import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAsset, listAssets } from "./api";

describe("assets API client", () => {
  beforeEach(() => {
    document.cookie = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listAssets serializes params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], page: 1, page_size: 50, total: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listAssets({ class: "WAT_HYD", domain: "water", q: "abc", page: 2 });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("class=WAT_HYD");
    expect(url).toContain("domain=water");
    expect(url).toContain("q=abc");
    expect(url).toContain("page=2");
  });

  it("createAsset POSTs JSON with Content-Type and credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          asset_uid: "HYD-00001",
          class_code: "WAT_HYD",
          domain: "water",
          geometry: { type: "Point", coordinates: [0, 0] },
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
    vi.stubGlobal("fetch", fetchMock);

    await createAsset({
      class_code: "WAT_HYD",
      geometry: { type: "Point", coordinates: [0, 0] },
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});
