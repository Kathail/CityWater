import { getDB } from "./db";

const MAX_ENTRIES = 64;

export async function cacheAssetResponse(url: string, payload: unknown): Promise<void> {
  const db = await getDB();
  await db.put("assets_cache", { url, cachedAt: Date.now(), payload });

  // Trim oldest entries past the cap.
  const total = await db.count("assets_cache");
  if (total > MAX_ENTRIES) {
    const all = await db.getAll("assets_cache");
    all.sort((a, b) => a.cachedAt - b.cachedAt);
    const toDelete = all.slice(0, all.length - MAX_ENTRIES);
    for (const e of toDelete) await db.delete("assets_cache", e.url);
  }
}

export async function readAssetResponse(url: string): Promise<unknown | null> {
  const db = await getDB();
  const entry = await db.get("assets_cache", url);
  return entry ? entry.payload : null;
}

export async function clearAssetCache(): Promise<void> {
  const db = await getDB();
  await db.clear("assets_cache");
}
