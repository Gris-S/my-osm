import { CONFIG } from "../../config";
import { areaBbox, areaContains, type Area, type AreaGeometry } from "./area";
import type { Bbox } from "./tiles";

// ---------------------------------------------------------------------------
// Le contour de ce qu'on touche sur la carte : pays, région ou département.
//
// Choisir une zone se fait comme dans Organic Maps : on touche, et c'est le
// zoom qui dit à quelle échelle — dézoomé un pays, puis une région, puis un
// département. Le contour vient de **Nominatim au moment du toucher**
// (demande explicite) : rien d'embarqué, le monde entier à tous les niveaux,
// au prix d'une requête par toucher.
//
// Mesuré sur Paris : la France au zoom 3 (tolérance 0,01°) pèse 77 ko pour
// 3 000 points, l'Île-de-France au zoom 5 fait 366 points, Paris au zoom 8
// 55 points. En mer, Nominatim répond `Unable to geocode`. Au zoom 8, Paris
// rend la **ville** (`addresstype: city`), qui est aussi son département.
// ---------------------------------------------------------------------------

export type BoundaryLevel = "country" | "region" | "department";

export interface Boundary {
  /** `relation/2202162` : deux touchers sur la même zone ont le même. */
  id: string;
  name: string;
  level: BoundaryLevel;
  area: Area;
  bbox: Bbox;
}

/** Le paramètre `zoom` de Nominatim qui rend chaque niveau. */
const NOMINATIM_ZOOM: Record<BoundaryLevel, number> = { country: 3, region: 5, department: 8 };

/**
 * Tolérance de simplification demandée à Nominatim, en degrés — et marge
 * appliquée ensuite autour des tuiles (`Area.margin`). Plus fin n'ajouterait
 * pas une tuile au zoom de chaque niveau, et alourdirait la réponse.
 */
const TOLERANCE: Record<BoundaryLevel, number> = { country: 0.01, region: 0.005, department: 0.001 };

/** Ce qu'un toucher vise au zoom donné de la carte réduite. */
export function levelForZoom(zoom: number): BoundaryLevel {
  if (zoom < CONFIG.OFFLINE.PICK_REGION_ZOOM) return "country";
  if (zoom < CONFIG.OFFLINE.PICK_DEPARTMENT_ZOOM) return "region";
  return "department";
}

/**
 * Le niveau de ce que Nominatim a vraiment rendu, quand il le dit : un petit
 * pays sans région répond par le pays même si l'on visait une région.
 */
function levelOf(addresstype: string | undefined, asked: BoundaryLevel): BoundaryLevel {
  if (addresstype === "country") return "country";
  if (addresstype === "state" || addresstype === "region" || addresstype === "province") return "region";
  if (addresstype === "county" || addresstype === "state_district") return "department";
  return asked;
}

/**
 * Écarte les morceaux lointains d'un multipolygone : ceux à plus de
 * `TRIM_FAR_PARTS_DEG` du morceau touché. C'est la règle de l'ancienne liste
 * des pays — la France garde la Corse mais pas l'outre-mer, l'Espagne les
 * Baléares mais pas les Canaries — et c'est ce qu'on attend en touchant la
 * métropole. Toucher la Guadeloupe, à l'inverse, ne rend que la Guadeloupe.
 */
function trimFarParts(geometry: AreaGeometry, lon: number, lat: number): AreaGeometry {
  if (geometry.type !== "MultiPolygon" || geometry.coordinates.length < 2) return geometry;
  const parts = geometry.coordinates.map((coordinates) => {
    const polygon: AreaGeometry = { type: "Polygon", coordinates };
    return { coordinates, polygon, bbox: areaBbox(polygon) };
  });
  // L'écart entre deux rectangles, le plus grand des deux axes ; 0 s'ils se touchent.
  const gap = (a: Bbox, b: Bbox) => Math.max(a[0] - b[2], b[0] - a[2], a[1] - b[3], b[1] - a[3], 0);
  const here: Bbox = [lon, lat, lon, lat];
  const main =
    parts.find((p) => areaContains({ geometry: p.polygon, margin: 0 }, lon, lat)) ??
    parts.reduce((best, p) => (gap(p.bbox, here) < gap(best.bbox, here) ? p : best));
  const kept = parts.filter((p) => gap(p.bbox, main.bbox) <= CONFIG.OFFLINE.TRIM_FAR_PARTS_DEG);
  return kept.length === 1
    ? { type: "Polygon", coordinates: kept[0].coordinates }
    : { type: "MultiPolygon", coordinates: kept.map((p) => p.coordinates) };
}

interface NominatimReverse {
  error?: string;
  name?: string;
  display_name?: string;
  addresstype?: string;
  osm_type?: string;
  osm_id?: number;
  geojson?: { type: string; coordinates: unknown };
}

// Le service public de Nominatim n'accepte **qu'une requête par seconde** :
// des touchers rapprochés attendent leur tour plutôt que de se faire bannir.
let lastCallAt = 0;

/**
 * Le contour sous le doigt, ou `null` s'il n'y a rien là (la mer). Lève en cas
 * d'échec réseau, pour que la fenêtre distingue « rien ici » de « pas de réseau ».
 */
export async function lookupBoundary(
  lon: number,
  lat: number,
  level: BoundaryLevel,
  language: string,
  signal: AbortSignal,
): Promise<Boundary | null> {
  const wait = lastCallAt + 1000 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  if (signal.aborted) throw new DOMException("Annulé", "AbortError");
  lastCallAt = Date.now();

  const url = new URL(CONFIG.NOMINATIM_REVERSE_URL);
  for (const [key, value] of Object.entries({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lon),
    zoom: String(NOMINATIM_ZOOM[level]),
    polygon_geojson: "1",
    polygon_threshold: String(TOLERANCE[level]),
    "accept-language": language,
  })) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = (await res.json()) as NominatimReverse;
  const type = data.geojson?.type;
  if (data.error || (type !== "Polygon" && type !== "MultiPolygon")) return null;

  const geometry = trimFarParts(data.geojson as AreaGeometry, lon, lat);
  return {
    id: `${data.osm_type}/${data.osm_id}`,
    name: data.name || data.display_name?.split(",")[0] || "",
    level: levelOf(data.addresstype, level),
    area: { geometry, margin: TOLERANCE[level] },
    bbox: areaBbox(geometry),
  };
}
