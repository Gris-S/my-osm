import { useEffect, useMemo, useState } from "react";
import type { LonLat } from "../../types";
import { getCarRoutes, hasLiveEngine, type CarRoute, type CarRouteOptions } from "./carRoute";

// ---------------------------------------------------------------------------
// Le temps de trajet **avec la circulation**, annoncé avant de partir.
//
// Le panneau d'itinéraire affichait la durée d'OSRM, qui ignore le trafic ;
// l'écran de choix, lui, affiche celle de TomTom, qui le connaît. Mesuré sur un
// Louvre → Bastille de 2,8 km, un midi de semaine :
//
//   OSRM                                    10,8 min
//   TomTom, route vide                       9,8 min   (les deux sont d'accord)
//   TomTom, trafic en cours                 24,6 min   ← ce qu'on va réellement mettre
//   dont retard d'incidents                  8,6 min   (deux bouchons, 235 s et 283 s)
//
// Les deux moteurs s'accordent sur la route vide : l'écart n'était pas une
// erreur, c'était la circulation. Mais annoncer 10 min puis 24 au départ n'est
// pas défendable — c'est le même trajet, à la même seconde.
//
// **Le calcul n'est pas ajouté, il est avancé.** Le départ demandait déjà ce
// parcours à TomTom (`proposals.ts`, appel « le meilleur et ses rechanges ») :
// le panneau le demande maintenant en premier, et le départ **réutilise le même
// résultat** par ce cache. Un départ coûte donc toujours ses trois appels, pas
// quatre.
//
// **Le signal d'annulation de l'appelant n'est volontairement pas transmis.**
// Fermer le panneau ne doit pas interrompre une requête dont le départ, une
// seconde plus tard, aura besoin : le travail est partagé, pas possédé. Chaque
// appelant ignore simplement une réponse qui ne l'intéresse plus.
// ---------------------------------------------------------------------------

/**
 * Durée de validité d'un calcul. Deux minutes : au-delà, le trafic annoncé
 * n'est plus celui de maintenant, et c'est précisément ce qu'on est venu
 * chercher. En deçà, regarder le panneau puis appuyer sur « Démarrer » ne doit
 * rien coûter de plus.
 */
const FRESH_MS = 120_000;

/** Quelques parcours au plus : on compare deux ou trois destinations, pas trente. */
const MAX_ENTRIES = 4;

/**
 * Nombre de rechanges demandées. **Le même que `proposals.ts`**, sans quoi les
 * deux appels porteraient des clés différentes et le partage ne jouerait pas —
 * c'est toute la raison d'être de ce module.
 */
export const ETA_ALTERNATIVES = 3;

interface Entry {
  at: number;
  routes: Promise<CarRoute[]>;
}

const cache = new Map<string, Entry>();

function keyOf(points: LonLat[], options: CarRouteOptions): string {
  const path = points.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
  return `${path}|${options.alternatives ?? 0}|${options.avoidTolls ? "sans-péage" : "péage"}`;
}

/**
 * Le calcul TomTom d'un parcours, partagé entre le panneau et le départ.
 *
 * Une demande identique déjà en vol est rendue telle quelle ; une réponse de
 * moins de deux minutes est resservie. Un échec n'est pas gardé — insister a un
 * sens quand le réseau revient.
 */
export function cachedCarRoutes(points: LonLat[], options: CarRouteOptions = {}): Promise<CarRoute[]> {
  const key = keyOf(points, options);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.routes;

  // Sans `signal` : voir l'en-tête. Le travail survit à celui qui l'a demandé.
  const { signal: _ignored, ...shared } = options;
  const routes = getCarRoutes(points, shared);
  cache.set(key, { at: Date.now(), routes });
  void routes.catch(() => cache.delete(key));

  // La plus ancienne entrée part : le cache accompagne une session de choix, il
  // ne garde pas l'historique des trajets.
  if (cache.size > MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return routes;
}

/**
 * Le parcours TomTom du trajet en cours d'examen, ou `null`.
 *
 * `null` sans clé TomTom — le panneau garde alors la durée d'OSRM, qui est tout
 * ce qu'on sait — et tant que la réponse n'est pas là : le panneau affiche
 * d'abord OSRM, instantané, puis se corrige. Aucune attente n'est imposée à
 * l'ouverture.
 *
 * Le résultat est rangé **avec la clé qui l'a produit** et n'est rendu que si
 * elle est encore celle du moment : changer de destination ne doit pas laisser
 * une seconde l'ancienne durée sous la nouvelle adresse. C'est le patron du
 * projet — aucun `setState` en tête d'effet.
 */
export function useCarEta(points: LonLat[] | null, active: boolean): CarRoute | null {
  const key = points && active && hasLiveEngine() ? keyOf(points, { alternatives: ETA_ALTERNATIVES }) : null;
  const [state, setState] = useState<{ key: string; route: CarRoute | null }>({ key: "", route: null });

  // Les points sont figés sur la clé : elle les encode entièrement, et en
  // dépendre directement relancerait l'effet à chaque rendu (un tableau neuf à
  // chaque fois). Même patron que `stopMarkers` dans `useItinerary`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => points, [key]);

  useEffect(() => {
    if (!key || !stable) return;
    let cancelled = false;
    cachedCarRoutes(stable, { alternatives: ETA_ALTERNATIVES })
      .then((routes) => {
        if (!cancelled) setState({ key, route: routes[0] ?? null });
      })
      .catch(() => {
        // Service injoignable : le panneau garde la durée d'OSRM. Un temps sans
        // le trafic vaut mieux que pas de temps du tout.
      });
    return () => {
      cancelled = true;
    };
  }, [key, stable]);

  return key !== null && state.key === key ? state.route : null;
}
