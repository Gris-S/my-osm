import { CONFIG } from "../config";
import type { LonLat } from "../types";
import type { TranslationKey } from "../i18n";

// ---------------------------------------------------------------------------
// Météo, qualité de l'air, pollens et vigilance.
//
// Trois sources, toutes appelées depuis le navigateur :
//
//  - **Open-Meteo** pour le relevé du moment (température, code temps) et pour
//    la qualité de l'air (indice européen, polluants) et les pollens, issus du
//    service européen CAMS. Gratuit, sans clé, origine croisée autorisée.
//  - **la Base Adresse Nationale** pour nommer l'endroit et en tirer le
//    département — c'est la maille de la vigilance française.
//  - **Météo-France** pour la vigilance en cours. C'est la seule source
//    officielle joignable depuis un navigateur : les flux européens
//    MeteoAlarm n'autorisent pas l'origine croisée. Elle demande une clé
//    gratuite, et son absence n'empêche que les alertes. Sa description
//    OpenAPI est à la racine du dépôt (`Vigilance_Bulletin_swagger.json`) :
//    elle donne l'adresse et l'authentification, mais laisse la forme des
//    réponses sans description — d'où la lecture prudente plus bas.
//
// Tout est mis en cache par lieu arrondi et par tranche de dix minutes : on
// rouvre l'encart bien plus souvent que le temps ne change.
// ---------------------------------------------------------------------------

export interface WeatherNow {
  /** Température de l'air, en degrés Celsius. */
  temperature: number;
  /** Température ressentie, quand le vent ou l'humidité la décalent. */
  apparent: number;
  /** Code temps de l'OMM (0 = ciel dégagé, 95 = orage…). */
  code: number;
  isDay: boolean;
  /** Vent moyen, en km/h. */
  wind: number;
  humidity: number;
}

// Les libellés de ce service sont des **clés** de traduction, pas des phrases :
// les relevés sont mis en cache dix minutes, et un changement de langue ne doit
// pas laisser un indice ou une vigilance dans l'ancienne. Ils sont traduits au
// rendu, par `WeatherCard`.

export interface AirQuality {
  /** Indice européen (EAQI) : 0 à 100 et au-delà, le plus bas étant le meilleur. */
  index: number;
  label: TranslationKey;
  color: string;
}

export interface PollenReading {
  label: TranslationKey;
  /** Grains par mètre cube. */
  value: number;
  level: TranslationKey;
  color: string;
}

export interface VigilanceAlert {
  phenomenon: TranslationKey;
  level: TranslationKey;
  /** Le même niveau tel qu'il se dit dans une phrase (« vigilance jaune »). */
  levelInline: TranslationKey;
  color: string;
}

/** L'endroit dont on parle : son nom, et le département pour la vigilance. */
export interface Area {
  city?: string;
  department?: string;
}

function hasVigilanceKey(): boolean {
  return CONFIG.METEOFRANCE_API_KEY.trim().length > 0;
}

// --- Cache -----------------------------------------------------------------

interface CacheEntry<T> {
  at: number;
  value: T;
}

function cached<T>(store: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = store.get(key);
  return entry && Date.now() - entry.at < CONFIG.WEATHER_TTL_MS ? entry.value : undefined;
}

/** Deux décimales suffisent : la météo ne change pas d'un pâté de maisons. */
function coordKey({ lon, lat }: LonLat): string {
  return `${lon.toFixed(2)},${lat.toFixed(2)}`;
}

// --- Relevé du moment ------------------------------------------------------

const weatherCache = new Map<string, CacheEntry<WeatherNow>>();

