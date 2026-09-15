import { useCallback, useEffect, useState } from "react";
import { CONFIG } from "../config";

// ---------------------------------------------------------------------------
// Photos de rue Mapillary : affichage de la couverture sur la carte.
//
// Même patron que `useMap3D` et `useBasemap` : une clé `osm-local:*` dans
// `localStorage`, une lecture tolérante aux pannes, et un choix qui survit au
// rechargement. Éteint par défaut : la couverture couvre les rues d'un réseau
// vert qui a sa place quand on la cherche, pas en permanence.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "osm-local:mapillary";

function readStored(): boolean | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "1" ? true : value === "0" ? false : null;
  } catch {
    return null; // localStorage indisponible (mode privé, etc.)
  }
}

/** Vrai si un jeton Mapillary est configuré. */
export function hasMapillaryToken(): boolean {
  return CONFIG.MAPILLARY_TOKEN.trim().length > 0;
}

export function useMapillary() {
  // Sans jeton, la couche ne peut rien afficher : inutile de la rallumer au
  // démarrage sur la foi d'un choix fait quand le jeton existait.
  const [mapillary, setMapillary] = useState<boolean>(() => hasMapillaryToken() && (readStored() ?? false));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mapillary ? "1" : "0");
    } catch {
      /* ignore : le choix restera simplement non persisté */
    }
  }, [mapillary]);

  const toggleMapillary = useCallback(() => setMapillary((prev) => !prev), []);

  return { mapillary, setMapillary, toggleMapillary };
}
