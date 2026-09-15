import { describe, expect, it } from "vitest";
import { TransportOrchestrator, type ProviderLoader } from "../src/transport/orchestrator";
import { REQUEST_BUDGET, TRANSITOUS_STOPS } from "../src/transport/policy";
import { createTransitousProvider } from "../src/transport/providers/transitous";
import { REGIONS } from "../src/transport/registry";
import { tilesForBbox } from "../src/transport/tiles";

// ---------------------------------------------------------------------------
// Le budget de requêtes par interaction (§2g), vérifié sur l'adaptateur réel et
// l'orchestrateur réel, avec un réseau simulé qui compte les appels.
// ---------------------------------------------------------------------------

const soon = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

const RESPONSES: Record<string, unknown> = {
  stoptimes: {
    stopTimes: [
      { mode: "TRAM", displayName: "15", agencyName: "TPG", headsign: "Nations", realTime: true, tripId: "t1", place: { departure: soon(3), scheduledDeparture: soon(2) } },
    ],
  },
  trip: { legs: [{ legGeometry: { points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@", precision: 5 } }] },
  plan: {
    itineraries: [
      {
        startTime: soon(1),
        endTime: soon(20),
        transfers: 0,
        legs: [{ mode: "TRAM", displayName: "15", from: { name: "A", lat: 46.21, lon: 6.14, departure: soon(1) }, to: { name: "B", lat: 46.2, lon: 6.14, arrival: soon(20) }, startTime: soon(1), endTime: soon(20) }],
      },
    ],
  },
  stops: [{ stopId: "s1", name: "Genève, Prairie", lat: 46.2085, lon: 6.1356, modes: ["BUS"] }],
};

function setup(lon: number, lat: number) {
  const calls: string[] = [];
  const loaders: Record<string, ProviderLoader> = { transitous: async () => createTransitousProvider };
  const orchestrator = new TransportOrchestrator({
    loaders,
    http: {
      getJson: async <T,>({ url }: { url: string }) => {
        const name = new URL(url).pathname.split("/").pop() ?? "";
        calls.push(name);
        return RESPONSES[name] as T;
      },
    },
    // Aucune clé : à Paris, IDFM est sauté et c'est Transitous qui répond.
    hasKey: () => false,
    regions: REGIONS,
  });
  orchestrator.updatePosition(lon, lat);
  return { orchestrator, calls };
}

const station = { id: "station:node/1", name: "Genève, Cornavin", lat: 46.2102, lon: 6.1424, origin: { placeId: "node/1", rawType: "station" } };

describe("budget de requêtes (Transitous)", () => {
  it("fiche d'une station, tracé d'une ligne, itinéraire : dans le budget, puis servis par le cache", async () => {
    const { orchestrator, calls } = setup(6.1424, 46.2102);
    const departures = () => orchestrator.run("departures", (p, s) => p.getDepartures?.(station, {}, s));

    const { value: groups } = await departures();
    expect(calls.length).toBeLessThanOrEqual(REQUEST_BUDGET.departuresOpened);
    await departures();
    expect(calls).toEqual(["stoptimes"]);

    const shape = () => orchestrator.run("shapes", (p, s) => p.getLineShape?.({ lineId: groups[0].line.id }, s));
    await shape();
    await shape();
    expect(calls.filter((call) => call === "trip")).toHaveLength(REQUEST_BUDGET.lineShape);

    const plan = () => orchestrator.run("journeys", (p, s) => p.planJourney?.([6.1424, 46.2102], [6.14, 46.2], {}, s));
    await plan();
    await plan();
    expect(calls.filter((call) => call === "plan")).toHaveLength(REQUEST_BUDGET.journey);
  });

  it("une vue posée : trois tuiles d'arrêts au plus, et rien la seconde fois", async () => {
    const { orchestrator, calls } = setup(6.1424, 46.2102);
    // Une vue de zoom 16 à cheval sur quatre tuiles z15.
    const tiles = tilesForBbox([46.2015, 6.1435, 46.2055, 6.1535], TRANSITOUS_STOPS.tileZoom).slice(0, TRANSITOUS_STOPS.maxTilesPerView);
    const view = () => Promise.all(tiles.map((tile) => orchestrator.run("stops", (p, s) => p.getStopsInViewport?.(tile, s))));
    await view();
    expect(calls.length).toBeLessThanOrEqual(REQUEST_BUDGET.viewportSettled);
    const first = calls.length;
    await view();
    expect(calls.length).toBe(first);
  });

  it("à Paris sans clé IDFM : Transitous répond aux départs, et aucune tuile d'arrêts n'est demandée", async () => {
    const { orchestrator, calls } = setup(2.3469, 48.8619);
    expect(orchestrator.activeRegion?.id).toBe("paris");
    const { providerId, attempts } = await orchestrator.run("departures", (p, s) => p.getDepartures?.({ ...station, lat: 48.8619, lon: 2.3469, name: "Châtelet" }, {}, s));
    expect(providerId).toBe("transitous");
    expect(attempts.map((attempt) => attempt.outcome)).toEqual(["skipped-key", "success"]);
    await expect(orchestrator.run("stops", (p, s) => p.getStopsInViewport?.({ z: 15, x: 16597, y: 11272 }, s))).rejects.toThrow();
    expect(calls).toEqual(["stoptimes"]);
  });
});
