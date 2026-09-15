import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Choix du fond de carte : "standard" (plan vectoriel, clair ou sombre selon
// le thème) ou "satellite" (imagerie aérienne). Le choix est mémorisé dans
// `localStorage`, comme le thème.
// ---------------------------------------------------------------------------

export type Basemap = "standard" | "satellite";

const STORAGE_KEY = "osm-local:basemap";

function readStored(): Basemap | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "standard" || v === "satellite" ? v : null;
  } catch {
    return null;
  }
}

export function useBasemap() {
  const [basemap, setBasemapState] = useState<Basemap>(() => readStored() ?? "standard");

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, basemap);
    } catch {
      /* ignore : le choix restera simplement non persisté */
    }
  }, [basemap]);

  const setBasemap = useCallback((next: Basemap) => setBasemapState(next), []);
  const toggleBasemap = useCallback(
    () => setBasemapState((prev) => (prev === "satellite" ? "standard" : "satellite")),
    []
  );

  return { basemap, setBasemap, toggleBasemap };
}
