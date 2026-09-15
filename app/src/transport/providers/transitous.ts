import { CONFIG } from "../../config";
import { readPersistent, writePersistent } from "../persistentCache";
import { groupStops, TRANSITOUS_PLACE_PREFIX } from "../stopsMerge";
import { tileBounds, tileKey } from "../tiles";
import type {
  CanonicalId,
  DepartureGroup,
  GeoTile,
  Station,
  Journey,
  JourneyLeg,
  LineRef,
  Position,
  Shape,
  StationRef,
  TransitMode,
  TripStop,
} from "../model";
import type { ProviderFactory } from "../orchestrator";
import { CACHE_POLICY, CAPABILITY_POLICY, TRANSITOUS_DEPARTURES } from "../policy";
import { decodePolyline } from "../polyline";

// ---------------------------------------------------------------------------
// Adaptateur Transitous (rang 2 partout ; seule source hors des régions dotées
// d'une source officielle).
//
// Transitous agrège les horaires GTFS et le temps réel publiés dans le monde,
// derrière le moteur MOTIS 2 (`api.transitous.org/api/`). Formes vérifiées
// par des appels réels le 15 septembre 2026 :
//
//  - `/v5/stoptimes` : départs autour d'un point (`center`, `radius`) ou d'un
//    arrêt (`stopId`) ; `realTime` par départ, heures en UTC ISO 8601, couleurs
//    en hexadécimal sans « # », parfois absentes (Genève).
//  - `/v5/plan` : itinéraires, `time` respecté ; les extrémités sans arrêt
//    s'appellent littéralement `START` et `END`.
//  - `/v5/trip` : une course, avec son tracé en polyligne de précision 6.
//  - `/v1/map/stops` : les arrêts d'une emprise (`min`, `max` en lat,lon), quais
//    compris, avec `parentId` ; `/v5/stoptimes` accepte ce `parentId` et rend
//    alors les départs de toute la station (vérifié à Genève Cornavin).
//
// **Conditions d'usage** : projet ouvert et non commercial, `User-Agent` qui
// identifie l'application (posé par `httpClient.ts`), réponses mises en cache,
// et lien visible vers `transitous.org/sources` (« Sources et licences »).
// ---------------------------------------------------------------------------

const ATTRIBUTION = "transitous";

interface MotisStop {
  name?: string;
  stopId?: string;
  parentId?: string | null;
  lat?: number;
  lon?: number;
  modes?: string[];
}

interface MotisPlace {
  name?: string;
  stopId?: string;
  parentId?: string | null;
  lat?: number;
  lon?: number;
  arrival?: string;
  departure?: string;
  scheduledArrival?: string;
  scheduledDeparture?: string;
  track?: string | null;
  scheduledTrack?: string | null;
  cancelled?: boolean;
}

interface MotisRoute {
  mode?: string;
  realTime?: boolean;
  headsign?: string;
  routeShortName?: string;
  displayName?: string;
  routeColor?: string;
  routeTextColor?: string;
  agencyName?: string;
  tripId?: string;
  cancelled?: boolean;
}

interface MotisStopTime extends MotisRoute {
  place: MotisPlace;
  tripCancelled?: boolean;
}

interface MotisLeg extends MotisRoute {
  from: MotisPlace;
  to: MotisPlace;
  duration?: number;
  startTime?: string;
  endTime?: string;
  intermediateStops?: MotisPlace[];
  legGeometry?: { points?: string; precision?: number };
}

interface MotisItinerary {
  duration?: number;
  startTime?: string;
  endTime?: string;
  transfers?: number;
  legs?: MotisLeg[];
}

/** Modes de MOTIS -> modes canoniques. Ce qui n'y figure pas (marche, vélo…) n'est pas un transport. */
const MODES: Record<string, TransitMode> = {
  TRAM: "tram",
  SUBWAY: "metro",
  METRO: "metro",
  BUS: "bus",
  COACH: "coach",
  FERRY: "ferry",
  FUNICULAR: "funicular",
  AERIAL_LIFT: "cable",
  CABLE_CAR: "cable",
  RAIL: "rail",
  HIGHSPEED_RAIL: "rail",
  LONG_DISTANCE: "rail",
  NIGHT_RAIL: "rail",
  REGIONAL_FAST_RAIL: "regional-rail",
  REGIONAL_RAIL: "regional-rail",
  SUBURBAN: "regional-rail",
  OTHER: "other",
};

