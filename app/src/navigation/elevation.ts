import { CONFIG } from "../config";
import type { LonLat } from "../types";
import { distance as haversine, interpolate } from "./geo";
import type { NavRoute } from "./route";

/** Ce dont le relevé a besoin d'un tracé : ses points et leurs distances. */
interface Path {
  points: LonLat[];
  measures: number[];
  distanceMeters: number;
}

// ---------------------------------------------------------------------------
// Le profil du dénivelé, lu dans les **tuiles d'altitude déjà utilisées par
// l'ombrage** (`CONFIG.TERRAIN_TILE_URL`, encodage « terrarium »).
//
// C'est ce qui évite d'ajouter une source : ces tuiles sont mondiales, sans
// clé, autorisent l'origine croisée, et le calque « Relief » les demande déjà —
// il y a donc de bonnes chances qu'elles soient dans le cache du navigateur.
// Un service de profil d'altitude aurait été un appel de plus, une limite de
// plus, et une couverture à vérifier.
//
// L'encodage a été relevé dans le projet et vérifié sur de vraies tuiles :
//
//     altitude = (R × 256 + G + B / 256) − 32768
// ---------------------------------------------------------------------------

/** Combien de tuiles au plus on accepte de télécharger pour un profil. */
const MAX_TILES = 16;

/** Zoom de départ : ~6 m par pixel sous nos latitudes, assez fin pour un pas. */
const START_ZOOM = 14;

/** Zoom plancher : en dessous, le profil ne décrit plus le parcours. */
const MIN_ZOOM = 10;

/**
 * Marche d'escalier ignorée dans le cumul. Sans ce seuil, le bruit du modèle
 * d'altitude — quelques dizaines de centimètres d'un point au suivant —
 * s'additionnerait sur deux cents relevés et annoncerait cent mètres de
 * dénivelé sur un parcours plat.
 */
const GAIN_THRESHOLD = 3;

export interface ElevationSample {
  /** Distance depuis le départ, en mètres. */
  atMeters: number;
  /** Altitude, en mètres. */
  elevation: number;
}

export interface ElevationProfile {
  samples: ElevationSample[];
  /** Cumul des montées, en mètres (D+). */
  ascent: number;
  /** Cumul des descentes, en mètres (D−). */
  descent: number;
  minElevation: number;
  maxElevation: number;
}

/**
 * Relève l'altitude tout au long du tracé.
 *
 * Les points sont échantillonnés à intervalle régulier — on ne suit pas les
 * sommets du tracé, dont la densité varie avec les virages, mais la distance
 * parcourue, qui est l'axe du graphe.
 */
export async function sampleElevation(route: NavRoute, signal?: AbortSignal): Promise<ElevationProfile> {
  return sampleAlong(route.points, route.measures, route.distanceMeters, signal);
}

/**
 * Le même relevé pour un tracé nu, sans manœuvres : c'est sous cette forme
 * qu'un trajet terminé est gardé dans l'historique, où l'on ne retient que le
 * chemin parcouru.
 */
export async function sampleElevationAlong(
  points: LonLat[],
  signal?: AbortSignal
): Promise<ElevationProfile> {
  if (points.length < 2) throw new Error("elevation needs a path");
  const measures = [0];
  for (let i = 1; i < points.length; i++) {
    measures.push(measures[i - 1] + haversine(points[i - 1], points[i]));
  }
  return sampleAlong(points, measures, measures[measures.length - 1], signal);
}

async function sampleAlong(
  path: LonLat[],
  measures: number[],
  totalMeters: number,
  signal?: AbortSignal
): Promise<ElevationProfile> {
  const route = { points: path, measures, distanceMeters: totalMeters };
  const count = Math.max(32, Math.min(200, Math.round(totalMeters / 20)));
  const points: LonLat[] = [];
  const distances: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = (totalMeters * i) / (count - 1);
    distances.push(at);
    points.push(pointAt(route, at));
  }

  const zoom = pickZoom(points);
  const tiles = new Map<string, Uint8ClampedArray | null>();
  const needed = new Set(points.map((p) => tileKey(p, zoom)));
  await Promise.all(
    [...needed].map(async (key) => {
      tiles.set(key, await loadTile(key, signal));
    })
  );

  const raw: number[] = [];
  for (const point of points) {
    raw.push(readElevation(tiles.get(tileKey(point, zoom)) ?? null, point, zoom));
  }
  if (raw.every((value) => Number.isNaN(value))) {
    throw new Error("elevation unavailable");
  }

  const smoothed = smooth(fillGaps(raw));
  const samples = smoothed.map((elevation, index) => ({ atMeters: distances[index], elevation }));

  let ascent = 0;
  let descent = 0;
  let reference = smoothed[0];
  for (const elevation of smoothed) {
    if (elevation - reference > GAIN_THRESHOLD) {
      ascent += elevation - reference;
      reference = elevation;
    } else if (reference - elevation > GAIN_THRESHOLD) {
      descent += reference - elevation;
      reference = elevation;
    }
  }

  return {
    samples,
    ascent: Math.round(ascent),
    descent: Math.round(descent),
    minElevation: Math.min(...smoothed),
    maxElevation: Math.max(...smoothed),
  };
}

