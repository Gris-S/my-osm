import { CONFIG } from "../config";
import type { ApiKeyId } from "./apiKeys";

// ---------------------------------------------------------------------------
// « Cette clé est-elle valide ? »
//
// Chaque emplacement est vérifié par **un appel réel au service concerné**, le
// plus léger qu'il accepte. C'est la seule façon honnête de répondre : une clé
// bien formée peut être révoquée, expirée, ou souscrite à une autre API que
// celle qu'on utilise. Une vérification qui se contenterait de compter les
// caractères dirait « valide » d'une clé morte.
//
// Les codes ci-dessous ont été **mesurés**, vraie clé contre clé inventée, et
// depuis une origine d'application empaquetée (`https://localhost`) :
//
//   TomTom          200 / 401   en-tête d'origine croisée renvoyé
//   PRIM (IDFM)     200 / 401   `access-control-allow-origin: *`
//   Mapillary       200 / 400   `access-control-allow-origin: *`
//   Météo-France    200 / 401   `access-control-allow-origin: *`
// ---------------------------------------------------------------------------

export type KeyStatus =
  /** Aucune clé à cet emplacement. */
  | { kind: "empty" }
  /** Appel en cours. */
  | { kind: "checking" }
  /** Le service a accepté la clé. */
  | { kind: "valid" }
  /** Le service a refusé la clé. */
  | { kind: "invalid" }
  /** Le service n'a pas répondu : on ne sait pas, et on ne prétend pas savoir. */
  | { kind: "unreachable" };

/** Un point d'observation quelconque, pour les appels qui exigent des coordonnées. */
const PROBE = { lon: 2.3522, lat: 48.8566 };

/**
 * Vérifie une clé en interrogeant son service.
 *
 * La valeur est passée en argument plutôt que relue du magasin : on vérifie ce
 * que l'utilisateur vient de taper, avant même de l'avoir enregistré.
 */
export async function checkApiKey(
  id: ApiKeyId,
  value: string,
  signal?: AbortSignal
): Promise<KeyStatus> {
  const key = value.trim();
  if (!key) return { kind: "empty" };

  try {
    const response = await request(id, key, signal);
    if (response.ok) return { kind: "valid" };
    // 401 et 403 disent « pas vous » ; 400 est la réponse de Mapillary à un
    // jeton mal formé. Tout le reste — 429, 5xx, une panne — n'est pas un
    // verdict sur la clé, et il ne faut pas le présenter comme tel.
    if ([400, 401, 403].includes(response.status)) return { kind: "invalid" };
    return { kind: "unreachable" };
  } catch {
    // Réseau coupé, requête annulée, origine croisée refusée : on ne sait pas.
    return { kind: "unreachable" };
  }
}

function request(id: ApiKeyId, key: string, signal?: AbortSignal): Promise<Response> {
  const here = `${PROBE.lat},${PROBE.lon}`;
  switch (id) {
    case "tomtom":
      // Le plus court itinéraire qu'on puisse demander : deux points voisins.
      return fetch(
        `${CONFIG.TOMTOM_ROUTING_URL}/${here}:${PROBE.lat + 0.01},${PROBE.lon + 0.01}/json` +
          `?key=${encodeURIComponent(key)}&routeRepresentation=summaryOnly`,
        { signal }
      );

    case "idfm":
      // Un arrêt quelconque : c'est l'en-tête `apiKey` qu'on met à l'épreuve,
      // pas la réponse.
      return fetch(
        `${CONFIG.IDFM_STOP_MONITORING_URL}?MonitoringRef=${encodeURIComponent(
          "STIF:StopPoint:Q:22380:"
        )}`,
        { headers: { apiKey: key }, signal }
      );

    case "mapillary":
      // Une emprise minuscule et un seul champ : la réponse tient en trente
      // octets, et un jeton refusé rend 400 avec « Error validating application ».
      return fetch(
        `${CONFIG.MAPILLARY_GRAPH_URL}/images?fields=id&limit=1` +
          `&bbox=${PROBE.lon},${PROBE.lat},${PROBE.lon + 0.004},${PROBE.lat + 0.003}` +
          `&access_token=${encodeURIComponent(key)}`,
        { signal }
      );

    case "meteofranceApiKey":
      return fetch(CONFIG.METEOFRANCE_VIGILANCE_URL, { headers: { apikey: key }, signal });
  }
}
