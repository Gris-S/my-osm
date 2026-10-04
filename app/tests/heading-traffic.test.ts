import { describe, expect, it } from "vitest";
import { angleBetween, HELD_BEARING_METERS, NO_STREAK, nextCameraBearing, nextWrongWay, WRONG_WAY_FIXES } from "../src/navigation/car/heading";
import { bearingAround } from "../src/navigation/car/carProgress";
import { distance } from "../src/navigation/geo";
import { readTrafficSection, trafficOverlay, trafficSegments } from "../src/navigation/car/carTraffic";
import type { CarRoute } from "../src/navigation/car/carRoute";

describe("angleBetween", () => {
  it("prend le plus court chemin, autour du nord compris", () => {
    expect(angleBetween(350, 10)).toBe(20);
    expect(angleBetween(10, 350)).toBe(20);
    expect(angleBetween(0, 180)).toBe(180);
    expect(angleBetween(90, 90)).toBe(0);
    expect(angleBetween(-30, 30)).toBe(60);
  });
});

describe("nextWrongWay — le contresens se voit au cap", () => {
  const along = { routeBearing: 90, offRoute: false };

  it(`recalcule après ${WRONG_WAY_FIXES} relevés à contresens sans avancer`, () => {
    const first = nextWrongWay(NO_STREAK, { ...along, gpsHeading: 270, traveledMeters: 0 });
    expect(first.reroute).toBe(false);
    const second = nextWrongWay(first.streak, { ...along, gpsHeading: 265, traveledMeters: 0 });
    expect(second.reroute).toBe(true);
    expect(second.streak).toEqual(NO_STREAK);
  });

  it("ne dit rien à l'arrêt (cap inconnu) ni dans le bon sens", () => {
    expect(nextWrongWay(NO_STREAK, { ...along, gpsHeading: null, traveledMeters: 0 }).streak).toEqual(NO_STREAK);
    expect(nextWrongWay(NO_STREAK, { ...along, gpsHeading: 100, traveledMeters: 0 }).streak).toEqual(NO_STREAK);
  });

  it("tolère un virage presque en équerre (jusqu'à 120°)", () => {
    expect(nextWrongWay(NO_STREAK, { ...along, gpsHeading: 205, traveledMeters: 0 }).streak.fixes).toBe(0);
  });

  it("laisse passer un rond-point : on avance sur le tracé malgré le cap", () => {
    const first = nextWrongWay(NO_STREAK, { ...along, gpsHeading: 270, traveledMeters: 100 });
    const second = nextWrongWay(first.streak, { ...along, gpsHeading: 270, traveledMeters: 112 });
    expect(second.reroute).toBe(false);
    expect(second.streak).toEqual(NO_STREAK);
  });

  it("s'efface hors du parcours : c'est alors la règle de l'écart", () => {
    const first = nextWrongWay(NO_STREAK, { ...along, gpsHeading: 270, traveledMeters: 0 });
    const off = nextWrongWay(first.streak, { routeBearing: 90, offRoute: true, gpsHeading: 270, traveledMeters: 0 });
    expect(off.reroute).toBe(false);
    expect(off.streak).toEqual(NO_STREAK);
  });
});

