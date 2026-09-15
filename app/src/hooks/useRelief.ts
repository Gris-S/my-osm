import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Relief : ombrage du terrain, et volume quand la vue 3D est allumée.
//
// Même patron que `useMap3D` — clé `osm-local:*` dans `localStorage`, lecture
// tolérante aux pannes. Éteint par défaut : les tuiles d'altitude pèsent plus
// de cent kilo-octets pièce, et une carte de ville n'a rien à en tirer.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "osm-local:relief";

function readStored(): boolean | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null; // localStorage indisponible (mode privé, etc.)
  }
}

export function useRelief() {
  const [relief, setRelief] = useState<boolean>(() => readStored() ?? false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, relief ? "1" : "0");
    } catch {
      /* ignore : le choix restera simplement non persisté */
    }
  }, [relief]);

  const toggleRelief = useCallback(() => setRelief((prev) => !prev), []);

  return { relief, toggleRelief };
}
