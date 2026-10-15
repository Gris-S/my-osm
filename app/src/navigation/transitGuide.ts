import type { LonLat } from "../types";
import type { TransitLeg } from "../transport/journeyView";
import { distance } from "./geo";
import { locateOnPath, type Path } from "./progress";
import { CONFIRM_METERS, type TransitStep } from "./transitSteps";

// ---------------------------------------------------------------------------
// Où en est-on **vraiment** dans un trajet en transports ?
//
// L'horaire dit où l'on devrait être ; le GPS, quand il répond, dit où l'on
// est. Trois règles, toutes nées du même trajet (8 octobre 2026, bus 111 à
// Bourbaki, captures à l'appui) :
//
// 1. **Un recalage par le GPS est une position, pas un décalage.** À 90 m de
//    l'arrêt, le guidage passait à « Prendre le 111 » — bien — mais rangeait
//    cela comme « avancé d'une étape à la main ». Trois minutes plus tard,
//    l'horaire avançait à son tour, le décalage s'y ajoutait, et l'on se
//    retrouvait une étape **après** la descente (`anchoredStep`).
// 2. **On n'est pas dans le bus tant qu'on est sur le trottoir.** À l'heure
//    du départ, l'horaire annonçait la descente à quelqu'un qui marchait
//    encore vers l'arrêt. Avec un relevé frais, monter demande une preuve :
//    avoir quitté l'arrêt le long de la ligne (`boardingGate`).
// 3. **Un trajet qu'on ne suit plus se recalcule**, comme en voiture
//    (demande explicite) : véhicule manqué, ou chemin quitté (`strayed`).
//
// Sous terre, sans relevé, rien de tout cela ne joue : l'horaire reste seul
// maître, comme avant. Fonctions pures, testées (`tests/transitGuide.test.ts`).
// ---------------------------------------------------------------------------

/** L'action où le GPS nous a reconnus, et ce que disait l'horaire à cet instant. */
export interface Anchor {
  index: number;
  scheduled: number;
}

/**
 * L'action en cours, horaire et recalage combinés.
 *
 * Reconnu **en avance** (arrivé tôt à l'arrêt), on y reste jusqu'à ce que
 * l'horaire nous rattrape, puis c'est lui qu'on suit — sans rien ajouter.
 * Reconnu **en retard**, on garde ce retard : l'horaire continue d'avancer,
 * une action derrière.
 */
export function anchoredStep(scheduled: number, anchor: Anchor | null): number {
  if (!anchor) return scheduled;
  return anchor.index >= anchor.scheduled
    ? Math.max(anchor.index, scheduled)
    : anchor.index + (scheduled - anchor.scheduled);
}

/** Écart à la ligne en deçà duquel on roule dessus, en mètres. */
const LINE_METERS = 150;
/** Chemin parcouru le long de la ligne au-delà duquel on a quitté l'arrêt, en mètres. */
const LEFT_STOP_METERS = 150;
/** Écart au chemin à pied au-delà duquel on ne le suit plus, en mètres. */
export const WALK_STRAY_METERS = 120;
/** Et à la ligne, une fois dedans : large, les tracés de lignes sont approximatifs. */
export const RIDE_STRAY_METERS = 400;

const paths = new WeakMap<TransitLeg, Path | null>();

/** Le tracé d'une étape, prêt pour la projection ; `null` si la source n'en donne pas. */
function pathOf(leg: TransitLeg | undefined): Path | null {
  if (!leg) return null;
  let path = paths.get(leg);
  if (path !== undefined) return path;
  const coordinates = leg.geometry?.coordinates ?? [];
  if (coordinates.length < 2) path = null;
  else {
    const points = coordinates.map(([lon, lat]) => ({ lon, lat }));
    const measures = [0];
    for (let i = 1; i < points.length; i++) measures.push(measures[i - 1] + distance(points[i - 1], points[i]));
    path = { points, measures };
  }
  paths.set(leg, path);
  return path;
}

/** Ce que la porte retient pour une ligne : a-t-on atteint son arrêt, y est-on monté. */
export interface GateMemory {
  leg: number;
  reached: boolean;
  boarded: boolean;
}

export type Hold = "waiting" | "walking";

/**
 * La porte de la montée : l'action à montrer quand l'horaire dit `index`.
 *
 * `here` est un relevé **frais et précis**, ou `null` (sous terre, GPS coupé) —
 * alors l'horaire passe tel quel. Quand il annonce la descente (on roule) :
 *
 *   - on a quitté l'arrêt le long de la ligne : on est monté, c'est noté —
 *     et si l'horaire en était encore à « monter » (véhicule en avance, ou
 *     recalage en retard), l'action rendue est la **descente** ;
 *   - on est encore à l'arrêt : `waiting`, on reste sur « Prendre le… » ;
 *   - on n'y est jamais arrivé : `walking`, on reste sur la marche ;
 *   - on y est passé puis on est ailleurs : le tracé de la ligne est sans
 *     doute imprécis, on se fie à l'horaire.
 */
