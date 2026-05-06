import { type DBSchema, type IDBPDatabase, openDB } from "idb";

/**
 * IDB schema for the field PWA's offline state.
 *
 * - `mutations`: queued non-GET requests, drained on `online` events.
 * - `assets_cache`: snapshot of GET /api/v1/assets responses keyed by full
 *   URL (so bbox/class/q permutations are independently cached). Lets the
 *   Asset list + Map render the last-seen view while offline.
 * - `meta`: scalar key/value (last drain time, schema version notes, etc.).
 */
export type MutationStatus = "queued" | "in_flight" | "conflict" | "failed";

export interface QueuedMutation {
  id?: number;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  url: string;
  body: string | null;
  contentType: string | null;
  enqueuedAt: number;
  attempts: number;
  status: MutationStatus;
  // Last error message + status code, populated after a failed replay.
  errorMessage?: string;
  errorStatus?: number;
}

export interface AssetCacheEntry {
  url: string;
  cachedAt: number;
  payload: unknown;
}

interface FlowOpsDB extends DBSchema {
  mutations: {
    key: number;
    value: QueuedMutation;
    indexes: { byStatus: MutationStatus };
  };
  assets_cache: {
    key: string;
    value: AssetCacheEntry;
  };
  meta: {
    key: string;
    value: unknown;
  };
}

const DB_NAME = "flowops-offline";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<FlowOpsDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<FlowOpsDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FlowOpsDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("mutations")) {
          const store = db.createObjectStore("mutations", {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("byStatus", "status");
        }
        if (!db.objectStoreNames.contains("assets_cache")) {
          db.createObjectStore("assets_cache", { keyPath: "url" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta");
        }
      },
    });
  }
  return dbPromise;
}

// Test-only: reset the singleton so a fresh fake-IDB can be used.
export function _resetDBForTests(): void {
  dbPromise = null;
}
