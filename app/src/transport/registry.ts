import manifest from "./regions.json";
import type { BBox, ProviderId, RegionId } from "./model";
import type { Capability } from "./provider";

// ---------------------------------------------------------------------------
// Le registre des régions (§3.1 du document d'architecture).
//
// Un fichier statique embarqué, lu une fois : quelles zones, quels
// fournisseurs, quelles capacités, quelle clé. **On résout la région avant
// tout**, et seuls ses fournisseurs sont chargés : à Paris, rien de Madrid ne
// transite. Ajouter une ville, c'est ajouter une entrée ici (et un adaptateur
// si le protocole est nouveau) — rien d'autre ne doit changer.
// ---------------------------------------------------------------------------

export interface RegionProvider {
  id: ProviderId;
  /** 1 source officielle locale, 2 agrégateur, 3 horaires théoriques, 4 OSM (§3.3). */
  rank: 1 | 2 | 3 | 4;
  capabilities: Capability[];
  /** Emplacement de clé d'API (`services/apiKeys.ts`) sans lequel le fournisseur est sauté. */
  needsKey?: string;
}

export interface Region {
  id: RegionId;
  name: { fr: string; en: string };
  bbox: BBox;
  timezone?: string;
  providers: RegionProvider[];
}

/** Marge autour d'une région, en part de sa taille, avant de la quitter. */
export const REGION_HYSTERESIS = 0.2;

export const REGIONS: Region[] = (manifest.regions as Region[]).map((region) => ({
  ...region,
  providers: [...region.providers].sort((a, b) => a.rank - b.rank),
}));

function contains(bbox: BBox, lon: number, lat: number, margin = 0): boolean {
  const [west, south, east, north] = bbox;
  const dx = (east - west) * margin;
  const dy = (north - south) * margin;
  return lon >= west - dx && lon <= east + dx && lat >= south - dy && lat <= north + dy;
}

function area(bbox: BBox): number {
  return (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
}

/**
 * La région d'un point : la plus précise (la plus petite emprise) qui le
 * contient. Une région déjà active est gardée tant que le point reste dans sa
 * marge (`REGION_HYSTERESIS`) : au bord d'une région, un panoramique de
 * quelques mètres ne doit pas décharger puis recharger ses fournisseurs.
 */
export function resolveRegion(lon: number, lat: number, previous: RegionId | null = null, regions: Region[] = REGIONS): Region {
  const current = previous ? regions.find((region) => region.id === previous) : undefined;
  const candidates = regions.filter((region) => contains(region.bbox, lon, lat));
  const best = candidates.sort((a, b) => area(a.bbox) - area(b.bbox))[0];
  if (current && contains(current.bbox, lon, lat, REGION_HYSTERESIS)) {
    // On ne garde la région active que si aucune région plus précise ne s'impose.
    if (!best || area(best.bbox) >= area(current.bbox)) return current;
  }
  if (best) return best;
  const world = regions.find((region) => region.id === "world");
  if (!world) throw new Error("Registre des régions sans région « world »");
  return world;
}

/** Les fournisseurs d'une région pour une capacité, du rang le plus élevé au plus bas. */
export function providersFor(region: Region, capability: Capability): RegionProvider[] {
  return region.providers.filter((provider) => provider.capabilities.includes(capability));
}
