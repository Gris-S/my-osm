// ---------------------------------------------------------------------------
// Les cartes téléchargées, lues **par la carte elle-même**, dans l'APK.
//
// Dans un navigateur, c'est le Service Worker (`src/sw.ts`) qui sert les tuiles
// d'une zone téléchargée. L'APK n'en a pas — une WebView Android ne lui fait
// pas intercepter les requêtes, et il empêchait le pont natif de s'installer
// (voir `vite.config.ts`). Vérifié sur le téléphone : aucun Service Worker
// actif, donc des zones téléchargées que rien ne lisait sans réseau.
//
// La carte les lit donc directement. MapLibre sait déléguer un chargement à une
// fonction (`addProtocol`), mais **refuse de le faire pour `https:`** — relevé
// dans sa source : `makeRequest` exclut `^https?:|^file:` des protocoles
// enregistrés. D'où deux pièces :
//
// - `transformRequest` réécrit les adresses de tuiles et d'habillage que les
//   zones savent ranger (`keys.ts`) en `zone://…` ;
// - le protocole `zone` les sert **depuis la zone d'abord**, puis le réseau —
//   exactement la règle du Service Worker, sur les mêmes clés — dans le
//   stockage de l'application (`deviceStore.ts`), à l'abri d'un effacement de
//   la WebView.
//
// Hors ligne et hors zone, une tuile **vide** plutôt qu'une erreur : c'est ce
// que rendait le 504 du Service Worker, et MapLibre laisse alors la case vide
// au lieu de remonter une erreur par tuile manquante.
//
// **Hors ligne, le zoom maximal descend à celui des zones.** Une zone s'arrête
// au zoom de son niveau (13 pour une région), la carte en demande 14 : toutes
// ses tuiles manquaient, et la carte hors ligne était vide sitôt qu'on zoomait.
// Constaté sur le téléphone : une seule ressource servie par la zone, le reste
// venant du cache HTTP de la WebView, qui ne garde que ce qu'on a déjà vu. Le
// TileJSON est donc réécrit hors ligne, et la carte le relit à chaque
// changement de connexion (`followConnectivity`) : elle agrandit alors les
// tuiles qu'elle a, au lieu d'en réclamer qu'elle n'aura pas.
// ---------------------------------------------------------------------------

import * as maplibregl from "maplibre-gl";
import { isNativeApp } from "../native";
import { cacheKeyFor, isStyleAssetUrl, tileRefFromUrl } from "./keys";
import { assetPath, pathOf, readAnywhere } from "./blobStore";
import { listRegions, prepareDeviceStorage, regionsRevisionNumber } from "./store";
import { VECTOR_SOURCE_ID } from "../tilePois";

/** Le TileJSON des tuiles vectorielles : c'est lui qui annonce leur zoom maximal. */
const TILEJSON_URL = "https://tiles.openfreemap.org/planet";

const SCHEME = "zone";
const PREFIX = `${SCHEME}://`;

/** D'où viennent les tuiles depuis le lancement — pour le diagnostic et le journal. */
export const offlineTileStats = { zone: 0, network: 0, empty: 0 };

/**
 * Les dernières ressources qu'on n'a pu servir ni de la zone ni du réseau :
 * c'est ce qui dit, hors ligne, quoi ajouter au téléchargement.
 */
const offlineMisses: { url: string; type: string; outcome: string }[] = [];
function miss(url: string, type: string | undefined, outcome: string) {
  offlineMisses.push({ url, type: type ?? "?", outcome });
  if (offlineMisses.length > 40) offlineMisses.shift();
}

let installed = false;

/** Le chemin d'une adresse dans le magasin des zones, ou `null` si aucune zone ne la range. */
function storedPath(url: string): string | null {
  const ref = tileRefFromUrl(url);
  if (ref) return pathOf(cacheKeyFor(ref));
  return isStyleAssetUrl(url) ? assetPath(url) : null;
}

// Existe-t-il une zone, et jusqu'à quel zoom descendent-elles toutes ? Relu
// toutes les trente secondes : sans zone, chaque tuile irait chercher dans OPFS
// un fichier qui n'y est pas, pour rien.
//
// **Tous les appels attendent la même lecture.** La première version notait
// l'heure de la vérification avant la réponse d'IndexedDB : les requêtes
// parties en même temps — pictogrammes, polices — voyaient une vérification
// « récente » encore à « aucune zone », allaient au réseau et revenaient vides
// hors ligne. Constaté sur le téléphone : le pictogramme était bien rangé, et
// pourtant jamais servi.
let zonesCheckedAt = 0;
let zonesRevision = -1;
let zonesRead: Promise<void> | null = null;
let zonesExist = false;
let zonesMinZoom: number | null = null;
async function hasZones(): Promise<boolean> {
  // Relue aussi dès que la liste des zones change : une zone téléchargée à
  // l'instant sert tout de suite (constaté : la carte l'ignorait jusqu'à trente
  // secondes).
  if (!zonesRead || Date.now() - zonesCheckedAt > 30_000 || zonesRevision !== regionsRevisionNumber()) {
    zonesCheckedAt = Date.now();
    zonesRevision = regionsRevisionNumber();
    zonesRead = (async () => {
      try {
        const zones = (await listRegions()).filter((region) => region.tilesDone > 0);
        zonesExist = zones.length > 0;
        // Le plus bas : un zoom plus fin laisserait vides les zones qui s'arrêtent avant.
        zonesMinZoom = zonesExist ? Math.min(...zones.map((region) => region.vectorMaxZoom)) : null;
      } catch {
        zonesExist = false;
        zonesMinZoom = null;
      }
    })();
  }
  await zonesRead;
  return zonesExist;
}

