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
/**
 * Se souvient qu'une position a déjà été obtenue, au moins une fois.
 *
 * C'est le seul signal fiable dont l'application dispose pour savoir qu'elle a
 * le droit de se localiser sans rien demander. L'API des permissions ne le
 * donne pas : mesurée sur appareil, elle répond « prompt » aussi bien
 * permission accordée que retirée, parce qu'elle décrit l'autorisation de
 * l'**origine web** et non celle qu'Android accorde au paquet.
 *
 * Faute de ce souvenir, le recentrage d'ouverture ne se déclenchait jamais dans
 * l'APK — le garde qui le protège attendait un « granted » qui n'arrive pas.
 * Observé sur appareil : permission accordée, position obtenue en 1,9 s au
 * bouton, et la carte restait pourtant au centre par défaut après chaque
 * rechargement.
 */
const CLE_DEJA_LOCALISE = "osm-local:geo-seen";

export function positionDejaObtenue(): boolean {
  try {
    return localStorage.getItem(CLE_DEJA_LOCALISE) === "on";
  } catch {
    return false; // localStorage indisponible (navigation privée)
  }
}

function retenirPositionObtenue(): void {
  try {
    localStorage.setItem(CLE_DEJA_LOCALISE, "on");
  } catch {
    /* le souvenir sera simplement perdu : on redemandera au bouton */
  }
}

export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>({ position: null, loading: false, error: null });

  /**
   * Efface le message d'erreur.
   *
   * Il est **latché** : sans cela, il resterait à l'écran indéfiniment. Or la
   * permission peut être accordée dans les réglages du téléphone sans que
   * l'application en soit prévenue, et un bandeau définitif finirait par mentir.
   */
  const clearError = useCallback(() => {
    setState((s) => (s.error ? { ...s, error: null } : s));
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setState((s) => ({ ...s, error: t("geo.unsupported") }));
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Une position obtenue vaut autorisation : on s'en souviendra au
        // prochain lancement, pour se recentrer sans avoir à redemander.
        retenirPositionObtenue();
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
        //
        // Le cas `TIMEOUT` mérite sa propre phrase, et c'est la mesure qui l'a
        // appris : sur la WebView Android, une permission retirée au niveau du
        // système ne produit **pas** `PERMISSION_DENIED`. L'appel reste sans
        // réponse jusqu'à notre propre délai et arrive ici en `TIMEOUT` — 10,0 s
        // mesurées, contre 1,9 s pour une position obtenue. Répondre « position
        // indisponible pour le moment » serait exact et inutile : ce qui manque
        // à l'utilisateur, c'est de savoir où aller la réactiver.
        //
        // L'API des permissions ne sert à rien pour trancher : mesurée sur
        // appareil, elle répond « prompt » aussi bien permission accordée que
        // retirée — elle décrit l'origine web, pas l'autorisation du paquet.
        const phrase =
          err.code === err.PERMISSION_DENIED
            ? "geo.denied"
            : err.code === err.TIMEOUT
              ? "geo.timeout"
              : "geo.unavailable";
        setState((s) => ({ ...s, loading: false, error: t(phrase) }));
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  return { ...state, locate, clearError };
}
