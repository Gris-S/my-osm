// ---------------------------------------------------------------------------
// Taxonomie des catégories affichables sur la carte.
//
// Chaque groupe rassemble un ensemble de tags OpenStreetMap. Il sert à la fois :
//  - à construire la requête Overpass (on ne télécharge que les groupes cochés) ;
//  - à classer un POI reçu (`groupFromTags`) pour le filtrage côté client,
//    sa couleur de pastille sur la carte et son libellé dans la fiche lieu.
//
// L'ordre du tableau `FILTER_GROUPS` est significatif : `groupFromTags` retient
// le premier groupe qui correspond. Les groupes spécifiques (supérettes,
// fast-foods, santé…) doivent donc précéder le fourre-tout « Commerces ».
// ---------------------------------------------------------------------------
import type { TranslationKey } from "./i18n";

export type FilterGroupId =
  | "grocery"
  | "bakery"
  | "fastfood"
  | "food"
  | "nightlife"
  | "health"
  | "beauty"
  | "fashion"
  | "home"
  | "culture"
  | "outdoors"
  | "sport"
  | "lodging"
  | "transport"
  | "parking"
  | "shop";

/**
 * Dessin d'une icône, au format « icon node » de Lucide : une liste d'éléments
 * SVG à tracer dans une zone 24×24, en trait de 2px sans remplissage.
 *
 * Les tracés ci-dessous sont repris de Lucide (licence ISC, lucide.dev). Ils
 * sont recopiés ici plutôt qu'importés depuis `lucide-react` pour être
 * utilisables des deux côtés à partir d'une seule source : le menu les rend en
 * React, la carte les redessine sur un canvas (voir `src/utils/markerImage.ts`).
 */
export type IconNode = [element: string, attrs: Record<string, string>][];

export interface FilterGroup {
  id: FilterGroupId;
  /**
   * Clé du libellé dans le dictionnaire (`src/i18n`), et non le libellé
   * lui-même : le menu et la fiche le traduisent au rendu, si bien qu'un
   * changement de langue ne demande pas de reconstruire ces tables.
   */
  label: TranslationKey;
  /** Couleur de la pastille sur la carte et de la puce dans le menu. */
  color: string;
  /** Pictogramme du groupe, partagé par le menu et les marqueurs de la carte. */
  icon: IconNode;
  /**
   * Tags OSM du groupe : clé -> valeurs retenues. Un tableau vide signifie
   * « n'importe quelle valeur » (utilisé par le fourre-tout `shop`).
   * `services/overpass.ts` fusionne ces tables pour les groupes cochés afin
   * d'en tirer une requête compacte.
   */
  tags: Record<string, string[]>;
  /**
   * Classes OpenMapTiles rattachées à ce groupe (voir `services/tilePois.ts`).
   *
   * Les POI affichés viennent des tuiles vectorielles, qui ne donnent pas les
   * tags bruts mais un couple `class` / `subclass`. La sous-classe *est* la
   * valeur du tag OSM : elle suffit dès que le groupe énumère ses valeurs
   * (`amenity=restaurant`, `shop=supermarket`…). Ces classes ne servent qu'aux
   * valeurs non énumérées — les milliers de `shop=*` du fourre-tout, ou les
   * `leisure=playground` qu'aucun groupe ne cite nommément. Ce qui n'est
   * réclamé ni par une valeur ni par une classe n'est pas affiché, ce qui
   * écarte d'office les corbeilles, bornes et arceaux à vélos que la couche
   * POI transporte aussi.
   */
  tileClasses?: readonly string[];
  /** Vrai si les tags OSM d'un POI relèvent de ce groupe. */
  match: (tags: Record<string, string>) => boolean;
}

interface TagRule {
  tags: Record<string, string[]>;
  match: (t: Record<string, string>) => boolean;
}

