import { describe, expect, it } from "vitest";
import { PRELOAD_AHEAD_METERS, tilesAhead } from "../src/navigation/car/routeTiles";
import { latToTileY, lonToTileX } from "../src/services/offline/tiles";
import { distance } from "../src/navigation/geo";

// Un tracé dont on connaît tout : vingt kilomètres plein est, puis dix plein
// nord, depuis Champigny. La vérité est recalculée ici point par point, sans
// passer par le code éprouvé.
const lat0 = 48.8;
const lon0 = 2.5;
const east = (meters: number) => meters / (111_320 * Math.cos((lat0 * Math.PI) / 180));
const north = (meters: number) => meters / 110_574;
const points = [
  { lon: lon0, lat: lat0 },
  { lon: lon0 + east(20_000), lat: lat0 },
  { lon: lon0 + east(20_000), lat: lat0 + north(10_000) },
];
const measures = [0];
for (let i = 1; i < points.length; i++) measures.push(measures[i - 1] + distance(points[i - 1], points[i]));
const route = { points, measures };

/** Le point du tracé à `meters` du départ, calculé à la main. */
function at(meters: number) {
  return meters <= 20_000
    ? { lon: lon0 + east(meters), lat: lat0 }
    : { lon: lon0 + east(20_000), lat: lat0 + north(meters - 20_000) };
}

const key = (z: number, lon: number, lat: number) => `${z}/${lonToTileX(lon, z)}/${latToTileY(lat, z)}`;

describe("tilesAhead — la carte des kilomètres à venir", () => {
  const tiles = tilesAhead(route, 0, PRELOAD_AHEAD_METERS);
  const keys = new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`));

  it("couvre chaque mètre des quinze kilomètres, aux trois zooms", () => {
    for (let meters = 0; meters <= PRELOAD_AHEAD_METERS; meters += 10) {
      const p = at(meters);
      for (const z of [12, 13, 14]) expect(keys.has(key(z, p.lon, p.lat)), `${meters} m, zoom ${z}`).toBe(true);
    }
  });

  it("couvre aussi 400 m de chaque côté au zoom 14 : la route peut longer le bord d'une tuile", () => {
    for (let meters = 0; meters <= PRELOAD_AHEAD_METERS; meters += 50) {
      const p = at(meters);
      expect(keys.has(key(14, p.lon, p.lat + north(400)))).toBe(true);
      expect(keys.has(key(14, p.lon, p.lat - north(400)))).toBe(true);
    }
  });

  it("s'arrête à quinze kilomètres : rien de la fin du trajet", () => {
    const far = at(19_500);
    expect(keys.has(key(14, far.lon, far.lat))).toBe(false);
    const end = at(29_000);
    expect(keys.has(key(13, end.lon, end.lat))).toBe(false);
  });

  it("reste une poignée de tuiles, sans doublon, les plus proches d'abord", () => {
    expect(keys.size).toBe(tiles.length);
    // 15 km font 9,3 tuiles de zoom 14 en longueur (1,61 km à cette latitude),
    // sur deux rangs au plus avec la marge : une quarantaine tous zooms compris.
    expect(tiles.length).toBeGreaterThan(15);
    expect(tiles.length).toBeLessThan(60);
    expect(`${tiles[0].z}/${tiles[0].x}/${tiles[0].y}`).toBe(key(14, lon0, lat0));
  });

  it("suit la route : la fenêtre avance et prend le virage", () => {
    const later = new Set(tilesAhead(route, 12_000, 12_000 + PRELOAD_AHEAD_METERS).map((t) => `${t.z}/${t.x}/${t.y}`));
    const turned = at(26_000);
    expect(later.has(key(14, turned.lon, turned.lat))).toBe(true);
    expect(later.has(key(14, lon0, lat0))).toBe(false);
  });

  it("ne dépasse pas la fin du tracé", () => {
    const tail = tilesAhead(route, 29_500, 29_500 + PRELOAD_AHEAD_METERS);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.length).toBeLessThan(12);
  });
});
