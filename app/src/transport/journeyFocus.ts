import { useSyncExternalStore } from "react";
import type { LonLat } from "../types";
import type { TransitJourney } from "./journeyView";

// ---------------------------------------------------------------------------
// Le trajet en transports qu'on suit — ou qu'on vient de retenir dans le
// panneau —, connu de la fiche d'un arrêt.
//
// Ouvrir la fiche de l'arrêt où l'on va monter, c'est vouloir une chose : **le
// passage qu'on prend** (demande explicite, 13 octobre 2026). La fiche alignait
// toutes les lignes de l'arrêt, la bonne parmi les autres, repliée. Elle la
// met désormais en tête, dépliée, avec l'heure du trajet.
//
// Un magasin de module, comme la langue : la fiche et le guidage sont loin
// l'un de l'autre dans l'arbre, et `App` n'a pas de contexte.
// ---------------------------------------------------------------------------

/** La montée du trajet suivi à un arrêt donné. */
export interface FollowedBoarding {
  /** L'indice de la ligne (« 111 », « A »), tel que la pastille l'écrit. */
  label: string;
  departure: Date;
  direction?: string;
}

/** Rayon dans lequel un arrêt de la carte est celui d'une montée du trajet, en mètres. */
const SAME_STOP_METERS = 200;

let followed: TransitJourney | null = null;
const listeners = new Set<() => void>();

export function setFollowedJourney(journey: TransitJourney | null): void {
  if (journey === followed) return;
  followed = journey;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Écart approché en mètres : il ne s'agit que de reconnaître un arrêt à deux cents mètres près. */
function meters(a: LonLat, b: LonLat): number {
  const x = (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  const y = (b.lat - a.lat) * 110_574;
  return Math.hypot(x, y);
}

/** La montée que `journey` prévoit à cet endroit, ou `null`. Fonction pure, testée. */
export function boardingAt(journey: TransitJourney | null, place: LonLat): FollowedBoarding | null {
  for (const leg of journey?.legs ?? []) {
    const first = leg.stops?.[0];
    if (leg.kind !== "transit" || !leg.line?.label || !first) continue;
    if (meters(place, first) <= SAME_STOP_METERS) {
      return { label: leg.line.label, departure: leg.departure, direction: leg.direction };
    }
  }
  return null;
}

/** Deux indices de ligne qui se valent : « 111 » et « 111 », « a » et « A ». */
export function sameLineLabel(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** La montée du trajet suivi à cet arrêt, tenue à jour. */
export function useFollowedBoarding(place: LonLat): FollowedBoarding | null {
  const journey = useSyncExternalStore(subscribe, () => followed, () => null);
  return boardingAt(journey, place);
}
