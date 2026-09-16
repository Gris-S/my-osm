import type { LonLat } from "../types";
import { bearing, interpolate, projectOnSegment } from "./geo";
import type { NavRoute, NavStep } from "./route";

// ---------------------------------------------------------------------------
// Où l'on en est du trajet.
//
// Tout part d'une projection : le point du tracé le plus proche de la position
// relevée. Il donne d'un coup l'avancement (la distance cumulée en ce point),
// l'écart au parcours (la distance qui l'en sépare) et le cap à tenir (la
// direction du tracé à cet endroit).
// ---------------------------------------------------------------------------

/** Au-delà de cet écart au tracé, on se considère hors parcours. */
export const OFF_ROUTE_METERS = 40;

/** Nombre de relevés consécutifs hors parcours avant de recalculer. */
export const OFF_ROUTE_FIXES = 3;

/** En deçà de cette distance de l'arrivée, on y est. */
export const ARRIVAL_METERS = 25;

/**
 * Combien de segments de part et d'autre du dernier point connu on inspecte.
 * Un marcheur avance de quelques mètres entre deux relevés : la fenêtre est
 * large pour absorber une perte de signal, étroite pour que deux passages au
 * même endroit — un aller-retour, une boucle — ne se confondent pas.
 */
const SEARCH_WINDOW = 400;

export interface NavProgress {
  /** La position ramenée sur le tracé. */
  snapped: LonLat;
  /** Index du point du tracé qui précède la position. */
  index: number;
  /** Distance parcourue le long du tracé, en mètres. */
  traveledMeters: number;
  remainingMeters: number;
  remainingSeconds: number;
  arrivalAt: Date;
  /** Écart entre la position relevée et le tracé. */
  offsetMeters: number;
  /** Cap du tracé à cet endroit, en degrés depuis le nord. */
  pathBearing: number;
  /** Rang de l'étape en cours dans `route.steps`. */
  stepIndex: number;
  /**
   * La manœuvre à venir et sa distance. `null` sur la toute dernière étape,
   * où il n'y a plus rien après l'arrivée.
   */
  next: { step: NavStep; distanceMeters: number } | null;
  arrived: boolean;
}

/**
 * L'avancement à partir d'une position relevée.
 *
 * `from` est l'index rendu au relevé précédent : la recherche commence autour
 * de lui. Elle repart du tracé entier si rien de convaincant ne s'y trouve —
 * on a pu couper à travers un parc et rejoindre le parcours cent mètres plus
 * loin.
 */
export function computeProgress(route: NavRoute, position: LonLat, from = 0): NavProgress {
  const found = locateOnPath(route, position, from);

  const traveled = Math.min(route.distanceMeters, found.measure);
  const remainingMeters = Math.max(0, route.distanceMeters - traveled);

  const stepIndex = stepAt(route, traveled);
  const step = route.steps[stepIndex];
  const nextStep = route.steps[stepIndex + 1] ?? null;

  // Le temps restant, étape par étape : la durée de celles qui suivent, plus
  // ce qu'il reste de celle qu'on parcourt. Le proratiser sur la **distance**
  // du trajet entier serait faux dès qu'une portion monte — OSRM donne à
  // chaque étape sa propre durée, autant s'en servir.
  const stepEnd = nextStep ? nextStep.atMeters : route.distanceMeters;
  const stepLength = Math.max(1, stepEnd - step.atMeters);
  const withinStep = Math.max(0, Math.min(1, (traveled - step.atMeters) / stepLength));
  const remainingSeconds = route.remainingAfter[stepIndex] + step.durationSeconds * (1 - withinStep);

  return {
    snapped: found.point,
    index: found.index,
    traveledMeters: traveled,
    remainingMeters,
    remainingSeconds,
    arrivalAt: new Date(Date.now() + remainingSeconds * 1000),
    offsetMeters: found.offset,
    pathBearing: bearingAt(route, found.index),
    stepIndex,
    next: nextStep ? { step: nextStep, distanceMeters: Math.max(0, nextStep.atMeters - traveled) } : null,
    arrived: remainingMeters <= ARRIVAL_METERS,
  };
}

/**
 * Le tracé du départ jusqu'à `atMeters` : ce qui a été réellement parcouru.
 *
 * C'est cette portion, et non l'itinéraire entier, qui part dans l'historique —
 * s'arrêter à mi-chemin ne doit pas enregistrer une marche qu'on n'a pas faite.
 * Le dernier point est **interpolé** à la distance exacte plutôt que pris au
 * sommet le plus proche : sur une longue ligne droite, le sommet précédent peut
 * être à cent mètres derrière.
 */
export function pathUpTo(route: NavRoute, atMeters: number): LonLat[] {
  const path: LonLat[] = [];
  for (let i = 0; i < route.points.length; i++) {
    if (route.measures[i] > atMeters) break;
    path.push(route.points[i]);
  }
  if (!path.length) return route.points.slice(0, 1);
  const last = path.length - 1;
  if (last < route.points.length - 1) {
    const span = route.measures[last + 1] - route.measures[last];
    const t = span > 0 ? (atMeters - route.measures[last]) / span : 0;
    if (t > 0) path.push(interpolate(route.points[last], route.points[last + 1], t));
  }
  return path;
}

