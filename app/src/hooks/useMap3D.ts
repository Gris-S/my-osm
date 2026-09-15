import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Vue 3D : caméra inclinée et bâtiments en volume.
//
// Le choix est mémorisé dans `localStorage`, comme le thème et le fond de
// carte. Par défaut la carte reste à plat : l'inclinaison élargit l'emprise
// visible, donc les requêtes Overpass, et tout le monde n'en veut pas.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "osm-local:3d";

function readStored(): boolean | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null; // localStorage indisponible (mode privé, etc.)
  }
}

export function useMap3D() {
  const [is3D, setIs3D] = useState<boolean>(() => readStored() ?? false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, is3D ? "1" : "0");
    } catch {
      /* ignore : le choix restera simplement non persisté */
    }
  }, [is3D]);

  const toggle3D = useCallback(() => setIs3D((prev) => !prev), []);

  return { is3D, setIs3D, toggle3D };
}
