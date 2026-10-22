import { useEffect, useState } from "react";
import { CONFIG } from "../config";
import { distance } from "../navigation/geo";
import type { LonLat } from "../types";

// ---------------------------------------------------------------------------
// Vélos en libre-service, en direct, par CityBikes (environ 800 réseaux).
//
// Deux temps : la liste des réseaux (un point par réseau, gardée pour la
// session), puis les stations des réseaux proches de la carte. CityBikes ne
// sert un réseau que d'un bloc — Vélib' entier, 1 516 stations — d'où un cache
// par réseau (`BIKES_TTL_MS`) : se déplacer dans Paris ne redemande rien.
//
// Vérifié le 22 octobre 2026 sur Vélib' : `free_bikes`, `empty_slots`, et dans
// `extra` `normal_bikes`, `ebikes`, `slots`, `renting`. Les autres réseaux ne
// portent pas tous ce détail : sans lui, tout vélo compte comme mécanique.
// ---------------------------------------------------------------------------

export interface BikeNetwork {
  id: string;
  name: string;
  city: string;
  country: string;
  lon: number;
  lat: number;
}

export interface BikeStation {
  /** Identifiant unique sur toute la carte : réseau et station. */
  id: string;
  name: string;
  network: string;
  lon: number;
  lat: number;
  mechanical: number;
  electric: number;
  /** Places libres pour rendre un vélo. */
  free: number;
  /** Nombre de bornes, quand le réseau le publie. */
  slots: number | null;
  /** Faux : station fermée (ni prise ni dépose). */
  open: boolean;
  /** Relevé de la station par CityBikes, en millisecondes. */
  at: number;
}

interface RawNetwork {
  id?: unknown;
  name?: unknown;
  location?: { city?: unknown; country?: unknown; latitude?: unknown; longitude?: unknown };
}

interface RawStation {
  id?: unknown;
  name?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  timestamp?: unknown;
  free_bikes?: unknown;
  empty_slots?: unknown;
  extra?: { normal_bikes?: unknown; ebikes?: unknown; slots?: unknown; renting?: unknown };
}

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** Lit la liste des réseaux ; un réseau sans position est écarté. */
export function parseNetworks(json: unknown): BikeNetwork[] {
  const list = (json as { networks?: RawNetwork[] } | null)?.networks;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw) => {
    const lat = num(raw.location?.latitude);
    const lon = num(raw.location?.longitude);
    const id = str(raw.id);
    if (lat === null || lon === null || !id) return [];
    return [{ id, name: str(raw.name), city: str(raw.location?.city), country: str(raw.location?.country), lon, lat }];
  });
}

/** Lit les stations d'un réseau. */
export function parseStations(json: unknown, network: string): BikeStation[] {
  const list = (json as { network?: { stations?: RawStation[] } } | null)?.network?.stations;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw) => {
    const lat = num(raw.latitude);
    const lon = num(raw.longitude);
    if (lat === null || lon === null) return [];
    const total = Math.max(0, num(raw.free_bikes) ?? 0);
    const electric = Math.min(total, Math.max(0, num(raw.extra?.ebikes) ?? 0));
    const at = Date.parse(str(raw.timestamp).replace(/Z+$/, "Z"));
    return [{
      id: `${network}/${str(raw.id)}`,
      name: str(raw.name),
      network,
      lon,
      lat,
      mechanical: total - electric,
      electric,
      free: Math.max(0, num(raw.empty_slots) ?? 0),
      slots: num(raw.extra?.slots),
      // `renting` vaut 0 quand on ne peut plus y prendre de vélo.
      open: raw.extra?.renting !== 0 && raw.extra?.renting !== false,
      at: Number.isFinite(at) ? at : Date.now(),
    }];
  });
}

let networks: Promise<BikeNetwork[]> | null = null;

/** La liste des réseaux, demandée une fois par session. Un échec se retente à l'appel suivant. */
export function bikeNetworks(): Promise<BikeNetwork[]> {
  networks ??= fetch(CONFIG.CITYBIKES_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`CityBikes ${res.status}`);
      return res.json();
    })
    .then(parseNetworks)
    .catch((error: unknown) => {
      networks = null;
      throw error;
    });
  return networks;
}

/** Les réseaux dont le centre est assez près de ce point pour couvrir la carte. */
export function networksNear(all: BikeNetwork[], at: LonLat, radiusKm = CONFIG.BIKES_NETWORK_RADIUS_KM): BikeNetwork[] {
  return all.filter((n) => distance(at, n) <= radiusKm * 1000);
}

const stationsCache = new Map<string, { at: number; stations: Promise<BikeStation[]> }>();

// Pas d'annulation : la réponse sert au déplacement suivant, même si celui qui
// l'a demandée est déjà passé.
function networkStations(id: string): Promise<BikeStation[]> {
  const cached = stationsCache.get(id);
  if (cached && Date.now() - cached.at < CONFIG.BIKES_TTL_MS) return cached.stations;
  const stations = fetch(`${CONFIG.CITYBIKES_URL}/${encodeURIComponent(id)}?fields=stations`)
    .then((res) => {
      if (!res.ok) throw new Error(`CityBikes ${res.status}`);
      return res.json();
    })
    .then((json) => parseStations(json, id))
    .catch((error: unknown) => {
      stationsCache.delete(id);
      throw error;
    });
  stationsCache.set(id, { at: Date.now(), stations });
  return stations;
}

/** Les stations de la zone affichée, tous réseaux proches confondus. */
export async function loadBikeStations(bbox: [number, number, number, number]): Promise<BikeStation[]> {
  const [west, south, east, north] = bbox;
  const center = { lon: (west + east) / 2, lat: (south + north) / 2 };
  const near = networksNear(await bikeNetworks(), center);
  const all = await Promise.all(near.map((n) => networkStations(n.id).catch((): BikeStation[] => [])));
  return all.flat().filter((s) => s.lon >= west && s.lon <= east && s.lat >= south && s.lat <= north);
}

/** Toutes les stations déjà chargées : la recherche y puise sans rien demander. */
export async function knownBikeStations(): Promise<BikeStation[]> {
  const lists = await Promise.all(
    [...stationsCache.values()].map((entry) => entry.stations.catch((): BikeStation[] => [])),
  );
  return lists.flat();
}

/** La liste des réseaux pour la recherche, demandée seulement quand le mode est allumé. */
export function useBikeNetworks(enabled: boolean): BikeNetwork[] {
  const [list, setList] = useState<BikeNetwork[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    bikeNetworks()
      .then((all) => alive && setList(all))
      .catch(() => {
        /* CityBikes muet : la recherche ne propose simplement pas d'autres villes */
      });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return enabled ? list : [];
}
