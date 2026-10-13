import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfflineRegion } from "../src/services/offline/store";

// La boucle de téléchargement d'une zone, avec un faux réseau et un faux
// magasin. Ce qu'elle ne doit plus jamais faire : dire « prête » une zone à
// qui le réseau n'a pas tout rendu.
const saved: OfflineRegion[] = [];
const files = new Map<string, Blob>();

vi.mock("../src/services/offline/store", () => ({
  putRegion: async (region: OfflineRegion) => void saved.push({ ...region }),
  putPlaces: async () => {},
  putSearchEntries: async () => {},
  requestPersistence: async () => true,
  freeBytes: async () => null,
}));
vi.mock("../src/services/offline/blobStore", async (original) => ({
  ...(await original<typeof import("../src/services/offline/blobStore")>()),
  tileStore: async () => ({
    name: "opfs",
    has: async (path: string) => files.has(path),
    put: async (path: string, blob: Blob) => void files.set(path, blob),
    get: async (path: string) => files.get(path),
    prune: async () => {},
  }),
}));

const { downloadRegion, isRetryableStatus } = await import("../src/services/offline/download");
const { newRegion } = await import("../src/services/offline");

/** Un faux réseau : `tile` décide de la réponse de chaque tuile, dans l'ordre des demandes. */
function network(tile: (n: number) => Response | Error) {
  let asked = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "https://tiles.openfreemap.org/planet") {
      return Response.json({ tiles: ["https://tiles.openfreemap.org/planet/v1/{z}/{x}/{y}.pbf"] });
    }
    if (!url.includes("/planet/v1/")) return Response.json({ layers: [] });
    const answer = tile(asked++);
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

const region = () =>
  newRegion({
    name: "Essai",
    bbox: [2.3, 48.8, 2.4, 48.9],
    detail: "map",
    vectorMaxZoom: 6,
    satelliteMaxZoom: null,
    reliefMaxZoom: null,
    addresses: false,
    addressDepts: [],
  });

afterEach(() => {
  vi.unstubAllGlobals();
  saved.length = 0;
  files.clear();
});

describe("downloadRegion — une zone ne se dit prête que complète", () => {
  it("finit prête quand tout arrive", async () => {
    network(() => new Response("tuile"));
    await downloadRegion(region(), () => {}).promise;
    expect(saved.at(-1)?.status).toBe("ready");
  });

  it("s'arrête, raison « réseau », quand le réseau tombe en route", async () => {
    network((n) => (n < 3 ? new Response("tuile") : new TypeError("Failed to fetch")));
    await expect(downloadRegion(region(), () => {}).promise).rejects.toThrow(/Réseau/);
    const last = saved.at(-1)!;
    expect(last.status).toBe("error");
    expect(last.failure).toBe("network");
    expect(last.tilesDone).toBe(3);
  });

  it("reprend ce qui manque, sans redemander ce qui est là", async () => {
    const zone = region();
    network((n) => (n < 3 ? new Response("tuile") : new Response("", { status: 503 })));
    await downloadRegion(zone, () => {}).promise.catch(() => {});
    let asked = 0;
    network(() => (asked++, new Response("tuile")));
    await downloadRegion(zone, () => {}).promise;
    expect(saved.at(-1)?.status).toBe("ready");
    expect(asked).toBe(saved.at(-1)!.tilesTotal - 3);
  });

  it("tient un 404 pour une tuile absente, pas pour un trou", async () => {
    network(() => new Response("", { status: 404 }));
    await downloadRegion(region(), () => {}).promise;
    expect(saved.at(-1)?.status).toBe("ready");
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(429)).toBe(true);
  });
});