/** Le point du tracé à cette distance du départ. */
function pointAt(route: Path, atMeters: number): LonLat {
  const { measures, points } = route;
  if (atMeters <= 0) return points[0];
  if (atMeters >= route.distanceMeters) return points[points.length - 1];
  let low = 0;
  let high = measures.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measures[middle] <= atMeters) low = middle;
    else high = middle - 1;
  }
  const span = measures[low + 1] - measures[low];
  const t = span > 0 ? (atMeters - measures[low]) / span : 0;
  return interpolate(points[low], points[low + 1], t);
}

/**
 * Le zoom le plus fin qui tienne dans le budget de tuiles. Le décompte porte
 * sur les tuiles **réellement traversées** et non sur l'emprise du parcours :
 * un trajet en diagonale couvre un large rectangle mais ne touche qu'une
 * poignée de tuiles.
 */
function pickZoom(points: LonLat[]): number {
  for (let zoom = Math.min(START_ZOOM, CONFIG.TERRAIN_MAX_ZOOM); zoom > MIN_ZOOM; zoom--) {
    const tiles = new Set(points.map((p) => tileKey(p, zoom)));
    if (tiles.size <= MAX_TILES) return zoom;
  }
  return MIN_ZOOM;
}

/** Coordonnées fractionnaires de tuile (Web Mercator) pour un point. */
function tileCoords(point: LonLat, zoom: number): { x: number; y: number } {
  const scale = 2 ** zoom;
  const sin = Math.sin((point.lat * Math.PI) / 180);
  return {
    x: ((point.lon + 180) / 360) * scale,
    // Bornée : à l'approche des pôles, `log((1+sin)/(1-sin))` diverge et la
    // coordonnée sortirait de la grille.
    y: Math.max(
      0,
      Math.min(scale - 1e-6, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale)
    ),
  };
}

function tileKey(point: LonLat, zoom: number): string {
  const { x, y } = tileCoords(point, zoom);
  return `${zoom}/${Math.floor(x)}/${Math.floor(y)}`;
}

/**
 * Les tuiles déjà décodées, gardées d'un profil à l'autre : deux parcours dans
 * le même quartier lisent les mêmes. Le cache est vidé d'un bloc quand il
 * grossit — 256 × 256 × 4 octets la tuile, il n'a pas à s'accumuler.
 */
const tileCache = new Map<string, Uint8ClampedArray | null>();
const TILE_CACHE_MAX = 48;

/**
 * Télécharge une tuile d'altitude et en rend les pixels.
 *
 * Le passage par `fetch` puis `createImageBitmap` évite de « teinter » le
 * canvas : une image chargée par son URL en interdirait la relecture, et c'est
 * précisément les octets qu'on vient chercher.
 */
async function loadTile(key: string, signal?: AbortSignal): Promise<Uint8ClampedArray | null> {
  const cached = tileCache.get(key);
  if (cached !== undefined) return cached;

  const [z, x, y] = key.split("/");
  const url = CONFIG.TERRAIN_TILE_URL.replace("{z}", z).replace("{x}", x).replace("{y}", y);
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(String(res.status));
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    bitmap.close();
    if (tileCache.size >= TILE_CACHE_MAX) tileCache.clear();
    tileCache.set(key, pixels);
    return pixels;
  } catch {
    // Une tuile manquante n'annule pas le profil : le trou est comblé par ses
    // voisines (voir `fillGaps`). En mer, hors couverture, c'est le cas normal.
    if (signal?.aborted) throw new Error("aborted");
    tileCache.set(key, null);
    return null;
  }
}

/** L'altitude d'un point dans une tuile décodée. */
function readElevation(pixels: Uint8ClampedArray | null, point: LonLat, zoom: number): number {
  if (!pixels) return NaN;
  const size = Math.sqrt(pixels.length / 4);
  const { x, y } = tileCoords(point, zoom);
  const px = Math.min(size - 1, Math.floor((x - Math.floor(x)) * size));
  const py = Math.min(size - 1, Math.floor((y - Math.floor(y)) * size));
  const offset = (py * size + px) * 4;
  return pixels[offset] * 256 + pixels[offset + 1] + pixels[offset + 2] / 256 - 32768;
}

/** Comble les relevés manquants par le dernier connu, de part et d'autre. */
function fillGaps(values: number[]): number[] {
  const filled = [...values];
  let last = filled.find((value) => !Number.isNaN(value)) ?? 0;
  for (let i = 0; i < filled.length; i++) {
    if (Number.isNaN(filled[i])) filled[i] = last;
    else last = filled[i];
  }
  return filled;
}

/**
 * Moyenne glissante sur trois relevés. Le modèle d'altitude est échantillonné
 * au pixel : deux points voisins peuvent tomber de part et d'autre d'une marche
 * d'un mètre qui n'existe pas sur le terrain, et le graphe en devient hérissé.
 */
function smooth(values: number[]): number[] {
  return values.map((value, index) => {
    const before = values[index - 1] ?? value;
    const after = values[index + 1] ?? value;
    return (before + value + after) / 3;
  });
}
