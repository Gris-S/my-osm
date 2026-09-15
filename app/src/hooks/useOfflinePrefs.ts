import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Réglages de comportement des téléchargements.
//
// Même patron que les autres réglages persistés : clé `osm-local:*` dans
// `localStorage`, lecture tolérante aux pannes (mode privé), valeurs inconnues
// écartées à la relecture.
// ---------------------------------------------------------------------------

export interface OfflinePrefs {
  /** Télécharger en wifi uniquement — dans la mesure du détectable. */
  wifiOnly: boolean;
  /** Suspendre quand la connexion se coupe, reprendre à son retour. */
  pauseOffline: boolean;
}

const KEY = "osm-local:offline-prefs";

const DEFAULTS: OfflinePrefs = {
  wifiOnly: false,
  pauseOffline: true,
};

function read(): OfflinePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<OfflinePrefs>;
    return {
      wifiOnly: typeof parsed.wifiOnly === "boolean" ? parsed.wifiOnly : DEFAULTS.wifiOnly,
      pauseOffline:
        typeof parsed.pauseOffline === "boolean" ? parsed.pauseOffline : DEFAULTS.pauseOffline,
    };
  } catch {
    return DEFAULTS;
  }
}

export function useOfflinePrefs() {
  const [prefs, setPrefs] = useState<OfflinePrefs>(read);

  const update = useCallback((patch: Partial<OfflinePrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* mode privé : le réglage vaut pour la session */
      }
      return next;
    });
  }, []);

  return { prefs, update };
}
