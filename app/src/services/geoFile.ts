import type { LonLat } from "../types";
import { distance } from "../navigation/geo";

// ---------------------------------------------------------------------------
// Les fichiers de traces et de points qu'on ouvre dans MY OSM : GPX, KML et
// GeoJSON (demande explicite, 15 octobre 2026 — « être dans la liste des
// applications pour ouvrir des points GPX et autres »).
//
// On n'en garde que ce que la carte sait montrer : des **traces** (lignes) et
// des **points** nommés. Le reste — horaires, altitudes, styles, extensions —
// est ignoré.
//
// La lecture est faite d'expressions régulières et non de `DOMParser` : les
// deux formats XML sont simples et réguliers, et c'est ce qui permet de tester
// la lecture dans Node, sans navigateur. Les préfixes d'espace de noms
// (`gpx:wpt`) sont acceptés. Un KMZ (KML zippé) n'est pas lu.
// ---------------------------------------------------------------------------

export interface GeoFilePoint extends LonLat {
  name: string;
}

export interface GeoFile {
  /** Le nom du fichier, ou celui qu'il se donne. */
  name: string;
  tracks: LonLat[][];
  points: GeoFilePoint[];
  /**
   * Les consignes de guidage du fichier (`isGuidance`), mises à part des
   * lieux : elles ne s'affichent pas en épingles, mais le guidage sur la trace
   * les dit à leur place (`navigation/trackRoute.ts`).
   */
  guidance: GeoFilePoint[];
}

/** Au-delà, le fichier n'est pas lu : une trace de randonnée pèse rarement plus d'un mégaoctet. */
export const GEO_FILE_MAX_CHARS = 20_000_000;

/** Les extensions reconnues, pour le sélecteur de fichier. */
export const GEO_FILE_ACCEPT = ".gpx,.kml,.geojson,.json";

/** Lit un fichier ; `null` s'il n'est d'aucun format connu ou ne contient rien à montrer. */
export function parseGeoFile(fileName: string, text: string): GeoFile | null {
  const parsed = readGeoFile(text);
  if (!parsed) return null;
  // Les consignes d'une trace ne sont pas des lieux : elles vont à part.
  const guidance = parsed.tracks.length && isGuidance(parsed.points) ? parsed.points : [];
  const points = guidance.length ? [] : parsed.points;
  if (!parsed.tracks.length && !points.length) return null;
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return { ...parsed, points, guidance, name: parsed.name || base || fileName };
}

type Parsed = Omit<GeoFile, "guidance">;

function readGeoFile(text: string): Parsed | null {
  if (text.length > GEO_FILE_MAX_CHARS) return null;
  const head = text.trimStart().slice(0, 2000);
  return head.startsWith("{")
    ? parseGeoJson(text)
    : /<(\w+:)?gpx[\s>]/.test(head)
      ? parseGpx(text)
      : /<(\w+:)?kml[\s>]/.test(head)
        ? parseKml(text)
        : null;
}

/**
 * Des consignes de guidage, et non des lieux : un GPX exporté d'un calculateur
 * d'itinéraire range chaque virage en point (« Tournez à gauche sur Rue de
 * B… », « Restez sur la droite », « End »). Mesuré le 15 octobre 2026 sur une
 * boucle de 70 km : 453 points, dont 447 consignes, devenus 447 signets qui
 * couvraient la carte. Vrai à partir de dix points dont la moitié au moins se
 * lit comme une consigne.
 */
export function isGuidance(points: GeoFilePoint[]): boolean {
  if (points.length < 10) return false;
  const instructions = points.filter((point) => GUIDANCE.test(point.name.trim())).length;
  return instructions * 2 >= points.length;
}

const GUIDANCE =
  /^(tournez|tourner|restez|continuez|prenez|serrez|faites demi-tour|au rond-point|sortez|rejoignez|arrivée|départ|turn|keep|continue|take|bear|make a u-turn|at the roundabout|exit|merge|head|slight|sharp|start|end|finish|arrive)\b/i;

