import { CONFIG } from "../config";
import { relayedFetch } from "../services/native";
import type { FuelType } from "./settings";

// ---------------------------------------------------------------------------
// Prix des carburants et bornes de recharge, autour de la carte.
//
// Deux sources, et **pour chaque prix la plus récente l'emporte** (demande
// explicite du 22 octobre 2026) :
//
// - le **flux officiel** français (prix-carburants.gouv.fr, servi par
//   data.economie.gouv.fr) : la vraie date de chaque prix, les ruptures, les
//   carburants non vendus, l'automate 24/24. France seulement ;
// - **Pumperly** : 39 pays, et les bornes (Open Charge Map). Sans origine
//   croisée, il passe par le relais (`/api/pumperly/stations`).
//
// Piège mesuré : Pumperly date un prix **du jour où il l'a collecté**
// (`reportedAt`), pas du jour où la station l'a publié — un prix vieux d'un
// mois y paraît d'aujourd'hui. Ses prix français sont ceux du flux officiel
// (même identifiant de station, `externalId`). À prix égal on garde donc la
// date officielle ; c'est quand ils diffèrent que la date décide.
// ---------------------------------------------------------------------------

/** Les carburants vendus au litre : tout sauf l'électrique. */
export type LiquidFuel = Exclude<FuelType, "ev">;

export const LIQUID_FUELS: readonly LiquidFuel[] = ["gazole", "e10", "sp95", "sp98", "e85", "gplc"];

/** Les codes de Pumperly (norme EN 16942), relevés dans sa documentation. Pas d'E85 chez lui. */
const PUMPERLY_CODES: Partial<Record<FuelType, string>> = {
  gazole: "B7",
  e10: "E10",
  sp95: "E5",
  sp98: "E5_98",
  gplc: "LPG",
  ev: "EV",
};

export interface FuelPrice {
  price: number;
  /** Code ISO 4217 : la station affiche dans sa monnaie. */
  currency: string;
  /** Date du prix, en millisecondes. */
  at: number;
}

export interface FuelStation {
  id: string;
  lon: number;
  lat: number;
  address: string;
  city: string;
  /** Enseigne, quand une source la donne (le flux officiel ne la donne pas). */
  brand: string | null;
  prices: Partial<Record<LiquidFuel, FuelPrice>>;
  /** Vendus ici d'habitude, manquants aujourd'hui. */
  shortage: LiquidFuel[];
  /** Jamais vendus à cette station. */
  notSold: LiquidFuel[];
  open24h: boolean;
  services: string[];
}

export interface Charger {
  id: string;
  lon: number;
  lat: number;
  name: string;
  address: string;
  /** Puissance du connecteur le plus puissant, quand la source la donne. */
  powerKw: number | null;
}

type Bbox = [number, number, number, number];

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

const SMALL_WORDS = new Set(["de", "du", "des", "la", "le", "les", "et", "d", "l", "a", "à", "au", "aux", "sur", "en"]);

/**
 * Les adresses du flux officiel arrivent souvent en capitales (« 238 RUE DE
 * CHARENTON ») : on les écrit comme une adresse, les petits mots en minuscules.
 * Une adresse déjà en casse mixte est laissée telle quelle.
 */
