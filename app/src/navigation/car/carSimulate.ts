import { useEffect, useRef, useState } from "react";
import { bearing, interpolate } from "../geo";
import type { NavFix } from "../useNavPosition";
import { speedLimitAt, type CarRoute } from "./carRoute";

// ---------------------------------------------------------------------------
// Un conducteur fictif, pour vérifier le guidage sans prendre la voiture.
//
// Comme le marcheur simulé, il n'existe **qu'en développement** : le bouton
// n'est pas rendu dans la version compilée et la boucle refuse de partir
// ailleurs. Deux verrous plutôt qu'un — une position inventée affichée comme
// une vraie serait le pire des défauts pour un guidage.
//
// ## Beaucoup plus vite qu'à pied, et pour une autre raison
//
// Le marcheur simulé avance à deux fois et demie l'allure réelle. Ici le
// facteur est de **vingt-cinq** : un trajet Paris-Lyon de quatre heures et
// demie se déroule en onze minutes, et un trajet de ville en quelques dizaines
// de secondes. C'est nécessaire pour voir défiler quarante manœuvres, deux
// péages et une poignée de radars sans y passer l'après-midi.
//
// **Mais la vitesse annoncée, elle, reste réaliste.** C'est le point à ne pas
// défaire : la position avance vingt-cinq fois trop vite, le compteur affiche
// la vitesse qu'on tiendrait vraiment sur cette route. Sans cette séparation,
// l'indicateur de vitesse afficherait trois mille kilomètres-heure et resterait
// rouge du départ à l'arrivée — c'est-à-dire qu'il ne serait pas testable, ce
// qui est précisément ce pour quoi la simulation existe.
// ---------------------------------------------------------------------------

/** De combien le temps de la simulation va plus vite que le vrai. */
const SPEED_FACTOR = 25;

/** Cadence des relevés, en millisecondes : celle d'un GPS de téléphone. */
const TICK = 1000;

/** Vitesse retenue là où la source n'en publie pas, en km/h. */
const DEFAULT_KMH = 80;

/**
 * Toutes les N secondes de simulation, le conducteur dépasse un peu.
 *
 * Ce n'est pas une facétie : l'indicateur de vitesse change de couleur au
 * dépassement, et sans excès il n'y aurait aucun moyen de vérifier qu'il le
 * fait — ni de voir à quoi il ressemble. Les excès sont réguliers pour être
 * reproductibles, et non aléatoires.
 */
const SPEEDING_EVERY = 12;
const SPEEDING_FOR = 3;

export function useSimulatedDriver(route: CarRoute | null, running: boolean): NavFix | null {
  // Le relevé simulé, rangé avec le tracé qui l'a produit : arrêter la
  // simulation ou changer de tracé ne laisse pas traîner l'ancien.
  const [sample, setSample] = useState<{ route: CarRoute; fix: NavFix } | null>(null);
  // Le temps écoulé est gardé hors du rendu : il change à chaque battement et
  // n'a rien à redessiner par lui-même.
  const tickRef = useRef(0);

  useEffect(() => {
    if (!running || !route || !import.meta.env.DEV) return;
    let traveled = 0;
    tickRef.current = 0;

    const timer = window.setInterval(() => {
      tickRef.current += 1;
      const index = indexAt(route, traveled);

      // La vitesse plausible à cet endroit : celle que la route autorise, un
      // peu en dessous — on roule rarement au ras de la limite — et au-dessus
      // par intermittence, pour faire réagir l'indicateur.
      const limit = speedLimitAt(route, traveled) ?? DEFAULT_KMH;
      const speeding = tickRef.current % SPEEDING_EVERY < SPEEDING_FOR;
      const kmh = Math.round(limit * (speeding ? 1.14 : 0.93));
      const metersPerSecond = kmh / 3.6;

      // Seule la **position** est accélérée. Le compteur, lui, reçoit la
      // vitesse réelle calculée ci-dessus.
      traveled = Math.min(
        route.distanceMeters,
        traveled + metersPerSecond * SPEED_FACTOR * (TICK / 1000)
      );

      const span = route.measures[index + 1] - route.measures[index];
      const t = span > 0 ? (traveled - route.measures[index]) / span : 0;
      const exact = interpolate(
        route.points[index],
        route.points[index + 1] ?? route.points[index],
        Math.max(0, Math.min(1, t))
      );
      // ~3 m de flottement : un GPS de voiture est plus stable qu'à pied, mais
      // il n'est pas au centimètre, et le guidage doit s'en accommoder.
      const jitter = 0.00003;
      setSample({ route, fix: {
        lon: exact.lon + (Math.random() - 0.5) * jitter,
        lat: exact.lat + (Math.random() - 0.5) * jitter,
        accuracy: 6,
        heading: bearing(
          route.points[index],
          route.points[Math.min(index + 1, route.points.length - 1)]
        ),
        speed: metersPerSecond,
        // Le conducteur simulé annonce une vitesse exacte : c'est bien une
        // mesure, pas une déduction, et l'indicateur doit se comporter comme
        // devant un vrai récepteur.
        speedDerived: false,
        at: Date.now(),
      } });
    }, TICK);

    return () => window.clearInterval(timer);
  }, [route, running]);

  return running && route && sample?.route === route ? sample.fix : null;
}

function indexAt(route: CarRoute, atMeters: number): number {
  let low = 0;
  let high = route.measures.length - 2;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (route.measures[middle] <= atMeters) low = middle;
    else high = middle - 1;
  }
  return Math.max(0, low);
}
