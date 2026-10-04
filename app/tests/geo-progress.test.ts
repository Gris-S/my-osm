import { describe, expect, it } from "vitest";
import { bearing, distance, interpolate, projectOnSegment } from "../src/navigation/geo";
import { locateOnPath, OFF_ROUTE_METERS, SAME_PLACE_METERS, type Path } from "../src/navigation/progress";
import { bearingAround, computeCarProgress, isOffRoute, pointAtMeters } from "../src/navigation/car/carProgress";
import type { CarRoute } from "../src/navigation/car/carRoute";

/** Un tracé à partir de points, avec ses distances cumulées. */
function pathOf(points: { lon: number; lat: number }[]): Path {
  const measures = [0];
  for (let i = 1; i < points.length; i++) measures.push(measures[i - 1] + distance(points[i - 1], points[i]));
  return { points, measures };
}

/** Un itinéraire voiture minimal autour d'un tracé. */
function carRouteOf(points: { lon: number; lat: number }[]): CarRoute {
  const { measures } = pathOf(points);
  const total = measures[measures.length - 1];
  return {
    points,
    measures,
    steps: [
      { maneuver: { kind: "depart", street: "", road: "", exit: null, waypoint: null }, atMeters: 0, atSeconds: 0, location: points[0] },
      { maneuver: { kind: "arrive", street: "", road: "", exit: null, waypoint: null }, atMeters: total, atSeconds: 600, location: points[points.length - 1] },
    ],
    lanes: [],
    speedZones: [],
    tollSections: [],
    traffic: [],
    distanceMeters: total,
    durationSeconds: 600,
    trafficDelaySeconds: 0,
    live: true,
    result: { mode: "driving", distanceMeters: total, durationSeconds: 600, segments: [] },
  } as unknown as CarRoute;
}

describe("geo", () => {
  it("mesure la distance Paris → Lyon à quelques kilomètres près", () => {
    const km = distance({ lon: 2.3522, lat: 48.8566 }, { lon: 4.8357, lat: 45.764 }) / 1000;
    expect(km).toBeGreaterThan(385);
    expect(km).toBeLessThan(400);
  });

  it("donne le cap : nord 0°, est 90°", () => {
    expect(bearing({ lon: 2, lat: 48 }, { lon: 2, lat: 49 })).toBeCloseTo(0, 0);
    expect(bearing({ lon: 2, lat: 48 }, { lon: 2.1, lat: 48 })).toBeCloseTo(90, 0);
  });

  it("projette un point sur un segment et borne la projection à ses extrémités", () => {
    const a = { lon: 2, lat: 48 };
    const b = { lon: 2.01, lat: 48 };
    const middle = projectOnSegment({ lon: 2.005, lat: 48.001 }, a, b);
    expect(middle.t).toBeCloseTo(0.5, 2);
    expect(middle.offset).toBeGreaterThan(100);
    expect(middle.offset).toBeLessThan(120);
    expect(projectOnSegment({ lon: 1.99, lat: 48 }, a, b).t).toBe(0);
    expect(interpolate(a, b, 0.5).lon).toBeCloseTo(2.005, 6);
  });
});

describe("locateOnPath", () => {
  const path = pathOf([
    { lon: 2.0, lat: 48.0 },
    { lon: 2.01, lat: 48.0 },
    { lon: 2.02, lat: 48.0 },
  ]);

  it("ramène une position sur le tracé, avec l'avancement et l'écart", () => {
    const found = locateOnPath(path, { lon: 2.015, lat: 48.0001 });
    expect(found.index).toBe(1);
    expect(found.offset).toBeLessThan(15);
    expect(found.measure).toBeCloseTo(path.measures[1] + (path.measures[2] - path.measures[1]) / 2, -1);
  });

  it("signale l'écart quand on s'éloigne franchement", () => {
    const found = locateOnPath(path, { lon: 2.015, lat: 48.002 });
    expect(found.offset).toBeGreaterThan(OFF_ROUTE_METERS);
  });
});

