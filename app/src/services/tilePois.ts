import type { GeoJSONFeature, Map as MLMap } from "maplibre-gl";
import { FILTER_GROUPS, groupFromTags, type FilterGroupId } from "../filters";
import type { Place } from "../types";

// ---------------------------------------------------------------------------
// Les commerces affichés sur la carte viennent des **tuiles vectorielles du
// fond de carte**, pas d'une requête réseau.
//
// Le schéma OpenMapTiles embarque une couche `poi` (nom, `class`, `subclass`,
// `rank`) dans les tuiles que MapLibre télécharge déjà pour dessiner la carte :
// les lire coûte zéro requête et quelques millisecondes, là où interroger
// Overpass pour la même zone demandait des dizaines de secondes. Les détails
// d'un lieu (horaires, téléphone, site) ne sont pas dans la tuile : ils sont
// demandés à Overpass à l'ouverture d'une fiche, pour ce seul lieu
// (voir `services/overpass.ts`).
// ---------------------------------------------------------------------------

/** Source vectorielle du fond de carte (schéma OpenMapTiles) et sa couche POI. */
export const VECTOR_SOURCE_ID = "openmaptiles";
export const POI_SOURCE_LAYER = "poi";

/**
 * Valeur de tag OSM -> clés qui la déclarent, dérivé de `FILTER_GROUPS`.
 *
 * La `subclass` d'une tuile est la valeur brute du tag (`restaurant`,
 * `supermarket`, `bus_stop`…) mais la tuile ne dit pas de quelle clé elle
 * vient. Comme les groupes énumèrent leurs valeurs, la table inverse rend la
 * clé : `restaurant` -> `amenity`, `supermarket` -> `shop`. Une catégorie
 * ajoutée dans `filters.ts` est donc reconnue ici sans rien changer.
 */
const KEYS_BY_VALUE = new Map<string, string[]>();
for (const group of FILTER_GROUPS) {
  for (const [key, values] of Object.entries(group.tags)) {
    for (const value of values) {
      const keys = KEYS_BY_VALUE.get(value);
      if (!keys) KEYS_BY_VALUE.set(value, [key]);
      else if (!keys.includes(key)) keys.push(key);
    }
  }
}

/** Classe OpenMapTiles -> groupe, pour les valeurs qu'aucun groupe n'énumère. */
const GROUP_BY_CLASS = new Map<string, FilterGroupId>();
for (const group of FILTER_GROUPS) {
  for (const cls of group.tileClasses ?? []) {
    if (!GROUP_BY_CLASS.has(cls)) GROUP_BY_CLASS.set(cls, group.id); // le premier groupe l'emporte
  }
}

/**
 * Type d'objet OSM tel que Planetiler l'encode dans l'identifiant d'entité :
 * `identifiant = id OSM × 10 + type`. C'est ce qui permet, à l'ouverture d'une
 * fiche, d'aller chercher les horaires du bon objet dans la base OSM.
 */
const OSM_TYPES: Record<number, string> = { 1: "node", 2: "way", 3: "relation" };

function osmRef(id: string | number | undefined): string | null {
  if (typeof id !== "number" || !Number.isFinite(id)) return null;
  const type = OSM_TYPES[id % 10];
  return type ? `${type}/${Math.floor(id / 10)}` : null;
}

/**
 * Classe un POI de tuile dans une catégorie de `filters.ts`.
 *
 * D'abord par la valeur du tag (`subclass`), qui est exacte ; à défaut par la
 * classe OpenMapTiles, plus grossière mais qui rattrape les valeurs non
 * énumérées. `null` = aucune catégorie ne le réclame : le POI n'est pas
 * affiché.
 */
function groupFromTile(cls: unknown, subclass: unknown): FilterGroupId | null {
  if (typeof subclass === "string") {
    const keys = KEYS_BY_VALUE.get(subclass);
    if (keys) {
      const group = groupFromTags(Object.fromEntries(keys.map((key) => [key, subclass])));
      if (group) return group;
    }
  }
  return (typeof cls === "string" ? GROUP_BY_CLASS.get(cls) : undefined) ?? null;
}

function featureToPlace(feature: GeoJSONFeature): Place | null {
  const props = feature.properties ?? {};
  const name = typeof props.name === "string" ? props.name : undefined;
  if (!name) return null; // POI anonyme : rien à afficher

  const group = groupFromTile(props.class, props.subclass);
  if (!group) return null;

  const geometry = feature.geometry;
  if (geometry.type !== "Point") return null;
  const [lon, lat] = geometry.coordinates;

  // Sans identifiant OSM exploitable, le lieu reste affichable et cliquable :
  // seule la recherche de ses horaires sera impossible.
  const ref = osmRef(feature.id);

  return {
    id: ref ?? `poi/${lon.toFixed(6)},${lat.toFixed(6)}`,
    name,
    group,
    rawType: typeof props.subclass === "string" ? props.subclass : undefined,
    lon,
    lat,
    // `rank` : importance calculée par OpenMapTiles, 1 = le plus important.
    // Elle sert ici à deux choses — retenir les mieux classés quand la vue en
    // contient plus que le plafond, et fixer l'ordre de placement des pastilles
    // sur la carte.
    rank: typeof props.rank === "number" ? props.rank : 999,
  };
}