export function readableAddress(text: string): string {
  if (text !== text.toUpperCase()) return text;
  return text
    .toLowerCase()
    .replace(/(^|[\s'’-])(\p{L}+)/gu, (_, sep: string, word: string) =>
      sep + (sep !== "" && SMALL_WORDS.has(word) ? word : word[0].toUpperCase() + word.slice(1)),
    );
}

/** « SP95;E85;GPLc » → les carburants qu'on sait nommer. */
function fuelList(value: unknown): LiquidFuel[] {
  return str(value)
    .split(";")
    .map((part) => part.trim().toLowerCase())
    .filter((part): part is LiquidFuel => (LIQUID_FUELS as readonly string[]).includes(part));
}

/** Lit une page de la réponse officielle (API Opendatasoft, `records`). */
export function parseOfficial(json: unknown): FuelStation[] {
  const results = (json as { results?: Record<string, unknown>[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((r) => {
    const geom = r.geom as { lat?: unknown; lon?: unknown } | undefined;
    const lat = num(geom?.lat);
    const lon = num(geom?.lon);
    if (lat === null || lon === null || r.id === undefined) return [];
    const prices: FuelStation["prices"] = {};
    for (const fuel of LIQUID_FUELS) {
      const price = num(r[`${fuel}_prix`]);
      const at = Date.parse(str(r[`${fuel}_maj`]));
      if (price !== null && Number.isFinite(at)) prices[fuel] = { price, currency: "EUR", at };
    }
    const services = r.services_service;
    return [{
      id: `fr/${String(r.id)}`,
      lon,
      lat,
      address: readableAddress(str(r.adresse)),
      city: readableAddress(str(r.ville)),
      brand: null,
      prices,
      shortage: fuelList(r.carburants_rupture_temporaire),
      notSold: fuelList(r.carburants_rupture_definitive),
      open24h: r.horaires_automate_24_24 === "Oui",
      services: Array.isArray(services) ? services.filter((s): s is string => typeof s === "string") : [],
    }];
  });
}

interface PumperlyFeature {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
}

function pumperlyFeatures(json: unknown): { lon: number; lat: number; p: Record<string, unknown> }[] {
  const features = (json as { features?: PumperlyFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((f) => {
    const coords = f.geometry?.coordinates;
    const lon = Array.isArray(coords) ? num(coords[0]) : null;
    const lat = Array.isArray(coords) ? num(coords[1]) : null;
    return lon === null || lat === null || !f.properties ? [] : [{ lon, lat, p: f.properties }];
  });
}

/** Lit une réponse de Pumperly pour un carburant au litre. */
export function parsePumperly(json: unknown, fuel: LiquidFuel): FuelStation[] {
  return pumperlyFeatures(json).flatMap(({ lon, lat, p }) => {
    const price = num(p.price);
    const at = Date.parse(str(p.reportedAt));
    if (price === null) return [];
    const country = str(p.country).toLowerCase();
    return [{
      id: `${country}/${str(p.externalId)}`,
      lon,
      lat,
      address: str(p.address),
      city: str(p.city),
      brand: str(p.brand) || null,
      prices: { [fuel]: { price, currency: str(p.currency) || "EUR", at: Number.isFinite(at) ? at : Date.now() } },
      shortage: [],
      notSold: [],
      open24h: false,
      services: [],
    }];
  });
}

/** Lit une réponse de Pumperly pour les bornes (`fuel=EV`). */
export function parseChargers(json: unknown): Charger[] {
  return pumperlyFeatures(json).map(({ lon, lat, p }) => ({
    id: str(p.externalId) || `${lon},${lat}`,
    lon,
    lat,
    name: str(p.name),
    address: str(p.address),
    powerKw: num(p.powerKw),
  }));
}

/**
 * Réunit les deux sources pour un carburant. Une station connue des deux garde
 * le détail officiel ; son prix est celui de la source la plus récente, et à
 * prix égal le prix officiel, dont la date est la vraie (voir plus haut).
 */
export function mergeStations(official: FuelStation[], pumperly: FuelStation[], fuel: LiquidFuel): FuelStation[] {
  const byId = new Map(official.map((s) => [s.id, s]));
  const extra: FuelStation[] = [];
  for (const other of pumperly) {
    const mine = byId.get(other.id);
    if (!mine) {
      extra.push(other);
      continue;
    }
    mine.brand ??= other.brand;
    const ours = mine.prices[fuel];
    const theirs = other.prices[fuel];
    if (theirs && (!ours || (theirs.price !== ours.price && theirs.at > ours.at))) {
      mine.prices = { ...mine.prices, [fuel]: theirs };
    }
  }
  return [...official, ...extra];
}

// --- Réseau ---------------------------------------------------------------

/** Plafond du flux officiel : 100 par page. Trois pages couvrent une grande ville. */
const OFFICIAL_PAGE = 100;
const OFFICIAL_PAGES = 3;

async function fetchOfficial(bbox: Bbox, signal?: AbortSignal): Promise<FuelStation[]> {
  const [west, south, east, north] = bbox;
  const stations: FuelStation[] = [];
  for (let page = 0; page < OFFICIAL_PAGES; page++) {
    const url = new URL(CONFIG.FUEL_OFFICIAL_URL);
    // Ordre de l'API : latitude puis longitude, pour chaque coin.
    url.searchParams.set("where", `in_bbox(geom, ${south}, ${west}, ${north}, ${east})`);
    url.searchParams.set("limit", String(OFFICIAL_PAGE));
    url.searchParams.set("offset", String(page * OFFICIAL_PAGE));
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`prix-carburants ${res.status}`);
    const json: unknown = await res.json();
    stations.push(...parseOfficial(json));
    const total = num((json as { total_count?: unknown }).total_count) ?? 0;
    if ((page + 1) * OFFICIAL_PAGE >= total) break;
  }
  return stations;
}

async function fetchPumperly(bbox: Bbox, fuel: FuelType, signal?: AbortSignal): Promise<unknown> {
  const code = PUMPERLY_CODES[fuel];
  if (!code) return null;
  const query = new URLSearchParams({ bbox: bbox.map((v) => v.toFixed(5)).join(","), fuel: code });
  const res = await relayedFetch(`${CONFIG.PUMPERLY_STATIONS_URL}?${query}`, { signal });
  if (!res.ok) throw new Error(`Pumperly ${res.status}`);
  return res.json<unknown>();
}

// Un cache par emprise arrondie : revenir sur ses pas ne redemande rien.
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CONFIG.FUEL_TTL_MS) return hit.value as Promise<T>;
  const value = load().catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** L'emprise élargie et arrondie : de petits déplacements retombent sur la même clé. */
function roundedBbox([west, south, east, north]: Bbox): Bbox {
  const step = 0.02;
  return [
    Math.floor(west / step) * step,
    Math.floor(south / step) * step,
    Math.ceil(east / step) * step,
    Math.ceil(north / step) * step,
  ];
}

/**
 * Les stations-service de la zone, avec le prix du carburant demandé. Une
 * source muette n'empêche pas l'autre de répondre.
 */
export async function loadFuelStations(bbox: Bbox, fuel: LiquidFuel, signal?: AbortSignal): Promise<FuelStation[]> {
  const box = roundedBbox(bbox);
  const key = box.join(",");
  const [official, pumperly] = await Promise.all([
    cached(`official:${key}`, () => fetchOfficial(box, signal)).catch((): FuelStation[] => []),
    cached(`pumperly:${fuel}:${key}`, () => fetchPumperly(box, fuel, signal)).catch(() => null),
  ]);
  // Des copies : la fusion complète les stations, et le cache doit rester tel quel.
  const fresh = official.map((s) => ({ ...s, prices: { ...s.prices } }));
  return mergeStations(fresh, parsePumperly(pumperly, fuel), fuel);
}

/** Les bornes de recharge de la zone. */
export async function loadChargers(bbox: Bbox, signal?: AbortSignal): Promise<Charger[]> {
  const box = roundedBbox(bbox);
  const json = await cached(`pumperly:ev:${box.join(",")}`, () => fetchPumperly(box, "ev", signal));
  return parseChargers(json);
}
