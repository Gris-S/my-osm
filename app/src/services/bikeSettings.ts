import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Les réglages du vélo : ce qui oriente le calcul d'un itinéraire à vélo, dans
// le panneau comme pendant le guidage.
//
// Un **magasin de module**, comme `navigation/settings.ts` et pour la même
// raison : la valeur est lue par la fenêtre des paramètres et par les deux
// calculs (`services/routing.ts`, `navigation/route.ts`), loin l'un de l'autre
// dans l'arbre. Il est ici et non dans `src/navigation/` parce que le panneau
// d'itinéraire en dépend aussi : retirer la navigation ne doit pas retirer le
// vélo du panneau.
// ---------------------------------------------------------------------------

export interface BikeSettings {
  /**
   * Éviter la circulation, de 0 (la route ne gêne pas) à 1 (pistes et chemins
   * d'abord). Valhalla l'exprime à l'envers : `use_roads = 1 − avoidTraffic`.
   */
  avoidTraffic: number;
  /** Éviter les côtes, de 0 (indifférent) à 1 (le plus plat possible). */
  avoidHills: number;
  /**
   * Vélo à assistance électrique : une vitesse de croisière plus haute, et des
   * côtes qui comptent moins — le moteur les monte.
   */
  electric: boolean;
  /**
   * Priorité à la sécurité : le moins de circulation possible, quel que soit le
   * curseur. En secours, BRouter prend alors son profil `safety`.
   */
  safety: boolean;
  /**
   * Autoriser le secours BRouter quand Valhalla ne répond pas. Vrai par défaut,
   * et **toujours annoncé** quand il sert ; faux, un Valhalla injoignable donne
   * une erreur plutôt qu'un autre moteur.
   */
  allowFallback: boolean;
}

const STORAGE_KEY = "osm-local:bike-settings";

export const DEFAULT_BIKE_SETTINGS: BikeSettings = {
  // Les trois quarts : on vient chercher les pistes, c'est la demande même du
  // mode vélo, sans pour autant tripler un trajet pour éviter une rue calme.
  avoidTraffic: 0.75,
  // Le milieu, qui est aussi le défaut de Valhalla.
  avoidHills: 0.5,
  electric: false,
  safety: false,
  allowFallback: true,
};

function unit(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Relecture tolérante : une valeur absente ou abîmée reprend son défaut. */
function read(): BikeSettings {
  const d = DEFAULT_BIKE_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<Record<keyof BikeSettings, unknown>>) : {};
    return {
      avoidTraffic: unit(stored.avoidTraffic, d.avoidTraffic),
      avoidHills: unit(stored.avoidHills, d.avoidHills),
      electric: flag(stored.electric, d.electric),
      safety: flag(stored.safety, d.safety),
      allowFallback: flag(stored.allowFallback, d.allowFallback),
    };
  } catch {
    return d; // localStorage indisponible (mode privé), ou JSON abîmé
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let current: BikeSettings = read();

/** Les réglages en vigueur, hors de tout composant. */
export function bikeSettings(): BikeSettings {
  return current;
}

export function setBikeSettings(patch: Partial<BikeSettings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* ignore : le choix restera simplement non persisté */
  }
  for (const listener of listeners) listener();
}

/**
 * Les réglages, avec l'abonnement : le panneau d'itinéraire recalcule le
 * parcours affiché quand on les change.
 */
export function useBikeSettings(): BikeSettings {
  return useSyncExternalStore(subscribe, bikeSettings, bikeSettings);
}