describe("carProgress", () => {
  // Un L : 700 m vers l'est, puis 700 m vers le nord.
  const route = carRouteOf([
    { lon: 2.0, lat: 48.0 },
    { lon: 2.0094, lat: 48.0 },
    { lon: 2.0094, lat: 48.0063 },
  ]);
  const corner = route.measures[1];

  it("interpole un point à une distance donnée, bornes comprises", () => {
    expect(pointAtMeters(route, -10)).toEqual(route.points[0]);
    expect(pointAtMeters(route, 1e9)).toEqual(route.points[2]);
    const half = pointAtMeters(route, corner / 2);
    expect(half.lat).toBeCloseTo(48.0, 6);
    expect(half.lon).toBeCloseTo(2.0047, 3);
  });

  it("prend le cap du trait sous la position : est avant le coin, nord après", () => {
    expect(bearingAround(route, corner / 2)).toBeCloseTo(90, 0);
    expect(bearingAround(route, corner + 300)).toBeCloseTo(0, 0);
  });

  it("calcule l'avancement, le restant et l'arrivée", () => {
    const start = computeCarProgress(route, { lon: 2.001, lat: 48.0 });
    expect(isOffRoute(start)).toBe(false);
    expect(start.remainingMeters).toBeGreaterThan(1200);
    expect(start.arrived).toBe(false);
    const end = computeCarProgress(route, route.points[2], start.index);
    expect(end.arrived).toBe(true);
  });

  it("ne tient pas pour arrivé un relevé lointain projeté sur la fin", () => {
    // Deux kilomètres au nord-est de l'arrivée : la projection tombe sur la
    // fin du tracé, mais on n'y est pas (17 septembre 2026 : « 0 min · 12 km »).
    const far = computeCarProgress(route, { lon: 2.03, lat: 48.02 });
    expect(far.remainingMeters).toBeLessThan(50);
    expect(far.arrived).toBe(false);
  });
});

describe("locateOnPath — un tracé qui repasse au même endroit", () => {
  // Le cas du 3 octobre 2026 : on roule vers l'est, le tracé part d'ici, fait
  // le tour du pâté de maisons et revient **dans la même rue, en sens
  // inverse**, deux mètres à côté. La vérité est connue : on est au départ.
  const lat = 48.8;
  const east = (meters: number) => meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  const north = (meters: number) => meters / 110_574;
  const at = (x: number, y: number) => ({ lon: 2.5 + east(x), lat: lat + north(y) });
  const loop = pathOf([at(0, 0), at(200, 0), at(200, 150), at(-100, 150), at(-100, 2), at(150, 2)]);
  const total = loop.measures[loop.measures.length - 1];

  it("le tracé d'essai repasse bien au-dessus de son départ", () => {
    expect(total).toBeGreaterThan(900);
    // À 20 m du départ, le retour passe à deux mètres : dans la marge.
    expect(2).toBeLessThan(SAME_PLACE_METERS);
  });

  it("au départ, on reste au départ même si le retour est un peu plus près", () => {
    // 1,6 m au nord de l'aller : à 0,4 m du retour, à 1,6 m de l'aller.
    const found = locateOnPath(loop, at(20, 1.6), 0);
    expect(found.measure).toBeCloseTo(20, 0);
    expect(found.index).toBe(0);
  });

  it("au fil des relevés, on avance sur l'aller sans jamais sauter au retour", () => {
    let from = 0;
    for (let x = 0; x <= 140; x += 10) {
      const found = locateOnPath(loop, at(x, 1.6), from);
      expect(found.measure, `à ${x} m`).toBeCloseTo(x, 0);
      from = found.index;
    }
  });

  it("revenu par le dernier tronçon, on est bien sur le retour", () => {
    // On vient du tronçon qui descend (rang 3) : c'est le retour qui est voisin.
    const found = locateOnPath(loop, at(60, 0.4), 4);
    expect(found.index).toBe(4);
    expect(found.measure).toBeCloseTo(total - 90, 0);
  });

  it("un passage nettement plus proche l'emporte toujours", () => {
    // Douze mètres au nord de l'aller ? Non : ici, loin de l'aller (150 m au nord), seul un tronçon convient.
    const found = locateOnPath(loop, at(50, 149), 0);
    expect(found.index).toBe(2);
  });

  it("sur un tracé simple, rien ne change : on suit les sommets sans retard", () => {
    const line = pathOf(Array.from({ length: 60 }, (_, k) => at(k * 5, 0)));
    let from = 0;
    for (let x = 0; x <= 290; x += 7) {
      const found = locateOnPath(line, at(x, 4), from);
      expect(found.measure, `à ${x} m`).toBeCloseTo(x, 0);
      from = found.index;
    }
  });
});
