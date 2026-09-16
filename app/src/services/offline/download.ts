// ---------------------------------------------------------------------------
// Le téléchargement d'une zone.
//
// Une zone se télécharge en quatre passes, dans cet ordre : l'habillage du
// style, les tuiles, les détails de lieux, les adresses. L'ordre n'est pas
// indifférent — l'habillage pèse un mégaoctet et rend la carte affichable ;
// si l'on s'interrompt ensuite, on a déjà quelque chose plutôt que rien.
//
// **Tout est reprenable.** Chaque tuile déjà présente dans le cache est
// sautée, et l'avancement est écrit dans IndexedDB au fil de l'eau : fermer
// l'application au milieu d'un téléchargement de 250 Mo ne coûte que ce qui
// était en vol. C'est la contrepartie d'un travail mené dans l'onglet et non
// dans le Service Worker — un onglet, ça se ferme.
// ---------------------------------------------------------------------------

import { CONFIG } from "../../config";
import { groupFromTags } from "../../filters";
import { cacheKeyFor, type TileRef } from "./keys";
import { StorageWriteError, assetPath, classifyWriteFailure, isQuotaError, pathOf, tileStore, type BlobStore } from "./blobStore";
import {
  freeBytes,
  putRegion,
  putPlaces,
  putSearchEntries,
  requestPersistence,
  type OfflineRegion,
  type SearchEntry,
  type StoredPlaceDetails,
} from "./store";
import { footprintChunks, footprintTiles, type Bbox, type Tile } from "./tiles";
import { downloadAddresses } from "./addresses";
import { anySignal } from "../../utils/signals";
import { currentLocale, t } from "../../i18n";

export interface Progress {
  phase: "style" | "tiles" | "places" | "addresses" | "done";
  done: number;
  total: number;
  bytes: number;
  label: string;
}

/** Requêtes menées de front. Au-delà, les serveurs de tuiles ralentissent. */
const PARALLEL = 6;

/** Sauvegarde de l'avancement — pas à chaque tuile, ce serait du gâchis. */
const SAVE_EVERY = 40;

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function termsOf(...parts: (string | undefined)[]): string[] {
  const words = normalize(parts.filter(Boolean).join(" "))
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
  return [...new Set(words)];
}

/**
 * Exécute des travaux par lots, en s'arrêtant net si l'on annule.
 *
 * Volontairement une boucle et non un `Promise.all` sur tout : sur une zone de
 * 10 000 tuiles, tout lancer d'un coup ferait exploser la mémoire et
 * rendrait l'annulation sans effet.
 */
async function pool<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  let cursor = 0;
  async function next(): Promise<void> {
    while (cursor < items.length) {
      if (signal.aborted) return;
      const item = items[cursor++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, next));
}

/**
 * Range un fichier, ou arrête la zone en disant pourquoi. Une tuile que le
 * réseau ne rend pas laisse un trou qu'on reprendra ; une écriture que
 * l'appareil refuse ne se réglera pas en insistant.
 */
async function writeOrStop(store: BlobStore, path: string, blob: Blob): Promise<void> {
  try {
    await store.put(path, blob);
  } catch (error) {
    throw new StorageWriteError(classifyWriteFailure(error, await freeBytes().catch(() => null)), error);
  }
}

// --- 1. L'habillage du style ----------------------------------------------

/**
 * Le style, ses pictogrammes et ses polices.
 *
 * Sans eux, une zone téléchargée s'affiche en aplats gris sans un seul nom :
 * MapLibre a les géométries mais ni les symboles ni les glyphes pour les
 * dessiner. Ces fichiers sont les mêmes pour toutes les zones, on ne les
 * reprend donc pas d'une zone à l'autre.
 */
