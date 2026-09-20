import type { Place } from "../types";
import { isTransitStop } from "../services/idfm";
import { normalizeBrand } from "../services/geocode";

// ---------------------------------------------------------------------------
// Les résultats de recherche : ce qu'ils sont, et dans quel ordre.
//
// Refonte de la barre de recherche (demande explicite, 19 septembre 2026) :
// chaque ligne dit d'un coup d'œil ce qu'elle désigne — une adresse (flèche),
// un lieu (épingle), un arrêt où passent des lignes (pastille de la ligne, ou
// pictogramme de transport s'il y en a plusieurs). Les arrêts d'un même nom au
// même endroit ne font qu'un résultat, et une station dont le nom ressemble à
// ce qu'on tape passe en tête (réglable : `stationsFirst`).
// ---------------------------------------------------------------------------

export type ResultKind = "address" | "transit" | "place";

/** Ce que désigne un résultat : un arrêt, un lieu nommé, ou une adresse. */
export function resultKind(place: Place): ResultKind {
  if (isTransitStop(place)) return "transit";
  // Sans catégorie : une rue, un numéro, une commune, un lieu-dit.
  return place.group ? "place" : "address";
}

/** Distance en mètres, suffisante à l'échelle d'un quartier. */
function meters(a: Place, b: Place): number {
  const x = (b.lon - a.lon) * 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const y = (b.lat - a.lat) * 110_540;
  return Math.hypot(x, y);
}

/**
 * Au-delà, deux arrêts du même nom sont deux endroits (« Mairie », « Gare »).
 *
 * Sept cents mètres et non quatre cents : les grandes stations s'étalent, et
 * leurs arrêts sortaient du cercle. Relevé le 20 septembre 2026 en cherchant
 * des stations au hasard — « Châtelet » rendait la station, un poteau de bus
 * « Châtelet » et « Châtelet - Les Halles » en trois résultats séparés,
 * « Shinjuku » deux fois, « Montparnasse » cinq fois. Deux stations réellement
 * distinctes portant le même nom à moins de 700 m n'existent pour ainsi dire
 * pas ; deux arrêts du même nom si proches sont le même endroit.
 */
const SAME_STOP_METERS = 700;

/** Un résultat affiché : le lieu ouvert au toucher, et les arrêts qu'il réunit. */
export interface SearchEntry {
  place: Place;
  /** Les arrêts réunis sous ce résultat ; un seul hors transport. */
  members: Place[];
}

/**
 * Réunit les arrêts de même nom à moins de 400 m : Bastille métro, Bastille
 * bus et Bastille RER ne sont qu'un endroit pour qui le cherche. Le résultat
 * garde la place du premier venu, mais ouvre de préférence la **station**
 * (rail, métro, tram) : sa fiche réunit le plus de lignes.
 */
export function groupStops(results: Place[]): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const place of results) {
    if (resultKind(place) !== "transit") {
      entries.push({ place, members: [place] });
      continue;
    }
    const name = baseName(place.name);
    const same = entries.find(
      (entry) =>
        resultKind(entry.place) === "transit" &&
        sameStopName(baseName(entry.place.name), name) &&
        meters(entry.place, place) <= SAME_STOP_METERS
    );
    if (!same) {
      entries.push({ place, members: [place] });
      continue;
    }
    same.members.push(place);
    if (better(place, same.place)) same.place = place;
  }
  for (const entry of entries) {
    if (resultKind(entry.place) === "transit") entry.place = withoutParenthetical(entry.place);
  }
  return withoutRepeatedPlaces(withoutStationNamesakes(entries));
}

/**
 * Un même lieu, rendu plusieurs fois : une rue découpée en tronçons, un lieu
 * porté à la fois par un point et par un contour. Relevé le 20 septembre 2026
 * sur des recherches au hasard — « Tunnel du Vieux-Port » trois fois à
 * Marseille, « King's Cross Road » trois fois à Londres, « Place de la
 * République » trois fois à Rennes, « Termini FS » trois fois à Rome.
 *
 * Le nom **et** l'adresse doivent coïncider : deux « Mairie » de deux communes
 * restent deux résultats, et deux commerces d'une même enseigne à deux adresses
 * aussi. Les arrêts ne passent pas par ici — ils ont leur propre regroupement,
 * qui sait réunir des noms voisins (`sameStopName`).
 */
function withoutRepeatedPlaces(entries: SearchEntry[]): SearchEntry[] {
  const kept: SearchEntry[] = [];
  for (const entry of entries) {
    const kind = resultKind(entry.place);
    if (kind === "transit") {
      kept.push(entry);
      continue;
    }
    const name = normalizeBrand(entry.place.name);
    const already = kept.some((other) => {
      if (resultKind(other.place) === "transit" || normalizeBrand(other.place.name) !== name) return false;
      // Même nom, même adresse : le même lieu rendu deux fois.
      if (normalizeBrand(other.place.address ?? "") === normalizeBrand(entry.place.address ?? "")) return true;
      // Une **voie** garde son nom sur toute sa longueur, et OSM la découpe en
      // tronçons qui n'ont ni le même code postal ni le même bout de ville :
      // « King's Cross Road » sortait trois fois à Londres, « Rue Saint-Lazare »
      // deux fois à Paris. À moins d'un kilomètre, c'est la même voie.
      // Réservé à ce qui n'a pas de catégorie — une rue, une place, un tunnel,
      // un quartier. Deux commerces d'une même enseigne à deux coins de rue
      // restent deux résultats : c'est tout l'intérêt de chercher une enseigne.
      return kind === "address" && meters(other.place, entry.place) <= SAME_STREET_METERS;
    });
    if (!already) kept.push(entry);
  }
  return kept;
}

