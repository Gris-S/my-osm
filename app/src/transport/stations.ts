import type { Place } from "../types";
import type { LineChip } from "../utils/markerImage";
import { toLineDepartures, type LineDepartures } from "./departuresView";
import { transport } from "./index";
import type { StationRef } from "./model";

// ---------------------------------------------------------------------------
// Ce que l'interface demande à propos d'une station : ses départs, les lignes
// qui la desservent, le tracé d'une ligne. Tout passe par l'orchestrateur, qui
// choisit la source de la région où se trouve la station.
// ---------------------------------------------------------------------------

/** La station touchée sur la carte, en référence canonique. */
export function stationRefFromPlace(place: Place): StationRef {
  return {
    id: `station:${place.id}`,
    name: place.name,
    lat: place.lat,
    lon: place.lon,
    origin: { placeId: place.id, rawType: place.rawType },
  };
}

/** La région suit la station consultée : ce sont ses fournisseurs qui répondent. */
function orchestratorAt(place: Place) {
  const orchestrator = transport();
  orchestrator.updatePosition(place.lon, place.lat);
  return orchestrator;
}

/** Les départs d'une station, et la source qui les a donnés (pour le dire sous les horaires). */
export async function loadDepartures(
  place: Place,
  signal?: AbortSignal,
  options: { fresh?: boolean } = {}
): Promise<{ lines: LineDepartures[]; source: string }> {
  const station = stationRefFromPlace(place);
  const { value, providerId } = await orchestratorAt(place).run(
    "departures",
    (provider, attemptSignal) => provider.getDepartures?.(station, { fresh: options.fresh }, attemptSignal),
    signal,
    // Une source officielle qui ne connaît pas l'arrêt laisse la main à la suivante.
    { accept: (groups) => groups.length > 0 }
  );
  return { lines: toLineDepartures(value, Date.now()), source: providerId };
}

/** Les lignes déclarées à la station, pour signaler celles qui ne répondent pas. */
export async function loadStationLines(place: Place, signal?: AbortSignal): Promise<LineChip[]> {
  const station = stationRefFromPlace(place);
  const { value } = await orchestratorAt(place).run(
    "stationDetails",
    (provider, attemptSignal) => provider.getStationDetails?.(station, attemptSignal),
    signal
  );
  return value.lines.map((line) => ({ label: line.shortName, color: line.color ?? "#5856D6", textColor: line.textColor ?? "#ffffff" }));
}

/** Le tracé d'une ligne, dans la région active ; `null` s'il n'est pas publié. */
export async function loadLineShape(lineId: string, signal?: AbortSignal): Promise<GeoJSON.Geometry | null> {
  const { value } = await transport().run("shapes", (provider, attemptSignal) => provider.getLineShape?.({ lineId }, attemptSignal), signal);
  if (!value) return null;
  return value.type === "LineString"
    ? { type: "LineString", coordinates: value.coordinates as GeoJSON.Position[] }
    : { type: "MultiLineString", coordinates: value.coordinates as GeoJSON.Position[][] };
}
