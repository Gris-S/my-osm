import { describe, expect, it } from "vitest";
import { CircuitBreakers } from "../src/transport/circuitBreaker";
import { MODE_COLORS } from "../src/transport/departuresView";
import { stitchJourneys, toTransitJourney, type TransitJourney } from "../src/transport/journeyView";
import type { Journey } from "../src/transport/model";
import { TransportOrchestrator, type ProviderLoader } from "../src/transport/orchestrator";
import { toCanonicalJourney } from "../src/transport/providers/idfm";
import type { Region } from "../src/transport/registry";

const at = (hour: number, minute: number) => new Date(2026, 8, 15, hour, minute);

/** Un trajet tel que le parseur Navitia le rend (Nation → La Défense, relevé réel simplifié). */
const navitia: TransitJourney = {
  id: "20260915T081000-0",
  departure: at(8, 10),
  arrival: at(8, 41),
  durationSeconds: 1860,
  transfers: 0,
  walkingSeconds: 420,
  legs: [
    {
      kind: "walk",
      departure: at(8, 10),
      arrival: at(8, 15),
      durationSeconds: 300,
      to: "Nation",
      realtime: false,
      geometry: { type: "LineString", coordinates: [[2.39, 48.84], [2.395, 48.848]] },
    },
    {
      kind: "transit",
      departure: at(8, 16),
      arrival: at(8, 39),
      durationSeconds: 1380,
      from: "Nation",
      to: "La Défense",
      line: { label: "A", color: "#E3051C", textColor: "#FFFFFF", mode: "RER" },
      direction: "Saint-Germain-en-Laye",
      stopCount: 2,
      stops: [
        { name: "Nation", lon: 2.395, lat: 48.848, at: at(8, 16) },
        { name: "Châtelet-Les Halles", lon: 2.347, lat: 48.861, at: at(8, 24) },
        { name: "La Défense", lon: 2.238, lat: 48.892, at: at(8, 39) },
      ],
      lineId: "line:IDFM:C01742",
      stopPointId: "stop_point:IDFM:monomodalStopPlace:47889",
      realtime: true,
      geometry: { type: "LineString", coordinates: [[2.395, 48.848], [2.347, 48.861], [2.238, 48.892]] },
    },
    { kind: "walk", departure: at(8, 39), arrival: at(8, 41), durationSeconds: 120, from: "La Défense", realtime: false },
  ],
};

describe("trajets : du modèle canonique à l'interface", () => {
  it("un trajet Navitia fait l'aller-retour par le modèle canonique sans rien perdre", () => {
    const canonical = toCanonicalJourney(navitia, 1);
    expect(canonical.dataQuality).toBe("realtime");
    expect(canonical.legs[1].line).toMatchObject({ id: "paris:line:IDFM:C01742", mode: "regional-rail", modeLabel: "RER" });
    expect(canonical.legs[1].boarding).toEqual({ lineId: "line:IDFM:C01742", stopId: "stop_point:IDFM:monomodalStopPlace:47889" });
    expect(toTransitJourney(canonical, 0)).toEqual({ ...navitia, source: "idfm" });
  });

  it("une source sans couleurs ni durées retombe sur le mode et sur les heures", () => {
    const journey: Journey = {
      source: "transitous",
      dataQuality: "scheduled",
      fetchedAt: 0,
      attribution: "transitous",
      originIds: [],
      departAt: at(9, 0).getTime(),
      arriveAt: at(9, 20).getTime(),
      transfers: 0,
      legs: [
        {
          source: "transitous",
          dataQuality: "scheduled",
          fetchedAt: 0,
          attribution: "transitous",
          originIds: [],
          kind: "transit",
          from: { name: "Cornavin" },
          to: { name: "Plainpalais" },
          departAt: at(9, 0).getTime(),
          arriveAt: at(9, 20).getTime(),
          line: { id: "geneve:line:12", shortName: "12", mode: "tram" },
        },
      ],
    };
    const view = toTransitJourney(journey, 3);
    expect(view.id).toBe(`${journey.departAt}-3`);
    expect(view.durationSeconds).toBe(1200);
    expect(view.walkingSeconds).toBe(0);
    expect(view.legs[0].line).toEqual({ label: "12", ...MODE_COLORS.tram, mode: "Tramway" });
    expect(view.legs[0].realtime).toBe(false);
    expect(view.legs[0].geometry).toBeUndefined();
  });

  it("recoud les tronçons d'un parcours à étapes, escales marquées", () => {
    const second: TransitJourney = { ...navitia, id: "b", departure: at(9, 0), arrival: at(9, 30), transfers: 1, walkingSeconds: 60 };
    const stitched = stitchJourneys([navitia, second]);
    expect(stitched.id).toBe("20260915T081000-0+b");
    expect(stitched.stopoverAfter).toEqual([2]);
    expect(stitched.legs).toHaveLength(6);
    expect(stitched.transfers).toBe(1);
    expect(stitched.walkingSeconds).toBe(480);
    expect(stitched.durationSeconds).toBe(80 * 60);
  });
});

describe("orchestrateur : réponse vide", () => {
  const region: Region = {
    id: "test",
    name: { fr: "Test", en: "Test" },
    bbox: [0, 0, 10, 10],
    providers: [
      { id: "local", rank: 1, capabilities: ["journeys"] },
      { id: "aggregator", rank: 2, capabilities: ["journeys"] },
    ],
  };
  const found = [{ id: "trouvé" }] as unknown as Journey[];

  function setup(local: Journey[], aggregator: Journey[]) {
    const breakers = new CircuitBreakers();
    const loaders: Record<string, ProviderLoader> = {
      local: async () => () => ({ id: "local", planJourney: async () => local }),
      aggregator: async () => () => ({ id: "aggregator", planJourney: async () => aggregator }),
    };
    const orchestrator = new TransportOrchestrator({
      loaders,
      http: { getJson: async () => ({}) as never },
      hasKey: () => true,
      breakers,
      sleep: async () => {},
      regions: [region],
    });
    orchestrator.setRegion(region);
    const plan = () =>
      orchestrator.run("journeys", (provider, signal) => provider.planJourney?.([0, 0], [1, 1], {}, signal), undefined, {
        accept: (journeys) => journeys.length > 0,
      });
    return { plan, breakers };
  }

  it("passe à la source suivante sans tenir la première pour en panne", async () => {
    const { plan, breakers } = setup([], found);
    for (let i = 0; i < 4; i++) {
      const result = await plan();
      expect(result.providerId).toBe("aggregator");
      expect(result.value).toBe(found);
      expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(["empty", "success"]);
    }
    expect(breakers.isOpen("local:journeys")).toBe(false);
  });

  it("rend la première réponse vide quand personne ne fait mieux", async () => {
    const { plan } = setup([], []);
    const result = await plan();
    expect(result.providerId).toBe("local");
    expect(result.value).toEqual([]);
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(["empty", "empty"]);
  });
});
