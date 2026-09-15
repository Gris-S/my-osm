// ---------------------------------------------------------------------------
// Le contour d'une zone : pays, région ou département choisi sur la carte.
//
// Une zone suit **son contour exact**, pas le rectangle qui l'entoure : la
// Bretagne sans la Manche, la France sans l'Espagne. Ce module traduit ce
// contour en tuiles, sans réseau.
//
// Le parcours est **hiérarchique** : on part de la tuile du zoom 0 et l'on ne
// descend que dans celles que le contour traverse. Une tuile qu'aucun bord ne
// traverse est entièrement dedans ou entièrement dehors — un seul test de
// point le dit — et si elle est dedans, toutes ses descendantes le sont aussi :
// on les compte par arithmétique au lieu de les visiter. C'est ce qui rend un
// pays entier calculable pendant qu'on regarde la fenêtre, là où tester chaque
// tuile contre chaque sommet se compterait en secondes.
// ---------------------------------------------------------------------------

import type { Bbox, Tile } from "./tiles";

/** Le contour, en GeoJSON — tel que Nominatim le rend. */
export type AreaGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export interface Area {
  geometry: AreaGeometry;
  /**
   * Marge ajoutée autour de chaque tuile testée, en degrés : la tolérance de
   * simplification du contour. Un contour simplifié peut couper un cap ; sans
   * cette marge, les tuiles de la côte qu'il a rabotée manqueraient.
   */
  margin: number;
}

interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Tous les anneaux, extérieurs et trous confondus. */
function ringsOf(geometry: AreaGeometry): number[][][] {
  return geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
}

// Les bords ne se recalculent pas à chaque appel : une même zone est parcourue
// pour l'estimation, le calibrage et les mailles d'Overpass.
const edgeCache = new WeakMap<AreaGeometry, Edge[]>();

function edgesOf(geometry: AreaGeometry): Edge[] {
  let edges = edgeCache.get(geometry);
  if (!edges) {
    edges = [];
    for (const ring of ringsOf(geometry)) {
      for (let i = 0; i + 1 < ring.length; i++) {
        edges.push({ x1: ring[i][0], y1: ring[i][1], x2: ring[i + 1][0], y2: ring[i + 1][1] });
      }
    }
    edgeCache.set(geometry, edges);
  }
  return edges;
}

/**
 * Point dans le contour, règle pair-impair sur tous les anneaux : elle traite
 * d'un même geste les trous d'un polygone et les morceaux d'un multipolygone.
 */
function contains(edges: Edge[], x: number, y: number): boolean {
  let inside = false;
  for (const { x1, y1, x2, y2 } of edges) {
    if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

/** Le segment rencontre-t-il le rectangle ? (découpage de Liang-Barsky) */
function crosses({ x1, y1, x2, y2 }: Edge, [w, s, e, n]: Bbox): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, x1 - w],
    [dx, e - x1],
    [-dy, y1 - s],
    [dy, n - y1],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

/** L'emprise d'une tuile, en degrés. */
export function tileBbox({ z, x, y }: Tile): Bbox {
  const size = 2 ** z;
  const lat = (row: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / size))) * 180) / Math.PI;
  return [(x / size) * 360 - 180, lat(y + 1), ((x + 1) / size) * 360 - 180, lat(y)];
}

/** Le rectangle qui entoure le contour. */
export function areaBbox(geometry: AreaGeometry): Bbox {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const ring of ringsOf(geometry)) {
    for (const [x, y] of ring) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return [w, s, e, n];
}

/**
 * Surface du contour en « degrés carrés », trous déduits — la même unité que
 * l'estimation des détails de lieux, calibrée sur l'emprise d'un rectangle.
 */