/** Ordre des lignes dans la fiche, le même qu'à Paris : le lourd d'abord. */
const MODE_ORDER: TransitMode[] = ["metro", "regional-rail", "rail", "tram", "funicular", "cable", "ferry", "bus", "coach", "other"];

const time = (value: string | undefined): number | undefined => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

const hex = (value: string | undefined): string | undefined => {
  const cleaned = value?.replace(/^#/, "").trim();
  return cleaned && /^[0-9a-f]{3,8}$/i.test(cleaned) ? `#${cleaned}` : undefined;
};

/** Pour comparer des noms d'arrêt : ni casse, ni accents, ni ponctuation. */
const normalizeName = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

/** `START` et `END` : les extrémités sans arrêt d'un itinéraire. */
const placeName = (place: MotisPlace) => (place.name === "START" || place.name === "END" ? "" : (place.name ?? ""));

/** Un arrêt de bus, de tram ou un quai : on l'interroge de près. */
const isSingleStop = (rawType: string | undefined) => !!rawType && /bus_stop|tram_stop|platform|stop_position/.test(rawType);

export const createTransitousProvider: ProviderFactory = (context) => {
  const regionId = context.region.id;
  const api = (path: string) => new URL(path, CONFIG.TRANSITOUS_API_URL);
  /**
   * Une course récente par ligne. MOTIS n'a pas de tracé par ligne, seulement
   * par course : le tracé d'une ligne dépliée dans la fiche est celui d'une
   * course qu'on vient d'y lire.
   */
  const tripsByLine = new Map<CanonicalId, string>();

  const lineRef = (route: MotisRoute): LineRef => {
    const shortName = route.displayName || route.routeShortName || "?";
    const mode = MODES[route.mode ?? ""] ?? "other";
    return {
      id: `${regionId}:line:transitous:${route.agencyName ?? ""}:${mode}:${shortName}`,
      shortName,
      mode,
      color: hex(route.routeColor),
      textColor: hex(route.routeTextColor),
    };
  };

  const provenance = (realtime: boolean, originIds: string[]) => ({
    source: "transitous",
    dataQuality: realtime ? ("realtime" as const) : ("scheduled" as const),
    fetchedAt: Date.now(),
    attribution: ATTRIBUTION,
    originIds,
  });

  const quayId = (place: MotisPlace) => (place.stopId ? `${regionId}:quay:transitous:${place.stopId}` : undefined);

  const tripStop = (place: MotisPlace): TripStop => ({
    quayId: quayId(place),
    name: placeName(place),
    lat: place.lat,
    lon: place.lon,
    arrivalAt: time(place.arrival),
    departureAt: time(place.departure),
  });

  const toLeg = (leg: MotisLeg): JourneyLeg | null => {
    const departAt = time(leg.startTime);
    const arriveAt = time(leg.endTime);
    if (departAt === undefined || arriveAt === undefined) return null;
    const transitMode = MODES[leg.mode ?? ""];
    const geometry = leg.legGeometry?.points ? decodePolyline(leg.legGeometry.points, leg.legGeometry.precision ?? 6) : [];
    const shape: Shape | undefined = geometry.length > 1 ? { type: "LineString", coordinates: geometry } : undefined;
    const base = {
      ...provenance(leg.realTime === true, leg.tripId ? [leg.tripId] : []),
      from: tripStop(leg.from),
      to: tripStop(leg.to),
      departAt,
      arriveAt,
      durationSeconds: leg.duration,
      shape,
    };
    if (!transitMode) return { ...base, kind: "walk" };
    const intermediate = leg.intermediateStops ?? [];
    return {
      ...base,
      kind: "transit",
      line: lineRef(leg),
      headsign: leg.headsign,
      // Montée, arrêts desservis, descente : comme la desserte de Navitia.
      intermediateStops: [leg.from, ...intermediate, leg.to].map(tripStop),
      stopCount: intermediate.length + 1,
    };
  };

  const toJourney = (itinerary: MotisItinerary): Journey | null => {
    const departAt = time(itinerary.startTime);
    const arriveAt = time(itinerary.endTime);
    if (departAt === undefined || arriveAt === undefined) return null;
    const legs = (itinerary.legs ?? []).map(toLeg).filter((leg): leg is JourneyLeg => leg !== null);
    // Un trajet sans transport est un trajet à pied : le mode « À pied » le fait déjà.
    if (!legs.some((leg) => leg.kind === "transit")) return null;
    return {
      ...provenance(legs.some((leg) => leg.dataQuality === "realtime"), []),
      legs,
      departAt,
      arriveAt,
      transfers: itinerary.transfers ?? 0,
      durationSeconds: itinerary.duration,
    };
  };

  return {
    id: "transitous",

    async getStopsInViewport(tile: GeoTile, signal): Promise<Station[]> {
      const key = `stops:${tileKey(tile)}`;
      const { value } = await context.cached<Station[]>({
        key,
        ...CACHE_POLICY.stopsTile,
        load: async () => {
          // Sept jours sur l'appareil : relancer l'application ne redemande rien.
          const persistentKey = `${regionId}:transitous:${key}`;
          const stored = await readPersistent<Station[]>(persistentKey);
          if (stored) return stored;
          const [west, south, east, north] = tileBounds(tile);
          const url = api("v1/map/stops");
          url.searchParams.set("min", `${south},${west}`);
          url.searchParams.set("max", `${north},${east}`);
          const stops = await context.http.getJson<MotisStop[]>({
            url: url.href,
            timeoutMs: CAPABILITY_POLICY.stops.timeoutMs,
            signal,
          });
          const raw = (Array.isArray(stops) ? stops : []).flatMap((stop) =>
            stop.stopId && stop.name && typeof stop.lat === "number" && typeof stop.lon === "number"
              ? [
                  {
                    stopId: stop.stopId,
                    parentId: stop.parentId,
                    name: stop.name,
                    lat: stop.lat,
                    lon: stop.lon,
                    modes: [...new Set((stop.modes ?? []).map((mode) => MODES[mode] ?? ("other" as const)))],
                  },
                ]
              : []
          );
          const stations = groupStops(raw, regionId, Date.now());
          void writePersistent(persistentKey, stations, CACHE_POLICY.stopsTile.ttlMs);
          return stations;
        },
      });
      return value;
    },

    async getDepartures(station: StationRef, options, signal): Promise<DepartureGroup[]> {
      const url = api("v5/stoptimes");
      const placeId = station.origin?.placeId ?? "";
      if (placeId.startsWith(TRANSITOUS_PLACE_PREFIX)) {
        url.searchParams.set("stopId", placeId.slice(TRANSITOUS_PLACE_PREFIX.length));
      } else {
        url.searchParams.set("center", `${station.lat},${station.lon}`);
        const radius = isSingleStop(station.origin?.rawType)
          ? TRANSITOUS_DEPARTURES.stopRadiusMeters
          : TRANSITOUS_DEPARTURES.stationRadiusMeters;
        url.searchParams.set("radius", String(radius));
      }
      url.searchParams.set("n", String(TRANSITOUS_DEPARTURES.perRequest));

      const load = () =>
        context.http.getJson<{ stopTimes?: MotisStopTime[] }>({
          url: url.href,
          timeoutMs: CAPABILITY_POLICY.departures.timeoutMs,
          signal,
        });
      // Le temps réel n'est jamais servi périmé ; « actualiser » saute le cache.
      const data = options.fresh
        ? await load()
        : (await context.cached({ key: `stoptimes:${url.search}`, ...CACHE_POLICY.realtimeDepartures, load })).value;

      const now = options.from ?? Date.now();
      const horizon = now + TRANSITOUS_DEPARTURES.horizonMinutes * 60_000;
      const perGroup = options.perGroup ?? TRANSITOUS_DEPARTURES.perGroup;
      const stationName = normalizeName(station.name);
      const groups = new Map<string, DepartureGroup & { first: number }>();
      // Une même course publiée deux fois — constaté à Amsterdam Centraal, où
      // « EST 9382 » et « NJ 421 » s'affichaient en double : même ligne, même
      // destination, même heure prévue. On n'en garde qu'une.
      const seenTrips = new Set<string>();

      for (const stopTime of data.stopTimes ?? []) {
        const place = stopTime.place;
        // Sans heure de départ, c'est une arrivée : le véhicule finit ici.
        const scheduledAt = time(place.scheduledDeparture) ?? time(place.departure);
        if (scheduledAt === undefined) continue;
        const realtime = stopTime.realTime === true;
        const expectedAt = realtime ? time(place.departure) : undefined;
        const at = expectedAt ?? scheduledAt;
        if (at < now - 60_000 || at > horizon) continue;
        const destination = stopTime.headsign?.trim() ?? "";
        // Un véhicule qui termine à la station interrogée ne mène nulle part.
        if (destination && normalizeName(destination) === stationName) continue;

        const line = lineRef(stopTime);
        const trip = `${line.mode}|${normalizeName(line.shortName)}|${normalizeName(destination)}|${scheduledAt}`;
        if (seenTrips.has(trip)) continue;
        seenTrips.add(trip);
        const key = `${line.id}|${destination}`;
        let group = groups.get(key);
        if (!group) {
          group = { destination, line, departures: [], first: at };
          groups.set(key, group);
        }
        if (stopTime.tripId && !tripsByLine.has(line.id)) tripsByLine.set(line.id, stopTime.tripId);
        group.first = Math.min(group.first, at);
        group.departures.push({
          ...provenance(realtime, stopTime.tripId ? [stopTime.tripId] : []),
          lineId: line.id,
          quayId: quayId(place),
          destination,
          scheduledAt,
          expectedAt,
          platform: place.track ?? place.scheduledTrack ?? undefined,
          cancelled: !!(stopTime.cancelled || stopTime.tripCancelled || place.cancelled),
          tripId: stopTime.tripId,
        });
      }

      const at = (departure: { scheduledAt: number; expectedAt?: number }) => departure.expectedAt ?? departure.scheduledAt;
      return [...groups.values()]
        .sort(
          (a, b) =>
            MODE_ORDER.indexOf(a.line.mode) - MODE_ORDER.indexOf(b.line.mode) ||
            a.line.shortName.localeCompare(b.line.shortName, undefined, { numeric: true }) ||
            a.first - b.first
        )
        .map(({ first: _first, ...group }) => ({
          ...group,
          departures: group.departures.sort((a, b) => at(a) - at(b)).slice(0, perGroup),
        }));
    },

    async getLineShape(ref, signal): Promise<Shape | null> {
      const tripId = ref.tripId ?? tripsByLine.get(ref.lineId);
      if (!tripId) return null;
      const url = api("v5/trip");
      url.searchParams.set("tripId", tripId);
      const { value } = await context.cached<Shape | null>({
        key: `shape:${ref.lineId}`,
        ...CACHE_POLICY.shape,
        load: async () => {
          const data = await context.http.getJson<MotisItinerary & MotisLeg>({
            url: url.href,
            timeoutMs: CAPABILITY_POLICY.shapes.timeoutMs,
            signal,
          });
          const legs = data.legs ?? [data];
          const coordinates = legs.flatMap<Position>((leg) =>
            leg.legGeometry?.points ? decodePolyline(leg.legGeometry.points, leg.legGeometry.precision ?? 6) : []
          );
          return coordinates.length > 1 ? { type: "LineString", coordinates } : null;
        },
      });
      return value;
    },

    async planJourney(from, to, options, signal): Promise<Journey[]> {
      const url = api("v5/plan");
      url.searchParams.set("fromPlace", `${from[1]},${from[0]}`);
      url.searchParams.set("toPlace", `${to[1]},${to[0]}`);
      if (options.at !== undefined) url.searchParams.set("time", new Date(options.at).toISOString());
      if (options.arriveBy) url.searchParams.set("arriveBy", "true");
      const maxResults = options.maxResults ?? 3;
      url.searchParams.set("numItineraries", String(maxResults));

      // Clé à la minute, comme les horaires : un va-et-vient entre les modes ne coûte rien.
      const minute = options.at === undefined ? "now" : String(Math.floor(options.at / 60_000));
      const round = (position: Position) => `${position[0].toFixed(5)},${position[1].toFixed(5)}`;
      const { value } = await context.cached<Journey[]>({
        key: `plan:${round(from)}>${round(to)}@${minute}:${options.arriveBy ? "arrive" : "depart"}`,
        ...CACHE_POLICY.journeys,
        load: async () => {
          const data = await context.http.getJson<{ itineraries?: MotisItinerary[] }>({
            url: url.href,
            timeoutMs: CAPABILITY_POLICY.journeys.timeoutMs,
            signal,
          });
          return (data.itineraries ?? [])
            .map(toJourney)
            .filter((journey): journey is Journey => journey !== null)
            .sort((a, b) => a.arriveAt - b.arriveAt)
            .slice(0, maxResults);
        },
      });
      return value;
    },

    dispose() {
      tripsByLine.clear();
    },
  };
};
