import { getDepartures, type TransitMode as IdfmMode } from "../../services/idfm";
import { getLineShape, getStopLines } from "../../services/idfmNetwork";
import { getJourneysBetween } from "../../services/transit";
import type { Place } from "../../types";
import type { TransitJourney, TransitLeg } from "../journeyView";
import type {
  DepartureGroup,
  Journey,
  JourneyLeg,
  LineRef,
  Position,
  Shape,
  Station,
  StationRef,
  TransitMode,
} from "../model";
import type { ProviderFactory } from "../orchestrator";

// ---------------------------------------------------------------------------
// Adaptateur Île-de-France Mobilités (rang 1 à Paris).
//
// **Il reprend tel quel le code qui tourne** — `services/idfm.ts` (temps réel
// SIRI Lite, résolution de la zone d'arrêt, groupement par terminus, cache de
// 30 s) et `services/idfmNetwork.ts` (lignes déclarées, tracés) — et se contente
// de traduire vers le modèle canonique. Les règles mesurées qui y sont décrites
// (poteau pour le bus, zone pour le ferré, `ref:FR:STIF` écarté…) restent donc
// les mêmes à l'octet près : c'est la condition de non-régression de Paris.
// ---------------------------------------------------------------------------

const ATTRIBUTION = "idfm";
const LINE_PREFIX = "paris:line:IDFM:";

const MODES: Record<IdfmMode, TransitMode> = {
  metro: "metro",
  rer: "regional-rail",
  train: "rail",
  tram: "tram",
  bus: "bus",
  other: "other",
};

/** Le lieu de la carte, dans la forme qu'attend `services/idfm.ts`. */
function toPlace(station: StationRef): Place {
  return {
    id: station.origin?.placeId ?? station.id,
    name: station.name,
    group: "transport",
    rawType: station.origin?.rawType,
    lon: station.lon,
    lat: station.lat,
  };
}

export function idfmLineId(canonical: string): string | null {
  return canonical.startsWith(LINE_PREFIX) ? canonical.slice(LINE_PREFIX.length) : null;
}

/** Mode commercial de Navitia (« Métro », « RER », « Train Transilien »…) -> mode canonique. */
function modeFromLabel(label: string): TransitMode {
  if (/m[ée]tro/i.test(label)) return "metro";
  if (/\brer\b/i.test(label)) return "regional-rail";
  if (/tram/i.test(label)) return "tram";
  if (/funi/i.test(label)) return "funicular";
  if (/c[âa]ble/i.test(label)) return "cable";
  if (/bus|navette|noctilien/i.test(label)) return "bus";
  if (/train|transilien|ter\b/i.test(label)) return "rail";
  return "other";
}

/** `line:IDFM:C01742` -> `C01742`, la clé du référentiel ouvert. */
const navitiaLineKey = (lineId: string) => lineId.replace(/^line:IDFM:/, "");

function toCanonicalLeg(leg: TransitLeg, fetchedAt: number): JourneyLeg {
  const first = leg.stops?.[0];
  const last = leg.stops?.[leg.stops.length - 1];
  return {
    source: "idfm",
    dataQuality: leg.realtime ? "realtime" : "scheduled",
    fetchedAt,
    attribution: ATTRIBUTION,
    originIds: leg.lineId ? [leg.lineId] : [],
    kind: leg.kind,
    from: { name: leg.from ?? "", lat: first?.lat, lon: first?.lon, departureAt: leg.departure.getTime() },
    to: { name: leg.to ?? "", lat: last?.lat, lon: last?.lon, arrivalAt: leg.arrival.getTime() },
    departAt: leg.departure.getTime(),
    arriveAt: leg.arrival.getTime(),
    durationSeconds: leg.durationSeconds,
    line: leg.line && {
      id: `${LINE_PREFIX}${leg.lineId ? navitiaLineKey(leg.lineId) : leg.line.label}`,
      shortName: leg.line.label,
      mode: modeFromLabel(leg.line.mode),
      modeLabel: leg.line.mode,
      color: leg.line.color,
      textColor: leg.line.textColor,
    },
    headsign: leg.direction,
    intermediateStops: leg.stops?.map((stop) => ({ name: stop.name, lat: stop.lat, lon: stop.lon, arrivalAt: stop.at.getTime() })),
    stopCount: leg.stopCount,
    boarding: leg.lineId || leg.stopPointId ? { lineId: leg.lineId, stopId: leg.stopPointId } : undefined,
    shape: leg.geometry ? { type: "LineString", coordinates: leg.geometry.coordinates as Position[] } : undefined,
  };
}

