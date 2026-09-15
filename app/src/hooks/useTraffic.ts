import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Trafic routier : événements du réseau national, et débit des routes quand une
// clé TomTom est renseignée.
//
// Même patron que `useRelief` — clé `osm-local:*` dans `localStorage`, lecture
// tolérante aux pannes. Éteint par défaut : le flux national pèse deux cents
// kilo-octets par lecture, et l'écrasante majorité des usages de cette carte
// est piétonne.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "osm-local:traffic";

function readStored(): boolean | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null; // localStorage indisponible (mode privé, etc.)
  }
}

export function useTraffic() {
  const [traffic, setTraffic] = useState<boolean>(() => readStored() ?? false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, traffic ? "1" : "0");
    } catch {
      /* ignore : le choix restera simplement non persisté */
    }
  }, [traffic]);

  const toggleTraffic = useCallback(() => setTraffic((prev) => !prev), []);

  return { traffic, toggleTraffic };
}
