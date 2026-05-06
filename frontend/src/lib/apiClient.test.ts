import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, apiJson } from "./apiClient";
import { _resetDBForTests, cacheAssetResponse } from "./offline";
import { clearMutations, listMutations } from "./offline/queue";

describe("apiClient", () => {
  beforeEach(async () => {
    document.cookie = "";
    await clearMutations().catch(() => {});
    _resetDBForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes credentials on every request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/v1/anything");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("include");
  });

  it("propagates the CSRF cookie as X-CSRFToken on mutating requests", async () => {
    document.cookie = "XSRF-TOKEN=test-token-abc";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/v1/auth/logout", { method: "POST" });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("X-CSRFToken")).toBe("test-token-abc");
  });

  it("does NOT send X-CSRFToken on GET", async () => {
    document.cookie = "XSRF-TOKEN=test-token-abc";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/v1/anything", { method: "GET" });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("X-CSRFToken")).toBeNull();
  });

  it("raises ApiError with code+message on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "bad_credentials", message: "nope" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(apiJson("/api/v1/auth/login")).rejects.toMatchObject({
      status: 401,
      code: "bad_credentials",
      message: "nope",
    });
  });

  it("ApiError instances carry status + code", () => {
    const err = new ApiError(409, "slug_taken", "taken");
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(409);
    expect(err.code).toBe("slug_taken");
  });

  describe("offline behaviour", () => {
    it("queues a mutation and returns a 202 sentinel when offline", async () => {
      vi.stubGlobal("navigator", { onLine: false });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("should not be called")),
      );
      const resp = await apiFetch("/api/v1/work-orders", {
        method: "POST",
        body: JSON.stringify({ title: "Field-logged" }),
      });
      expect(resp.status).toBe(202);
      expect(resp.headers.get("X-FlowOps-Queued")).toBe("1");
      const queued = await listMutations();
      expect(queued).toHaveLength(1);
      expect(queued[0].url).toBe("/api/v1/work-orders");
    });

    it("falls back to IDB cache for asset GETs when fetch rejects", async () => {
      vi.stubGlobal("navigator", { onLine: true });
      const url = "/api/v1/assets?bbox=-77,39,-76,40";
      await cacheAssetResponse(url, {
        items: [{ asset_uid: "HYD-1" }],
        total: 1,
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

      const resp = await apiFetch(url);
      expect(resp.status).toBe(200);
      expect(resp.headers.get("X-FlowOps-Cache")).toBe("idb");
      const body = await resp.json();
      expect(body.items[0].asset_uid).toBe("HYD-1");
    });

    it("does not enqueue when online", async () => {
      vi.stubGlobal("navigator", { onLine: true });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("{}", { status: 201 })),
      );
      await apiFetch("/api/v1/work-orders", {
        method: "POST",
        body: JSON.stringify({ title: "Live save" }),
      });
      expect(await listMutations()).toHaveLength(0);
    });

    it("rethrows when fetch fails on a non-cacheable URL", async () => {
      vi.stubGlobal("navigator", { onLine: true });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      await expect(apiFetch("/api/v1/work-orders/WO-99")).rejects.toThrow(
        "offline",
      );
    });
  });
});
