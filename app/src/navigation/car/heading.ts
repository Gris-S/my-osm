// ---------------------------------------------------------------------------
// Le sens de marche face au tracé : rouler à contresens se voit au cap.
//
// Sorti de `useCarNavigation` en fonctions pures, pour être testé : c'est la
// règle qui, au départ, fait comprendre en deux relevés qu'on part à droite
// quand le moteur proposait la gauche — là où il fallait quarante-cinq secondes
// à attendre de s'écarter de cinquante mètres.
// ---------------------------------------------------------------------------

/**
 * Écart entre le cap et le tracé au-delà duquel on roule **à contresens**, en
 * degrés. Cent vingt, pas quatre-vingt-dix : un virage serré pris au moment
 * d'un relevé peut approcher l'équerre sans qu'on se trompe de sens.
 */
export const WRONG_WAY_DEGREES = 120;

/** Relevés consécutifs à contresens avant de recalculer. */
export const WRONG_WAY_FIXES = 2;

/**
 * Avancement sur le tracé qui dément le contresens, en mètres : qui progresse
 * le long du parcours n'est pas parti dans l'autre sens, quel que soit son cap
 * dans un rond-point ou un lacet.
 */
export const WRONG_WAY_PROGRESS_METERS = 5;

/** Le plus petit angle entre deux caps, de 0 à 180. */
export function angleBetween(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** Les relevés à contresens accumulés, et l'avancement au premier d'entre eux. */
export interface WrongWayStreak {
  fixes: number;
  fromMeters: number;
}

export const NO_STREAK: WrongWayStreak = { fixes: 0, fromMeters: 0 };

/**
 * Un relevé de plus : où en est la série, et faut-il recalculer ?
 *
 * - `gpsHeading` : le cap du récepteur, `null` s'il n'est pas fiable (à l'arrêt).
 * - `routeBearing` : le cap du tracé sous la position.
 * - `offRoute` : hors du parcours, c'est la règle de l'écart qui s'applique.
 */
export function nextWrongWay(
  streak: WrongWayStreak,
  input: { gpsHeading: number | null; routeBearing: number; traveledMeters: number; offRoute: boolean },
): { streak: WrongWayStreak; reroute: boolean } {
  const against =
    input.gpsHeading !== null &&
    !input.offRoute &&
    angleBetween(input.gpsHeading, input.routeBearing) > WRONG_WAY_DEGREES;
  if (!against) return { streak: NO_STREAK, reroute: false };

  const next = {
    fixes: streak.fixes + 1,
    fromMeters: streak.fixes === 0 ? input.traveledMeters : streak.fromMeters,
  };
  // On avance sur le tracé : un rond-point, un lacet, pas un contresens.
  if (input.traveledMeters - next.fromMeters > WRONG_WAY_PROGRESS_METERS) return { streak: NO_STREAK, reroute: false };
  return next.fixes >= WRONG_WAY_FIXES ? { streak: NO_STREAK, reroute: true } : { streak: next, reroute: false };
}

// ---------------------------------------------------------------------------
// Le cap de la caméra : la carte ne tourne que quand la voiture tourne.
//
// À moins de sept kilomètres-heure, le cap du récepteur ne vaut rien, et la
// caméra prenait à sa place la direction du tracé **cent mètres devant**. Vingt
// mètres avant un virage — là où l'on freine, justement, et où l'on s'arrête au
// stop ou au feu — ces cent mètres sont déjà dans la rue suivante : la carte
// pivotait d'un quart de tour avant la voiture, la flèche se retrouvait de
// travers, et « tournez à gauche » se lisait comme un tout-droit (constaté le
// 3 octobre 2026, à l'arrêt sur un pont, vingt mètres avant de tourner).
//
// La règle, dans l'ordre :
//  1. on roule : le cap du récepteur ;
//  2. on vient de ralentir ou de s'arrêter : le dernier cap du récepteur,
//     **tenu** tant que la flèche n'a pas avancé de `HELD_BEARING_METERS` — la
//     voiture regarde toujours du même côté ;
//  3. on se traîne au-delà (bouchon dans une courbe) ou l'on n'a jamais roulé :
//     le cap du tracé **sous la flèche**, celui que la flèche montre elle-même ;
//  4. rien de tout cela (hors parcours, jamais roulé) : on ne touche à rien.
// ---------------------------------------------------------------------------

/** Avancée de la flèche, en mètres, au-delà de laquelle un cap tenu ne vaut plus. */
export const HELD_BEARING_METERS = 15;

/** Le cap de la caméra, d'où il vient, et où était la flèche quand il a été pris. */
export interface CameraBearing {
  bearing: number;
  /** Vrai s'il vient du récepteur : lui seul se tient à l'arrêt. */
  fromGps: boolean;
  /** Avancement de la flèche sur le tracé à ce moment ; `null` hors parcours ou après un recalcul. */
  atMeters: number | null;
}

/**
 * Un relevé de plus : vers où tourner la carte.
 *
 * - `gpsHeading` : le cap du récepteur, `null` s'il n'est pas fiable (lent, arrêté).
 * - `routeBearing` : le cap du tracé sous la flèche, `null` hors parcours.
 * - `meters` : l'avancement de la flèche sur le tracé, `null` hors parcours.
 */
export function nextCameraBearing(
  held: CameraBearing | null,
  input: { gpsHeading: number | null; routeBearing: number | null; meters: number | null },
): CameraBearing | null {
  if (input.gpsHeading !== null) return { bearing: input.gpsHeading, fromGps: true, atMeters: input.meters };
  if (held?.fromGps) {
    // Hors parcours, rien ne dit mieux que le dernier cap mesuré.
    if (input.meters === null) return held;
    // Repère perdu (recalcul, retour sur le tracé) : on le reprend ici, sans tourner.
    if (held.atMeters === null) return { ...held, atMeters: input.meters };
    if (Math.abs(input.meters - held.atMeters) < HELD_BEARING_METERS) return held;
  }
  if (input.routeBearing !== null) return { bearing: input.routeBearing, fromGps: false, atMeters: input.meters };
  return held;
}
