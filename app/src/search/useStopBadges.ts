import { useEffect, useState } from "react";
import type { LineChip } from "../utils/markerImage";
import { getLinesForStops } from "../services/idfmNetwork";
import { rememberedStopLines } from "../transport/stopLinesStore";
import { capabilityAt } from "../transport/registry";
import type { SearchEntry } from "./searchResults";

// ---------------------------------------------------------------------------
// La pastille de ligne d'un arrêt proposé par la recherche.
//
// Un arrêt où passe **une seule** ligne s'affiche avec elle (RER A, bus 111) ;
// plusieurs lignes, ou une ligne inconnue : le pictogramme de transport
// générique (demande explicite).
//
// La règle vaut pour un résultat qui **réunit plusieurs arrêts** comme pour un
// arrêt seul. C'est tout l'intérêt du regroupement : « Saint-Denis - Université »
// rassemble huit quais et poteaux, mais une seule ligne les dessert tous, et
// c'est sa pastille qu'on attend. Les écarter revenait à priver de pastille
// presque toutes les stations, puisqu'une station arrive rarement seule
// (constaté le 20 septembre 2026). Les lignes sont cherchées autour du lieu
// ouvert — la station — et par nom d'arrêt, donc un seul appel par résultat.
//
// D'où vient la ligne :
//  - en Île-de-France, du référentiel ouvert d'IDFM (sans clé ni quota), déjà
//    lu par la carte pour les pastilles des arrêts ;
//  - ailleurs, des lignes déjà vues dans la fiche de l'arrêt
//    (`stopLinesStore`). Interroger Transitous pour chaque résultat coûterait
//    une requête par ligne de la liste, à chaque frappe.
// ---------------------------------------------------------------------------

/** Rayon autour de l'arrêt où chercher ses lignes dans le référentiel. */
const LOOKUP_RADIUS_M = 300;

export function useStopBadges(entries: SearchEntry[]): Map<string, LineChip> {
  const [badges, setBadges] = useState<Map<string, LineChip>>(new Map());

  const stops = entries.filter((entry) => entry.place.group === "transport");
  const key = stops.map((entry) => entry.place.id).join("|");

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const found = new Map<string, LineChip>();
    void Promise.all(
      stops.map(async ({ place }) => {
        let lines: LineChip[] | undefined = rememberedStopLines(place.id);
        if (!lines && capabilityAt(place.lon, place.lat, "stationDetails")) {
          const isBus = place.rawType === "bus_stop" || place.rawType === "bus_station";
          // Tous les poteaux du même nom : l'arrêt entier, pas un trottoir.
          const result = await getLinesForStops(
            [place],
            place,
            LOOKUP_RADIUS_M,
            isBus,
            controller.signal,
            "sameName"
          ).catch(() => null);
          lines = result?.get(place.id)?.all;
        }
        if (lines?.length === 1) found.set(place.id, lines[0]);
      })
    ).then(() => {
      if (!controller.signal.aborted) setBadges(found);
    });
    return () => controller.abort();
    // `stops` se déduit de `key` : on ne relance que si les arrêts changent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return badges;
}
