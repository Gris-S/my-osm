import type { Place } from "../types";
import type { Quay, RegionId, Station, TransitMode } from "./model";
import { TRANSITOUS_STOPS } from "./policy";
import type { ViewBbox } from "./tiles";

// ---------------------------------------------------------------------------
// Un marqueur par station, et pas d'arrêt en double avec OSM.
//
// Mesuré sur Transitous : 86 arrêts dans un kilomètre carré autour de Genève
// Cornavin, dont 14 quais de la seule gare ; 80 à Amsterdam Centraal, où
// plusieurs flux décrivent la même gare. Trois règles, dans cet ordre :
//
//  1. **Les quais d'une même station se réunissent** sous leur `parentId`.
//  2. **Deux stations voisines de même nom n'en font qu'une** (flux différents).
//     Le nom est comparé sans le préfixe de ville que certains flux ajoutent
//     (« Genève, Mercier ») : sans cela, toute station de Genève ressemblerait
//     à la gare « Genève ».
//  3. **Ce qu'OSM a déjà ne se redessine pas** : les arrêts des tuiles passent
//     d'abord, Transitous ne fait que combler les manques.
// ---------------------------------------------------------------------------

export interface RawStop {
  stopId: string;
  parentId?: string | null;
  name: string;
  lat: number;
  lon: number;
  modes: TransitMode[];
}

/** Mots qui ne distinguent pas une station d'une autre. */
const GENERIC_WORDS = new Set([
  "station", "gare", "bahnhof", "estacao", "estacion", "stop", "halt", "arret", "parada", "platform",
  "quai", "voie", "gleis", "track", "bus", "tram", "metro", "subway", "rail", "centre", "center", "place", "rue",
]);

function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** « Genève, Mercier » -> « Mercier » : le préfixe de ville de certains flux. */
function withoutCityPrefix(name: string): string {
  const comma = name.indexOf(",");
  return comma > 0 && comma < name.length - 1 ? name.slice(comma + 1) : name;
}

function words(name: string): string[] {
  return normalize(withoutCityPrefix(name)).split(" ").filter((word) => word.length > 2);
}

/** Vrai si deux noms désignent vraisemblablement la même station. */
export function similarNames(a: string, b: string): boolean {
  const left = words(a);
  const right = words(b);
  if (left.length === 0 || right.length === 0) return normalize(a) === normalize(b);
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  const set = new Set(longer);
  if (shorter.every((word) => set.has(word))) return true;
  return shorter.some((word) => word.length >= 4 && !GENERIC_WORDS.has(word) && set.has(word));
}

export function metersBetween(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/** Règle 1 : les quais d'une même station sous un seul objet. */
export function groupStops(stops: RawStop[], regionId: RegionId, fetchedAt: number): Station[] {
  const groups = new Map<string, RawStop[]>();
  for (const stop of stops) {
    const key = stop.parentId || stop.stopId;
    const group = groups.get(key);
    if (group) group.push(stop);
    else groups.set(key, [stop]);
  }
  const provenance = { source: "transitous", dataQuality: "scheduled" as const, fetchedAt, attribution: "transitous" };
  return [...groups.entries()].map(([key, members]) => {
    const names = new Map<string, number>();
    for (const member of members) names.set(member.name, (names.get(member.name) ?? 0) + 1);
    const name = [...names.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const id = `${regionId}:station:transitous:${key}`;
    const quays: Quay[] = members.map((member) => ({
      ...provenance,
      originIds: [member.stopId],
      id: `${regionId}:quay:transitous:${member.stopId}`,
      stationId: id,
      name: member.name,
      lat: member.lat,
      lon: member.lon,
      modes: member.modes,
    }));
    return {
      ...provenance,
      originIds: [key],
      id,
      name,
      lat: members.reduce((sum, member) => sum + member.lat, 0) / members.length,
      lon: members.reduce((sum, member) => sum + member.lon, 0) / members.length,
      modes: [...new Set(members.flatMap((member) => member.modes))],
      quays,
      lines: [],
      regionId,
    };
  });
}

/** Règle 2 : deux stations voisines de même nom, venues de flux différents, n'en font qu'une. */
export function dedupeStations(stations: Station[]): Station[] {
  const kept: Station[] = [];
  // La station la plus détaillée d'abord : c'est elle qui donne son nom et son identifiant.
  for (const station of [...stations].sort((a, b) => b.quays.length - a.quays.length)) {
    const twin = kept.find(
      (candidate) =>
        metersBetween(candidate, station) <= TRANSITOUS_STOPS.sameStationMeters && similarNames(candidate.name, station.name)
    );
    if (!twin) {
      kept.push({ ...station, quays: [...station.quays], modes: [...station.modes] });
      continue;
    }
    twin.quays.push(...station.quays);
    twin.modes = [...new Set([...twin.modes, ...station.modes])];
    twin.originIds = [...twin.originIds, ...station.originIds];
  }
  return kept;
}

const RAIL_MODES = new Set<TransitMode>(["metro", "rail", "regional-rail", "funicular", "cable", "ferry"]);

/** Préfixe des lieux venus de Transitous : la fiche interroge alors la station par son identifiant. */
export const TRANSITOUS_PLACE_PREFIX = "transitous/";

/** Une station de Transitous, dans la forme des lieux de la carte. */
export function stationToPlace(station: Station): Place {
  const rawType = station.modes.some((mode) => RAIL_MODES.has(mode))
    ? "station"
    : station.modes.includes("tram")
      ? "tram_stop"
      : "bus_stop";
  return {
    id: `${TRANSITOUS_PLACE_PREFIX}${station.originIds[0]}`,
    name: station.name,
    group: "transport",
    rawType,
    lon: station.lon,
    lat: station.lat,
    // Derrière les lieux d'OSM quand deux pastilles se disputent la place.
    rank: 600,
  };
}

/** Règle 3 : les arrêts de Transitous qu'OSM n'a pas, dans l'emprise visible. */
export function mergeTransitousStops(osmPlaces: Place[], transitous: Place[], bbox: ViewBbox): Place[] {
  if (transitous.length === 0) return osmPlaces;
  const [south, west, north, east] = bbox;
  const osmStops = osmPlaces.filter((place) => place.group === "transport");
  const known = new Set(osmPlaces.map((place) => place.id));
  const missing = transitous.filter((stop) => {
    if (known.has(stop.id)) return false;
    if (stop.lat < south || stop.lat > north || stop.lon < west || stop.lon > east) return false;
    return !osmStops.some((osm) => {
      const distance = metersBetween(osm, stop);
      return (
        distance <= TRANSITOUS_STOPS.osmNearMeters ||
        (distance <= TRANSITOUS_STOPS.osmSameNameMeters && similarNames(osm.name, stop.name))
      );
    });
  });
  return missing.length ? [...osmPlaces, ...missing] : osmPlaces;
}
