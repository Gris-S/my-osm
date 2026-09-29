import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BikeRouteError,
  brouterProfile,
  brouterToOsrm,
  fetchBikeRoute,
  valhallaCosting,
} from "../src/services/bikeRouting";
import { DEFAULT_BIKE_SETTINGS, setBikeSettings } from "../src/services/bikeSettings";
import { getNavRoute } from "../src/navigation/route";

// L'itinéraire à vélo : les réglages traduits pour Valhalla, la réponse de
// BRouter ramenée à la forme d'OSRM, et surtout la règle du secours — qui ne
// doit servir que quand Valhalla est en panne, et jamais en silence.

describe("réglages vélo → Valhalla", () => {
  it("inverse les curseurs : éviter la circulation = peu de route", () => {
    const c = valhallaCosting({ ...DEFAULT_BIKE_SETTINGS, avoidTraffic: 0.75, avoidHills: 0.5 });
    expect(c).toEqual({ bicycle_type: "hybrid", use_roads: 0.25, use_hills: 0.5 });
  });

  it("la sécurité force use_roads à 0, quel que soit le curseur", () => {
    const c = valhallaCosting({ ...DEFAULT_BIKE_SETTINGS, avoidTraffic: 0.1, safety: true });
    expect(c.use_roads).toBe(0);
  });

  it("le VAE roule à 22 km/h et craint trois fois moins les côtes", () => {
    const c = valhallaCosting({ ...DEFAULT_BIKE_SETTINGS, avoidHills: 0.9, electric: true });
    expect(c.cycling_speed).toBe(22);
    expect(c.use_hills).toBe(0.7);
  });

  it("BRouter : profil safety pour la sécurité ou une circulation très évitée", () => {
    expect(brouterProfile({ ...DEFAULT_BIKE_SETTINGS })).toBe("trekking");
    expect(brouterProfile({ ...DEFAULT_BIKE_SETTINGS, safety: true })).toBe("safety");
    expect(brouterProfile({ ...DEFAULT_BIKE_SETTINGS, avoidTraffic: 0.9 })).toBe("safety");
  });
});

/** Un tracé droit vers l'est, un point tous les ~73 m à Paris. */
function line(n: number): Array<[number, number, number]> {
  return Array.from({ length: n }, (_, i) => [2.35 + i * 0.001, 48.85, 35]);
}

describe("BRouter → OSRM", () => {
  it("fait une étape par consigne, un départ et une arrivée", () => {
    const route = brouterToOsrm(
      {
        geometry: { coordinates: line(6) },
        properties: {
          "total-time": "50",
          times: [0, 10, 20, 30, 40, 50],
          // [indice, commande, sortie, distance, angle] — 5 = à droite, 13 = rond-point
          voicehints: [
            [2, 5, 0, 100, 90],
            [4, 13, -2, 50, 0],
          ],
        },
      },
      [
        { lon: 2.35, lat: 48.85 },
        { lon: 2.355, lat: 48.85 },
      ]
    );
    expect(route.legs).toHaveLength(1);
    const steps = route.legs[0].steps;
    expect(steps.map((s) => s.maneuver.type)).toEqual(["depart", "turn", "roundabout", "arrive"]);
    expect(steps[1].maneuver.modifier).toBe("right");
    // Sortie négative (rond-point à gauche) : c'est son rang qui compte.
    expect(steps[2].maneuver.exit).toBe(2);
    expect(steps[0].duration).toBe(20);
    expect(steps.every((s) => s.name === "")).toBe(true);
    // La somme des étapes redonne la longueur du tracé.
    const sum = steps.reduce((total, s) => total + s.distance, 0);
    expect(sum).toBeCloseTo(route.distance, 6);
    expect(route.duration).toBe(50);
  });

  it("recoupe le tracé à chaque étape, pour que le guidage retrouve ses arrivées", () => {
    const route = brouterToOsrm(
      { geometry: { coordinates: line(9) }, properties: { "total-time": "80" } },
      [
        { lon: 2.35, lat: 48.85 },
        { lon: 2.354, lat: 48.8501 }, // étape, près du 5e point
        { lon: 2.358, lat: 48.85 },
      ]
    );
    expect(route.legs).toHaveLength(2);
    expect(route.legs[0].steps.at(-1)?.maneuver.location).toEqual([2.354, 48.85]);
    expect(route.legs[1].steps[0].maneuver.type).toBe("depart");
  });
});

