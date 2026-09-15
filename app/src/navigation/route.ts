import { CONFIG } from "../config";
import type { LonLat, RouteResult } from "../types";
import { distance } from "./geo";
import { navText } from "./strings";

// ---------------------------------------------------------------------------
// Le trajet à guider : le même OSRM que `services/routing.ts`, mais interrogé
// avec `steps=true`.
//
// `services/routing.ts` ne demande qu'un tracé et une durée — c'est tout ce
// qu'un panneau d'itinéraire montre. Le guidage a besoin des **manœuvres** :
// où tourner, dans quel sens, dans quelle rue. Elles ne coûtent qu'un
// paramètre de plus sur le même appel, mais elles changent la forme de la
// réponse, d'où ce module à part plutôt qu'une option dans l'autre.
//
// Le tracé rendu ici est **recomposé à partir des étapes** et non repris de
// `geometry` : c'est la garantie que la ligne dessinée sur la carte et celle
// sur laquelle on mesure l'avancement sont exactement la même. Deux tracés
// voisins mais distincts feraient tomber la position entre les deux.
// ---------------------------------------------------------------------------

/** Bleu d'itinéraire, celui de `services/routing.ts`. */
const ROUTE_COLOR = "#007AFF";

/**
 * Une manœuvre, telle qu'OSRM la décrit. Les champs sont gardés **bruts** :
 * la phrase est fabriquée au rendu (`maneuverText`), de sorte qu'un changement
 * de langue redessine l'instruction au lieu de la figer au calcul.
 */
export interface NavManeuver {
  /** Type OSRM : `depart`, `turn`, `new name`, `roundabout`, `arrive`… */
  type: string;
  /** Modificateur OSRM : `left`, `slight right`, `straight`, `uturn`… */
  modifier?: string;
  /** Numéro de sortie d'un rond-point, quand OSRM le donne. */
  exit?: number;
  /** Nom de la voie **empruntée après** la manœuvre ; vide si elle n'en a pas. */
  name: string;
  /**
   * Rang du point de passage atteint, pour une arrivée intermédiaire. `null`
   * pour toutes les autres manœuvres, y compris l'arrivée finale.
   */
  waypoint: number | null;
}

export interface NavStep {
  maneuver: NavManeuver;
  /** Distance depuis le départ à laquelle la manœuvre s'exécute, en mètres. */
  atMeters: number;
  /** Longueur de l'étape qui suit la manœuvre. */
  distanceMeters: number;
  durationSeconds: number;
  location: LonLat;
}

export interface NavRoute {
  /** Le tracé, point par point. */
  points: LonLat[];
  /** Distance cumulée depuis le départ pour chacun de ces points. */
  measures: number[];
  /** Les manœuvres, dans l'ordre, la dernière étant l'arrivée. */
  steps: NavStep[];
  /**
   * Durée du trajet restant à partir de chaque étape, sommée d'avance : c'est
   * elle qui donne le temps restant sans reparcourir la liste à chaque relevé.
   */
  remainingAfter: number[];
  distanceMeters: number;
  durationSeconds: number;
  /** Le trajet sous la forme que `MapView` sait déjà dessiner. */
  result: RouteResult;
}

interface OsrmStep {
  distance: number;
  duration: number;
  name: string;
  geometry: GeoJSON.LineString;
  maneuver: {
    type: string;
    modifier?: string;
    exit?: number;
    location: [number, number];
  };
}

interface OsrmStepsResponse {
  code: string;
  routes: Array<{
    distance: number;
    duration: number;
    legs: Array<{ steps: OsrmStep[] }>;
  }>;
}

/**
 * Demande à OSRM le trajet à pied passant par ces points, manœuvres comprises.
 *
 * Les points de passage restent natifs : OSRM enchaîne les coordonnées dans une
 * seule URL et rend un tronçon (`leg`) par couple. Il n'y a donc qu'un appel,
 * quel que soit le nombre d'étapes.
 */
