import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDBForTests } from "./db";
import {
  clearMutations,
  drainQueue,
  enqueueMutation,
  listMutations,
  queueCounts,
  subscribeQueue,
} from "./queue";

beforeEach(async () => {
  // Wipe any state from a previous test before resetting the singleton.
  await clearMutations().catch(() => {});
  _resetDBForTests();
  // Each test gets a fresh fake-IDB context.
  // fake-indexeddb's `auto` import resets DB connections per test file but
  // not per test; the singleton reset above ensures `getDB` re-opens.
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("offline mutation queue", () => {
  it("enqueueMutation persists records with status='queued'", async () => {
    await enqueueMutation({
      method: "POST",
      url: "/api/v1/work-orders",
      body: JSON.stringify({ title: "Fix it" }),
      contentType: "application/json",
    });
    const all = await listMutations();
    expect(all).toHaveLength(1);
    expect(all[0].method).toBe("POST");
    expect(all[0].status).toBe("queued");
    expect(all[0].body).toContain("Fix it");
  });

  it("queueCounts reports queued / conflict / failed buckets", async () => {
    await enqueueMutation({
      method: "POST",
      url: "/api/v1/work-orders",
      body: "{}",
      contentType: "application/json",
    });
    await enqueueMutation({
      method: "PATCH",
      url: "/api/v1/work-orders/WO-1",
      body: "{}",
      contentType: "application/json",
    });
    const counts = await queueCounts();
    expect(counts.queued).toBe(2);
    expect(counts.conflict).toBe(0);
  });

  it("drainQueue replays queued mutations and removes successes", async () => {
    await enqueueMutation({
      method: "POST",
      url: "/api/v1/work-orders",
      body: JSON.stringify({ title: "Hello" }),
      contentType: "application/json",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 201 }),
      ),
    );

    const result = await drainQueue();
    expect(result.replayed).toBe(1);
    expect(result.remaining).toBe(0);
    expect(await listMutations()).toHaveLength(0);
  });

  it("drainQueue marks 4xx replies as conflict and keeps the entry", async () => {
    await enqueueMutation({
      method: "POST",
      url: "/api/v1/work-orders",
      body: "{}",
      contentType: "application/json",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("conflict body", { status: 409 }),
        ),
    );

    const result = await drainQueue();
    expect(result.replayed).toBe(0);
    expect(result.conflict).toBe(1);
    const remaining = await listMutations();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].status).toBe("conflict");
    expect(remaining[0].errorStatus).toBe(409);
  });

  it("drainQueue keeps 5xx entries queued for the next attempt", async () => {
    await enqueueMutation({
      method: "POST",
      url: "/api/v1/work-orders",
      body: "{}",
      contentType: "application/json",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("oops", { status: 503 })),
    );

    await drainQueue();
    const remaining = await listMutations();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].status).toBe("queued");
    expect(remaining[0].attempts).toBe(1);
  });

  it("subscribeQueue notifies on enqueue", async () => {
    const fn = vi.fn();
    const unsub = subscribeQueue(fn);
    // initial notify
    await new Promise((r) => setTimeout(r, 0));
    fn.mockClear();
    await enqueueMutation({
      method: "POST",
      url: "/api/v1/x",
      body: "{}",
      contentType: "application/json",
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(fn).toHaveBeenCalled();
    expect(fn.mock.calls.at(-1)?.[0]).toEqual({
      queued: 1,
      conflict: 0,
      failed: 0,
    });
    unsub();
  });
});
