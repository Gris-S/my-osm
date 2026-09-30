import { CONFIG } from "../config";
import { t } from "../i18n";
import { authorizeUrl, codeFromRedirect, exchangeCode, makePkce, OsmError } from "./osmEdit";
import { osmClientId, setOsmToken } from "./osmContrib";
import { hasInAppBrowser, openAuthBrowser } from "./webSearch";

// ---------------------------------------------------------------------------
// Se connecter à OpenStreetMap — une seule fois : le jeton n'expire pas.
//
// Deux chemins, selon ce que l'appareil permet :
// - **APK** : la page d'OSM s'ouvre dans le navigateur intégré, et l'adresse
//   de retour (`REDIRECT_APP`, `http://127.0.0.1/…`) n'est pas ouverte mais
//   rendue à l'application, qui y lit le code (demande explicite : rien à
//   recopier) ;
// - **navigateur et version Docker** : l'application ne sait pas à quelle
//   adresse elle est servie, et OSM n'accepte qu'une adresse de retour
//   déclarée d'avance. OSM affiche donc le code (`REDIRECT_OOB`), à recopier
//   dans la fenêtre.
// ---------------------------------------------------------------------------

export type LoginStart =
  | { kind: "done" }
  | { kind: "cancelled" }
  /** Navigateur : OSM s'est ouvert dans un onglet, le code se recopie. */
  | { kind: "needsCode"; finish: (code: string) => Promise<void> };

export async function startOsmLogin(): Promise<LoginStart> {
  const clientId = osmClientId();
  if (!clientId) throw new OsmError("osm.error.noClientId");
  const { verifier, challenge } = makePkce();

  if (hasInAppBrowser()) {
    const redirect = CONFIG.OSM_EDIT.REDIRECT_APP;
    const back = await openAuthBrowser(authorizeUrl(clientId, challenge, redirect), redirect, t("osm.login.browserHint"));
    if (!back) return { kind: "cancelled" };
    const result = codeFromRedirect(back, redirect);
    if (!result) return { kind: "cancelled" };
    if ("error" in result) {
      if (result.error === "access_denied") return { kind: "cancelled" };
      // L'adresse de retour n'est pas déclarée dans l'application enregistrée.
      throw new OsmError(result.error === "invalid_redirect_uri" ? "osm.error.redirect" : "osm.error.http", result.error);
    }
    setOsmToken(await exchangeCode(clientId, result.code, verifier, redirect));
    return { kind: "done" };
  }

  const redirect = CONFIG.OSM_EDIT.REDIRECT_OOB;
  window.open(authorizeUrl(clientId, challenge, redirect), "_blank", "noopener,noreferrer");
  return {
    kind: "needsCode",
    finish: async (code: string) => {
      setOsmToken(await exchangeCode(clientId, code, verifier, redirect));
    },
  };
}