export async function getWeather(coords: LonLat, signal?: AbortSignal): Promise<WeatherNow> {
  const key = coordKey(coords);
  const known = cached(weatherCache, key);
  if (known) return known;

  const url = new URL(CONFIG.OPEN_METEO_URL);
  url.searchParams.set("latitude", coords.lat.toFixed(4));
  url.searchParams.set("longitude", coords.lon.toFixed(4));
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m"
  );
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Météo indisponible (${res.status})`);
  const data = (await res.json()) as {
    current?: {
      temperature_2m?: number;
      apparent_temperature?: number;
      relative_humidity_2m?: number;
      is_day?: number;
      weather_code?: number;
      wind_speed_10m?: number;
    };
  };
  const current = data.current;
  if (!current || current.temperature_2m === undefined) throw new Error("Météo indisponible");

  const weather: WeatherNow = {
    temperature: current.temperature_2m,
    apparent: current.apparent_temperature ?? current.temperature_2m,
    code: current.weather_code ?? 0,
    isDay: current.is_day !== 0,
    wind: current.wind_speed_10m ?? 0,
    humidity: current.relative_humidity_2m ?? 0,
  };
  weatherCache.set(key, { at: Date.now(), value: weather });
  return weather;
}

// --- Qualité de l'air et pollens -------------------------------------------

/**
 * Barème de l'indice européen de la qualité de l'air (EAQI), avec ses couleurs
 * officielles : c'est le même partout en Europe, ce qui permet de comparer
 * deux villes sans convertir.
 */
const AQI_BANDS: { max: number; label: TranslationKey; color: string }[] = [
  { max: 20, label: "aqi.good", color: "#50f0e6" },
  { max: 40, label: "aqi.fair", color: "#50ccaa" },
  { max: 60, label: "aqi.moderate", color: "#f0e641" },
  { max: 80, label: "aqi.poor", color: "#ff5050" },
  { max: 100, label: "aqi.veryPoor", color: "#960032" },
  { max: Infinity, label: "aqi.extreme", color: "#7d2181" },
];

function aqiBand(index: number) {
  return AQI_BANDS.find((band) => index <= band.max) ?? AQI_BANDS[AQI_BANDS.length - 1];
}

/**
 * Espèces suivies par CAMS, avec leur seuil de gêne.
 *
 * Les seuils sont **indicatifs** et propres à chaque espèce : quelques grains
 * de bouleau se remarquent moins que la même quantité d'ambroisie. Ils suivent
 * l'échelle courante des réseaux de surveillance (grains par mètre cube), et
 * servent à qualifier, pas à diagnostiquer.
 */
const POLLENS: { field: string; label: TranslationKey; moderate: number; high: number }[] = [
  { field: "alder_pollen", label: "pollen.alder", moderate: 11, high: 51 },
  { field: "birch_pollen", label: "pollen.birch", moderate: 11, high: 51 },
  { field: "grass_pollen", label: "pollen.grass", moderate: 6, high: 21 },
  { field: "mugwort_pollen", label: "pollen.mugwort", moderate: 6, high: 21 },
  { field: "olive_pollen", label: "pollen.olive", moderate: 11, high: 51 },
  { field: "ragweed_pollen", label: "pollen.ragweed", moderate: 6, high: 21 },
];

export interface AirReport {
  air: AirQuality | null;
  pollens: PollenReading[];
}

const airCache = new Map<string, CacheEntry<AirReport>>();

export async function getAirQuality(coords: LonLat, signal?: AbortSignal): Promise<AirReport> {
  const key = coordKey(coords);
  const known = cached(airCache, key);
  if (known) return known;

  // L'indice résume déjà les polluants qui le composent : le détail par gaz
  // n'est pas demandé, il n'est plus affiché.
  const fields = ["european_aqi", ...POLLENS.map((p) => p.field)];
  const url = new URL(CONFIG.OPEN_METEO_AIR_QUALITY_URL);
  url.searchParams.set("latitude", coords.lat.toFixed(4));
  url.searchParams.set("longitude", coords.lon.toFixed(4));
  url.searchParams.set("current", fields.join(","));
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Qualité de l'air indisponible (${res.status})`);
  const data = (await res.json()) as { current?: Record<string, number | string | null> };
  const current = data.current ?? {};

  const index = typeof current.european_aqi === "number" ? current.european_aqi : null;
  const band = index === null ? null : aqiBand(index);
  const report: AirReport = {
    air:
      index === null || !band
        ? null
        : { index: Math.round(index), label: band.label, color: band.color },
    // Les espèces absentes de la saison sont à zéro : les taire évite une
    // liste de six lignes vides en plein hiver.
    pollens: POLLENS.flatMap(({ field, label, moderate, high }) => {
      const value = current[field];
      if (typeof value !== "number" || value < 1) return [];
      const level =
        value >= high
          ? { level: "pollen.high" as TranslationKey, color: "#ff453a" }
          : value >= moderate
            ? { level: "pollen.moderate" as TranslationKey, color: "#ff9f0a" }
            : { level: "pollen.low" as TranslationKey, color: "#34c759" };
      return [{ label, value: Math.round(value), ...level }];
    }).sort((a, b) => b.value - a.value),
  };

  airCache.set(key, { at: Date.now(), value: report });
  return report;
}

// --- Nom du lieu et département --------------------------------------------

const areaCache = new Map<string, CacheEntry<Area>>();

/**
 * Nomme l'endroit et en tire le département, à partir de la Base Adresse
 * Nationale. Le code INSEE de la commune commence par le numéro du
 * département (`75104` → `75`, `97411` → `974` outre-mer), qui est la maille
 * de la vigilance météorologique.
 */
export async function getArea(coords: LonLat, signal?: AbortSignal): Promise<Area> {
  const key = coordKey(coords);
  const known = cached(areaCache, key);
  if (known) return known;

  const url = new URL(CONFIG.BAN_REVERSE_URL);
  url.searchParams.set("lon", String(coords.lon));
  url.searchParams.set("lat", String(coords.lat));
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return {};
    const data = (await res.json()) as {
      features?: { properties?: { city?: string; citycode?: string } }[];
    };
    const properties = data.features?.[0]?.properties;
    const citycode = properties?.citycode ?? "";
    const area: Area = {
      city: properties?.city,
      department: citycode.startsWith("97") ? citycode.slice(0, 3) : citycode.slice(0, 2) || undefined,
    };
    areaCache.set(key, { at: Date.now(), value: area });
    return area;
  } catch {
    // Hors de France, ou service muet : on se passe du nom et des alertes.
    return {};
  }
}

// --- Vigilance Météo-France ------------------------------------------------

