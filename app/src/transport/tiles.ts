import type { GeoTile } from "./model";

// ---------------------------------------------------------------------------
// Découpage en tuiles XYZ (Web Mercator) des demandes d'arrêts.
//
// Les arrêts se demandent par tuile et non par emprise visible : une tuile a
// une clé stable, donc un cache qui sert d'un déplacement à l'autre, alors
// qu'une emprise ne se répète jamais au mètre près.
// ---------------------------------------------------------------------------

/** Emprise `[sud, ouest, nord, est]`, l'ordre de `currentBbox` dans `MapView`. */
export type ViewBbox = [number, number, number, number];

const MAX_LAT = 85.05112878;

function tileCoords(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const rad = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return [x, y];
}

/** Les tuiles qui couvrent une emprise, de la plus proche du centre à la plus lointaine. */
export function tilesForBbox(bbox: ViewBbox, z: number): GeoTile[] {
  const [south, west, north, east] = bbox;
  const n = 2 ** z;
  const [x0, y0] = tileCoords(west, north, z);
  const [x1, y1] = tileCoords(east, south, z);
  const [cx, cy] = tileCoords((west + east) / 2, (south + north) / 2, z);
  const tiles: (GeoTile & { distance: number })[] = [];
  for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(n - 1, Math.floor(y1)); y++) {
      tiles.push({ z, x: ((x % n) + n) % n, y, distance: (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 });
    }
  }
  return tiles.sort((a, b) => a.distance - b.distance).map(({ z: tz, x, y }) => ({ z: tz, x, y }));
}

/** Emprise d'une tuile, `[ouest, sud, est, nord]`. */
export function tileBounds({ z, x, y }: GeoTile): [number, number, number, number] {
  const n = 2 ** z;
  const lon = (tx: number) => (tx / n) * 360 - 180;
  const lat = (ty: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}

export const tileKey = ({ z, x, y }: GeoTile) => `${z}/${x}/${y}`;