describe("le secours BRouter", () => {
  const points = [
    { lon: 2.3522, lat: 48.8566 },
    { lon: 2.395, lat: 48.848 },
  ];
  const valhallaOk = {
    code: "Ok",
    routes: [
      {
        distance: 100,
        duration: 20,
        geometry: { type: "LineString", coordinates: [[2.35, 48.85], [2.351, 48.85]] },
        legs: [
          {
            steps: [
              {
                distance: 100,
                duration: 20,
                name: "Rue de Rivoli",
                geometry: { type: "LineString", coordinates: [[2.35, 48.85], [2.351, 48.85]] },
                maneuver: { type: "depart", location: [2.35, 48.85] },
              },
              {
                distance: 0,
                duration: 0,
                name: "",
                geometry: { type: "LineString", coordinates: [[2.351, 48.85], [2.351, 48.85]] },
                maneuver: { type: "arrive", location: [2.351, 48.85] },
              },
            ],
          },
        ],
      },
    ],
  };
  const brouterOk = {
    features: [{ geometry: { coordinates: line(4) }, properties: { "total-time": "30" } }],
  };
  let calls: string[];

  function serve(valhalla: () => Response) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url.includes("valhalla") ? "valhalla" : "brouter");
        return url.includes("valhalla") ? valhalla() : new Response(JSON.stringify(brouterOk));
      })
    );
  }

  /** Le calcul, horloge avancée : les appels sont espacés d'une seconde. */
  async function run() {
    const pending = fetchBikeRoute(points);
    pending.catch(() => {});
    await vi.runAllTimersAsync();
    return pending;
  }

  beforeEach(() => {
    calls = [];
    vi.useFakeTimers();
    setBikeSettings({ ...DEFAULT_BIKE_SETTINGS });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("Valhalla répond : pas de secours", async () => {
    serve(() => new Response(JSON.stringify(valhallaOk)));
    const result = await run();
    expect(result.source).toBe("valhalla");
    expect(calls).toEqual(["valhalla"]);
  });

  it("Valhalla en panne : BRouter répond, et le résultat le dit", async () => {
    serve(() => new Response("oops", { status: 503 }));
    const result = await run();
    expect(result.source).toBe("brouter");
    expect(calls).toEqual(["valhalla", "brouter"]);
  });

  it("Valhalla injoignable : même secours", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url.includes("valhalla") ? "valhalla" : "brouter");
        if (url.includes("valhalla")) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify(brouterOk));
      })
    );
    expect((await run()).source).toBe("brouter");
  });

  it("secours interdit : l'erreur remonte, BRouter n'est pas appelé", async () => {
    setBikeSettings({ allowFallback: false });
    serve(() => new Response("oops", { status: 503 }));
    await expect(run()).rejects.toBeInstanceOf(BikeRouteError);
    expect(calls).toEqual(["valhalla"]);
  });

  it("pas de chemin (400) : pas de secours — un autre moteur n'en trouverait pas", async () => {
    serve(() => new Response(JSON.stringify({ code: "DistanceExceeded" }), { status: 400 }));
    await expect(run()).rejects.toMatchObject({ reason: "noRoute" });
    expect(calls).toEqual(["valhalla"]);
  });

  it("le guidage lit la réponse de secours comme celle de Valhalla", async () => {
    serve(() => new Response("oops", { status: 503 }));
    const pending = getNavRoute(points, undefined, "cycling");
    await vi.runAllTimersAsync();
    const route = await pending;
    expect(route.source).toBe("brouter");
    expect(route.result.mode).toBe("cycling");
    expect(route.steps[0].maneuver.type).toBe("depart");
    expect(route.steps.at(-1)?.maneuver.type).toBe("arrive");
    expect(route.distanceMeters).toBeGreaterThan(0);
  });
});
