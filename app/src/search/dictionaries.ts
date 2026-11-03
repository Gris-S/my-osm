import { editDistance, normalizeText, singular } from "./textMatch";

// ---------------------------------------------------------------------------
// Les deux dictionnaires de la recherche, engendrés par
// `scripts/build-search-data.mjs` depuis deux projets OpenStreetMap libres :
//
// - les **catégories** (id-tagging-schema, ISC) : « pharmacie », « pharmacy »,
//   « Apotheke » → `amenity=pharmacy`. Une langue n'est chargée qu'à la
//   première recherche, et seulement celles du téléphone, plus l'anglais.
// - les **enseignes** (name-suggestion-index, BSD-3-Clause) : « fnac »,
//   « 7-eleven », « macdo » → l'enseigne, même jamais croisée sur la carte.
//
// Le chargement est paresseux et partagé ; tant qu'il n'a pas répondu, la
// recherche fait sans (`current()` rend `null`).
// ---------------------------------------------------------------------------

/** Une catégorie reconnue dans la saisie : le tag OSM et le mot tapé. */
export interface CategoryMatch {
  key: string;
  value: string;
  /** Le mot qui a été reconnu, tel qu'écrit dans le dictionnaire. */
  term: string;
  /** La saisie **est** la catégorie (« pharmacie »), et pas seulement son début (« pharm »). */
  exact: boolean;
}

export interface SearchDictionaries {
  /** Mot normalisé (et mis au singulier) → tags `clé=valeur` dont c'est le **nom**. */
  categoryNames: Map<string, string[]>;
  /** Mot normalisé (et mis au singulier) → tous les tags qu'il désigne, synonymes compris. */
  categories: Map<string, string[]>;
  /** Nom d'enseigne normalisé, ou un de ses autres noms → nom affiché. */
  brands: Map<string, string>;
  /** Noms d'enseigne normalisés seulement, pour les débuts de nom. */
  brandNames: Map<string, string>;
}

const categoryFiles = import.meta.glob<string[][] | [string, string[]][]>("./data/categories/*.json", { import: "default" });
const brandFile = () => import("./data/brands.json").then((m) => m.default as string[][]);

/**
 * Les langues à charger : celles du téléphone (sans la région), puis les deux
 * de l'interface — un téléphone réglé en anglais avec l'application en
 * français tape « pharmacie » (constaté à l'essai du 3 novembre 2026).
 */
export function wantedLanguages(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const tag of [...tags, "fr", "en"]) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    for (const candidate of [tag.replace("_", "-"), base]) {
      if (!out.includes(candidate) && categoryFiles[`./data/categories/${candidate}.json`]) out.push(candidate);
    }
  }
  return out;
}

/** Construit les index à partir des données brutes (séparé pour les tests). */
export function buildDictionaries(categoryLists: [string, string[]][][], brandList: string[][]): SearchDictionaries {
  const categoryNames = new Map<string, string[]>();
  const categories = new Map<string, string[]>();
  const add = (index: Map<string, string[]>, key: string, tag: string) => {
    const tags = index.get(key);
    if (!tags) index.set(key, [tag]);
    else if (!tags.includes(tag)) tags.push(tag);
  };
  for (const list of categoryLists) {
    for (const [tag, words] of list) {
      // La valeur du tag compte comme un mot (« pharmacy », « fuel ») : iD ne
      // l'écrit pas toujours parmi les synonymes.
      add(categories, normalizeText(tag.split("=")[1]).split(" ").map(singular).join(" "), tag);
      words.forEach((word, i) => {
        const key = normalizeText(word).split(" ").map(singular).join(" ");
        if (!key) return;
        add(categories, key, tag);
        if (i === 0) add(categoryNames, key, tag); // le premier mot est le nom de la catégorie
      });
    }
  }
  const brands = new Map<string, string>();
  const brandNames = new Map<string, string>();
  for (const [name, ...others] of brandList) {
    const key = normalizeText(name);
    if (key && !brandNames.has(key)) brandNames.set(key, name);
    if (key && !brands.has(key)) brands.set(key, name);
    for (const alias of others) {
      const k = normalizeText(alias);
      // Un surnom qui est aussi un mot de catégorie (« station », « pharmacie »)
      // ne désigne pas l'enseigne : relevé dans name-suggestion-index.
      if (k && !brands.has(k) && !categories.has(k.split(" ").map(singular).join(" "))) brands.set(k, name);
    }
  }
  return { categoryNames, categories, brands, brandNames };
}

let loaded: SearchDictionaries | null = null;
let loading: Promise<SearchDictionaries> | null = null;

/** Charge les dictionnaires une fois ; les appels suivants rendent la même promesse. */
export function loadDictionaries(): Promise<SearchDictionaries> {
  if (!loading) {
    const tags = typeof navigator !== "undefined" ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
    loading = Promise.all([
      Promise.all(wantedLanguages(tags).map((lang) => categoryFiles[`./data/categories/${lang}.json`]() as Promise<[string, string[]][]>)),
      brandFile(),
    ]).then(([lists, brands]) => (loaded = buildDictionaries(lists, brands)));
    // Un échec (fragment introuvable hors ligne) se retente à la recherche suivante.
    loading.catch(() => (loading = null));
  }
  return loading;
}

