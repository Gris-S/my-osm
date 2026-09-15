import { CONFIG, type RoadMode } from "../config";
import type { LonLat, RouteResult } from "../types";
import { t } from "../i18n";

// Chaque mode a sa propre instance OSRM (profil dédié) + le segment "profile"
// attendu dans l'URL. `routed-foot` route sur les chemins piétons et exclut
// autoroutes / voies rapides ; `routed-car` route pour la voiture.
const PROFILE: Record<RoadMode, { base: string; path: string }> = {
  driving: { base: CONFIG.OSRM_ROUTING.driving, path: "driving" },
  walking: { base: CONFIG.OSRM_ROUTING.walking, path: "walking" },
};

/** Bleu d'itinéraire, commun à la voiture et à la marche. */
const ROUTE_COLOR = "#007AFF";

interface OsrmResponse {
  code: string;
  routes: Array<{
    distance: number;
    duration: number;
    geometry: GeoJSON.LineString;
  }>;
}

/**
 * Itinéraire routier passant par les points donnés, dans l'ordre.
 *
 * Les étapes intermédiaires sont **natives dans OSRM** : les coordonnées se
 * suivent dans l'URL et le moteur rend un tracé unique qui les enchaîne, en un
 * seul appel. Il n'y a donc rien à recoudre ici, et surtout pas à additionner
 * des trajets calculés deux à deux — le moteur tient compte du sens d'arrivée
 * à chaque étape, ce qu'une somme de calculs séparés ignorerait.
 *
 * L'ordre est celui de la liste : OSRM ne réordonne pas les points (ce serait
 * `/trip`, un problème du voyageur de commerce), et c'est bien ce qu'on veut —
 * l'ordre des étapes est un choix de l'utilisateur, qu'il modifie lui-même.
 */
export async function getRoute(mode: RoadMode, points: LonLat[]): Promise<RouteResult> {
  if (points.length < 2) throw new Error(t("error.noRoute"));
  const { base, path } = PROFILE[mode];
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
  const url = `${base}/route/v1/${path}/${coords}?overview=full&geometries=geojson`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(t("error.routeFailed", { status: res.status }));
  const data: OsrmResponse = await res.json();
  if (data.code !== "Ok" || !data.routes.length) {
    throw new Error(t("error.noRoute"));
  }
  const route = data.routes[0];
  return {
    mode,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    // Un seul tronçon, à la couleur de l'itinéraire : la découpe par étape ne
    // sert qu'aux transports en commun (voir `services/transit.ts`).
    segments: [{ geometry: route.geometry, color: ROUTE_COLOR, dashed: false }],
  };
}
