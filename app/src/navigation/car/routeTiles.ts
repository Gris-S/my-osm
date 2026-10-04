import { tilesForZoom, type Tile } from "../../services/offline/tiles";
import { tileStoredInZone } from "../../services/offline/nativeTiles";
import { note } from "../journal";
import { pointAtMeters } from "./carProgress";
import type { CarRoute } from "./carRoute";

// ---------------------------------------------------------------------------
// La carte des kilomètres à venir, chargée d'avance.
//
// Demande explicite (4 octobre 2026), après un trajet fait sur un fond vide :
// le trait bleu, et rien dessous. La carte ne demandait une tuile qu'au moment
// de l'afficher — donc trop tard dès que le réseau manquait à cet instant-là,
// tunnel, zone blanche ou WebView qui se croit hors ligne.
//
// Les tuiles des **quinze kilomètres devant** sont donc demandées dès le
// départ, puis au fil de la route (tous les kilomètres, et à chaque nouveau
// tracé). Elles ne sont rangées nulle part de particulier : un `fetch`
// ordinaire les dépose dans le cache HTTP de la WebView — ou dans celui du
// Service Worker, côté navigateur — et c'est là que la carte les retrouve,
// réseau ou pas. Le serveur les déclare valables dix ans (`max-age=315360000`,
// l'adresse porte la date du jeu de données) : une tuile préchargée ne se
// périme pas en route.
//
// **Cela ne consomme guère plus que le trajet lui-même** : ce sont, à la marge
// de côté près, les tuiles que la carte aurait demandées en y arrivant. Le
// surcoût vient des recalculs — ce qu'on avait chargé pour l'ancien tracé — et
// il est borné par les quinze kilomètres.
//
// Trois zooms, parce que le cadrage de la navigation va de 12,5 à 17,5
// (`carCamera.ts`) et que les tuiles vectorielles s'arrêtent à 14 : la carte
// demande du 12, du 13 ou du 14 selon la distance de la prochaine manœuvre.
// ---------------------------------------------------------------------------

/** Jusqu'où l'on charge devant la voiture, en mètres. */
export const PRELOAD_AHEAD_METERS = 15_000;

/** Avancée après laquelle on regarde de nouveau ce qui manque devant, en mètres. */
export const PRELOAD_STEP_METERS = 1_000;

/** Un point du tracé tous les tant de mètres : assez serré pour ne sauter aucune tuile de zoom 14 (1,6 km). */
const SAMPLE_METERS = 150;

/**
 * Les zooms chargés, et la marge prise de chaque côté du tracé, en mètres :
 * la moitié environ de ce que l'écran montre au zoom le plus large servi par
 * ces tuiles. Sans marge, une route qui longe le bord d'une tuile laisserait
 * la moitié de l'écran vide.
 */
const LEVELS = [
  { z: 14, margin: 500 },
  { z: 13, margin: 1_000 },
  { z: 12, margin: 2_000 },
];

/** Deux requêtes à la fois : la carte, elle, doit rester servie la première. */
const PARALLEL = 2;

const TILEJSON_URL = "https://tiles.openfreemap.org/planet";

type Path = Pick<CarRoute, "points" | "measures">;

/**
 * Les tuiles qui couvrent le tracé entre deux avancements, les plus proches
 * d'abord. Fonction pure : c'est elle que les tests éprouvent.
 */