/**
 * Une trace allégée pour être gardée sur l'appareil : un point tous les
 * `minMeters` au plus, coordonnées à six décimales (une dizaine de
 * centimètres). Une boucle de 70 km tient alors en une centaine de
 * kilo-octets, dans le stockage des signets.
 */
export function thinTrack(track: LonLat[], minMeters = 15): LonLat[] {
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  const kept: LonLat[] = [];
  for (const point of track) {
    const last = kept[kept.length - 1];
    if (!last || distance(last, point) >= minMeters) kept.push({ lon: round(point.lon), lat: round(point.lat) });
  }
  const end = track[track.length - 1];
  if (end && kept.length && kept[kept.length - 1] !== end) kept[kept.length - 1] = { lon: round(end.lon), lat: round(end.lat) };
  return kept.length > 1 ? kept : [];
}

/**
 * Un ordre de visite : depuis `start`, le lieu le plus proche, puis le plus
 * proche de celui-là, et ainsi de suite. Pas l'ordre le plus court possible,
 * mais un ordre qu'on comprend, sans aller-retour flagrant, et calculé sans
 * réseau. Sans point de départ, on part du premier lieu.
 */
export function nearestOrder<T extends LonLat>(start: LonLat | null, places: T[]): T[] {
  const left = [...places];
  const ordered: T[] = [];
  let from: LonLat | null = start;
  while (left.length) {
    let best = 0;
    if (from) {
      let bestMeters = Infinity;
      left.forEach((place, rank) => {
        const meters = distance(from!, place);
        if (meters < bestMeters) {
          bestMeters = meters;
          best = rank;
        }
      });
    }
    const [next] = left.splice(best, 1);
    ordered.push(next);
    from = next;
  }
  return ordered;
}

/** La longueur des traces, en mètres. */
export function tracksLength(tracks: LonLat[][]): number {
  let total = 0;
  for (const track of tracks) for (let i = 1; i < track.length; i++) total += distance(track[i - 1], track[i]);
  return total;
}

/** L'emprise de tout ce que montre le fichier : `[ouest, sud, est, nord]`. */
export function geoFileBounds(file: GeoFile): [number, number, number, number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const point of [...file.points, ...file.tracks.flat()]) {
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
  }
  return [west, south, east, north];
}

const valid = (lon: number, lat: number) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** Le texte d'une balise enfant (`<name>…</name>`), CDATA et entités compris. */
function childText(xml: string, tag: string): string {
  const match = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`).exec(xml);
  if (!match) return "";
  return decode(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
}

function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

/** Les éléments `tag` d'un texte XML, avec leurs attributs et leur contenu. */
function elements(xml: string, tag: string): { attributes: string; body: string }[] {
  const found: { attributes: string; body: string }[] = [];
  const pattern = new RegExp(`<(?:\\w+:)?${tag}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, "g");
  for (const match of xml.matchAll(pattern)) found.push({ attributes: match[1] ?? "", body: match[2] ?? "" });
  return found;
}