/** Hors ligne, le TileJSON annonce le zoom des zones plutôt que celui du serveur. */
function clampTileJson(url: string, data: unknown): unknown {
  if (url !== TILEJSON_URL || navigator.onLine || zonesMinZoom === null) return data;
  const tilejson = data as { maxzoom?: number };
  if (typeof tilejson.maxzoom !== "number" || tilejson.maxzoom <= zonesMinZoom) return data;
  return { ...tilejson, maxzoom: zonesMinZoom };
}

type Wanted = "string" | "json" | "arrayBuffer" | "image" | undefined;

/** Ce que MapLibre attend selon le type demandé — du binaire pour une image, qu'il décode lui-même. */
async function decode(source: Blob | Response, type: Wanted): Promise<unknown> {
  if (type === "json") return JSON.parse(await source.text());
  if (type === "string") return source.text();
  return source.arrayBuffer();
}

/**
 * À passer en `transformRequest` à la carte : les adresses que les zones savent
 * ranger passent par le protocole `zone`, toutes les autres restent intactes.
 */
export function offlineTransformRequest(url: string): { url: string } | undefined {
  if (!url.startsWith("https://") || !storedPath(url)) return undefined;
  return { url: PREFIX + url.slice("https://".length) };
}

/**
 * Installe le protocole, **dans l'APK seulement** — un navigateur a son Service
 * Worker. Rend vrai si la carte doit recevoir `offlineTransformRequest`.
 */
export function installOfflineTiles(): boolean {
  if (installed) return true;
  if (!isNativeApp()) return false;
  installed = true;

  // Premier lancement avec le stockage de l'appareil : les anciennes copies
  // partent et les zones passent « à retélécharger ». Après un effacement de la
  // WebView : la liste des zones revient de sa copie. Dans les deux cas, les
  // zones sont relues ensuite.
  void prepareDeviceStorage()
    .then((changed) => {
      if (changed) zonesRead = null;
    })
    .catch(() => {});

  maplibregl.addProtocol(SCHEME, async (params, abortController) => {
    const url = "https://" + params.url.slice(PREFIX.length);
    const path = storedPath(url);

    const zones = path ? await hasZones() : false;
    if (path && zones) {
      const blob = await readAnywhere(path).catch(() => undefined);
      if (blob) {
        offlineTileStats.zone += 1;
        return { data: clampTileJson(url, await decode(blob, params.type)) };
      }
    }

    try {
      const res = await fetch(url, {
        method: params.method ?? "GET",
        headers: params.headers,
        body: params.body,
        credentials: params.credentials,
        signal: abortController.signal,
      });
      if (!res.ok) {
        // La forme d'une `AJAXError` de MapLibre : le statut reste lisible.
        throw Object.assign(new Error(`${res.status} ${res.statusText}: ${url}`), {
          status: res.status,
          statusText: res.statusText,
          url,
        });
      }
      offlineTileStats.network += 1;
      return {
        data: clampTileJson(url, await decode(res, params.type)),
        cacheControl: res.headers.get("Cache-Control"),
        expires: res.headers.get("Expires"),
      };
    } catch (error) {
      if (abortController.signal.aborted) throw error;
      // Hors ligne et hors zone : une case vide, pas une erreur par tuile.
      // En ligne, l'échec est réel et remonte — une tuile vide mise en cache
      // par la carte laisserait sinon un trou jusqu'au prochain lancement.
      if (!navigator.onLine && params.type !== "json" && params.type !== "string") {
        offlineTileStats.empty += 1;
        miss(url, params.type, "vide");
        return { data: new ArrayBuffer(0) };
      }
      miss(url, params.type, String(error));
      throw error;
    }
  });

  // Lisible par le câble (débogage de la WebView), sans rien exposer d'autre.
  // Absent de la version release (`__DIAGNOSTICS__`).
  if (__DIAGNOSTICS__) {
    (window as unknown as { __myosm?: Record<string, unknown> }).__myosm = {
      ...(window as unknown as { __myosm?: Record<string, unknown> }).__myosm,
      offlineTiles: offlineTileStats,
      offlineMisses,
      // Les fonctions des zones, pour essayer le stockage de l'appareil par le
      // câble (télécharger, lire, supprimer une petite zone de test).
      offlineStore: () => import("./index"),
    };
  }
  return true;
}

/**
 * Fait relire le TileJSON à la carte à chaque perte ou retour du réseau : hors
 * ligne, il annonce le zoom des zones ; en ligne, celui du serveur. `setUrl` est
 * l'API publique qui recharge la source — et la relecture passe par le
 * protocole, zone d'abord, si bien qu'elle aboutit sans réseau. Rend la
 * fonction qui arrête l'écoute.
 */
export function followConnectivity(map: maplibregl.Map): () => void {
  const reload = () => {
    zonesRead = null; // les zones ont pu changer depuis la dernière lecture
    const source = map.getSource(VECTOR_SOURCE_ID) as maplibregl.VectorTileSource | undefined;
    if (source?.url) source.setUrl(source.url);
  };
  window.addEventListener("online", reload);
  window.addEventListener("offline", reload);
  return () => {
    window.removeEventListener("online", reload);
    window.removeEventListener("offline", reload);
  };
}