async function downloadStyleAssets(store: BlobStore, onProgress: (p: Partial<Progress>) => void) {
  const style = (await (await fetch(CONFIG.MAP_STYLE_URL)).json()) as {
    sprite?: string;
    layers: { layout?: { "text-font"?: string[] } }[];
  };

  const fonts = new Set<string>();
  for (const layer of style.layers) {
    for (const font of layer.layout?.["text-font"] ?? []) fonts.add(font);
  }

  const urls = [
    CONFIG.MAP_STYLE_URL,
    "https://tiles.openfreemap.org/planet",
    // Les deux densités, **chacune avec son JSON** : un écran haute densité
    // demande `@2x.json` avec `@2x.png`, et leurs coordonnées diffèrent. Le JSON
    // `@2x` manquait — constaté hors ligne sur le téléphone : ni pictogramme, et
    // une erreur « Failed to fetch » par-dessus la carte.
    ...(style.sprite
      ? [`${style.sprite}.json`, `${style.sprite}.png`, `${style.sprite}@2x.json`, `${style.sprite}@2x.png`]
      : []),
    ...[...fonts].flatMap((font) =>
      CONFIG.OFFLINE.GLYPH_RANGES.map(
        (range) => `https://tiles.openfreemap.org/fonts/${encodeURIComponent(font)}/${range}.pbf`,
      ),
    ),
  ];

  let done = 0;
  for (const url of urls) {
    let blob: Blob | null = null;
    try {
      const res = await fetch(url);
      if (res.ok) blob = await res.blob();
    } catch {
      // Un glyphe manquant dégrade l'affichage, il ne doit pas faire échouer
      // la zone entière.
    }
    if (blob) await writeOrStop(store, assetPath(url), blob);
    onProgress({ phase: "style", done: ++done, total: urls.length, label: t("progress.style") });
  }
}

// --- 2. Les tuiles ---------------------------------------------------------

function tileUrl(ref: TileRef, vectorTemplate: string): string {
  const fill = (t: string) =>
    t.replace("{z}", String(ref.z)).replace("{x}", String(ref.x)).replace("{y}", String(ref.y));
  if (ref.kind === "vector") return fill(vectorTemplate);
  if (ref.kind === "esri") return fill(CONFIG.SATELLITE_TILE_URL);
  if (ref.kind === "dem") return fill(CONFIG.TERRAIN_TILE_URL);
  if (ref.kind === "contour") return fill(CONFIG.CONTOUR_TILE_URL);
  return fill(CONFIG.SATELLITE_IGN_TILE_URL);
}

/** La partie datée d'un gabarit d'URL de tuiles : `…/planet/CECI/{z}/…`. */
export function versionOf(template: string): string {
  return /\/planet\/([^/]+)\//.exec(template)?.[1] ?? "";
}

/** Le gabarit d'URL courant des tuiles vectorielles, version datée comprise. */
export async function resolveVectorTemplate(): Promise<string> {
  const res = await fetch("https://tiles.openfreemap.org/planet");
  const json = (await res.json()) as { tiles: string[] };
  return json.tiles[0];
}

// --- 3. Les détails de lieux ----------------------------------------------

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function overpassQuery([w, s, e, n]: Bbox): string {
  const box = `${s},${w},${n},${e}`;
  return `[out:json][timeout:120];(nwr["shop"](${box});nwr["amenity"](${box});nwr["tourism"](${box});nwr["leisure"](${box});nwr["healthcare"](${box});nwr["office"](${box});nwr["public_transport"="station"](${box}););out center tags;`;
}

/**
 * Une maille d'Overpass, transformée en détails et en entrées de recherche.
 *
 * On ne garde que les étiquettes qui servent : la réponse brute d'une maille
 * fait 5,6 Mo pour 16 000 objets, dont l'essentiel est du bruit
 * (`source`, `wikidata`, les noms dans quarante langues). Trier ici plutôt
 * que de tout ranger fait la différence entre une zone de 25 Mo et une de 150.
 */
