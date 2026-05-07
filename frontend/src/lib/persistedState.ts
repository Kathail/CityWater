import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/**
 * `useState` that mirrors itself into localStorage so user toggles
 * (map layers, list filters, expanded panels) survive a refresh or
 * cold-start visit. Falls back to the supplied initial value on
 * first render or when the stored payload can't be deserialized.
 *
 * Set/Map need explicit (de)serializers because JSON.stringify drops
 * their entries — see `setSerde` below for the idiomatic helper.
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
  serializer?: { serialize: (v: T) => string; deserialize: (s: string) => T },
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === null) return initial;
      return serializer ? serializer.deserialize(stored) : (JSON.parse(stored) as T);
    } catch {
      return initial;
    }
  });

  // Skip the first run — value === initial, nothing to persist. Without
  // this, the very first render writes the initial value over a stored
  // value the constructor *just chose to ignore* on a deserialize error.
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    try {
      const s = serializer ? serializer.serialize(value) : JSON.stringify(value);
      window.localStorage.setItem(key, s);
    } catch {
      // Quota exceeded, private mode, etc. The in-memory state is still
      // authoritative — silently drop the persistence write. We don't
      // want a logging dependency here.
    }
  }, [key, value, serializer]);

  return [value, setValue];
}

/** Idiomatic Set<string> serde for usePersistedState. */
export const setSerde = {
  serialize: (s: Set<string>) => JSON.stringify([...s]),
  deserialize: (s: string) => new Set<string>(JSON.parse(s) as string[]),
};
