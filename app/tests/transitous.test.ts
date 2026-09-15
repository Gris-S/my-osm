import { describe, expect, it } from "vitest";
import { MODE_COLORS } from "../src/transport/departuresView";
import { toTransitJourney } from "../src/transport/journeyView";
import type { ProviderContext } from "../src/transport/orchestrator";
import { decodePolyline } from "../src/transport/polyline";
import { createTransitousProvider } from "../src/transport/providers/transitous";

/** Le tracé d'exemple de la documentation de Google (précision 5). */
const GOOGLE_SAMPLE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

/** Un contexte de fournisseur qui rend des réponses enregistrées, rangées par nom de point d'accès. */
function fakeContext(responses: Record<string, unknown>) {
  const urls: URL[] = [];
  const context = {
    region: { id: "geneve", name: { fr: "Genève", en: "Geneva" }, bbox: [5.9, 46.1, 6.3, 46.4], providers: [] },
    http: {
      getJson: async ({ url }: { url: string }) => {
        const parsed = new URL(url);
        urls.push(parsed);
        return responses[parsed.pathname.split("/").pop() ?? ""];
      },
    },
    cached: async ({ load }: { load: () => Promise<unknown> }) => ({ value: await load(), fresh: true }),
  } as unknown as ProviderContext;
  return { provider: createTransitousProvider(context), urls };
}

const signal = new AbortController().signal;
const utc = (hhmm: string) => `2026-09-15T${hhmm}:00Z`;
const now = Date.parse(utc("16:00"));
const cornavin = { id: "station:node/1", name: "Genève, Cornavin", lat: 46.21, lon: 6.14, origin: { placeId: "node/1", rawType: "station" } };

describe("polyligne encodée", () => {
  it("décode l'exemple de référence, en longitude puis latitude", () => {
    const points = decodePolyline(GOOGLE_SAMPLE, 5);
    expect(points).toHaveLength(3);
    [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]].forEach(([lon, lat], index) => {
      expect(points[index][0]).toBeCloseTo(lon, 5);
      expect(points[index][1]).toBeCloseTo(lat, 5);
    });
  });

  it("s'arrête au dernier point complet d'une chaîne tronquée", () => {
    expect(decodePolyline(GOOGLE_SAMPLE.slice(0, 14), 5)).toHaveLength(1);
  });
});

describe("Transitous : départs", () => {
  const stopTimes = [
    { mode: "TRAM", displayName: "12", agencyName: "TPG", headsign: "Carouge", realTime: true, tripId: "t1", place: { stopId: "s1", departure: utc("16:05"), scheduledDeparture: utc("16:04"), track: "A" } },
    { mode: "TRAM", displayName: "12", agencyName: "TPG", headsign: "Carouge", realTime: false, tripId: "t2", place: { stopId: "s1", departure: utc("16:15"), scheduledDeparture: utc("16:15") } },
    { mode: "BUS", routeShortName: "8", agencyName: "TPG", headsign: "OMS", realTime: true, routeColor: "e2001a", routeTextColor: "ffffff", tripId: "t3", place: { departure: utc("16:02"), scheduledDeparture: utc("16:02") } },
    // Termine à la station interrogée : ne mène nulle part.
    { mode: "TRAM", displayName: "12", agencyName: "TPG", headsign: "Genève, Cornavin", realTime: false, place: { departure: utc("16:07"), scheduledDeparture: utc("16:07") } },
    // Arrivée seule.
    { mode: "TRAM", displayName: "15", agencyName: "TPG", headsign: "Nations", place: { arrival: utc("16:03"), scheduledArrival: utc("16:03") } },
    // La même course publiée par un second flux : écartée.
    { mode: "TRAM", displayName: "12", agencyName: "Autre flux", headsign: "Carouge", realTime: false, tripId: "t1-bis", place: { departure: utc("16:04"), scheduledDeparture: utc("16:04") } },
    // Au-delà de l'horizon.
    { mode: "RAIL", displayName: "L2", agencyName: "CFF", headsign: "Annemasse", place: { departure: utc("19:30"), scheduledDeparture: utc("19:30") } },
  ];

  it("groupe par ligne et destination, lourd d'abord, et garde la qualité de chaque départ", async () => {
    const { provider, urls } = fakeContext({ stoptimes: { stopTimes } });
    const groups = await provider.getDepartures!(cornavin, { from: now }, signal);

    expect(urls[0].searchParams.get("center")).toBe("46.21,6.14");
    expect(urls[0].searchParams.get("radius")).toBe("250");
    expect(groups.map((group) => `${group.line.mode} ${group.line.shortName} → ${group.destination}`)).toEqual([
      "tram 12 → Carouge",
      "bus 8 → OMS",
    ]);
    const [tram, bus] = groups;
    expect(tram.line.color).toBeUndefined();
    expect(bus.line).toMatchObject({ color: "#e2001a", textColor: "#ffffff" });
    expect(tram.departures[0]).toMatchObject({
      dataQuality: "realtime",
      scheduledAt: Date.parse(utc("16:04")),
      expectedAt: Date.parse(utc("16:05")),
      platform: "A",
      quayId: "geneve:quay:transitous:s1",
      attribution: "transitous",
    });
    expect(tram.departures[1]).toMatchObject({ dataQuality: "scheduled", expectedAt: undefined });
  });

  it("interroge de près un poteau, et par identifiant un arrêt de Transitous", async () => {
    const { provider, urls } = fakeContext({ stoptimes: { stopTimes: [] } });
    await provider.getDepartures!({ ...cornavin, origin: { placeId: "node/2", rawType: "bus_stop" } }, {}, signal);
    await provider.getDepartures!({ ...cornavin, origin: { placeId: "transitous/ch:1:sloid:87057" } }, {}, signal);
    expect(urls[0].searchParams.get("radius")).toBe("60");
    expect(urls[1].searchParams.get("stopId")).toBe("ch:1:sloid:87057");
    expect(urls[1].searchParams.has("center")).toBe(false);
  });

  it("trace une ligne par une course qu'on vient d'y lire", async () => {
    const { provider, urls } = fakeContext({
      stoptimes: { stopTimes },
      trip: { legs: [{ legGeometry: { points: GOOGLE_SAMPLE, precision: 5 } }] },
    });
    const [tram] = await provider.getDepartures!(cornavin, { from: now }, signal);
    const shape = await provider.getLineShape!({ lineId: tram.line.id }, signal);
    expect(urls[1].searchParams.get("tripId")).toBe("t1");
    expect(shape?.type).toBe("LineString");
    expect(shape?.coordinates).toHaveLength(3);
    expect(await provider.getLineShape!({ lineId: "geneve:line:inconnue" }, signal)).toBeNull();
  });
});