function harvest(elements: OverpassElement[], regionId: string) {
  const places: StoredPlaceDetails[] = [];
  const entries: SearchEntry[] = [];

  for (const el of elements) {
    const tags = el.tags;
    if (!tags) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) continue;

    const id = `${el.type}/${el.id}`;
    const address = [tags["addr:housenumber"], tags["addr:street"], tags["addr:postcode"], tags["addr:city"]]
      .filter(Boolean)
      .join(" ");

    if (tags.opening_hours || tags.phone || tags["contact:phone"] || tags.website || address) {
      places.push({
        id,
        region: regionId,
        address: address || undefined,
        openingHours: tags.opening_hours,
        phone: tags.phone ?? tags["contact:phone"],
        website: tags.website ?? tags["contact:website"],
      });
    }

    // Un lieu sans nom n'a rien à faire dans une recherche par texte.
    const name = tags.name;
    if (!name) continue;
    entries.push({
      id: `${regionId}:${id}`,
      region: regionId,
      label: name,
      sub: address,
      lon,
      lat,
      group: groupFromTags(tags),
      rawType: tags.shop ?? tags.amenity ?? tags.tourism ?? tags.leisure,
      terms: termsOf(name, tags["addr:street"], tags["addr:city"]),
    });
  }
  return { places, entries };
}

// --- L'orchestration -------------------------------------------------------

export interface DownloadHandle {
  promise: Promise<void>;
  cancel: () => void;
}

/**
 * @param refresh Retélécharge les tuiles **déjà présentes**.
 *
 * Indispensable à la mise à jour, et facile à manquer : les tuiles sont
 * rangées sous une clé normalisée, sans le numéro de version amont (voir
 * `keys.ts`). Une zone périmée a donc, pour le cache, exactement les mêmes
 * clés qu'une zone à jour — sans ce drapeau, la reprise sauterait chaque
 * tuile et une mise à jour ne changerait rien du tout.
 */
