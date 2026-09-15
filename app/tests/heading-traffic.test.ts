import { describe, expect, it } from "vitest";
import { angleBetween, NO_STREAK, nextWrongWay, WRONG_WAY_FIXES } from "../src/navigation/car/heading";
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
