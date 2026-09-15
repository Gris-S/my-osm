import type { LonLat } from "../../types";
import { bearing, interpolate } from "../geo";
import { locateOnPath } from "../progress";
import type { CarRoute, CarStep } from "./carRoute";

// ---------------------------------------------------------------------------
// Où l'on en est du trajet, en voiture.
//
// Le principe est celui du guidage piéton — tout part de la projection de la
// position sur le tracé, et le localisateur est **le même** (`locateOnPath`) —
// mais trois choses diffèrent, et elles justifient un module à part :
//
// - les **seuils** ne sont pas les mêmes. Une voiture ne s'écarte pas de son
//   parcours comme un marcheur : elle est sur une chaussée, et quarante mètres
//   d'écart en voiture ne veulent pas dire « détour » mais « autre route ».
//   Réciproquement, on arrive à destination en s'arrêtant devant, pas dessus.
// - le **temps restant** se lit dans un cumul et non dans une somme d'étapes :
//   TomTom donne à chaque manœuvre le temps écoulé depuis le départ, trafic
//   compris. Il n'y a rien à additionner, seulement à soustraire.
// - la **manœuvre suivante** compte double : on annonce celle qui vient, et on
//   prépare déjà la file où se mettre pour celle d'après.
// ---------------------------------------------------------------------------

/**
 * Au-delà de cet écart au tracé, on se considère hors parcours.
 *
 * Cinquante mètres, contre quarante à pied : le relevé GPS d'une voiture est
 * plus stable — antenne dégagée, vitesse régulière — mais les échangeurs
 * superposent des chaussées séparées de quelques dizaines de mètres, et un
 * relevé qui bascule sur la bretelle voisine ne doit pas déclencher un recalcul.
 */
export const CAR_OFF_ROUTE_METERS = 50;

/**
 * Nombre de relevés consécutifs hors parcours avant de recalculer.
 *
 * Deux, contre trois à pied. À 110 km/h, trois relevés valent cent mètres de
 * plus sur la mauvaise route : le recalcul doit venir vite, et l'écart est de
 * toute façon plus franc qu'à pied — on a pris une sortie, ou on ne l'a pas.
 */
export const CAR_OFF_ROUTE_FIXES = 2;

/** En deçà de cette distance de l'arrivée, on y est. */
const ARRIVAL_METERS = 40;

export interface CarProgress {
  snapped: LonLat;
  index: number;
  traveledMeters: number;
  remainingMeters: number;
  remainingSeconds: number;
  arrivalAt: Date;
  offsetMeters: number;
  pathBearing: number;
  stepIndex: number;
  /** La manœuvre à venir et sa distance ; `null` sur la dernière étape. */
  next: { step: CarStep; distanceMeters: number } | null;
  /** Celle d'après, pour l'annoncer en second — « puis à droite ». */
  then: CarStep | null;
  arrived: boolean;
}

export function computeCarProgress(route: CarRoute, position: LonLat, from = 0): CarProgress {
  const found = locateOnPath(route, position, from);

  const traveled = Math.min(route.distanceMeters, found.measure);
  const remainingMeters = Math.max(0, route.distanceMeters - traveled);

  const stepIndex = stepAt(route, traveled);
  const nextStep = route.steps[stepIndex + 1] ?? null;

  // Le temps restant se déduit du cumul porté par les manœuvres : celui de
  // l'étape en cours, plus la part qu'il en reste à parcourir. Prorater sur la
  // distance du trajet entier serait faux dès la première agglomération —
  // trente kilomètres d'autoroute et trois de ville ne se parcourent pas à la
  // même vitesse, et le trafic accentue encore l'écart.
  const remainingSeconds = remainingTime(route, stepIndex, traveled);

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
    next: nextStep
      ? { step: nextStep, distanceMeters: Math.max(0, nextStep.atMeters - traveled) }
      : null,
    then: route.steps[stepIndex + 2] ?? null,
    arrived: remainingMeters <= ARRIVAL_METERS,
  };
}

