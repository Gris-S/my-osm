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