/**
 * POI déjà rencontrés, par identifiant.
 *
 * Les tuiles ne portent la couche `poi` que jusqu'au zoom 14 : au-delà,
 * MapLibre réutilise la tuile de niveau 14 et, selon l'état de son cache, la
 * relecture peut ne plus rien rendre au moment précis où l'on zoome sur une
 * rue. Garder ce qu'on a déjà lu règle la question une fois pour toutes : les
 * commerces d'un quartier parcouru restent affichés quand on s'en approche,
 * et l'affichage ne clignote plus pendant qu'une tuile se recharge.
 */
const seen = new Map<string, { place: Place; rank: number }>();
// Assez large pour couvrir une vue dense au zoom 14 et l'historique du
// déplacement qui l'a précédée : c'est ce souvenir qui garde les commerces
// affichés quand on zoome sur une rue et que la relecture des tuiles ne rend
// rien pendant leur rechargement.
const SEEN_LIMIT = 20000;

function remember(id: string, entry: { place: Place; rank: number }) {
  // Une réinsertion remet l'entrée en fin de file : les POI revus survivent aux
  // POI oubliés depuis longtemps.
  seen.delete(id);
  seen.set(id, entry);
  if (seen.size > SEEN_LIMIT) {
    for (const key of seen.keys()) {
      seen.delete(key);
      if (seen.size <= SEEN_LIMIT) break;
    }
  }
}

interface CollectOptions {
  /** Catégories cochées dans le menu de filtres. */
  groups: readonly FilterGroupId[];
  /** Faux en vue large : les arrêts de bus y sont trop nombreux pour être lisibles. */
  showBusStops: boolean;
  /** Emprise visible [sud, ouest, nord, est] : au-delà, inutile de dessiner. */
  bbox: [number, number, number, number];
  /** Plafond de POI retenus, les mieux classés d'abord. */
  limit: number;
}

/**
 * Lit les POI des tuiles chargées et les convertit en lieux affichables.
 *
 * `querySourceFeatures` interroge les tuiles déjà en mémoire : aucune requête
 * réseau, et le résultat est disponible immédiatement. Il renvoie en revanche
 * *toutes* les entités des tuiles couvrant la vue — en zoom rapproché, la tuile
 * parente déborde largement de l'écran — d'où le filtrage par emprise, puis le
 * plafond appliqué par `rank` (l'ordre d'importance calculé par OpenMapTiles,
 * 1 = le plus important) pour ne pas alimenter la carte avec des dizaines de
 * milliers de points en vue large.
 */
export function collectTilePois(map: MLMap, { groups, showBusStops, bbox, limit }: CollectOptions): Place[] {
  const wanted = new Set(groups);
  if (wanted.size === 0) return [];

  let features: GeoJSONFeature[] = [];
  if (map.getSource(VECTOR_SOURCE_ID)) {
    try {
      features = map.querySourceFeatures(VECTOR_SOURCE_ID, {
        sourceLayer: POI_SOURCE_LAYER,
        filter: ["has", "name"],
      });
    } catch {
      features = []; // source pas encore prête (changement de style en cours)
    }
  }

  const fresh = new Map<string, { place: Place; rank: number }>();
  for (const feature of features) {
    const place = featureToPlace(feature);
    if (!place) continue;
    const rank = place.rank ?? 999;
    fresh.set(place.id, { place, rank });
    remember(place.id, { place, rank });
  }

  // L'affichage réunit ce qui vient d'être lu et ce dont on se souvient. La
  // lecture courante passe en premier et sans condition : en zone dense elle
  // dépasse à elle seule le plafond du souvenir, et la faire transiter par lui
  // reviendrait à en perdre une partie au moment même où les tuiles viennent
  // de la fournir.
  const [south, west, north, east] = bbox;
  const visible: { place: Place; rank: number }[] = [];
  const keep = (entry: { place: Place; rank: number }) => {
    const { place } = entry;
    const inView = place.lat >= south && place.lat <= north && place.lon >= west && place.lon <= east;
    if (!inView) return false;

    if (!place.group || !wanted.has(place.group)) return false;
    if (!showBusStops && stopFamily(place.rawType) === "bus" && place.group === "transport") return false;
    return true;
  };

  for (const entry of fresh.values()) {
    if (keep(entry)) visible.push(entry);
  }
  for (const [id, entry] of seen) {
    if (!fresh.has(id) && keep(entry)) visible.push(entry);
  }

  // Tri par importance : quand deux pastilles se disputent la même place à
  // l'écran, MapLibre garde celle qui vient en premier.
  visible.sort((a, b) => a.rank - b.rank);
  return mergeNearbyStops(visible.map((entry) => entry.place)).slice(0, limit);
}