/**
 * Le temps qu'il reste, interpolé dans l'étape en cours.
 *
 * Les manœuvres portent un temps **cumulé depuis le départ** : le restant est
 * la durée totale moins celui de l'endroit où l'on se trouve, lequel se situe
 * entre la manœuvre passée et la suivante, au prorata de la distance.
 */
function remainingTime(route: CarRoute, stepIndex: number, traveled: number): number {
  const step = route.steps[stepIndex];
  if (!step) return Math.max(0, route.durationSeconds);
  const next = route.steps[stepIndex + 1];
  const endMeters = next ? next.atMeters : route.distanceMeters;
  const endSeconds = next ? next.atSeconds : route.durationSeconds;
  const span = Math.max(1, endMeters - step.atMeters);
  const share = Math.max(0, Math.min(1, (traveled - step.atMeters) / span));
  const elapsed = step.atSeconds + (endSeconds - step.atSeconds) * share;
  return Math.max(0, route.durationSeconds - elapsed);
}

/** L'étape en cours : la dernière dont la manœuvre est derrière nous. */
function stepAt(route: CarRoute, traveled: number): number {
  let low = 0;
  let high = route.steps.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (route.steps[middle].atMeters <= traveled) low = middle;
    else high = middle - 1;
  }
  return Math.max(0, low);
}

/**
 * Le cap du tracé au point donné, lissé sur cent mètres.
 *
 * Plus loin qu'à pied (trente mètres) : à vitesse de voiture, un lissage court
 * fait osciller la carte au moindre décrochage du tracé, et c'est la direction
 * générale de la route qui intéresse le conducteur, pas celle du segment sous
 * ses roues.
 */
function bearingAt(route: CarRoute, index: number): number {
  const last = route.points.length - 1;
  if (index >= last) return last > 0 ? bearing(route.points[last - 1], route.points[last]) : 0;

  const target = route.measures[index] + 100;
  let ahead = index;
  while (ahead < last && route.measures[ahead] < target) ahead++;
  if (ahead === index) ahead = index + 1;
  return bearing(route.points[index], route.points[ahead]);
}

/** Le point du tracé à `meters` du départ, interpolé entre deux sommets. */
export function pointAtMeters(route: CarRoute, meters: number): LonLat {
  const { points, measures } = route;
  const last = points.length - 1;
  if (last <= 0 || meters <= 0) return points[0];
  if (meters >= measures[last]) return points[last];
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (measures[middle] <= meters) low = middle;
    else high = middle;
  }
  const span = measures[high] - measures[low];
  return interpolate(points[low], points[high], span > 0 ? (meters - measures[low]) / span : 0);
}

/**
 * Demi-longueur sur laquelle se prend le cap de la flèche, en mètres.
 *
 * Courte, à l'inverse de `bearingAt` (cent mètres, pour la caméra) : la flèche
 * doit épouser le trait **sous elle**, virages compris. Lissée sur cent mètres,
 * elle couperait chaque courbe et pointerait hors de la ligne.
 */
const ARROW_BEARING_SPAN = 12;

/** Le cap du tracé sous la flèche, de quelques mètres derrière à quelques mètres devant. */
export function bearingAround(route: CarRoute, meters: number): number {
  const end = route.measures[route.measures.length - 1] ?? 0;
  const behind = pointAtMeters(route, Math.max(0, Math.min(meters, end) - ARROW_BEARING_SPAN));
  const ahead = pointAtMeters(route, Math.min(end, meters + ARROW_BEARING_SPAN));
  return bearing(behind, ahead);
}

/** Vrai quand la position s'est écartée de la chaussée suivie. */
export function isOffRoute(progress: CarProgress): boolean {
  return progress.offsetMeters > CAR_OFF_ROUTE_METERS;
}
