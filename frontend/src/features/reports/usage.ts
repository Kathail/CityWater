/**
 * Per-browser tracking of report usage — favorites and last-run timestamps.
 * Stored in localStorage. Pure client state, intentionally not in the
 * database: it's a personal preference per device, not tenant data.
 *
 * Future work: when we have a `/me/preferences` endpoint, these can move
 * server-side so they follow the user across devices.
 */

import { useEffect, useState } from "react";

const FAV_KEY = "citywater.reports.favorites.v1";
const RUN_KEY = "citywater.reports.lastRun.v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    // Notify listeners in this same tab. The native "storage" event
    // only fires on *other* tabs, so we dispatch a custom one here.
    window.dispatchEvent(new CustomEvent("citywater:reports-usage"));
  } catch {
    /* localStorage unavailable (private mode, quota) — silent no-op. */
  }
}

export function useReportFavorites(): {
  favorites: Set<string>;
  toggle: (slug: string) => void;
  isFavorite: (slug: string) => boolean;
} {
  const [favorites, setFavorites] = useState<Set<string>>(
    () => new Set(read<string[]>(FAV_KEY, [])),
  );

  useEffect(() => {
    function reload() {
      setFavorites(new Set(read<string[]>(FAV_KEY, [])));
    }
    window.addEventListener("citywater:reports-usage", reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener("citywater:reports-usage", reload);
      window.removeEventListener("storage", reload);
    };
  }, []);

  return {
    favorites,
    isFavorite: (slug) => favorites.has(slug),
    toggle: (slug) => {
      const next = new Set(favorites);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      write(FAV_KEY, [...next]);
    },
  };
}

export function useReportLastRun(): {
  lastRun: Record<string, string>;
  markRun: (slug: string) => void;
} {
  const [lastRun, setLastRun] = useState<Record<string, string>>(() =>
    read<Record<string, string>>(RUN_KEY, {}),
  );

  useEffect(() => {
    function reload() {
      setLastRun(read<Record<string, string>>(RUN_KEY, {}));
    }
    window.addEventListener("citywater:reports-usage", reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener("citywater:reports-usage", reload);
      window.removeEventListener("storage", reload);
    };
  }, []);

  return {
    lastRun,
    markRun: (slug: string) => {
      const next = { ...lastRun, [slug]: new Date().toISOString() };
      write(RUN_KEY, next);
    },
  };
}