/** Les dictionnaires s'ils sont déjà là, sans attendre. */
export function currentDictionaries(): SearchDictionaries | null {
  return loaded;
}

/** Part minimale d'un mot à avoir tapée pour qu'un début désigne la catégorie (« opera » n'est pas « opérateur »). */
const CATEGORY_PREFIX_SHARE = 0.6;

/**
 * La catégorie que désigne la saisie (relevés du 3 novembre 2026 sur les vrais
 * dictionnaires) :
 *
 * - **entière** (« pharmacies », « bakery ») : le nom d'une catégorie l'emporte
 *   sur un synonyme (« restaurant » est un restaurant, pas un café) ; un mot qui
 *   n'est que le synonyme de plusieurs catégories est ambigu et ne désigne rien
 *   (« station » : service, sauvetage, métro…) ;
 * - **à une faute près** sur un mot d'au moins six lettres (« boulangeire »),
 *   sauf si c'est une enseigne (« carrefour » n'est pas « carreleur ») ;
 * - **son début** (« boulang »), s'il fait au moins 60 % du mot et cinq
 *   lettres : il ne vaut pas la catégorie entière (`exact` faux).
 */
export function matchCategory(dict: SearchDictionaries, query: string): CategoryMatch | null {
  const typed = normalizeText(query).split(" ").map(singular).join(" ");
  if (typed.length < 3) return null;
  const pick = (tags: string[], term: string, exact: boolean): CategoryMatch => {
    const [key, value] = tags[0].split("=");
    return { key, value, term, exact };
  };
  const unambiguous = (term: string): string[] | null => {
    const all = dict.categories.get(term) ?? [];
    // La valeur du tag elle-même (« pharmacy ») : en anglais, iD nomme la
    // pharmacie « Pharmacy Counter » et range « pharmacy » chez la droguerie.
    const byValue = all.filter((tag) => normalizeText(tag.split("=")[1]).split(" ").map(singular).join(" ") === term);
    if (byValue.length === 1) return byValue;
    // `amenity=fuel` et `shop=fuel` : le service avant le commerce.
    if (byValue.length > 1) return [byValue.find((tag) => tag.startsWith("amenity=")) ?? byValue[0]];
    const named = dict.categoryNames.get(term);
    if (named?.length === 1) return named;
    if (all.length === 1) return all;
    // « coiffeur » : coiffeur et fournitures de coiffure — la valeur qui
    // prolonge les autres (`hairdresser_supply`) n'est qu'une variante.
    const base = all.find((tag) => all.every((other) => other.startsWith(tag)));
    return base ? [base] : null;
  };
  if (dict.categories.has(typed)) {
    const tags = unambiguous(typed);
    return tags ? pick(tags, typed, true) : null;
  }
  if (typed.length < 5) return null;
  // Un mot entier d'une autre catégorie (« station » dans « station service »)
  // n'est pas le début d'une troisième (« stationery »).
  const wholeWord = [...dict.categories.keys()].some((term) => term.split(" ").includes(typed));
  let best: string | null = null;
  for (const term of dict.categories.keys()) {
    if (!wholeWord && term.startsWith(typed) && typed.length >= CATEGORY_PREFIX_SHARE * term.length && unambiguous(term) && (best === null || term.length < best.length)) best = term;
  }
  if (best) return pick(unambiguous(best)!, best, false);
  if (typed.length < 6 || dict.brands.has(normalizeText(query))) return null;
  let closest: string | null = null;
  for (const term of dict.categories.keys()) {
    if (editDistance(typed, term, 1) <= 1 && unambiguous(term) && (closest === null || term.length < closest.length)) closest = term;
  }
  return closest ? pick(unambiguous(closest)!, closest, true) : null;
}

/** Part minimale du nom d'une enseigne à avoir tapée pour la proposer sur un début (« gare » n'est pas « GarentaDAY »). */
const BRAND_PREFIX_SHARE = 0.5;

/**
 * Les enseignes que désigne la saisie : son nom exact ou un autre nom connu
 * (« macdo »), puis, dès trois lettres, celles dont le **nom** commence par
 * elle et dont on a tapé au moins la moitié — les plus courtes d'abord
 * (« Lidl » avant « Lidl Express »).
 */
export function matchBrands(dict: SearchDictionaries, query: string, limit = 3): string[] {
  const typed = normalizeText(query);
  if (typed.length < 2) return [];
  const out: string[] = [];
  const exact = dict.brands.get(typed);
  if (exact) out.push(exact);
  if (typed.length >= 3) {
    const starts: string[] = [];
    for (const [key, name] of dict.brandNames) {
      if (key !== typed && key.startsWith(typed) && typed.length >= BRAND_PREFIX_SHARE * key.length && !out.includes(name) && !starts.includes(name)) starts.push(name);
    }
    starts.sort((a, b) => a.length - b.length || a.localeCompare(b));
    out.push(...starts);
  }
  return out.slice(0, limit);
}
