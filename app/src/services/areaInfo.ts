import { CONFIG } from "../config";
import type { AreaInfo } from "../types";
import type { TranslationKey } from "../i18n";
import { readPersistent, writePersistent } from "../transport/persistentCache";
import { nominatimTurn } from "./nominatim";

// ---------------------------------------------------------------------------
// La fiche d'une ville ou d'un quartier dont on a touché le nom sur la carte
// (demande explicite, 28 septembre 2026) : son contour surligné, quelques
// chiffres, et de quoi s'y rendre.
//
// L'étiquette de la carte porte l'identifiant OSM du lieu (un nœud `place`,
// encodé `id × 10 + 1` dans les tuiles). Deux questions à Nominatim, pas plus :
//
//  1. **le lieu lui-même** (`/lookup`) — population et son année, Wikidata,
//     Wikipédia, département, région. C'est un point : il n'a pas de contour ;
//  2. **le contour** (`/reverse` au point de l'étiquette, à l'échelle de sa
//     nature) — accepté seulement s'il désigne bien ce lieu : même Wikidata, ou
//     nom qui se recoupe. Mesuré : au point de « Le Marais », Nominatim rend
//     « Quartier des Archives », une autre division ; la surligner mentirait.
//     Pas de contour vaut mieux qu'un faux.
//
// Le tout est gardé trente jours sur l'appareil : une commune ne change pas de
// forme d'une semaine à l'autre, et Nominatim n'accepte qu'une requête par
// seconde.
// ---------------------------------------------------------------------------

/** L'échelle Nominatim à essayer pour le contour, selon la nature du lieu. */
const OUTLINE_ZOOMS: Record<string, number[]> = {
  city: [10],
  town: [10],
  village: [10],
  hamlet: [10],
  municipality: [10],
  suburb: [12, 14],
  borough: [12, 14],
  quarter: [14],
  neighbourhood: [14, 16],
};

/** Détail du contour, en degrés : une commune tient en quelques centaines de points. */
const OUTLINE_TOLERANCE = 0.0005;

export interface AreaLookup {
  /** Ce qu'on sait, pour la fiche. */
  area: AreaInfo;
  wikidata?: string;
  wikipedia?: string;
}

interface NominatimPlace {
  error?: string;
  name?: string;
  osm_type?: string;
  osm_id?: number;
  addresstype?: string;
  address?: Record<string, string>;
  extratags?: Record<string, string> | null;
  geojson?: { type: string; coordinates: unknown };
}

/** Les lettres d'un nom, sans accents ni casse ni ponctuation. */
function letters(name: string | undefined): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Deux noms désignent-ils le même lieu ? « Charonne » et « Quartier de Charonne », oui. */
export function sameArea(a: string | undefined, b: string | undefined): boolean {
  const x = letters(a);
  const y = letters(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
}

/**
 * Surface d'un polygone en km², sur une projection équivalente locale : à
 * l'échelle d'une commune, l'écart à la surface sphérique est négligeable.
 * Les trous (enclaves) sont retranchés.
 */
export function areaKm2(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): number {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const R = 6371.0088;
  let total = 0;
  for (const rings of polygons) {
    rings.forEach((ring, index) => {
      let sum = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const [lon1, lat1] = ring[i];
        const [lon2, lat2] = ring[i + 1];
        sum += ((lon2 - lon1) * Math.PI) / 180 * (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
      }
      const ringArea = Math.abs((sum * R * R) / 2);
      total += index === 0 ? ringArea : -ringArea;
    });
  }
  return total;
}

async function nominatim(url: URL, signal: AbortSignal): Promise<unknown> {
  await nominatimTurn(signal);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

function parsePopulation(raw: string | undefined): number | undefined {
  const value = Number((raw ?? "").replace(/[\s,.]/g, ""));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Ce qu'on sait du lieu dont l'étiquette a été touchée. `osmNode` est
 * l'identifiant du nœud `place` ; `kind` la classe de l'étiquette.
 */
export async function lookupArea(
  target: { osmNode: number; kind: string; name: string; lon: number; lat: number },
  language: string,
  signal: AbortSignal
): Promise<AreaLookup> {
  const key = `area:v1:${target.osmNode}:${language}`;
  const cached = await readPersistent<AreaLookup>(key);
  if (cached) return cached;

  const lookupUrl = new URL(CONFIG.NOMINATIM_LOOKUP_URL);
  for (const [k, v] of Object.entries({
    format: "jsonv2",
    osm_ids: `N${target.osmNode}`,
    addressdetails: "1",
    extratags: "1",
    "accept-language": language,
  })) {
    lookupUrl.searchParams.set(k, v);
  }
  const found = ((await nominatim(lookupUrl, signal)) as NominatimPlace[])[0];
  const tags = found?.extratags ?? {};
  const address = found?.address ?? {};
  const wikidata = tags.wikidata;

  const area: AreaInfo = {
    kind: target.kind,
    population: parsePopulation(tags.population),
    populationYear: tags["population:date"]?.slice(0, 4),
    county: address.county,
    state: address.state,
    country: address.country,
    postcode: address.postcode,
  };

  // Le contour, à l'échelle de la nature du lieu, et seulement s'il le désigne.
  for (const zoom of OUTLINE_ZOOMS[target.kind] ?? [10]) {
    const url = new URL(CONFIG.NOMINATIM_REVERSE_URL);
    for (const [k, v] of Object.entries({
      format: "jsonv2",
      lat: String(target.lat),
      lon: String(target.lon),
      zoom: String(zoom),
      extratags: "1",
      polygon_geojson: "1",
      polygon_threshold: String(OUTLINE_TOLERANCE),
      "accept-language": language,
    })) {
      url.searchParams.set(k, v);
    }
    const around = (await nominatim(url, signal)) as NominatimPlace;
    const type = around.geojson?.type;
    if (around.error || (type !== "Polygon" && type !== "MultiPolygon")) continue;
    const matches =
      (!!wikidata && around.extratags?.wikidata === wikidata) || sameArea(around.name, target.name);
    if (!matches) continue;
    area.outline = around.geojson as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    area.areaKm2 = areaKm2(area.outline);
    // La population du nœud manque souvent pour un quartier ; celle de la
    // division administrative qui le décrit est la même chose.
    area.population ??= parsePopulation(around.extratags?.population);
    area.populationYear ??= around.extratags?.["population:date"]?.slice(0, 4);
    break;
  }

  const result: AreaLookup = { area, wikidata, wikipedia: tags.wikipedia };
  await writePersistent(key, result, CONFIG.WIKIPEDIA_CACHE_TTL_MS);
  return result;
}

/** Le libellé d'une nature de lieu, pour le sous-titre de la fiche. */
export function areaKindLabel(kind: string): TranslationKey {
  const known = ["city", "town", "village", "hamlet", "suburb", "borough", "quarter", "neighbourhood"];
  return `area.kind.${known.includes(kind) ? kind : "other"}` as TranslationKey;
}
