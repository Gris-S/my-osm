// ---------------------------------------------------------------------------
// Arithmétique des tuiles, et estimation du poids d'une zone.
//
// Rien ici ne touche au réseau : ce module ne fait que traduire une emprise
// géographique en liste de tuiles, et cette liste en un ordre de grandeur.
// C'est ce qui permet d'afficher un poids dès qu'une zone est choisie, sans
// rien demander à personne.
// ---------------------------------------------------------------------------

import { CONFIG } from "../../config";
import { areaTileCounts, areaTiles, tileBbox, type Area } from "./area";

/** Emprise géographique, dans l'ordre de MapLibre : ouest, sud, est, nord. */
export type Bbox = [number, number, number, number];

/** Une tuile, dans le découpage sphérique de Mercator utilisé partout ici. */
export interface Tile {
  z: number;
  x: number;
  y: number;
}

export function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

export function latToTileY(lat: number, z: number): number {
  // Bornée à la latitude limite de Mercator : au-delà, le logarithme diverge
  // et l'on obtiendrait un indice de tuile infini.
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

/** Les tuiles d'un zoom donné qui rencontrent l'emprise. */
export function tilesForZoom(bbox: Bbox, z: number): Tile[] {
  const [west, south, east, north] = bbox;
  const x1 = lonToTileX(west, z);
  const x2 = lonToTileX(east, z);
  const y1 = latToTileY(north, z);
  const y2 = latToTileY(south, z);
  const out: Tile[] = [];
  const max = 2 ** z - 1;
  for (let x = Math.max(0, x1); x <= Math.min(max, x2); x++) {
    for (let y = Math.max(0, y1); y <= Math.min(max, y2); y++) out.push({ z, x, y });
  }
  return out;
}

/** Toutes les tuiles d'une emprise, du zoom 0 au zoom demandé. */
export function tilesForRange(bbox: Bbox, maxZoom: number, minZoom = 0): Tile[] {
  const out: Tile[] = [];
  for (let z = minZoom; z <= maxZoom; z++) out.push(...tilesForZoom(bbox, z));
  return out;
}

/**
 * Ce qu'une zone couvre : son rectangle, et son contour quand elle en a un.
 * Les zones tracées au carré, d'avant les contours, n'ont que le premier.
 */
export interface Footprint {
  bbox: Bbox;
  area?: Area | null;
}

/** Les tuiles d'une zone : celles de son contour s'il existe, de son rectangle sinon. */
export function footprintTiles(f: Footprint, maxZoom: number, minZoom = 0): Tile[] {
  return f.area ? areaTiles(f.area, maxZoom, minZoom) : tilesForRange(f.bbox, maxZoom, minZoom);
}

/** Le même compte, zoom par zoom, sans énumérer. */
function footprintCounts(f: Footprint, maxZoom: number): number[] {
  if (f.area) return areaTileCounts(f.area, maxZoom);
  return Array.from({ length: maxZoom + 1 }, (_, z) => countTiles(f.bbox, z, z));
}

function footprintCount(f: Footprint, maxZoom: number, minZoom = 0): number {
  return footprintCounts(f, maxZoom)
    .slice(minZoom)
    .reduce((a, b) => a + b, 0);
}

/**
 * Compte les tuiles sans les énumérer.
 *
 * Ce n'est pas une optimisation gratuite : au zoom 19, une emprise de la
 * taille de Paris fait 70 000 tuiles, et construire ce tableau à chaque
 * déplacement du carré de sélection ferait ramer la fenêtre.
 */
export function countTiles(bbox: Bbox, maxZoom: number, minZoom = 0): number {
  let total = 0;
  const [west, south, east, north] = bbox;
  for (let z = minZoom; z <= maxZoom; z++) {
    const max = 2 ** z - 1;
    const x1 = Math.max(0, lonToTileX(west, z));
    const x2 = Math.min(max, lonToTileX(east, z));
    const y1 = Math.max(0, latToTileY(north, z));
    const y2 = Math.min(max, latToTileY(south, z));
    total += Math.max(0, x2 - x1 + 1) * Math.max(0, y2 - y1 + 1);
  }
  return total;
}

/** Poids estimé des tuiles vectorielles d'une zone, en octets. */
export function estimateVectorBytes(f: Footprint, maxZoom = CONFIG.OFFLINE.VECTOR_MAX_ZOOM): number {
  return footprintCounts(f, maxZoom).reduce((bytes, count, z) => {
    const perTile =
      CONFIG.OFFLINE.BYTES_PER_VECTOR_TILE[z] ?? CONFIG.OFFLINE.BYTES_PER_VECTOR_TILE_DEFAULT;
    return bytes + count * perTile;
  }, 0);
}

/** Poids estimé de l'imagerie satellite d'une zone, en octets. */
export function estimateRasterBytes(f: Footprint, maxZoom: number): number {
  return footprintCount(f, maxZoom) * CONFIG.OFFLINE.BYTES_PER_RASTER_TILE;
}

/** Poids estimé des tuiles d'altitude d'une zone, en octets. */
export function estimateReliefBytes(f: Footprint, maxZoom: number): number {
  return footprintCount(f, maxZoom) * CONFIG.OFFLINE.BYTES_PER_RELIEF_TILE;
}

/** Vrai si l'emprise rencontre une zone où l'IGN a des données. */
export function intersectsIgn([w, s, e, n]: Bbox): boolean {
  return CONFIG.SATELLITE_IGN_AREAS.some(
    ({ bounds: [aw, as_, ae, an] }) => w <= ae && e >= aw && s <= an && n >= as_,
  );
}

/**
 * Poids estimé des courbes de niveau. Nul hors de France — le service n'y a
 * rien, et compter des tuiles qui rendront un 404 gonflerait l'estimation d'un
 * téléchargement qui n'aura pas lieu.
 */
export function estimateContourBytes(f: Footprint, maxZoom: number): number {
  if (!intersectsIgn(f.bbox) || maxZoom < CONFIG.CONTOUR_MIN_ZOOM) return 0;
  return footprintCount(f, maxZoom, CONFIG.CONTOUR_MIN_ZOOM) * CONFIG.CONTOUR_BYTES_PER_TILE_HINT;
}

/** « 57 Mo », « 1,1 Go » — l'unité suit la taille, jamais de 1024 Mo. */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} ko`;
  if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} Mo`;
  return `${(bytes / 1_000_000_000).toFixed(1).replace(".", ",")} Go`;
}