/** Un trajet de Navitia, dans le modèle canonique — sans rien perdre de ce que lit l'interface. */
export function toCanonicalJourney(journey: TransitJourney, fetchedAt: number): Journey {
  const legs = journey.legs.map((leg) => toCanonicalLeg(leg, fetchedAt));
  return {
    source: "idfm",
    dataQuality: legs.some((leg) => leg.dataQuality === "realtime") ? "realtime" : "scheduled",
    fetchedAt,
    attribution: ATTRIBUTION,
    originIds: [],
    id: journey.id,
    legs,
    departAt: journey.departure.getTime(),
    arriveAt: journey.arrival.getTime(),
    transfers: journey.transfers,
    durationSeconds: journey.durationSeconds,
    walkingSeconds: journey.walkingSeconds,
  };
}

export const createIdfmProvider: ProviderFactory = (context) => ({
  id: "idfm",

  async getDepartures(station, options, signal): Promise<DepartureGroup[]> {
    const lines = await getDepartures(toPlace(station), signal, { fresh: options.fresh });
    const fetchedAt = Date.now();
    // L'ordre des lignes (métro, RER, train, tram, bus) et celui des groupes
    // (le plus imminent d'abord) sont conservés tels que la source les rend.
    return lines.flatMap((line) => {
      const lineRef: LineRef = {
        id: `${LINE_PREFIX}${line.lineId}`,
        shortName: line.label,
        mode: MODES[line.mode],
        color: line.color,
        textColor: line.textColor,
      };
      return line.groups.map((group) => ({
        destination: group.key,
        line: lineRef,
        departures: group.departures.map((departure) => ({
          source: "idfm",
          dataQuality: departure.realtime ? ("realtime" as const) : ("scheduled" as const),
          fetchedAt,
          attribution: ATTRIBUTION,
          originIds: [line.lineId],
          lineId: lineRef.id,
          destination: departure.destination,
          scheduledAt: departure.at.getTime(),
          expectedAt: departure.realtime ? departure.at.getTime() : undefined,
          platform: departure.platform,
          cancelled: departure.cancelled,
        })),
      }));
    });
  },

  async getStationDetails(station, signal): Promise<Station> {
    const chips = await getStopLines(toPlace(station), signal);
    return {
      source: "idfm",
      dataQuality: "scheduled",
      fetchedAt: Date.now(),
      attribution: ATTRIBUTION,
      originIds: [station.origin?.placeId ?? station.id],
      id: station.id,
      name: station.name,
      lat: station.lat,
      lon: station.lon,
      modes: [],
      quays: [],
      // Le référentiel ne dit pas le mode de chaque pastille : seules comptent
      // ici l'étiquette et les couleurs, pour repérer les lignes muettes.
      lines: chips.map((chip) => ({
        id: `${LINE_PREFIX}${chip.label}`,
        shortName: chip.label,
        mode: "other" as const,
        color: chip.color,
        textColor: chip.textColor,
      })),
      regionId: context.region.id,
    };
  },

  async getLineShape(ref, signal): Promise<Shape | null> {
    const lineId = idfmLineId(ref.lineId);
    if (!lineId) return null;
    const geometry = await getLineShape(lineId, signal);
    if (!geometry || (geometry.type !== "LineString" && geometry.type !== "MultiLineString")) return null;
    return { type: geometry.type, coordinates: geometry.coordinates as Shape["coordinates"] };
  },

  async planJourney(from, to, options, signal): Promise<Journey[]> {
    // Navitia, avec son cache d'une minute par couple et par heure de départ.
    const journeys = await getJourneysBetween(
      { lon: from[0], lat: from[1] },
      { lon: to[0], lat: to[1] },
      options.at === undefined ? undefined : new Date(options.at),
      signal
    );
    const fetchedAt = Date.now();
    return journeys.map((journey) => toCanonicalJourney(journey, fetchedAt));
  },
});
