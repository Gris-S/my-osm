import type { LonLat } from "../types";

// ---------------------------------------------------------------------------
// Géométrie du guidage.
//
// Tout est calculé en mètres sur un plan local : à l'échelle d'un segment de
// tracé — quelques dizaines de mètres — l'écart avec une projection géodésique
// est de l'ordre du centimètre, pour un coût dix fois moindre. Ces fonctions
// sont appelées à chaque relevé GPS, sur des milliers de segments.
// ---------------------------------------------------------------------------

/** Rayon moyen de la Terre (IUGG), en mètres. */
const EARTH_RADIUS = 6371008.8;

const RAD = Math.PI / 180;

/** Distance orthodromique entre deux points, en mètres. */
export function distance(a: LonLat, b: LonLat): number {
  const lat1 = a.lat * RAD;
  const lat2 = b.lat * RAD;
  const dLat = lat2 - lat1;
  const dLon = (b.lon - a.lon) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cap de `a` vers `b`, en degrés depuis le nord (0–360). */
export function bearing(a: LonLat, b: LonLat): number {
  const lat1 = a.lat * RAD;
  const lat2 = b.lat * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/**
 * Combien de mètres vaut un degré de longitude à cette latitude. Les longitudes
 * se resserrent vers les pôles : sans ce facteur, un écart est-ouest serait
 * surestimé de moitié en Europe.
 */
function lonScale(lat: number): number {
  return Math.cos(lat * RAD);
}

/** Un point projeté sur un segment du tracé. */
export interface Projection {
  /** Où l'on tombe sur le segment, de 0 (début) à 1 (fin). */
  t: number;
  /** Distance entre le point réel et le tracé, en mètres. */
  offset: number;
  /** Le point du tracé lui-même. */
  point: LonLat;
}

/**
 * Projette `p` sur le segment `[a, b]` : le point du segment le plus proche,
 * et l'écart qui les sépare.
 *
 * C'est l'opération centrale du guidage — elle dit à la fois où l'on en est du
 * parcours et si l'on s'en est écarté.
 */
export function projectOnSegment(p: LonLat, a: LonLat, b: LonLat): Projection {
  // Repère local en mètres, origine sur `a` : les composantes de `a` valent
  // donc zéro et n'apparaissent pas dans les calculs.
  const scale = lonScale(a.lat);
  const bx = (b.lon - a.lon) * scale;
  const by = b.lat - a.lat;
  const px = (p.lon - a.lon) * scale;
  const py = p.lat - a.lat;

  const lengthSquared = bx * bx + by * by;
  // Deux points confondus : le segment n'a pas de direction, on retombe sur
  // son origine plutôt que de diviser par zéro.
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / lengthSquared));

  const point: LonLat = { lon: a.lon + (bx * t) / scale, lat: a.lat + by * t };
  return { t, offset: distance(p, point), point };
}

/** Interpole entre deux points, `t` allant de 0 à 1. */
export function interpolate(a: LonLat, b: LonLat, t: number): LonLat {
  return { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t };
}