export function tilesAhead(route: Path, fromMeters: number, toMeters: number): Tile[] {
  const end = route.measures[route.measures.length - 1] ?? 0;
  const last = Math.min(end, toMeters);
  const seen = new Set<string>();
  const out: Tile[] = [];
  for (let meters = Math.max(0, fromMeters); ; meters += SAMPLE_METERS) {
    const at = Math.min(meters, last);
    const point = pointAtMeters(route as CarRoute, at);
    for (const { z, margin } of LEVELS) {
      const dLat = margin / 110_574;
      const dLon = margin / (111_320 * Math.max(0.1, Math.cos((point.lat * Math.PI) / 180)));
      for (const tile of tilesForZoom([point.lon - dLon, point.lat - dLat, point.lon + dLon, point.lat + dLat], z)) {
        const key = `${tile.z}/${tile.x}/${tile.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(tile);
      }
    }
    if (at >= last) break;
  }
  return out;
}

// Le gabarit des adresses de tuiles, lu dans le TileJSON : il porte la date du
// jeu de données, qu'on ne peut pas deviner. Relu si la lecture a échoué.
let templateRead: Promise<string | null> | null = null;
function tileTemplate(): Promise<string | null> {
  templateRead ??= fetch(TILEJSON_URL)
    .then((res) => (res.ok ? res.json() : null))
    .then((tilejson: { tiles?: unknown } | null) => {
      const first = Array.isArray(tilejson?.tiles) ? tilejson.tiles[0] : null;
      return typeof first === "string" ? first : null;
    })
    .catch(() => null)
    .then((template) => {
      if (!template) templateRead = null;
      return template;
    });
  return templateRead;
}

/** Le chargeur d'une navigation : `update` à chaque relevé, `stop` à la fin. */
export interface RoutePreloader {
  update(route: Path, traveledMeters: number): void;
  stop(): void;
}

export function createRoutePreloader(): RoutePreloader {
  // Ce qui est déjà dans le cache, pour ne pas le redemander à chaque passe.
  const done = new Set<string>();
  let plannedRoute: Path | null = null;
  let plannedAt = -Infinity;
  let controller: AbortController | null = null;
  // Une passe ratée se rejoue, mais pas à chaque relevé : dix secondes de répit.
  let retryAt = 0;

  async function run(tiles: Tile[], signal: AbortSignal, fromMeters: number) {
    // « Économiseur de données » : l'utilisateur a demandé qu'on ne charge rien d'avance.
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    const template = await tileTemplate();
    if (!template || signal.aborted) return;
    let loaded = 0;
    let failed = 0;
    let next = 0;
    const worker = async () => {
      while (next < tiles.length && !signal.aborted) {
        const tile = tiles[next++];
        const key = `${tile.z}/${tile.x}/${tile.y}`;
        const url = template.replace("{z}", String(tile.z)).replace("{x}", String(tile.x)).replace("{y}", String(tile.y));
        try {
          // Une zone téléchargée la sert déjà, sans réseau.
          if (!(await tileStoredInZone(url))) {
            const res = await fetch(url, { signal });
            // Le corps doit être lu en entier pour que le cache garde la réponse.
            if (res.ok) await res.arrayBuffer();
            else throw new Error(String(res.status));
          }
          done.add(key);
          loaded += 1;
        } catch {
          if (signal.aborted) return;
          failed += 1;
          // Deux échecs de suite : le réseau n'est pas là, inutile d'insister.
          // La passe suivante reprendra ce qui manque.
          if (failed >= 2) next = tiles.length;
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (!signal.aborted) note("car.preload", { km: fromMeters / 1000, tiles: loaded, failed, wanted: tiles.length });
    // Une passe incomplète se rejoue au prochain relevé venu, pas dans un kilomètre.
    if (failed > 0 && !signal.aborted) plannedAt = -Infinity;
  }

  return {
    update(route, traveledMeters) {
      if (route === plannedRoute && traveledMeters - plannedAt < PRELOAD_STEP_METERS && traveledMeters >= plannedAt) return;
      if (route === plannedRoute && plannedAt === -Infinity && Date.now() < retryAt) return;
      retryAt = Date.now() + 10_000;
      plannedRoute = route;
      plannedAt = traveledMeters;
      controller?.abort();
      controller = new AbortController();
      const tiles = tilesAhead(route, traveledMeters, traveledMeters + PRELOAD_AHEAD_METERS).filter(
        (tile) => !done.has(`${tile.z}/${tile.x}/${tile.y}`),
      );
      if (tiles.length) void run(tiles, controller.signal, traveledMeters);
    },
    stop() {
      controller?.abort();
      controller = null;
      plannedRoute = null;
      plannedAt = -Infinity;
    },
  };
}