export async function getNavRoute(points: LonLat[], signal?: AbortSignal): Promise<NavRoute> {
  if (points.length < 2) throw new Error(navText("nav.errorNoRoute"));
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
  const url =
    `${CONFIG.OSRM_ROUTING.walking}/route/v1/walking/${coords}` +
    `?overview=full&geometries=geojson&steps=true`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(navText("nav.errorService", { status: String(res.status) }));
  const data: OsrmStepsResponse = await res.json();
  if (data.code !== "Ok" || !data.routes.length) throw new Error(navText("nav.errorNoRoute"));

  return buildRoute(data.routes[0]);
}

/**
 * Recompose le trajet à partir des étapes de tous les tronçons.
 *
 * Deux étapes consécutives partagent leur point de jonction, et le `depart`
 * d'un tronçon répète l'`arrive` du précédent : les points confondus sont
 * écartés à l'assemblage, faute de quoi le tracé porterait des segments de
 * longueur nulle sur lesquels aucune projection n'a de sens.
 */
function buildRoute(route: OsrmStepsResponse["routes"][number]): NavRoute {
  const points: LonLat[] = [];
  const measures: number[] = [];
  const steps: NavStep[] = [];
  let traveled = 0;

  const lastLeg = route.legs.length - 1;

  route.legs.forEach((leg, legIndex) => {
    leg.steps.forEach((step) => {
      const type = step.maneuver.type;
      // **Toutes** les étapes sont gardées, y compris le `depart` d'un tronçon
      // qui n'est pas le premier. Il paraît redondant avec l'arrivée au point de
      // passage qui le précède — même endroit, même instant — mais il porte la
      // géométrie et la durée de tout ce qui suit : l'écarter amputerait le
      // tracé d'une portion et le temps restant d'autant.
      //
      // Les deux manœuvres tombent alors à la même distance, et c'est voulu :
      // avant le point de passage, c'est l'arrivée qui est annoncée ; une fois
      // franchi, `stepAt` retient la dernière des deux, c'est-à-dire le départ
      // du tronçon suivant.
      const isFinalArrival = type === "arrive" && legIndex === lastLeg;
      const waypoint = type === "arrive" && !isFinalArrival ? legIndex + 1 : null;

      steps.push({
        maneuver: {
          type,
          modifier: step.maneuver.modifier,
          exit: step.maneuver.exit,
          name: step.name ?? "",
          waypoint,
        },
        atMeters: traveled,
        distanceMeters: step.distance,
        durationSeconds: step.duration,
        location: { lon: step.maneuver.location[0], lat: step.maneuver.location[1] },
      });

      for (const [lon, lat] of step.geometry.coordinates) {
        const point = { lon, lat };
        const previous = points[points.length - 1];
        // Le point de jonction entre deux étapes est écrit par les deux : on
        // ne le garde qu'une fois.
        if (previous && previous.lon === lon && previous.lat === lat) continue;
        if (previous) traveled += distance(previous, point);
        points.push(point);
        measures.push(traveled);
      }
    });
  });

  // Un tracé d'un seul point n'a ni segment ni direction : rien à projeter,
  // rien à guider. Mieux vaut le dire que rendre un guidage qui n'avance pas.
  if (points.length < 2 || steps.length < 2) throw new Error(navText("nav.errorNoRoute"));

  // Durée du trajet restant après chaque étape, sommée depuis la fin.
  const remainingAfter = new Array<number>(steps.length).fill(0);
  for (let i = steps.length - 2; i >= 0; i--) {
    remainingAfter[i] = remainingAfter[i + 1] + steps[i + 1].durationSeconds;
  }

  return {
    points,
    measures,
    steps,
    remainingAfter,
    // La distance mesurée sur le tracé recomposé, et non celle qu'annonce
    // OSRM : c'est sur celle-là que l'avancement est calculé, les deux doivent
    // s'accorder au mètre près.
    distanceMeters: traveled,
    durationSeconds: route.duration,
    result: {
      mode: "walking",
      distanceMeters: traveled,
      durationSeconds: route.duration,
      segments: [
        {
          geometry: { type: "LineString", coordinates: points.map((p) => [p.lon, p.lat]) },
          color: ROUTE_COLOR,
          dashed: false,
        },
      ],
    },
  };
}
