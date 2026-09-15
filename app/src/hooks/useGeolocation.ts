import { useCallback, useState } from "react";
import type { LonLat } from "../types";

interface GeolocationState {
  position: LonLat | null;
  loading: boolean;
  error: string | null;
}

/**
 * Géolocalisation navigateur. En version APK (Capacitor), remplacer le corps
 * de `locate()` par le plugin `@capacitor/geolocation` — l'interface exposée
 * ici (position / loading / error / locate) peut rester identique.
 */
export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>({ position: null, loading: false, error: null });

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setState((s) => ({ ...s, error: "Géolocalisation non disponible sur cet appareil." }));
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState({
          position: { lon: pos.coords.longitude, lat: pos.coords.latitude },
          loading: false,
          error: null,
        });
      },
      (err) => {
        setState((s) => ({ ...s, loading: false, error: err.message || "Position indisponible." }));
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  return { ...state, locate };
}
