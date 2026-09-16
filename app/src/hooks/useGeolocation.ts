import { useCallback, useState } from "react";
import type { LonLat } from "../types";
import { t } from "../i18n";

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
      setState((s) => ({ ...s, error: t("geo.unsupported") }));
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
        // `err.message` est celui du navigateur : il n'est pas traduit, et il
        // varie d'une WebView à l'autre. On s'en tient au **code**, qui est
        // normalisé, et on écrit la phrase nous-mêmes.
        setState((s) => ({
          ...s,
          loading: false,
          error: t(err.code === err.PERMISSION_DENIED ? "geo.denied" : "geo.unavailable"),
        }));
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  return { ...state, locate };
}
