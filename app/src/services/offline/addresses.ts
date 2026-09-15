// ---------------------------------------------------------------------------
// Les adresses hors ligne.
//
// La source est la **BAN servie en WFS par la Géoplateforme de l'IGN**
// (`BAN-PLUS:adresse`), et non le fichier de la BAN ni BANO. Trois raisons,
// toutes mesurées :
//
//   - le serveur de fichiers de la BAN (`adresse.data.gouv.fr/data/…`) accepte
//     la connexion puis ne répond jamais — en HTTP/2 comme en HTTP/1.1, sur le
//     plus petit département comme sur le plus gros, alors que la racine du
//     site et son API répondent normalement ;
//   - BANO, le repli d'OpenStreetMap France, est **incomplète** : 158 186
//     adresses sur Paris intra-muros contre 242 153 ici, soit 53 % de moins.
//     Le 12 rue de Rivoli, par exemple, n'y figure pas ;
//   - le WFS se demande **par emprise**, alors qu'un fichier BANO se
//     télécharge par département entier. Une zone de quelques rues coûte donc
//     quelques centaines de kilo-octets au lieu de quatorze mégaoctets.
//
// La même Géoplateforme sert déjà l'orthophotographie de la vue satellite :
// c'est un hôte de moins à surveiller, et son origine croisée est ouverte.
// ---------------------------------------------------------------------------

import { CONFIG } from "../../config";
import { putSearchEntries, type SearchEntry } from "./store";
import type { Bbox, Footprint } from "./tiles";
import { areaContains } from "./area";

/** Une adresse d'une voie : son numéro et sa position. */
export interface HouseNumber {
  n: string;
  lon: number;
  lat: number;
}

interface AddressFeature {
  properties: {
    numero?: number | null;
    rep?: string | null;
    nom_voie?: string | null;
    nom_com?: string | null;
    insee_com?: string | null;
  };
  geometry?: { coordinates?: [number, number] } | null;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function termsOf(text: string): string[] {
  return [
    ...new Set(
      normalize(text)
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 1),
    ),
  ];
}

/**
 * L'emprise, dans l'ordre que le service attend.
 *
 * Piège vérifié : sans code de référentiel explicite, le WFS rend **zéro
 * objet** au lieu d'une erreur — silencieusement. `CRS:84` fixe l'ordre
 * longitude/latitude ; le `EPSG:4326` par défaut d'un WFS 2.0 est l'ordre
 * inverse, et l'on obtient alors une emprise au milieu de l'océan Indien.
 */
function bboxParam([w, s, e, n]: Bbox): string {
  return `${w},${s},${e},${n},CRS:84`;
}

function wfsUrl(bbox: Bbox, params: Record<string, string>): string {
  const url = new URL(CONFIG.OFFLINE.BAN_WFS_URL);
  url.searchParams.set("SERVICE", "WFS");
  url.searchParams.set("VERSION", "2.0.0");
  url.searchParams.set("REQUEST", "GetFeature");
  url.searchParams.set("TYPENAMES", CONFIG.OFFLINE.BAN_WFS_LAYER);
  url.searchParams.set("SRSNAME", "CRS:84");
  url.searchParams.set("BBOX", bboxParam(bbox));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * Le nombre exact d'adresses dans une emprise, en une requête et une demi-
 * seconde (`RESULTTYPE=hits`).
 *
 * C'est ce qui permet d'annoncer un poids **exact** avant de télécharger,
 * là où les tuiles doivent se contenter d'une estimation calibrée : mesuré,
 * une adresse pèse 258 octets une fois les champs inutiles écartés.
 */
export async function countAddresses(bbox: Bbox, signal?: AbortSignal): Promise<number> {
  const res = await fetch(wfsUrl(bbox, { RESULTTYPE: "hits" }), { signal });
  if (!res.ok) throw new Error(`Comptage indisponible (${res.status})`);
  const xml = await res.text();
  return Number(/numberMatched="(\d+)"/.exec(xml)?.[1] ?? 0);
}

/** Poids approximatif du téléchargement, en octets. */
export function addressBytes(count: number): number {
  return count * CONFIG.OFFLINE.BYTES_PER_ADDRESS;
}

/**
 * Télécharge les adresses d'une zone et les indexe **par voie**.
 *
 * Le service ne se questionne que par rectangle : quand la zone a un contour,
 * les adresses qui tombent dehors — le département voisin — sont écartées à
 * la lecture. Le transfert, lui, reste celui du rectangle.
 *
 * Elles ne sont pas indexées une par une : Paris intra-muros, c'est 242 153
 * numéros pour quelques milliers de voies. Une ligne d'index par numéro ferait
 * exploser les écritures et le stockage, pour une recherche qui commence de
 * toute façon par reconnaître une rue. Le numéro tapé est ensuite retrouvé
 * dans la liste portée par la voie, et rend sa position exacte ; s'il manque,
 * on rend le milieu de la voie plutôt que rien.
 */
export async function downloadAddresses(
  footprint: Footprint,
  regionId: string,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<number> {
  const { bbox, area } = footprint;
  const total = await countAddresses(bbox, signal);
  if (!total) return 0;

  const page = CONFIG.OFFLINE.BAN_WFS_PAGE;
  const streets = new Map<string, { street: string; city: string; numbers: HouseNumber[] }>();

  for (let start = 0; start < total; start += page) {
    if (signal.aborted) throw new DOMException("Annulé", "AbortError");
    const url = wfsUrl(bbox, {
      OUTPUTFORMAT: "application/json",
      // Sans cette sélection, chaque adresse traîne deux identifiants longs et
      // un champ `position` : 340 octets au lieu de 258, soit un quart de
      // téléchargement en plus pour rien.
      PROPERTYNAME: "numero,rep,nom_voie,nom_com,insee_com,geom",
      COUNT: String(page),
      STARTINDEX: String(start),
    });
    const res = await fetch(url, { signal });
    if (!res.ok) break;
    const data = (await res.json()) as { features?: AddressFeature[] };

    for (const f of data.features ?? []) {
      const coords = f.geometry?.coordinates;
      const street = f.properties.nom_voie;
      if (!coords || !street) continue;
      if (area && !areaContains(area, coords[0], coords[1])) continue;
      const city = f.properties.nom_com ?? f.properties.insee_com ?? "";
      const key = `${normalize(street)}|${city}`;
      let entry = streets.get(key);
      if (!entry) {
        entry = { street, city, numbers: [] };
        streets.set(key, entry);
      }
      entry.numbers.push({
        n: `${f.properties.numero ?? ""}${f.properties.rep ?? ""}`,
        lon: coords[0],
        lat: coords[1],
      });
    }
    onProgress(Math.min(total, start + page), total);
  }

  // Écriture par paquets : une transaction de plusieurs milliers de voies d'un
  // coup fige l'interface le temps qu'elle se valide.
  const entries: SearchEntry[] = [];
  for (const [key, s] of streets) {
    const mid = s.numbers[Math.floor(s.numbers.length / 2)];
    entries.push({
      id: `${regionId}:voie:${key}`,
      region: regionId,
      label: s.street,
      sub: s.city,
      lon: mid.lon,
      lat: mid.lat,
      group: null,
      terms: termsOf(`${s.street} ${s.city}`),
      numbers: s.numbers,
    });
  }
  for (let i = 0; i < entries.length; i += 500) {
    await putSearchEntries(entries.slice(i, i + 500));
  }
  return entries.length;
}