describe("nextCameraBearing — la carte ne tourne que quand la voiture tourne", () => {
  // Le cas du 3 octobre 2026 : on roule plein est, on s'arrête vingt mètres
  // avant de tourner à gauche (plein nord). Le tracé, cent mètres devant, est
  // déjà dans la rue d'après.
  const lat = 48.8;
  const east = (meters: number) => meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  const north = (meters: number) => meters / 110_574;
  const points = [
    { lon: 2.5, lat },
    { lon: 2.5 + east(200), lat },
    { lon: 2.5 + east(200), lat: lat + north(300) },
  ];
  const measures = [0];
  for (let i = 1; i < points.length; i++) measures.push(measures[i - 1] + distance(points[i - 1], points[i]));
  const route = { points, measures } as unknown as CarRoute;
  const under = (meters: number) => bearingAround(route, meters);

  it("le tracé d'essai va bien à l'est puis au nord", () => {
    expect(under(100)).toBeCloseTo(90, 0);
    expect(under(300)).toBeCloseTo(0, 0);
  });

  it("en roulant, suit le cap du récepteur", () => {
    const moving = nextCameraBearing(null, { gpsHeading: 88, routeBearing: under(150), meters: 150 });
    expect(moving).toEqual({ bearing: 88, fromGps: true, atMeters: 150 });
  });

  it("arrêté vingt mètres avant le virage, garde le cap qu'on avait — pas celui de la rue d'après", () => {
    let camera = nextCameraBearing(null, { gpsHeading: 90, routeBearing: under(170), meters: 170 });
    // Dix relevés à l'arrêt, la flèche glissant de quelques mètres sous le tremblement du GPS.
    for (const meters of [176, 178, 180, 180, 181, 181, 182, 182, 182, 183]) {
      camera = nextCameraBearing(camera, { gpsHeading: null, routeBearing: under(meters), meters });
      expect(camera?.bearing).toBe(90);
    }
  });

  it("au pas dans le virage, tourne avec le tracé sous la flèche — ni avant, ni d'un coup", () => {
    let camera = nextCameraBearing(null, { gpsHeading: 90, routeBearing: under(170), meters: 170 });
    const seen: number[] = [];
    for (let meters = 172; meters <= 230; meters += 2) {
      camera = nextCameraBearing(camera, { gpsHeading: null, routeBearing: under(meters), meters });
      seen.push(camera?.bearing ?? NaN);
    }
    // Encore plein est tant que la flèche n'a pas avancé de la distance tenue…
    expect(seen[0]).toBe(90);
    expect(seen[Math.floor(HELD_BEARING_METERS / 2) - 2]).toBe(90);
    // … plein nord une fois le virage passé, et jamais au-delà de l'intervalle.
    expect(seen[seen.length - 1]).toBeCloseTo(0, 0);
    for (const bearing of seen) expect(bearing).toBeLessThanOrEqual(90.5);
    for (const bearing of seen) expect(bearing).toBeGreaterThanOrEqual(-0.5);
    // Sans saut : deux mètres d'avance ne font jamais tourner d'un quart de tour.
    for (let i = 1; i < seen.length; i++) expect(Math.abs(seen[i] - seen[i - 1])).toBeLessThan(25);
  });

  it("au départ, sans avoir jamais roulé, regarde le tracé sous la flèche et non cent mètres devant", () => {
    const start = nextCameraBearing(null, { gpsHeading: null, routeBearing: under(180), meters: 180 });
    expect(start?.fromGps).toBe(false);
    expect(start?.bearing).toBeCloseTo(90, 0);
  });

  it("hors parcours et à l'arrêt, ne bouge pas", () => {
    const held = { bearing: 125, fromGps: true, atMeters: 6459 };
    expect(nextCameraBearing(held, { gpsHeading: null, routeBearing: null, meters: null })).toBe(held);
  });

  it("après un recalcul à l'arrêt, garde le cap et reprend son repère sur le nouveau tracé", () => {
    const held = { bearing: 125, fromGps: true, atMeters: null };
    const next = nextCameraBearing(held, { gpsHeading: null, routeBearing: 300, meters: 2 });
    expect(next).toEqual({ bearing: 125, fromGps: true, atMeters: 2 });
  });
});

describe("readTrafficSection", () => {
  const section = (s: object) => readTrafficSection({ startPointIndex: 0, endPointIndex: 3, ...s });

  it("colore selon l'ampleur : 1 ralenti, 2-3 bouchon", () => {
    expect(section({ simpleCategory: "JAM", magnitudeOfDelay: 1 })?.level).toBe("slow");
    expect(section({ simpleCategory: "JAM", magnitudeOfDelay: 3 })?.level).toBe("jam");
    // Un bouchon d'ampleur inconnue reste signalé.
    expect(section({ simpleCategory: "JAM", magnitudeOfDelay: 0 })?.level).toBe("slow");
  });

  it("pose un repère pour les travaux, fermetures et accidents", () => {
    expect(section({ simpleCategory: "ROAD_WORK", magnitudeOfDelay: 4 })).toMatchObject({ incident: "roadworks", level: null });
    expect(section({ simpleCategory: "ROAD_CLOSURE", magnitudeOfDelay: 2 })).toMatchObject({ incident: "closure", level: null });
    expect(
      section({ simpleCategory: "OTHER", magnitudeOfDelay: 2, tec: { causes: [{ mainCauseCode: 2 }] } }),
    ).toMatchObject({ incident: "accident", level: "jam" });
  });

  it("garde couleur et repère pour un bouchon dû à des travaux (relevé sur la D86)", () => {
    expect(
      section({ simpleCategory: "JAM", magnitudeOfDelay: 2, tec: { causes: [{ mainCauseCode: 1 }, { mainCauseCode: 3 }] } }),
    ).toMatchObject({ level: "jam", incident: "roadworks" });
  });
});

describe("trafficOverlay", () => {
  // Une ligne droite de 11 points, environ 75 m entre chacun.
  const points = Array.from({ length: 11 }, (_, i) => ({ lon: 2 + i * 0.001, lat: 48 }));
  const route = {
    points,
    traffic: [
      { startIndex: 0, endIndex: 3, level: "slow", incident: null, delaySeconds: 30 },
      { startIndex: 4, endIndex: 6, level: "jam", incident: "roadworks", delaySeconds: 60 },
      // Même chantier, découpé par la source, à ~75 m : un seul repère.
      { startIndex: 5, endIndex: 8, level: null, incident: "roadworks", delaySeconds: 0 },
      { startIndex: 9, endIndex: 9, level: "jam", incident: null, delaySeconds: 10 },
    ],
  } as unknown as CarRoute;

  it("découpe les tronçons colorés et ignore ceux de moins de deux points", () => {
    const segments = trafficSegments(route);
    expect(segments.map((s) => s.level)).toEqual(["slow", "jam"]);
    expect(segments[0].geometry.coordinates).toHaveLength(4);
  });

  it("fusionne les repères de même nature à moins de 150 m", () => {
    const { incidents } = trafficOverlay(route);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].kind).toBe("roadworks");
  });
});