/**
 * Enseignes suggérées à la saisie, tirées des lieux déjà croisés sur la carte.
 *
 * Les suggestions viennent des données elles-mêmes plutôt que d'une liste
 * tenue à la main : ce que la carte propose est ce qu'elle contient. Les
 * raccourcis d'usage — « macdo », « bk » — sont les seuls à demander une
 * table, les lettres n'y suffisant pas.
 */
const BRAND_SHORTCUTS: Record<string, string> = {
  macdo: "McDonald's",
  macdonald: "McDonald's",
  mcdo: "McDonald's",
  bk: "Burger King",
  burgerk: "Burger King",
  ce: "Caisse d'Épargne",
  bnp: "BNP Paribas",
  sg: "Société Générale",
  ldl: "Lidl",
  kfc: "KFC",
  gv: "Grand Frais",
};

export function suggestBrands(query: string, limit = 3): string[] {
  const wanted = normalizeStopName(query);
  if (wanted.length < 2) return [];

  const shortcut = BRAND_SHORTCUTS[wanted];
  const terms = [wanted];
  if (shortcut) terms.push(normalizeStopName(shortcut));

  // Un nom d'enseigne revient plusieurs fois sur la carte : ce décompte fait
  // remonter les vraies enseignes avant les commerces isolés.
  const counts = new Map<string, number>();
  for (const { place } of seen.values()) {
    // Un arrêt n'est pas une enseigne : les poteaux « Bastille » faisaient
    // proposer « afficher tous les Bastille » comme s'il s'agissait d'une chaîne.
    if (place.group === "transport") continue;
    const name = normalizeStopName(place.name);
    const compact = name.replace(/ /g, "");
    const hit = terms.some((term) => name.startsWith(term) || compact.startsWith(term.replace(/ /g, "")));
    if (!hit) continue;
    counts.set(place.name, (counts.get(place.name) ?? 0) + 1);
  }

  // Un nom qui ne revient qu'une fois est un commerce, pas une enseigne : la
  // proposition « afficher tous les… » n'aurait rien à afficher de plus.
  const found = [...counts]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"))
    .slice(0, limit)
    .map(([name]) => name);

  // Le raccourci vaut même quand la carte n'a encore rien croisé — en vue
  // large, elle ne connaît aucun commerce.
  if (found.length === 0 && shortcut) return [shortcut];
  return found;
}

/** Rayon en deçà duquel deux arrêts de même nom sont le même lieu. */
const STOP_MERGE_RADIUS_M = 300;

/**
 * Le regroupement se fait à l'intérieur d'un même mode.
 *
 * Un poteau de bus « Châtelet » et la station de métro du même nom sont deux
 * points de montée distincts, desservis par des lignes différentes : les
 * confondre ferait disparaître les pastilles de bus de la carte. En revanche
 * les deux poteaux d'un même arrêt, de part et d'autre de la rue, méritent bien
 * une seule icône.
 */
function stopFamily(rawType: string | undefined): string {
  return rawType === "bus_stop" || rawType === "bus_station" ? "bus" : "rail";
}

function normalizeStopName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function metersBetween(a: Place, b: Place): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const lat = ((a.lat + b.lat) / 2) * toRad;
  return Math.hypot(dLon * Math.cos(lat), dLat) * 6371000;
}

/**
 * Réunit les arrêts d'une même gare en un seul point.
 *
 * OpenStreetMap décrit une grande gare par plusieurs objets — un par mode, par
 * quai ou par compagnie — et Châtelet finissait par afficher quatre fois la
 * même pastille. On ne garde donc que le premier de chaque groupe de même nom
 * situé à moins de 300 mètres ; comme la liste arrive triée par importance,
 * c'est l'objet le mieux classé qui représente la gare.
 *
 * La contrainte de distance est indispensable : « Mairie » ou « Église »
 * nomment des dizaines d'arrêts sans rapport dans toute la région.
 */
function mergeNearbyStops(places: Place[]): Place[] {
  const kept: Place[] = [];
  const stopsByName = new Map<string, Place[]>();

  for (const place of places) {
    if (place.group !== "transport") {
      kept.push(place);
      continue;
    }
    const name = `${stopFamily(place.rawType)}|${normalizeStopName(place.name)}`;
    const sameName = stopsByName.get(name);
    if (sameName?.some((other) => metersBetween(other, place) <= STOP_MERGE_RADIUS_M)) continue;

    if (sameName) sameName.push(place);
    else stopsByName.set(name, [place]);
    kept.push(place);
  }

  return kept;
}
