import { useEffect, useState } from "react";
import { bearing, interpolate } from "./geo";
import type { NavRoute } from "./route";
import type { NavFix } from "./useNavPosition";

// ---------------------------------------------------------------------------
// Un marcheur fictif, pour vérifier le guidage sans sortir.
//
// Il n'existe **qu'en développement** : le bouton qui l'allume n'est pas rendu
// dans la version compilée, et la boucle ci-dessous refuse de partir hors
// développement — deux verrous plutôt qu'un, parce qu'une position inventée
// affichée comme une vraie serait le pire des défauts pour un guidage.
// Sans lui, il faudrait descendre dans la rue pour voir si le bandeau annonce
// la bonne rue et si le graphe avance.
// ---------------------------------------------------------------------------

/**
 * Vitesse du marcheur simulé, en m/s. Deux fois et demie l'allure réelle
 * (1,3 m/s, ≈ 4,7 km/h) : la simulation sert à voir défiler les manœuvres et
 * avancer le graphe, pas à mimer une promenade — attendre un virage en temps
 * réel n'apprend rien de plus.
 */
const SPEED = 3.25;

/** Cadence des relevés, en millisecondes : celle d'un GPS de téléphone. */
const TICK = 1000;

/**
 * Fait avancer une position fictive le long du tracé, à allure de marche.
 *
 * Elle est décalée d'un mètre ou deux au hasard : un point qui suivrait le
 * tracé au millimètre ne dirait rien du comportement réel, où la projection et
 * l'écart au parcours travaillent en permanence.
 */
export function useSimulatedPosition(route: NavRoute | null, running: boolean): NavFix | null {
  // Le relevé simulé, rangé avec le tracé qui l'a produit : arrêter la
  // simulation ou changer de tracé ne laisse pas traîner l'ancien.
  const [sample, setSample] = useState<{ route: NavRoute; fix: NavFix } | null>(null);

  useEffect(() => {
    if (!running || !route || !import.meta.env.DEV) return;
    let traveled = 0;
    const timer = window.setInterval(() => {
      traveled = Math.min(route.distanceMeters, traveled + SPEED * (TICK / 1000));
      const index = indexAt(route, traveled);
      const span = route.measures[index + 1] - route.measures[index];
      const t = span > 0 ? (traveled - route.measures[index]) / span : 0;
      const exact = interpolate(route.points[index], route.points[index + 1] ?? route.points[index], t);
      // ~2 m de flottement, l'ordre de grandeur d'un GPS de téléphone en ville.
      const jitter = 0.00002;
      setSample({ route, fix: {
        lon: exact.lon + (Math.random() - 0.5) * jitter,
        lat: exact.lat + (Math.random() - 0.5) * jitter,
        accuracy: 8,
        heading: bearing(route.points[index], route.points[Math.min(index + 1, route.points.length - 1)]),
        speed: SPEED,
        // Vitesse fabriquée, donc « mesurée » du point de vue du guidage : elle
        // n'est pas déduite de deux positions.
        speedDerived: false,
        at: Date.now(),
      } });
    }, TICK);

    return () => window.clearInterval(timer);
  }, [route, running]);

  return running && route && sample?.route === route ? sample.fix : null;
}

function indexAt(route: NavRoute, atMeters: number): number {
  let low = 0;
  let high = route.measures.length - 2;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (route.measures[middle] <= atMeters) low = middle;
    else high = middle - 1;
  }
  return Math.max(0, low);
}
