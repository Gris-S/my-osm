import { useEffect, useMemo, useState } from "react";
import { speedLimitAt, type CarRoute } from "./carRoute";
import type { CarProgress } from "./carProgress";
import type { NavFix } from "../useNavPosition";

// ---------------------------------------------------------------------------
// Le compteur de vitesse : la vitesse du moment, la limite, l'excès — avec la
// tolérance, la protection contre le clignotement et le relevé périmé. Sorti de
// `useCarNavigation` sans rien changer.
// ---------------------------------------------------------------------------

/**
 * Tolérance avant de signaler un excès, telle que la pratique française la
 * retient : 5 km/h en dessous de 100, 5 % au-dessus.
 *
 * Elle est là pour que l'indicateur ne vire pas au rouge à chaque bosse du
 * relevé GPS — un compteur qui crie sans raison finit qu'on ne le regarde plus,
 * et c'est alors le vrai excès qui passe inaperçu.
 */
export function tolerance(limit: number, derived: boolean): number {
  const base = limit < 100 ? 5 : limit * 0.05;
  // Une vitesse déduite du déplacement, faute de mesure Doppler, se trompe de
  // quelques kilomètres-heure (mesuré : ±6,6 à 90 km/h, filtrage compris). Lui
  // appliquer la même tolérance qu'à une mesure sûre reviendrait à accuser sur
  // le bruit — mesuré aussi : neuf passages au rouge en une minute pour qui
  // longe la limite, contre zéro avec la vitesse du récepteur. On élargit donc
  // la marge au lieu de retarder l'avertissement pour tout le monde.
  return derived ? base + DERIVED_SPEED_MARGIN : base;
}

/** Marge supplémentaire, en km/h, accordée à une vitesse déduite. */
export const DERIVED_SPEED_MARGIN = 7;

/**
 * Nombre de relevés consécutifs au-dessus (ou au-dessous) avant que
 * l'indicateur ne change d'état.
 *
 * C'est l'autre moitié de la lutte contre le clignotement, et la plus utile :
 * elle vaut quelle que soit l'origine de la vitesse. Même mesurée au Doppler,
 * une vitesse qui longe la limite la franchit et la repasse plusieurs fois par
 * minute ; un compteur qui vire au rouge et en revient à chaque seconde cesse
 * d'être regardé, et c'est alors le vrai excès qui passe inaperçu.
 *
 * Deux relevés, soit environ deux secondes : assez pour ignorer un
 * franchissement passager, trop court pour retarder un avertissement utile.
 */
export const OVER_SPEED_FIXES = 2;

/**
 * Au-delà de ce silence, la vitesse affichée n'est plus celle du moment.
 *
 * Sur téléphone, `watchPosition` rend un relevé par seconde environ ; quatre
 * secondes sans rien, c'est un tunnel, un parking couvert ou une application
 * mise en veille. Le chiffre qui reste à l'écran est alors le dernier connu, et
 * **il ne doit pas se donner pour la vitesse actuelle** : un compteur figé qui
 * affiche 90 pendant qu'on ralentit est pire qu'un compteur éteint.
 */
export const SPEED_STALE_MS = 4000;

/** Ce que le compteur affiche. */
export interface SpeedState {
  /** Vitesse relevée, `null` tant que l'appareil n'en donne pas. */
  kmh: number | null;
  /** Vitesse autorisée ici, `null` hors TomTom ou là où elle n'est pas publiée. */
  limitKmh: number | null;
  /** Vrai au-delà de la limite et de sa tolérance. */
  over: boolean;
  /** Vrai quand aucun relevé n'est arrivé depuis assez longtemps pour douter. */
  stale: boolean;
}

/** L'indicateur de dépassement : son état, et les relevés d'affilée qui plaident pour en changer. */
export interface OverSpeed {
  over: boolean;
  streak: number;
}

export const NOT_OVER: OverSpeed = { over: false, streak: 0 };

/**
 * L'indicateur après un relevé. Il ne change d'état qu'après
 * `OVER_SPEED_FIXES` relevés d'affilée qui le demandent ; un relevé périmé le
 * remet à zéro — on ne reprend pas un excès là où le signal l'a laissé.
 */
export function nextOverSpeed(previous: OverSpeed, reading: { above: boolean; stale: boolean }): OverSpeed {
  if (reading.stale) return NOT_OVER;
  if (reading.above === previous.over) return previous.streak === 0 ? previous : { over: previous.over, streak: 0 };
  const streak = previous.streak + 1;
  return streak >= OVER_SPEED_FIXES ? { over: reading.above, streak: 0 } : { over: previous.over, streak };
}

/** Ce que le compteur doit afficher, relevé après relevé. */
export function useSpeedState(
  fix: NavFix | null,
  route: CarRoute | null,
  progress: CarProgress | null,
  running: boolean,
): SpeedState {
  // Le relevé devenu périmé, posé par le minuteur plus bas à l'instant exact où
  // il le devient.
  const [staleFix, setStaleFix] = useState<NavFix | null>(null);

  /**
   * Le compteur doit pâlir si les relevés cessent — et rien d'autre ne
   * provoquerait alors de nouveau rendu. **Un seul minuteur, réarmé à chaque
   * relevé**, pour l'instant exact où celui-ci deviendrait périmé : tant que le
   * GPS répond, il ne se déclenche jamais.
   *
   * Il remplace une horloge d'une seconde qui redessinait **toute
   * l'application** — ce hook vit dans `App` — une fois par seconde, en plus du
   * rendu que chaque relevé provoque déjà : le double du nécessaire, pour un
   * seul détail du compteur (mesuré en navigation : le moteur web tenait 0,7
   * cœur). Google Maps, Waze ou Plans ne redessinent de même que ce qui change.
   */
  useEffect(() => {
    if (!running || !fix) return;
    const wait = fix.at + SPEED_STALE_MS - Date.now();
    // Quelques millisecondes de marge : réveillé pile à l'échéance, le calcul
    // pourrait encore juger le relevé frais.
    const timer = window.setTimeout(() => setStaleFix(fix), Math.max(0, wait) + 50);
    return () => window.clearTimeout(timer);
  }, [running, fix]);

  // `speed` est en mètres par seconde et vaut `null` sur un appareil qui ne la
  // mesure pas (un ordinateur de bureau, par exemple).
  const kmh = fix?.speed != null && fix.speed >= 0 ? Math.round(fix.speed * 3.6) : null;
  const limitKmh = route && progress ? speedLimitAt(route, progress.traveledMeters) : null;
  const stale = fix === null || staleFix === fix;
  const above =
    !stale && kmh !== null && limitKmh !== null && kmh > limitKmh + tolerance(limitKmh, fix?.speedDerived ?? false);

  // L'indicateur avance **une fois par relevé** — ou quand celui-ci devient
  // périmé — pendant le rendu, en comparant à ce qui a déjà été compté (patron
  // « valeur du rendu précédent » de React). Il vivait dans des refs modifiées
  // par un `useMemo` : un rendu rejoué par React le faisait compter deux fois.
  const [counted, setCounted] = useState<{ fix: NavFix | null; staleFix: NavFix | null; over: OverSpeed }>({
    fix: null,
    staleFix: null,
    over: NOT_OVER,
  });
  let over = counted.over;
  if (counted.fix !== fix || counted.staleFix !== staleFix) {
    over = nextOverSpeed(counted.over, { above, stale });
    setCounted({ fix, staleFix, over });
  }

  return useMemo(() => ({ kmh, limitKmh, over: over.over, stale }), [kmh, limitKmh, over.over, stale]);
}