/** Règle « ce tag prend l'une de ces valeurs ». Sans valeur : n'importe laquelle. */
function tagRule(key: string, values: string[] = []): TagRule {
  const set = new Set(values);
  return {
    tags: { [key]: values },
    match: (t) => {
      const v = t[key];
      return v !== undefined && (values.length === 0 || set.has(v));
    },
  };
}

/** Regroupe plusieurs règles en un seul groupe (union des tags). */
function rules(...rs: TagRule[]): TagRule {
  const tags: Record<string, string[]> = {};
  for (const rule of rs) {
    for (const [key, values] of Object.entries(rule.tags)) {
      // Une règle sans valeur absorbe les autres : « tout `shop` » rend inutile
      // d'énumérer les valeurs de `shop` déjà couvertes.
      if (values.length === 0 || tags[key]?.length === 0) tags[key] = [];
      else tags[key] = [...(tags[key] ?? []), ...values];
    }
  }
  return { tags, match: (t) => rs.some((r) => r.match(t)) };
}

const GROCERY = rules(
  tagRule("shop", [
    "supermarket",
    "convenience",
    "greengrocer",
    "butcher",
    "deli",
    "cheese",
    "seafood",
    "beverages",
    "alcohol",
    "wine",
    "coffee",
    "tea",
    "dairy",
    "frozen_food",
    "health_food",
    "farm",
    "grocery",
    "spices",
    "nuts",
  ])
);

const BAKERY = rules(tagRule("shop", ["bakery", "pastry", "confectionery", "chocolate"]));

const FASTFOOD = rules(tagRule("amenity", ["fast_food", "food_court"]));

const FOOD = rules(tagRule("amenity", ["restaurant", "cafe", "ice_cream"]));

const NIGHTLIFE = rules(tagRule("amenity", ["bar", "pub", "nightclub", "biergarten", "casino"]));

const HEALTH = rules(
  tagRule("amenity", ["pharmacy", "hospital", "clinic", "doctors", "dentist", "veterinary"]),
  tagRule("healthcare", []),
  tagRule("shop", ["chemist", "optician", "hearing_aids", "medical_supply"])
);

const BEAUTY = rules(
  tagRule("shop", ["hairdresser", "beauty", "cosmetics", "perfumery", "tattoo", "massage", "herbalist"]),
  tagRule("leisure", ["spa", "sauna"])
);

const FASHION = rules(
  tagRule("shop", [
    "clothes",
    "shoes",
    "bag",
    "jewelry",
    "watches",
    "boutique",
    "fashion_accessories",
    "leather",
    "fabric",
    "tailor",
    "second_hand",
    "sewing",
  ])
);

const HOME = rules(
  tagRule("shop", [
    "furniture",
    "hardware",
    "doityourself",
    "houseware",
    "garden_centre",
    "paint",
    "electrical",
    "appliance",
    "interior_decoration",
    "kitchen",
    "bed",
    "lighting",
    "curtain",
    "flooring",
    "trade",
    "tiles",
  ])
);

const CULTURE = rules(
  tagRule("amenity", ["cinema", "theatre", "library", "arts_centre", "community_centre", "music_venue"]),
  tagRule("tourism", ["museum", "gallery", "artwork", "attraction"]),
  tagRule("historic", ["monument", "memorial", "castle", "ruins", "archaeological_site"])
);

const OUTDOORS = rules(
  tagRule("leisure", ["park", "garden", "playground", "dog_park", "nature_reserve", "common"]),
  tagRule("tourism", ["viewpoint", "picnic_site"]),
  tagRule("natural", ["beach"])
);

const SPORT = rules(
  tagRule("leisure", [
    "sports_centre",
    "fitness_centre",
    "fitness_station",
    "swimming_pool",
    "pitch",
    "stadium",
    "golf_course",
    "horse_riding",
    "sports_hall",
    "track",
    "water_park",
    "ice_rink",
  ])
);

const LODGING = rules(
  tagRule("tourism", ["hotel", "hostel", "guest_house", "motel", "apartment", "chalet", "camp_site", "caravan_site"])
);