/**
 * Découpe une emprise en mailles pour les requêtes Overpass.
 *
 * Mesuré : une maille de 0,04° rend environ 16 000 objets en 3,6 secondes.
 * Demander Paris entier d'un coup, c'est se faire refuser la requête aux
 * heures chargées.
 */
export function chunkBbox(bbox: Bbox, step = CONFIG.OFFLINE.OVERPASS_CHUNK_DEG): Bbox[] {
  const [west, south, east, north] = bbox;
  const out: Bbox[] = [];
  for (let lon = west; lon < east; lon += step) {
    for (let lat = south; lat < north; lat += step) {
      out.push([lon, lat, Math.min(east, lon + step), Math.min(north, lat + step)]);
    }
  }
  return out;
}

/**
 * Les mailles d'Overpass d'une zone. Avec un contour, ce sont les tuiles du
 * zoom dont la largeur approche la maille mesurée (le 13 pour 0,04°) et qui
 * touchent la zone : la mer et les voisins ne coûtent plus une requête.
 */
export function footprintChunks(f: Footprint): Bbox[] {
  if (!f.area) return chunkBbox(f.bbox);
  const z = Math.round(Math.log2(360 / CONFIG.OFFLINE.OVERPASS_CHUNK_DEG));
  return areaTiles(f.area, z, z).map(tileBbox);
}

/**
 * Corrige l'estimation sur de vraies tuiles de la zone choisie.
 *
 * Les médianes de `CONFIG.OFFLINE.BYTES_PER_VECTOR_TILE` sont un ordre de
 * grandeur, pas une prévision : mesuré, une tuile de zoom 14 pèse 568 ko dans
 * Paris et 84 ko en Seine-et-Marne, soit un rapport de sept. Afficher « 15 Mo »
 * pour une zone qui en fera 60 est pire que ne rien afficher — c'est sur ce
 * chiffre que l'on décide de lancer, ou non, un téléchargement long.
 *
 * On échantillonne donc quelques tuiles réelles et l'on en tire un facteur de
 * densité, appliqué à toute la table. Le facteur est borné : quatre tuiles ne
 * font pas une statistique, et une zone à cheval sur un fleuve pourrait sinon
 * diviser l'estimation par dix.
 *
 * Le serveur n'expose pas `Content-Range` en origine croisée — mesuré — il n'y
 * a donc pas moyen de connaître la taille d'une tuile sans la télécharger. Ces
 * quelques centaines de kilo-octets sont le prix d'un chiffre honnête, et ils
 * ne sont pas perdus : le cache d'exécution les garde.
 */
export async function calibrate(footprint: Footprint, template: string): Promise<number> {
  const z = CONFIG.OFFLINE.CALIBRATION_ZOOM;
  const wanted = CONFIG.OFFLINE.CALIBRATION_SAMPLES;
  const picks: Tile[] = [];

  if (footprint.area) {
    // Avec un contour, on pèse des tuiles de la zone elle-même — pas la mer
    // ou le pays voisin que son rectangle engloberait.
    const inside = areaTiles(footprint.area, z, z);
    const step = Math.max(1, Math.floor(inside.length / wanted));
    for (let i = 0; i < inside.length && picks.length < wanted; i += step) picks.push(inside[i]);
  } else {
    const [west, south, east, north] = footprint.bbox;
    const max = 2 ** z - 1;
    const x1 = Math.max(0, lonToTileX(west, z));
    const x2 = Math.min(max, lonToTileX(east, z));
    const y1 = Math.max(0, latToTileY(north, z));
    const y2 = Math.min(max, latToTileY(south, z));
    // Échantillonnage **par arithmétique**, sans construire la liste des
    // tuiles : au zoom 13, une grande emprise en compte des centaines de
    // milliers, et les énumérer pour n'en garder que quatre bloquerait la
    // fenêtre.
    const total = Math.max(0, x2 - x1 + 1) * Math.max(0, y2 - y1 + 1);
    const step = Math.max(1, Math.floor(total / wanted));
    for (let i = 0; i < total && picks.length < wanted; i += step) {
      picks.push({ z, x: x1 + (i % (x2 - x1 + 1)), y: y1 + Math.floor(i / (x2 - x1 + 1)) });
    }
  }
  if (!picks.length) return 1;

  const sizes = await Promise.all(
    picks.map(async (t) => {
      try {
        const url = template
          .replace("{z}", String(t.z))
          .replace("{x}", String(t.x))
          .replace("{y}", String(t.y));
        const res = await fetch(url);
        if (!res.ok) return null;
        return (await res.blob()).size;
      } catch {
        return null;
      }
    }),
  );

  const seen = sizes.filter((s): s is number => s !== null && s > 0);
  if (!seen.length) return 1;
  const mean = seen.reduce((a, b) => a + b, 0) / seen.length;
  const reference = CONFIG.OFFLINE.BYTES_PER_VECTOR_TILE[z] ?? CONFIG.OFFLINE.BYTES_PER_VECTOR_TILE_DEFAULT;
  return Math.min(3, Math.max(0.3, mean / reference));
}