export function areaDeg2(geometry: AreaGeometry): number {
  const shoelace = (ring: number[][]) => {
    let sum = 0;
    for (let i = 0; i + 1 < ring.length; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    return Math.abs(sum) / 2;
  };
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let total = 0;
  for (const [outer, ...holes] of polygons) {
    total += shoelace(outer) - holes.reduce((acc, hole) => acc + shoelace(hole), 0);
  }
  return total;
}

/**
 * Parcourt les tuiles qui touchent la zone, jusqu'à `maxZoom`.
 *
 * `visit` reçoit chaque tuile traversée par le contour (`full = false`), et
 * chaque tuile **entièrement dedans** (`full = true`) — dont les descendantes
 * ne sont alors pas visitées : à l'appelant de les compter ou de les dérouler.
 */
function walk(area: Area, maxZoom: number, visit: (tile: Tile, full: boolean) => void) {
  const all = edgesOf(area.geometry);
  const m = area.margin;

  const step = (tile: Tile, edges: Edge[]) => {
    const [w, s, e, n] = tileBbox(tile);
    const box: Bbox = [w - m, s - m, e + m, n + m];
    const near = edges.filter((edge) => crosses(edge, box));
    if (!near.length) {
      // Aucun bord ne passe : tout dedans, ou tout dehors.
      if (contains(all, (w + e) / 2, (s + n) / 2)) visit(tile, true);
      return;
    }
    visit(tile, false);
    if (tile.z >= maxZoom) return;
    const z = tile.z + 1;
    const x = tile.x * 2;
    const y = tile.y * 2;
    step({ z, x, y }, near);
    step({ z, x: x + 1, y }, near);
    step({ z, x, y: y + 1 }, near);
    step({ z, x: x + 1, y: y + 1 }, near);
  };

  step({ z: 0, x: 0, y: 0 }, all);
}

/**
 * Au-delà de ce zoom, les comptes sont **majorés** au lieu d'être exacts : une
 * tuile du bord y compte pour toutes ses descendantes. Descendre le contour
 * d'un pays jusqu'au zoom 19 du satellite, c'est des centaines de milliers de
 * tuiles de bord à chaque cran du curseur ; la majoration ne pèse que sur la
 * frange, et une estimation doit pécher par excès. Le téléchargement, lui,
 * énumère exactement (`areaTiles`).
 */
const EXACT_COUNT_ZOOM = 12;

/** Le nombre de tuiles qui touchent la zone, zoom par zoom, de 0 à `maxZoom`. */
export function areaTileCounts(area: Area, maxZoom: number): number[] {
  const counts = new Array<number>(maxZoom + 1).fill(0);
  const exactUntil = Math.min(maxZoom, EXACT_COUNT_ZOOM);
  walk(area, exactUntil, (tile, full) => {
    // Une tuile pleine, ou une tuile du bord au dernier zoom exact : toutes
    // ses descendantes comptent.
    const spread = full || tile.z === exactUntil;
    const last = spread ? maxZoom : tile.z;
    for (let z = tile.z; z <= last; z++) counts[z] += 4 ** (z - tile.z);
  });
  return counts;
}

/** Les tuiles qui touchent la zone, de `minZoom` à `maxZoom`. */
export function areaTiles(area: Area, maxZoom: number, minZoom = 0): Tile[] {
  const out: Tile[] = [];
  walk(area, maxZoom, (tile, full) => {
    if (!full) {
      if (tile.z >= minZoom) out.push(tile);
      return;
    }
    for (let z = Math.max(tile.z, minZoom); z <= maxZoom; z++) {
      const size = 2 ** (z - tile.z);
      for (let dx = 0; dx < size; dx++) {
        for (let dy = 0; dy < size; dy++) out.push({ z, x: tile.x * size + dx, y: tile.y * size + dy });
      }
    }
  });
  return out;
}

/** Vrai si le point est dans la zone — pour trier ce qui arrive par rectangle. */
export function areaContains(area: Area, lon: number, lat: number): boolean {
  return contains(edgesOf(area.geometry), lon, lat);
}
