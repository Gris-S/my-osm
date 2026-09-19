import { CONFIG } from "../config";
import { t } from "../i18n";
import type { LonLat, Place } from "../types";
import { transport } from "./index";
import { stitchJourneys, toTransitJourney, type TransitJourney } from "./journeyView";
import { NoProviderError } from "./orchestrator";

// ---------------------------------------------------------------------------
// Les itinéraires en transports, quelle que soit la région.
//
// L'orchestrateur choisit la source de la région du départ ; une source qui ne
// trouve aucun trajet (hors de son réseau) laisse la main à la suivante sans
// être tenue pour en panne. Les étapes se traitent ici et non chez chaque
// source : aucun moteur interrogé ne sait router par des points de passage.
// ---------------------------------------------------------------------------

/** Ce qu'on dit quand aucune source n'a pu répondre. */
function messageFor(error: NoProviderError): string {
  // L'erreur de la source la mieux placée est déjà rédigée pour l'utilisateur
  // (clé refusée, quota atteint…).
  const failed = error.attempts.find((attempt) => attempt.outcome === "failed");
  if (failed?.error) return failed.error;
  if (error.attempts.some((attempt) => attempt.outcome === "skipped-key")) return t("error.transitNoKey");
  return t("error.transitUnavailable");
}

/**
 * Un tronçon : les trajets proposés entre deux points, au départ de `at`
 * (maintenant s'il est omis), triés par heure d'arrivée. Une liste vide veut
 * dire « aucun trajet en transports ici », pas une panne.
 */
/**
 * Un point du parcours tel que le calcul le reçoit : ses coordonnées, et la
 * station qu'il désigne quand c'en est une (voir `JourneyOptions.toStation`).
 */
export type JourneyPoint = LonLat & { station?: Place };

async function journeysBetween(from: JourneyPoint, to: JourneyPoint, at: Date | undefined, signal?: AbortSignal): Promise<TransitJourney[]> {
  const orchestrator = transport();
  orchestrator.updatePosition(from.lon, from.lat);
  try {
    const { value } = await orchestrator.run(
      "journeys",
      (provider, attemptSignal) =>
        provider.planJourney?.(
          [from.lon, from.lat],
          [to.lon, to.lat],
          {
            at: at?.getTime(),
            maxResults: CONFIG.TRANSIT_MAX_RESULTS,
            fromStation: from.station,
            toStation: to.station,
          },
          attemptSignal
        ),
      signal,
      { accept: (journeys) => journeys.length > 0 }
    );
    return value.map(toTransitJourney);
  } catch (error) {
    if (error instanceof NoProviderError) throw new Error(messageFor(error));
    throw error;
  }
}

/**
 * Trajets en transports en commun le long d'un parcours, au départ de
 * maintenant. `points` va du départ à l'arrivée, étapes comprises.
 *
 * **Sans étape**, une liste de propositions parmi lesquelles choisir. **Avec
 * étapes**, un calcul par tronçon, chacun partant de l'arrivée du précédent, et
 * le meilleur de chacun est retenu : le résultat est alors **un seul trajet**,
 * et non un choix — comparer les combinaisons de trois propositions sur cinq
 * tronçons n'aurait ni sens à lire ni un coût d'appels tenable. C'est ce coût
 * qui justifie le plafond `CONFIG.MAX_WAYPOINTS`.
 *
 * Un tronçon sans solution rend une liste vide pour le parcours entier — il
 * n'y a pas de demi-trajet à proposer.
 */
export async function loadJourneys(points: JourneyPoint[], signal?: AbortSignal): Promise<TransitJourney[]> {
  if (points.length < 2) return [];
  if (points.length === 2) return journeysBetween(points[0], points[1], undefined, signal);

  const parts: TransitJourney[] = [];
  // Séquentiel par nécessité : on ne peut pas demander le tronçon suivant avant
  // de savoir à quelle heure on arrive au point de passage.
  let at: Date | undefined;
  for (let index = 0; index < points.length - 1; index++) {
    const leg = await journeysBetween(points[index], points[index + 1], at, signal);
    if (!leg.length) return [];
    parts.push(leg[0]);
    at = leg[0].arrival;
  }
  return [stitchJourneys(parts)];
}