// Ne restent dans « Transports » que les points où l'on monte à bord, c'est-à-
// dire ceux dont on peut annoncer un horaire. Les bouches de métro et accès de
// gare en sont exclus : ils font double emploi avec la station qu'ils
// desservent, et une seule grande gare en aligne parfois vingt.
const TRANSPORT = rules(
  tagRule("amenity", ["bus_station"]),
  tagRule("highway", ["bus_stop"]),
  tagRule("railway", ["station", "halt", "tram_stop"])
);

const PARKING = rules(tagRule("amenity", ["parking", "parking_entrance"]));

const SHOP = rules(
  tagRule("amenity", [
    "bank",
    "post_office",
    "bureau_de_change",
    "marketplace",
    // Ni des arrêts ni des commerces : ces services de mobilité quittent la
    // catégorie « Transports », qui ne parle plus que des lignes.
    "fuel",
    "charging_station",
    "bicycle_rental",
    "car_rental",
    "taxi",
  ])
);

const GROCERY_ICON: IconNode = [
  ["path", { d: "m2.05 2.05 1.099-.028a1 1 0 0 1 1.008.815l2.69 14.347A1 1 0 0 0 7.83 18H18" }],
  ["path", { d: "M4.563 5h16.435a1 1 0 0 1 .981 1.204l-1.026 6.226A2 2 0 0 1 18.962 14H6.25" }],
  ["circle", { cx: "18", cy: "20", r: "2" }],
  ["circle", { cx: "8", cy: "20", r: "2" }],
];

const FASTFOOD_ICON: IconNode = [
  ["path", { d: "m2.37 11.223 8.372-6.777a2 2 0 0 1 2.516 0l8.371 6.777" }],
  ["path", { d: "M21 15a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-5.25" }],
  ["path", { d: "M3 15a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h9" }],
  ["path", { d: "m6.67 15 6.13 4.6a2 2 0 0 0 2.8-.4l3.15-4.2" }],
  ["rect", { width: "20", height: "4", x: "2", y: "11", rx: "1" }],
];

const FOOD_ICON: IconNode = [
  ["path", { d: "m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8" }],
  ["path", { d: "M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7" }],
  ["path", { d: "m2.1 21.8 6.4-6.3" }],
  ["path", { d: "m19 5-7 7" }],
];

const HEALTH_ICON: IconNode = [
  ["path", { d: "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" }],
  ["path", { d: "M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" }],
];


const TRANSPORT_ICON: IconNode = [
  ["path", { d: "M8 6v6" }],
  ["path", { d: "M15 6v6" }],
  ["path", { d: "M2 12h19.6" }],
  ["path", { d: "M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3" }],
  ["circle", { cx: "7", cy: "18", r: "2" }],
  ["path", { d: "M9 18h5" }],
  ["circle", { cx: "16", cy: "18", r: "2" }],
];

const CROISSANT_ICON: IconNode = [
  ["path", { d: "M10.2 18H4.774a1.5 1.5 0 0 1-1.352-.97 11 11 0 0 1 .132-6.487" }],
  ["path", { d: "M18 10.2V4.774a1.5 1.5 0 0 0-.97-1.352 11 11 0 0 0-6.486.132" }],
  ["path", { d: "M18 5a4 3 0 0 1 4 3 2 2 0 0 1-2 2 10 10 0 0 0-5.139 1.42" }],
  ["path", { d: "M5 18a3 4 0 0 0 3 4 2 2 0 0 0 2-2 10 10 0 0 1 1.42-5.14" }],
  ["path", { d: "M8.709 2.554a10 10 0 0 0-6.155 6.155 1.5 1.5 0 0 0 .676 1.626l9.807 5.42a2 2 0 0 0 2.718-2.718l-5.42-9.807a1.5 1.5 0 0 0-1.626-.676" }],
];