describe("Transitous : itinéraires", () => {
  const place = (name: string, lat: number, lon: number, extra: Record<string, string> = {}) => ({ name, lat, lon, ...extra });
  const plan = {
    itineraries: [
      {
        startTime: utc("16:00"),
        endTime: utc("16:12"),
        duration: 720,
        transfers: 0,
        legs: [
          { mode: "WALK", from: place("START", 46.21, 6.1424), to: place("Genève, gare Cornavin", 46.2099, 6.1429), startTime: utc("16:00"), endTime: utc("16:02"), duration: 120 },
          {
            mode: "TRAM",
            realTime: true,
            displayName: "15",
            agencyName: "TPG",
            headsign: "Plan-les-Ouates, ZIPLO",
            tripId: "t9",
            from: place("Genève, gare Cornavin", 46.2099, 6.1429, { departure: utc("16:02") }),
            to: place("Genève, Plainpalais", 46.1983, 6.1419, { arrival: utc("16:10") }),
            intermediateStops: [place("Genève, Mercier", 46.2072, 6.1395, { arrival: utc("16:04"), departure: utc("16:04") })],
            startTime: utc("16:02"),
            endTime: utc("16:10"),
            duration: 480,
            legGeometry: { points: GOOGLE_SAMPLE, precision: 5 },
          },
          { mode: "WALK", from: place("Genève, Plainpalais", 46.1983, 6.1419), to: place("END", 46.1983, 6.1423), startTime: utc("16:10"), endTime: utc("16:12"), duration: 60 },
        ],
      },
      // À pied seulement : écarté, le mode « À pied » le fait déjà.
      { startTime: utc("16:00"), endTime: utc("16:15"), transfers: 0, legs: [{ mode: "WALK", from: place("START", 0, 0), to: place("END", 0, 0), startTime: utc("16:00"), endTime: utc("16:15") }] },
    ],
  };

  it("rend les trajets canoniques, que l'interface lit comme ceux de Navitia", async () => {
    const { provider, urls } = fakeContext({ plan });
    const at = Date.parse(utc("16:00"));
    const journeys = await provider.planJourney!([6.1424, 46.21], [6.1423, 46.1983], { at, maxResults: 3 }, signal);

    expect(urls[0].searchParams.get("fromPlace")).toBe("46.21,6.1424");
    expect(urls[0].searchParams.get("time")).toBe(new Date(at).toISOString());
    expect(journeys).toHaveLength(1);
    const [journey] = journeys;
    expect(journey.dataQuality).toBe("realtime");
    expect(journey.legs.map((leg) => leg.kind)).toEqual(["walk", "transit", "walk"]);
    expect(journey.legs[0].from.name).toBe("");
    expect(journey.legs[1]).toMatchObject({ stopCount: 2, headsign: "Plan-les-Ouates, ZIPLO" });
    expect(journey.legs[1].intermediateStops).toHaveLength(3);

    const view = toTransitJourney(journey, 0);
    expect(view.walkingSeconds).toBe(180);
    expect(view.legs[0].from).toBeUndefined();
    expect(view.legs[1].line).toEqual({ label: "15", ...MODE_COLORS.tram, mode: "Tramway" });
    expect(view.legs[1].stops?.map((stop) => stop.name)).toEqual(["Genève, gare Cornavin", "Genève, Mercier", "Genève, Plainpalais"]);
    expect(view.legs[1].geometry?.coordinates).toHaveLength(3);
    expect(view.legs[1].realtime).toBe(true);
    expect(view.legs[1].lineId).toBeUndefined();
  });
});