/** Phénomènes de la vigilance, dans l'ordre des identifiants de Météo-France. */
const PHENOMENA: Record<string, TranslationKey> = {
  "1": "vigilance.wind",
  "2": "vigilance.rain",
  "3": "vigilance.storm",
  "4": "vigilance.flood",
  "5": "vigilance.snow",
  "6": "vigilance.heat",
  "7": "vigilance.cold",
  "8": "vigilance.avalanche",
  "9": "vigilance.waves",
};

/** Couleurs de vigilance : le vert (1) n'est pas une alerte, il est écarté. */
const VIGILANCE_COLORS: Record<number, { level: TranslationKey; levelInline: TranslationKey; color: string }> = {
  2: { level: "vigilance.yellow", levelInline: "vigilanceIn.yellow", color: "#ffcc00" },
  3: { level: "vigilance.orange", levelInline: "vigilanceIn.orange", color: "#ff9500" },
  4: { level: "vigilance.red", levelInline: "vigilanceIn.red", color: "#ff3b30" },
};

/** Ce qu'on cherche dans la réponse : un département et ses phénomènes. */
interface VigilanceDomain {
  domain_id?: string;
  phenomenon_items?: { phenomenon_id?: string; phenomenon_max_color_id?: number }[];
}

interface VigilanceResponse {
  product?: {
    periods?: { echeance?: string; timelaps?: { domain_ids?: VigilanceDomain[] } }[];
  };
}

/**
 * Repêchage : le premier objet portant le domaine cherché, à quelque
 * profondeur qu'il soit.
 *
 * Le chemin normal (`product.periods[].timelaps.domain_ids[]`) est vérifié
 * sur une réponse réelle, mais la description OpenAPI de Météo-France
 * (`Vigilance_Bulletin_swagger.json`, à la racine du dépôt) ne décrit pas le
 * corps des réponses : rien ne garantit qu'il ne bougera pas. Ce parcours
 * d'arbre évite qu'un changement de forme ne se lise comme « aucune
 * vigilance », ce qui serait le pire des silences.
 */
function findDomain(node: unknown, department: string): VigilanceDomain | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findDomain(item, department);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== "object") return undefined;
  const candidate = node as VigilanceDomain & Record<string, unknown>;
  if (candidate.domain_id === department && Array.isArray(candidate.phenomenon_items)) return candidate;
  for (const value of Object.values(candidate)) {
    const found = findDomain(value, department);
    if (found) return found;
  }
  return undefined;
}

const vigilanceCache = new Map<string, CacheEntry<VigilanceAlert[]>>();

/**
 * Vigilances en cours pour un département, aujourd'hui (échéance « J »).
 *
 * Lève si la clé manque, comme pour toute autre panne : l'encart n'affiche la
 * section que lorsqu'il a quelque chose à signaler, et n'a donc pas à
 * distinguer les causes d'un silence.
 */
export async function getVigilance(department: string, signal?: AbortSignal): Promise<VigilanceAlert[]> {
  if (!hasVigilanceKey()) throw new Error("no-key");
  const known = cached(vigilanceCache, department);
  if (known) return known;

  const res = await fetch(CONFIG.METEOFRANCE_VIGILANCE_URL, {
    headers: { apikey: CONFIG.METEOFRANCE_API_KEY },
    signal,
  });
  if (res.status === 401 || res.status === 403) throw new Error("Clé Météo-France refusée.");
  if (!res.ok) throw new Error(`Vigilance indisponible (${res.status})`);

  const data: VigilanceResponse = await res.json();
  // La carte porte aujourd'hui (« J ») et demain (« J1 ») ; l'encart parle du
  // temps qu'il fait, donc d'aujourd'hui.
  const today = data.product?.periods?.find((period) => period.echeance === "J") ?? data.product?.periods?.[0];

  // Un département côtier est décrit par **deux** domaines : le sien, et une
  // bande littorale numérotée `<département>10` (`3410` pour l'Hérault), qui
  // porte seule les vagues-submersion. Les deux sont lus, et c'est la couleur
  // la plus forte qui l'emporte pour un phénomène donné.
  const items = [department, `${department}10`].flatMap((id) => {
    const domain = today?.timelaps?.domain_ids?.find((item) => item.domain_id === id) ?? findDomain(data, id);
    return domain?.phenomenon_items ?? [];
  });

  const worst = new Map<string, number>();
  for (const item of items) {
    const id = item.phenomenon_id ?? "";
    const color = item.phenomenon_max_color_id ?? 0;
    if (color > (worst.get(id) ?? 0)) worst.set(id, color);
  }

  const alerts = [...worst]
    // Le plus grave en tête : c'est ce qu'on lit en premier.
    .sort(([, a], [, b]) => b - a)
    .flatMap(([id, colorId]) => {
      // Le vert (1) n'est pas une vigilance : il dit qu'il n'y a rien à dire.
      const color = VIGILANCE_COLORS[colorId];
      if (!color) return [];
      return [{ phenomenon: PHENOMENA[id] ?? "vigilance.other", ...color }];
    });

  vigilanceCache.set(department, { at: Date.now(), value: alerts });
  return alerts;
}