/** Deux tronçons du même nom plus éloignés que cela sont deux voies distinctes. */
const SAME_STREET_METERS = 1000;

/**
 * L'arrêt sans ce que les données ajoutent entre parenthèses : « Gare du Nord
 * (Métro ligne 5) » s'affiche « Gare du Nord ».
 *
 * La station l'emporte désormais sur ses quais (`better`), et c'est elle qui
 * porte le plus souvent cette précision — la liste y aurait perdu le nom court
 * qu'elle montrait jusqu'ici. Le nom nettoyé est aussi celui qui ressemble le
 * plus à l'entrée du référentiel des transports, qui rapproche les arrêts par
 * leur nom (`services/idfm.ts`). Une parenthèse qui serait tout le nom est
 * gardée telle quelle : mieux vaut un nom étrange qu'un résultat sans nom.
 */
function withoutParenthetical(place: Place): Place {
  const name = place.name.replace(/\s*\([^)]*\)/g, "").replace(/\s{2,}/g, " ").trim();
  return name && name !== place.name ? { ...place, name } : place;
}

/**
 * Écarte ce qui porte **exactement** le nom d'une station trouvée, au même
 * endroit, sans en être un arrêt : le bâtiment voyageurs (`building=…`, que le
 * géocodeur rend sans catégorie, donc en « adresse ») et la station de vélos
 * qui reprend le nom du métro. « Saint-Denis - Université » sortait ainsi trois
 * fois de suite, identique à l'œil (constaté sur appareil, 20 septembre 2026).
 *
 * Le nom doit être le même mot pour mot — et non simplement commencer pareil,
 * comme entre deux arrêts : « Bastille » ne doit pas faire disparaître le
 * « Bastille Café » d'en face. Ces lieux restent sur la carte, ils ne prennent
 * simplement plus une ligne de résultat pour redire une station déjà listée.
 */
function withoutStationNamesakes(entries: SearchEntry[]): SearchEntry[] {
  const stations = entries.filter((entry) => resultKind(entry.place) === "transit");
  if (stations.length === 0) return entries;
  return entries.filter(
    (entry) =>
      resultKind(entry.place) === "transit" ||
      !stations.some(
        (station) =>
          baseName(station.place.name) === baseName(entry.place.name) &&
          meters(station.place, entry.place) <= SAME_STOP_METERS
      )
  );
}

/**
 * Le nom d'un arrêt sans ce que les données y ajoutent entre parenthèses :
 * « Gare du Nord (Métro ligne 5) » est « Gare du Nord ».
 */
function baseName(name: string): string {
  return normalizeBrand(name.replace(/\([^)]*\)/g, " "));
}

/**
 * Deux noms désignent le même arrêt quand l'un **contient** l'autre, mot pour
 * mot : « Gare du Nord », « Gare du Nord - Dunkerque », « Gare du Nord USFRT »,
 * mais aussi « Saint-Lazare » et « Gare Saint-Lazare », « Berri-UQAM » et
 * « Station Berri-UQAM ». Les données nomment le même quai tantôt par la
 * station, tantôt par le bâtiment ou le mode ; se limiter au début du nom
 * laissait ces variantes en résultats séparés (relevé le 20 septembre 2026 :
 * quatre lignes pour Saint-Lazare, trois pour Berri-UQAM à Montréal).
 *
 * Mot entier seulement : « Gare » ne désigne pas « Garenne », et « Nation » ne
 * désigne pas « Nationale ».
 */
function sameStopName(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && containsWords(long, short);
}

/** `haystack` contient-il les mots de `needle`, à la suite et entiers ? */
function containsWords(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * Le lieu qu'ouvre un résultat réunissant plusieurs arrêts, du meilleur au
 * moins bon : la **station** d'abord — sa fiche réunit le plus de lignes —
 * puis un quai, puis une entrée, et le poteau de bus en dernier.
 *
 * La station était auparavant à égalité avec ses quais, et « Saint-Denis -
 * Université » ouvrait donc un `railway=stop` : le résultat portait le nom du
 * quai (« Saint-Denis-Université », sans les espaces) et la position d'un point
 * d'arrêt au lieu de celles de la station (constaté sur appareil,
 * 20 septembre 2026). À rang égal, le nom le plus court l'emporte : « Gare du
 * Nord » plutôt que « Gare du Nord (Métro) ».
 */
