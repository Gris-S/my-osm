import { useEffect, useRef, useState } from "react";
import type { LonLat } from "../types";
import { fetchBikeOptions, fetchCycleways, type BikeProfile, type CyclewayStretch } from "../services/bikeRouting";
import { getNavRoute, type NavRoute } from "./route";
import { navText } from "./strings";
import type { TrafficSegment } from "./car/carTraffic";

// ---------------------------------------------------------------------------
// Le choix d'itinéraire à vélo, avant de partir — **comme pour la voiture**
// (demande du 29 septembre 2026) : les parcours sont tracés sur la carte, chacun
// porte sa bulle, un premier toucher le met en avant, un second lance la
// navigation.
//
// Deux propositions, « Plus rapide » et « Plus sûr » (profils `fast` et `safe`
// de `services/bikeRouting.ts`), et une seule — « Rapide et sûr » — quand les
// deux suivent les mêmes rues (`fetchBikeOptions`).
//
// Les portions sur piste ou bande cyclable sont dessinées **en vert**, sur les
// propositions comme pendant la navigation (`useCycleways`).
// ---------------------------------------------------------------------------

export interface BikeProposal {
  profile: BikeProfile;
  route: NavRoute;
  /** Vrai quand le plus rapide est aussi le plus sûr : un seul parcours. */
  merged: boolean;
}

/**
 * Les propositions, telles que `fetchBikeOptions` les retient — plus rapide
 * puis plus sûr, ou un seul parcours quand ils suivent les mêmes rues — mises
 * en forme pour la navigation. Tout est déjà en cache : pas d'appel de plus.
 */
export async function getBikeProposals(points: LonLat[], signal?: AbortSignal): Promise<BikeProposal[]> {
  const options = await fetchBikeOptions(points, signal);
  return Promise.all(
    options.map(async ({ profile, merged }) => ({
      profile,
      merged,
      route: await getNavRoute(points, signal, "cycling", profile),
    }))
  );
}

/** Le libellé de la bulle, sous la durée : ce que la proposition privilégie, et sa part de pistes. */
export function proposalDetail(proposal: BikeProposal, stretch: CyclewayStretch | undefined): string {
  const label = navText(proposal.merged ? "bike.fastAndSafe" : proposal.profile === "fast" ? "bike.fast" : "bike.safe");
  if (!stretch) return label;
  return `${label} · ${navText("bike.share", { percent: Math.round(stretch.share * 100) })}`;
}

/** Les portions vertes d'un tracé, sous la forme que la carte sait colorer. */
export function cyclewaySegments(stretch: CyclewayStretch | undefined): TrafficSegment[] {
  return (stretch?.segments ?? []).map((geometry) => ({ geometry, level: "cycleway" }));
}

/**
 * Les pistes et bandes des tracés donnés, demandées **une fois par tracé** : le
 * tracé s'affiche tout de suite, le vert le rejoint quand Valhalla a répondu
 * (un appel par tracé, à une seconde d'écart). Un échec laisse le tracé bleu.
 */
export function useCycleways(routes: NavRoute[]): Map<NavRoute, CyclewayStretch> {
  const [found, setFound] = useState<Map<NavRoute, CyclewayStretch>>(() => new Map());
  const asked = useRef(new WeakSet<NavRoute>());

  useEffect(() => {
    for (const route of routes) {
      if (asked.current.has(route)) continue;
      asked.current.add(route);
      fetchCycleways(route.points.map((p) => [p.lon, p.lat]))
        .then((stretch) => setFound((current) => new Map(current).set(route, stretch)))
        .catch(() => {
          /* pas de vert : le tracé reste bleu, ce qui n'est faux nulle part */
        });
    }
  }, [routes]);

  return found;
}