/** Un point du tracé retrouvé sous une position relevée. */
export interface PathMatch {
  index: number;
  measure: number;
  offset: number;
  point: LonLat;
}

/**
 * Le tracé, réduit à ce qu'il faut pour s'y projeter : les points et la
 * distance cumulée en chacun d'eux.
 *
 * C'est volontairement plus pauvre que `NavRoute` — le guidage voiture a sa
 * propre forme de trajet (`car/carRoute.ts`, avec ses voies et ses vitesses) et
 * n'a aucune raison de porter des manœuvres d'OSRM pour se projeter. Les deux
 * guidages partagent ainsi le même localisateur, qui est la seule partie
 * réellement délicate de l'affaire.
 */
export interface Path {
  points: LonLat[];
  measures: number[];
}

function bestOf(a: PathMatch, b: PathMatch): PathMatch {
  return b.offset < a.offset ? b : a;
}

/**
 * La position ramenée sur le tracé : le point le plus proche, son rang et
 * l'écart qui les sépare.
 *
 * La recherche commence autour du rang trouvé au relevé précédent. Un point
 * trouvé loin du tracé dans cette fenêtre n'est peut-être que le plus proche
 * **de la fenêtre** : on relit alors le tracé entier avant de conclure à un
 * écart. C'est le seul cas où l'on paie le parcours complet, et il ne se
 * présente que hors trace.
 */
export function locateOnPath(path: Path, position: LonLat, from = 0): PathMatch {
  const best = nearest(path, position, from);
  return best.offset > OFF_ROUTE_METERS ? bestOf(best, nearest(path, position, 0, true)) : best;
}

/** Le point du tracé le plus proche, cherché dans une fenêtre ou en entier. */
function nearest(route: Path, position: LonLat, from: number, whole = false): PathMatch {
  const start = whole ? 0 : Math.max(0, from - Math.round(SEARCH_WINDOW / 4));
  const end = whole
    ? route.points.length - 1
    : Math.min(route.points.length - 1, from + SEARCH_WINDOW);

  let best: PathMatch = { index: start, measure: route.measures[start], offset: Infinity, point: route.points[start] };
  for (let i = start; i < end; i++) {
    const a = route.points[i];
    const b = route.points[i + 1];
    const projection = projectOnSegment(position, a, b);
    if (projection.offset >= best.offset) continue;
    const span = route.measures[i + 1] - route.measures[i];
    best = {
      index: i,
      measure: route.measures[i] + span * projection.t,
      offset: projection.offset,
      point: projection.point,
    };
  }
  return best;
}

/**
 * L'étape en cours : la dernière dont la manœuvre est derrière nous.
 *
 * Recherche dichotomique — la liste est triée par `atMeters`, et elle est
 * relue à chaque relevé.
 */
function stepAt(route: NavRoute, traveled: number): number {
  let low = 0;
  let high = route.steps.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (route.steps[middle].atMeters <= traveled) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * Le cap du tracé au point donné. Il est lissé sur une trentaine de mètres :
 * pris sur le seul segment courant, il sautait d'un dixième de degré à l'autre
 * au moindre décrochage du tracé, et la carte tournait sans raison.
 */
function bearingAt(route: NavRoute, index: number): number {
  const last = route.points.length - 1;
  // Sur le dernier point il n'y a plus rien devant : le cap est celui du
  // segment qu'on vient de parcourir, qui est bien la direction de l'arrivée.
  if (index >= last) return last > 0 ? bearing(route.points[last - 1], route.points[last]) : 0;

  const target = route.measures[index] + 30;
  let ahead = index;
  while (ahead < last && route.measures[ahead] < target) ahead++;
  if (ahead === index) ahead = index + 1;
  return bearing(route.points[index], route.points[ahead]);
}

/**
 * L'attente avant de retenter un recalcul raté : 5 s, puis 10, 20, 40, et une
 * minute au plus. Sans elle, hors réseau ou quand le moteur refuse les appels
 * (429), un nouveau recalcul repartait tous les deux ou trois relevés,
 * indéfiniment — des appels pour rien, et un journal rempli en moins d'une
 * heure. Un recalcul réussi remet le compte à zéro.
 */
export function rerouteRetryDelayMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(60_000, 5_000 * 2 ** (failures - 1));
}

/**
 * Délai minimal entre deux recalculs **réussis**.
 *
 * `rerouteRetryDelayMs` ne protège que de l'acharnement après un échec. Rien
 * n'empêchait en revanche d'enchaîner les recalculs qui aboutissent : un
 * parcours urbain agité — une rue barrée, un dédale de sens uniques — pouvait
 * appeler le moteur toutes les dix secondes, sur une instance publique offerte
 * (`routing.openstreetmap.de`, « usage raisonnable ») ou sur un quota mensuel.
 *
 * Trente secondes ne se sentent pas au volant : le trajet précédent reste
 * affiché et suivable pendant ce temps, exactement comme après un recalcul
 * raté. **Le contresens n'y est pas soumis** — il doit répondre tout de suite,
 * c'est sa raison d'être.
 */
export const REROUTE_MIN_GAP_MS = 30_000;