const MARTINI_ICON: IconNode = [
  ["path", { d: "M12 12 4.207 4.207A.707.707 0 0 1 4.707 3h14.586a.707.707 0 0 1 .5 1.207z" }],
  ["path", { d: "M12 12v10" }],
  ["path", { d: "M7 22h10" }],
];

const SHIRT_ICON: IconNode = [
  ["path", { d: "M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" }],
];

const SPARKLES_ICON: IconNode = [
  ["path", { d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" }],
  ["path", { d: "M20 2v4" }],
  ["path", { d: "M22 4h-4" }],
  ["circle", { cx: "4", cy: "20", r: "2" }],
];

const HAMMER_ICON: IconNode = [
  ["path", { d: "m15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9" }],
  ["path", { d: "m18 15 4-4" }],
  ["path", { d: "m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5" }],
];

const LANDMARK_ICON: IconNode = [
  ["path", { d: "M10 18v-7" }],
  ["path", { d: "M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z" }],
  ["path", { d: "M14 18v-7" }],
  ["path", { d: "M18 18v-7" }],
  ["path", { d: "M3 22h18" }],
  ["path", { d: "M6 18v-7" }],
];

const TREES_ICON: IconNode = [
  ["path", { d: "M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z" }],
  ["path", { d: "M7 16v6" }],
  ["path", { d: "M13 19v3" }],
  ["path", { d: "M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5" }],
];

const DUMBBELL_ICON: IconNode = [
  ["path", { d: "M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z" }],
  ["path", { d: "m2.5 21.5 1.4-1.4" }],
  ["path", { d: "m20.1 3.9 1.4-1.4" }],
  ["path", { d: "M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z" }],
  ["path", { d: "m9.6 14.4 4.8-4.8" }],
];

const BED_ICON: IconNode = [
  ["path", { d: "M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8" }],
  ["path", { d: "M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4" }],
  ["path", { d: "M12 4v6" }],
  ["path", { d: "M2 18h20" }],
];

const PARKING_ICON: IconNode = [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
  ["path", { d: "M9 17V7h4a3 3 0 0 1 0 6H9" }],
];

const SHOP_ICON: IconNode = [
  ["path", { d: "M16 10a4 4 0 0 1-8 0" }],
  ["path", { d: "M3.103 6.034h17.794" }],
  ["path", { d: "M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z" }],
];

export const FILTER_GROUPS: FilterGroup[] = [
  {
    id: "grocery",
    label: "filters.grocery",
    color: "#34C759",
    icon: GROCERY_ICON,
    tileClasses: ["grocery", "butcher", "alcohol_shop", "beer"],
    ...GROCERY,
  },
  {
    id: "bakery",
    label: "filters.bakery",
    color: "#E0A32E",
    icon: CROISSANT_ICON,
    tileClasses: ["bakery", "confectionery"],
    ...BAKERY,
  },
  { id: "fastfood", label: "filters.fastfood", color: "#A2845E", icon: FASTFOOD_ICON, tileClasses: ["fast_food"], ...FASTFOOD },
  {
    id: "food",
    label: "filters.food",
    color: "#FF9500",
    icon: FOOD_ICON,
    tileClasses: ["restaurant", "cafe", "ice_cream"],
    ...FOOD,
  },
  {
    id: "nightlife",
    label: "filters.nightlife",
    color: "#FF2D55",
    icon: MARTINI_ICON,
    tileClasses: ["bar", "beer", "nightclub"],
    ...NIGHTLIFE,
  },
  {
    id: "health",
    label: "filters.health",
    color: "#FF3B30",
    icon: HEALTH_ICON,
    tileClasses: ["pharmacy", "doctors", "dentist", "hospital", "veterinary"],
    ...HEALTH,
  },
  {
    id: "beauty",
    label: "filters.beauty",
    color: "#F062C0",
    icon: SPARKLES_ICON,
    tileClasses: ["hairdresser", "beauty"],
    ...BEAUTY,
  },
  {
    id: "fashion",
    label: "filters.fashion",
    color: "#AF52DE",
    icon: SHIRT_ICON,
    tileClasses: ["clothing_store", "jewelry_store", "shoe", "bag"],
    ...FASHION,
  },
  {
    id: "home",
    label: "filters.home",
    color: "#30B0C7",
    icon: HAMMER_ICON,
    tileClasses: ["furniture", "hardware", "doityourself", "florist"],
    ...HOME,
  },
  {
    id: "culture",
    label: "filters.culture",
    color: "#32ADE6",
    icon: LANDMARK_ICON,
    tileClasses: ["museum", "art_gallery", "cinema", "theatre", "attraction", "castle", "monument"],
    ...CULTURE,
  },
  {
    id: "outdoors",
    label: "filters.outdoors",
    color: "#2E8B57",
    icon: TREES_ICON,
    tileClasses: ["park", "garden", "playground", "dog_park", "picnic_site"],
    ...OUTDOORS,
  },
  {
    id: "sport",
    label: "filters.sport",
    color: "#00C7BE",
    icon: DUMBBELL_ICON,
    // Un terrain de sport prend dans les tuiles la classe du sport pratiqué :
    // `leisure=pitch` + `sport=tennis` ressort en classe « tennis ».
    tileClasses: [
      "sports_centre",
      "stadium",
      "pitch",
      "swimming",
      "golf",
      "fitness",
      "athletics",
      "boxing",
      "yoga",
      "climbing",
      "tennis",
      "basketball",
      "soccer",
      "cycling",
      "table_tennis",
      "curling",
      "water_park",
      "multi",
    ],
    ...SPORT,
  },
  {
    id: "lodging",
    label: "filters.lodging",
    color: "#4A6FA5",
    icon: BED_ICON,
    tileClasses: ["lodging", "camp_site"],
    ...LODGING,
  },
  {
    id: "transport",
    label: "filters.transport",
    color: "#5856D6",
    icon: TRANSPORT_ICON,
    // Uniquement les classes qui désignent un point de montée. `entrance` en
    // est volontairement absent : une bouche de métro n'a pas d'horaire propre.
    tileClasses: ["bus", "railway", "ferry_terminal"],
    ...TRANSPORT,
  },
  {
    id: "parking",
    label: "filters.parking",
    color: "#2E77C9",
    icon: PARKING_ICON,
    tileClasses: ["parking"],
    ...PARKING,
  },
  {
    id: "shop",
    label: "filters.shop",
    // Gris : ce groupe ne décrit plus un type de commerce mais tout ce que les
    // précédents n'ont pas réclamé.
    color: "#8A8A9E",
    icon: SHOP_ICON,
    // Le fourre-tout des `shop=*` : c'est ici que les classes comptent le plus,
    // puisque le groupe accepte n'importe quelle valeur de `shop` et que la
    // tuile, elle, ne dit pas de quelle clé vient la sous-classe.
    tileClasses: [
      "shop",
      "gift",
      "music",
      "car",
      "bicycle",
      "laundry",
      "library",
      "video",
      "stationery",
      "toy",
      "pet",
      "photo",
      "travel_agent",
      "copyshop",
      "bank",
      "fuel",
      "car_rental",
      "bicycle_rental",
      "taxi",
    ],
    ...rules(tagRule("shop"), SHOP),
  },
];

export const ALL_GROUP_IDS: FilterGroupId[] = FILTER_GROUPS.map((g) => g.id);

const BY_ID = new Map(FILTER_GROUPS.map((g) => [g.id, g]));

export function getFilterGroup(id: FilterGroupId | null | undefined): FilterGroup | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** Classe un POI d'après ses tags OSM ; `null` si aucun groupe ne correspond. */
export function groupFromTags(tags: Record<string, string>): FilterGroupId | null {
  for (const group of FILTER_GROUPS) {
    if (group.match(tags)) return group.id;
  }
  return null;
}

export const GROUP_COLOR_FALLBACK = "#8E8E93";