export function downloadRegion(
  region: OfflineRegion,
  onProgress: (p: Progress) => void,
  refresh = false,
): DownloadHandle {
  const controller = new AbortController();
  const { signal } = controller;

  const promise = (async () => {
    // La raison d'un arrêt précédent ne vaut plus : on repart.
    region.failure = undefined;
    await requestPersistence();
    const store = await tileStore();
    let bytes = region.bytes;
    let done = 0;

    const state: Progress = {
      phase: "style",
      done: 0,
      total: 1,
      bytes,
      label: t("progress.prepare"),
    };
    const report = (patch: Partial<Progress>) => {
      Object.assign(state, patch, { bytes });
      onProgress({ ...state });
    };

    async function save(status: OfflineRegion["status"]) {
      await putRegion({ ...region, bytes, tilesDone: done, status, updatedAt: Date.now() });
    }

    try {
      await save("downloading");
      await downloadStyleAssets(store, report);

      // --- Tuiles ---------------------------------------------------------
      const template = await resolveVectorTemplate();
      region.tileVersion = versionOf(template);
      const refs: TileRef[] = footprintTiles(region, region.vectorMaxZoom).map(
        (t: Tile) => ({ ...t, kind: "vector" as const }),
      );
      if (region.satelliteMaxZoom !== null) {
        for (const t of footprintTiles(region, region.satelliteMaxZoom)) {
          // Les deux fonds sont pris : l'IGN là où il existe, Esri partout —
          // c'est la superposition de la vue satellite, et hors ligne on ne
          // peut pas décider après coup.
          refs.push({ ...t, kind: "esri" }, { ...t, kind: "ign" });
        }
      }
      if (region.reliefMaxZoom !== null) {
        for (const t of footprintTiles(region, region.reliefMaxZoom)) {
          refs.push({ ...t, kind: "dem" });
        }
        // Les courbes ne commencent qu'au zoom où elles se lisent, et n'existent
        // qu'en France : hors de là le service rend un 404, que la boucle de
        // téléchargement traite déjà comme une tuile absente.
        for (const t of footprintTiles(region, region.reliefMaxZoom, CONFIG.CONTOUR_MIN_ZOOM)) {
          refs.push({ ...t, kind: "contour" });
        }
      }

      region.tilesTotal = refs.length;
      await save("downloading");
      report({ phase: "tiles", done: 0, total: refs.length, label: t("progress.tiles") });

      let sinceSave = 0;
      // Une écriture refusée arrête tous les travaux en cours, sans passer pour
      // une interruption demandée : la zone finit en erreur, avec sa raison.
      const stop = new AbortController();
      // `anySignal` et non `AbortSignal.any` : celle-ci demande une WebView 116,
      // et l'application s'installe à partir d'Android 7. Sur une WebView plus
      // ancienne, le téléchargement levait ici même, dès la première tuile.
      const working = anySignal([signal, stop.signal]);
      let writeFailure = null as StorageWriteError | null;
      await pool(
        refs,
        async (ref) => {
          if (working.aborted) return;
          const path = pathOf(cacheKeyFor(ref));
          if (!refresh && (await store.has(path))) {
            done++;
            return;
          }
          let blob: Blob | null = null;
          try {
            const res = await fetch(tileUrl(ref, template), { signal });
            if (res.ok) blob = await res.blob();
            // Une tuile absente n'est pas une erreur : l'IGN rend un 404 hors
            // de ses emprises, et Esri au-delà de son zoom natif.
          } catch {
            /* réseau : la tuile sera reprise au prochain passage */
          }
          if (blob && !working.aborted) {
            try {
              await writeOrStop(store, path, blob);
              bytes += blob.size;
            } catch (error) {
              writeFailure ??= error instanceof StorageWriteError ? error : new StorageWriteError("write", error);
              stop.abort();
              return;
            }
          }
          done++;
          if (++sinceSave >= SAVE_EVERY) {
            sinceSave = 0;
            void save("downloading");
            report({ done, total: refs.length });
          }
        },
        working,
      );
      if (writeFailure) throw writeFailure;
      if (signal.aborted) return void (await save("paused"));
      report({ done, total: refs.length });

      // --- Détails de lieux -------------------------------------------------
      if (region.detail !== "map") {
        const chunks = footprintChunks(region);
        let places = 0;
        report({ phase: "places", done: 0, total: chunks.length, label: t("progress.places") });

        for (const [i, chunk] of chunks.entries()) {
          if (signal.aborted) return void (await save("paused"));
          try {
            const res = await fetch(CONFIG.OVERPASS_URLS[0], {
              method: "POST",
              body: overpassQuery(chunk),
              signal,
            });
            if (res.ok) {
              const data = (await res.json()) as { elements: OverpassElement[] };
              const { places: p, entries } = harvest(data.elements, region.id);
              await putPlaces(p);
              await putSearchEntries(entries);
              places += entries.length;
            }
          } catch (err) {
            // Une maille manquée laisse un trou, pas un échec — sauf si c'est
            // la place qui manque : les suivantes échoueraient de même.
            if (isQuotaError(err)) throw new StorageWriteError("storage-full", err);
          }
          report({ done: i + 1, total: chunks.length });
          // Overpass est un service public partagé : on ne le mitraille pas.
          await new Promise((r) => setTimeout(r, CONFIG.OFFLINE.OVERPASS_PAUSE_MS));
        }
        region.placesCount = places;
      }

      // --- Adresses ---------------------------------------------------------
      //
      // En dernier, et c'est voulu : c'est la passe la plus lourde en
      // transfert et la moins essentielle. Interrompue, tout le reste de la
      // zone reste utilisable.
      if (region.addresses) {
        report({ phase: "addresses", done: 0, total: 1, label: t("progress.addresses") });
        try {
          region.addressCount = await downloadAddresses(
            region,
            region.id,
            signal,
            (got, all) =>
              report({
                done: got,
                total: all,
                label: t("progress.addressesCount", {
                  done: got.toLocaleString(currentLocale()),
                  total: all.toLocaleString(currentLocale()),
                }),
              }),
          );
        } catch (err) {
          if (signal.aborted) return void (await save("paused"));
          if (isQuotaError(err)) throw new StorageWriteError("storage-full", err);
          // Le service muet laisse la zone utilisable sans ses adresses : ce
          // n'est pas une raison de tout perdre.
        }
      }

      region.tilesDone = done;
      region.bytes = bytes;
      region.updatedAt = Date.now();
      await putRegion({ ...region, status: "ready" });
      report({ phase: "done", label: t("progress.done") });
    } catch (err) {
      await putRegion({
        ...region,
        bytes,
        tilesDone: done,
        status: signal.aborted ? "paused" : "error",
        failure: err instanceof StorageWriteError ? err.reason : undefined,
        error: err instanceof Error ? err.message : String(err),
        updatedAt: Date.now(),
      });
      throw err;
    }
  })();

  return { promise, cancel: () => controller.abort() };
}