function attribute(attributes: string, name: string): number {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`).exec(attributes);
  return match ? Number(match[1]) : NaN;
}

function gpxPoints(xml: string, tag: string): GeoFilePoint[] {
  return elements(xml, tag).flatMap(({ attributes, body }) => {
    const lat = attribute(attributes, "lat");
    const lon = attribute(attributes, "lon");
    return valid(lon, lat) ? [{ lon, lat, name: childText(body, "name") }] : [];
  });
}

function parseGpx(xml: string): Parsed {
  // Le nom du fichier est celui de ses métadonnées, pas celui d'un point.
  const metadata = elements(xml, "metadata")[0]?.body ?? "";
  const tracks: LonLat[][] = [];
  for (const { body } of elements(xml, "trkseg")) {
    const points = gpxPoints(body, "trkpt").map(({ lon, lat }) => ({ lon, lat }));
    if (points.length > 1) tracks.push(points);
  }
  for (const { body } of elements(xml, "rte")) {
    const points = gpxPoints(body, "rtept").map(({ lon, lat }) => ({ lon, lat }));
    if (points.length > 1) tracks.push(points);
  }
  const trackName = elements(xml, "trk")[0]?.body ?? "";
  return {
    name: childText(metadata, "name") || childText(trackName.replace(/<(\w+:)?trkseg[\s\S]*/, ""), "name"),
    tracks,
    points: gpxPoints(xml, "wpt"),
  };
}

/** `lon,lat[,alt] lon,lat…` : la liste de coordonnées d'un KML. */
function kmlCoordinates(text: string): LonLat[] {
  return text
    .trim()
    .split(/\s+/)
    .flatMap((tuple) => {
      const [lon, lat] = tuple.split(",").map(Number);
      return valid(lon, lat) ? [{ lon, lat }] : [];
    });
}

function parseKml(xml: string): Parsed {
  const tracks: LonLat[][] = [];
  const points: GeoFilePoint[] = [];
  for (const { body } of elements(xml, "Placemark")) {
    const name = childText(body, "name");
    for (const point of elements(body, "Point")) {
      const [at] = kmlCoordinates(childText(point.body, "coordinates"));
      if (at) points.push({ ...at, name });
    }
    for (const line of elements(body, "LineString")) {
      const coordinates = kmlCoordinates(childText(line.body, "coordinates"));
      if (coordinates.length > 1) tracks.push(coordinates);
    }
  }
  const document = elements(xml, "Document")[0]?.body ?? "";
  return { name: childText(document.replace(/<(\w+:)?(Placemark|Folder)[\s\S]*/, ""), "name"), tracks, points };
}

function parseGeoJson(text: string): Parsed | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const tracks: LonLat[][] = [];
  const points: GeoFilePoint[] = [];
  const toPoint = (position: unknown): LonLat | null => {
    if (!Array.isArray(position)) return null;
    const [lon, lat] = position.map(Number);
    return valid(lon, lat) ? { lon, lat } : null;
  };
  const line = (positions: unknown) => {
    const list = Array.isArray(positions) ? positions.map(toPoint).filter((p): p is LonLat => p !== null) : [];
    if (list.length > 1) tracks.push(list);
  };
  const visit = (geometry: { type?: string; coordinates?: unknown; geometries?: unknown[] } | null | undefined, name: string) => {
    if (!geometry) return;
    const coordinates = geometry.coordinates as unknown[];
    switch (geometry.type) {
      case "Point": {
        const at = toPoint(coordinates);
        if (at) points.push({ ...at, name });
        break;
      }
      case "MultiPoint":
        for (const position of coordinates ?? []) {
          const at = toPoint(position);
          if (at) points.push({ ...at, name });
        }
        break;
      case "LineString":
        line(coordinates);
        break;
      case "MultiLineString":
      case "Polygon":
        for (const ring of coordinates ?? []) line(ring);
        break;
      case "MultiPolygon":
        for (const polygon of coordinates ?? []) for (const ring of (polygon as unknown[]) ?? []) line(ring);
        break;
      case "GeometryCollection":
        for (const child of geometry.geometries ?? []) visit(child as typeof geometry, name);
        break;
    }
  };
  const root = data as { type?: string; features?: unknown[]; name?: string };
  const features = root.type === "FeatureCollection" ? (root.features ?? []) : root.type === "Feature" ? [root] : [{ geometry: root }];
  for (const feature of features as { geometry?: Parameters<typeof visit>[0]; properties?: Record<string, unknown> }[]) {
    const name = String(feature.properties?.name ?? feature.properties?.title ?? "");
    visit(feature.geometry, name);
  }
  return { name: typeof root.name === "string" ? root.name : "", tracks, points };
}