function better(candidate: Place, current: Place): boolean {
  const rank = (place: Place) =>
    isBusStop(place) ? 3 : isEntrance(place) ? 2 : isStation(place) ? 0 : 1;
  if (rank(candidate) !== rank(current)) return rank(candidate) < rank(current);
  const length = (place: Place) => baseName(place.name).length * 1000 + place.name.length;
  return length(candidate) < length(current);
}

/** Une station, par opposition à un quai, un point d'arrêt ou une entrée. */
function isStation(place: Place): boolean {
  return (
    place.rawType === "station" ||
    place.rawType === "halt" ||
    place.rawType === "subway" ||
    place.rawType === "tram" ||
    place.rawType === "tram_stop"
  );
}

function isEntrance(place: Place): boolean {
  return place.rawType === "train_station_entrance" || place.rawType === "subway_entrance";
}

function isBusStop(place: Place): boolean {
  return place.rawType === "bus_stop" || place.rawType === "bus_station";
}

/** Distance d'édition entre deux chaînes (Levenshtein). */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const kept = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = kept;
    }
  }
  return row[b.length];
}

/** Seuil de ressemblance demandé : 70 %. */
export const STATION_MATCH = 0.7;

/**
 * Ce que tape l'utilisateur ressemble-t-il au nom de cette station ?
 *
 * Oui si les deux se ressemblent à 70 % au moins — accents, majuscules et
 * tirets ignorés, une faute de frappe passe (« bastile ») — **ou** si le nom
 * commence par ce qu'on tape, dès trois lettres : « Ranel » ne ressemble à
 * « Ranelagh » qu'à 62 %, mais on est en train de l'écrire.
 */
export function looksLikeStation(query: string, name: string): boolean {
  const typed = normalizeBrand(query);
  const target = normalizeBrand(name);
  if (!typed || !target) return false;
  if (typed.length >= 3 && target.startsWith(typed)) return true;
  // Le nom de la station contient ce qu'on a tapé, mot pour mot : « part dieu »
  // désigne bien « Lyon Part-Dieu », que la distance d'édition écartait (64 %).
  // Deux mots au moins, sinon « lyon » désignerait « Gare de Lyon » — ce qui
  // est précisément ce qu'on ne veut pas.
  if (typed.split(" ").length >= 2 && containsWords(target, typed)) return true;
  const longest = Math.max(typed.length, target.length);
  return 1 - editDistance(typed, target) / longest >= STATION_MATCH;
}

/**
 * Les stations dont le nom ressemble à la saisie passent en tête, dans leur
 * ordre ; le reste suit, dans le sien.
 */
export function stationsFirst(entries: SearchEntry[], query: string): SearchEntry[] {
  const first = entries.filter(
    (entry) => resultKind(entry.place) === "transit" && looksLikeStation(query, entry.place.name)
  );
  if (first.length === 0) return entries;
  return [...first, ...entries.filter((entry) => !first.includes(entry))];
}

/**
 * Les mots qui ouvrent un nom de voie : ce qu'on tape est alors une rue ou une
 * adresse, jamais une enseigne.
 */
const STREET_WORDS =
  /^(rue|avenue|av|boulevard|bd|place|pl|chemin|allee|impasse|quai|route|rte|cours|square|passage|sentier|street|st|road|rd|lane|drive|way)\b/;

/**
 * La saisie désigne-t-elle une chose précise — une station, une rue, une
 * adresse, un lieu unique ? « Afficher tous les … » n'a alors pas de sens
 * (demande explicite) : il n'y a pas « tous les Bastille » ni « tous les rue de
 * Rivoli ». Il reste pour ce qui se répète : McDonald's, Monoprix, Picard.
 */
export function designatesSpecificPlace(query: string, entries: SearchEntry[], repeated: (name: string) => boolean): boolean {
  const typed = normalizeBrand(query);
  if (!typed) return false;
  // Un numéro en tête, ou un mot de voie : une adresse ou une rue.
  if (/^\d/.test(typed) || STREET_WORDS.test(typed)) return true;
  // Une station, même à moitié tapée (« Ranel »).
  if (entries.some(({ place }) => resultKind(place) === "transit" && looksLikeStation(query, place.name))) return true;
  // Un nom qui se répète parmi les commerces est une enseigne, même si une rue
  // ou un lieu-dit le porte aussi (« Mcdonald's », voie privée à Amilly).
  if (repeated(query)) return false;
  // Sinon, le nom exact d'une rue, d'une commune ou d'un lieu unique.
  return entries.some(({ place }) => normalizeBrand(place.name) === typed);
}

// --- Réglage ----------------------------------------------------------------

const STATIONS_FIRST_KEY = "osm-local:search-stations-first";

/** Réglage « stations en premier dans la recherche », actif par défaut. */
export function stationsFirstEnabled(): boolean {
  try {
    return localStorage.getItem(STATIONS_FIRST_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setStationsFirstEnabled(on: boolean): void {
  try {
    localStorage.setItem(STATIONS_FIRST_KEY, on ? "on" : "off");
  } catch {
    /* le réglage reviendra à sa valeur par défaut */
  }
}
