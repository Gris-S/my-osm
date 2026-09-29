import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  brouterProfile,
  brouterToOsrm,
  clearBikeRouteCache,
  cyclewaysFromAttributes,
  fetchBikeRoute,
  sameLine,
  valhallaCosting,
} from "../src/services/bikeRouting";
import { getNavRoute } from "../src/navigation/route";
import { getBikeProposals } from "../src/navigation/bikeChoice";

// L'itinéraire à vélo : les réglages traduits pour Valhalla, la réponse de
// BRouter ramenée à la forme d'OSRM, et surtout la règle du secours — qui ne
// doit servir que quand Valhalla est en panne, et jamais en silence.

describe("profils vélo", () => {
  it("plus rapide : la route ne gêne pas ; plus sûr : pistes d'abord", () => {
    expect(valhallaCosting("fast")).toEqual({ bicycle_type: "hybrid", use_roads: 1, use_hills: 0.5 });
    expect(valhallaCosting("safe")).toEqual({ bicycle_type: "hybrid", use_roads: 0, use_hills: 0.5 });
  });

  it("BRouter : fastbike et safety, les seuls profils nommés que son serveur accepte", () => {
    expect(brouterProfile("fast")).toBe("fastbike");
    expect(brouterProfile("safe")).toBe("safety");
  });
});

describe("pistes et bandes en vert", () => {
  // Quatre points alignés vers l'est, encodés comme Valhalla les rend (précision 6).
  const shape = encode([
    [2.35, 48.85],
    [2.351, 48.85],
    [2.352, 48.85],
    [2.353, 48.85],
  ]);

  it("piste, bande et piste séparée passent en vert ; route et voie partagée non", () => {
    const green = cyclewaysFromAttributes({
      shape,
      edges: [
        { use: "road", cycle_lane: "none", begin_shape_index: 0, end_shape_index: 1 },
        { use: "road", cycle_lane: "dedicated", begin_shape_index: 1, end_shape_index: 2 },
        { use: "cycleway", cycle_lane: "shared", begin_shape_index: 2, end_shape_index: 3 },
      ],
    });
    // Deux tronçons verts qui se suivent ne font qu'une portion.
    expect(green.segments).toHaveLength(1);
    expect(green.segments[0].coordinates).toHaveLength(3);
    expect(green.share).toBeCloseTo(2 / 3, 2);
  });

  it("une voie partagée coupe la portion verte", () => {
    const green = cyclewaysFromAttributes({
      shape,
      edges: [
        { use: "cycleway", begin_shape_index: 0, end_shape_index: 1 },
        { use: "road", cycle_lane: "shared", begin_shape_index: 1, end_shape_index: 2 },
        { use: "road", cycle_lane: "separated", begin_shape_index: 2, end_shape_index: 3 },
      ],
    });
    expect(green.segments).toHaveLength(2);
  });

  it("une réponse vide ne rend rien, sans lever", () => {
    expect(cyclewaysFromAttributes({})).toEqual({ segments: [], share: 0 });
  });
});

/** Encodage de polyligne (algorithme de Google), pour fabriquer une réponse. */
function encode(points: Array<[number, number]>, precision = 6): string {
  const factor = 10 ** precision;
  let out = "";
  let lat = 0;
  let lon = 0;
  const put = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [x, y] of points) {
    const ly = Math.round(y * factor);
    const lx = Math.round(x * factor);
    put(ly - lat);
    put(lx - lon);
    lat = ly;
    lon = lx;
  }
  return out;
}

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
    const pending = fetchBikeRoute(points, "fast");
    pending.catch(() => {});
    await vi.runAllTimersAsync();
    return pending;
  }

  beforeEach(() => {
    calls = [];
    vi.useFakeTimers();
    clearBikeRouteCache();
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

  it("Valhalla en panne : BRouter répond (en silence pour l'utilisateur)", async () => {
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

  it("pas de chemin (400) : pas de secours — un autre moteur n'en trouverait pas", async () => {
    serve(() => new Response(JSON.stringify({ code: "DistanceExceeded" }), { status: 400 }));
    await expect(run()).rejects.toMatchObject({ reason: "noRoute" });
    expect(calls).toEqual(["valhalla"]);
  });

  it("le même parcours redemandé sort du cache : un seul appel", async () => {
    serve(() => new Response(JSON.stringify(valhallaOk)));
    await run();
    await run();
    expect(calls).toEqual(["valhalla"]);
  });

  it("deux profils au même tracé ne font qu'une proposition", async () => {
    serve(() => new Response(JSON.stringify(valhallaOk)));
    const pending = getBikeProposals(points);
    await vi.runAllTimersAsync();
    const proposals = await pending;
    expect(proposals).toHaveLength(1);
    expect(proposals[0].merged).toBe(true);
    // Les mêmes rues : on garde le plus sûr, celui qui roule sur la piste.
    expect(proposals[0].profile).toBe("safe");
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

describe("deux tracés, les mêmes rues", () => {
  const straight = line(20).map(([lon, lat]) => [lon, lat]);

  it("une piste le long de la chaussée, à une dizaine de mètres, suit les mêmes rues", () => {
    expect(sameLine(straight, line(20).map(([lon, lat]) => [lon, lat + 0.0001]))).toBe(true);
  });

  it("un détour de 500 m en fait un autre parcours", () => {
    const detour = line(20).map(([lon, lat], i) => [lon, i > 5 && i < 15 ? lat + 0.005 : lat]);
    expect(sameLine(straight, detour)).toBe(false);
  });
});