export function boardingGate(
  steps: TransitStep[],
  legs: TransitLeg[],
  index: number,
  here: LonLat | null,
  memory: GateMemory | null,
): { index: number; hold: Hold | null; memory: GateMemory | null } {
  const step = steps[index];
  if (step?.kind !== "board" && step?.kind !== "alight") return { index, hold: null, memory };
  const mine: GateMemory =
    memory?.leg === step.legIndex ? { ...memory } : { leg: step.legIndex, reached: false, boarded: false };
  const board = step.kind === "board" ? step : steps[index - 1]?.kind === "board" ? steps[index - 1] : null;
  const atStop = !!here && !!board?.coord && distance(here, board.coord) <= CONFIRM_METERS;
  if (atStop) mine.reached = true;
  if (mine.boarded || !here) return { index, hold: null, memory: mine };

  const path = atStop ? null : pathOf(legs[step.legIndex]);
  const match = path ? locateOnPath(path, here) : null;
  const rolling = !!match && match.offset <= LINE_METERS && match.measure >= LEFT_STOP_METERS;
  if (step.kind === "board") {
    // Parti de l'arrêt le long de la ligne : on est dedans, avant l'horaire.
    if (rolling && mine.reached) {
      mine.boarded = true;
      return { index: index + 1, hold: null, memory: mine };
    }
    return { index, hold: null, memory: mine };
  }
  if (atStop) return { index: index - 1, hold: "waiting", memory: mine };
  if (rolling) {
    mine.boarded = true;
    return { index, hold: null, memory: mine };
  }
  if (!mine.reached && board) {
    // On marche encore : la marche d'approche, si le trajet en a une.
    const walking = steps[index - 2]?.kind === "walk" ? index - 2 : index - 1;
    return { index: walking, hold: "walking", memory: mine };
  }
  return { index, hold: null, memory: mine };
}

/** Vrai si ce relevé est hors du chemin de l'action en cours : marche quittée, autre ligne prise. */
export function strayed(steps: TransitStep[], legs: TransitLeg[], index: number, here: LonLat): boolean {
  const step = steps[index];
  if (step?.kind !== "walk" && step?.kind !== "alight") return false;
  const path = pathOf(legs[step.legIndex]);
  if (!path) return false;
  return locateOnPath(path, here).offset > (step.kind === "walk" ? WALK_STRAY_METERS : RIDE_STRAY_METERS);
}

/**
 * Où l'on est **le long des stations** d'une ligne : un rang fractionnaire dans
 * `leg.stops` — 2 à la troisième station, 2,5 à mi-chemin de la suivante.
 * C'est le point bleu de la liste des stations (demande explicite, 13 octobre
 * 2026), qui avance avec le voyageur.
 *
 * La position d'abord, quand elle tombe sur la ligne (`linePosition`). Sinon —
 * sous terre, sans relevé — l'horaire : la part du temps écoulée entre deux
 * passages. `null` si la source ne détaille pas la desserte.
 */
export function ridePosition(
  leg: TransitLeg | undefined,
  now: number,
  here: LonLat | null,
  tolerance = LINE_METERS,
): number | null {
  const stops = leg?.stops;
  if (!stops || stops.length < 2) return null;
  const last = stops.length - 1;

  const located = here ? linePosition(leg, here, tolerance) : null;
  if (located !== null) return located;

  for (let i = 0; i < last; i++) {
    const from = stops[i].at.getTime();
    const to = stops[i + 1].at.getTime();
    if (now < to) return i + (to > from ? Math.max(0, (now - from) / (to - from)) : 0);
  }
  return last;
}

/**
 * Le rang le long des stations d'après un relevé seul, ou `null` s'il tombe à
 * plus de `tolerance` mètres de la ligne. La tolérance suit la précision du
 * relevé : sous terre, la position vient souvent de la 4G du tunnel, juste à
 * 100–300 m près, et c'est elle qui avait raison le 14 octobre 2026 quand
 * l'horaire se trompait de train.
 */
export function linePosition(leg: TransitLeg | undefined, here: LonLat, tolerance = LINE_METERS): number | null {
  const stops = leg?.stops;
  const path = pathOf(leg);
  if (!stops || stops.length < 2 || !path) return null;
  const match = locateOnPath(path, here);
  if (match.offset > tolerance) return null;
  const measures = stops.map((stop) => locateOnPath(path, stop).measure);
  for (let i = 0; i < stops.length - 1; i++) {
    const span = measures[i + 1] - measures[i];
    if (match.measure < measures[i + 1] && span > 0) return i + Math.max(0, (match.measure - measures[i]) / span);
  }
  return stops.length - 1;
}

/** L'heure où l'horaire place le train au rang `position` (voir `ridePosition`). */
export function timeAtPosition(leg: TransitLeg, position: number): number | null {
  const stops = leg.stops;
  if (!stops?.length) return null;
  const i = Math.max(0, Math.min(Math.floor(position), stops.length - 1));
  const from = stops[i].at.getTime();
  const to = stops[Math.min(i + 1, stops.length - 1)].at.getTime();
  return from + (to - from) * Math.min(1, position - i);
}
