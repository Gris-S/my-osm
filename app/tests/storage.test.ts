import { describe, expect, it } from "vitest";
import { deviceFileUrl, keptAncestors } from "../src/services/offline/deviceStore";
import { STORAGE_FULL_MARGIN_BYTES, StorageWriteError, assetPath, classifyWriteFailure, isQuotaError } from "../src/services/offline/blobStore";

describe("deviceFileUrl — l'adresse locale d'un fichier de l'appareil", () => {
  const base = "https://localhost/_capacitor_file_/data/user/0/org.osmlocal.plans/files/zones";

  it("laisse une tuile telle quelle", () => {
    expect(deviceFileUrl(base, "vector/14/8298/5637")).toBe(`${base}/vector/14/8298/5637`);
  });

  it("ré-échappe le nom d'une ressource d'habillage, que le serveur décodera", () => {
    const path = assetPath("https://tiles.openfreemap.org/fonts/Noto Sans Regular/0-255.pbf");
    const url = deviceFileUrl(base, path);
    // Le serveur de Capacitor décode l'adresse une fois : il doit retomber sur le nom rangé.
    expect(decodeURIComponent(url.slice(base.length + 1))).toBe(path);
    expect(url.slice(base.length)).not.toContain("https:/");
  });
});

describe("keptAncestors — les dossiers où descendre pendant une suppression", () => {
  it("rend chaque dossier parent d'un chemin gardé, et lui seul", () => {
    const ancestors = keptAncestors(["vector/14/8298/5637", "assets", "esri/15/16603/11270"]);
    expect([...ancestors].sort()).toEqual(["esri", "esri/15", "esri/15/16603", "vector", "vector/14", "vector/14/8298"]);
    // Un dossier gardé en entier n'a pas à être parcouru.
    expect(ancestors.has("assets")).toBe(false);
  });

  it("est vide quand on ne garde rien : tout part d'un seul appel par dossier", () => {
    expect(keptAncestors([]).size).toBe(0);
  });
});

describe("classifyWriteFailure — stockage plein ou autre refus", () => {
  it("reconnaît le quota des API web", () => {
    const quota = Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    expect(isQuotaError(quota)).toBe(true);
    expect(classifyWriteFailure(quota, null)).toBe("storage-full");
  });

  it("reconnaît le disque plein dans le message du greffon", () => {
    const error = new Error("'writeFile' failed with: /data/user/0/…: write failed: ENOSPC (No space left on device)");
    expect(classifyWriteFailure(error, 5_000_000_000)).toBe("storage-full");
  });

  it("tranche par la place libre quand le message ne dit rien", () => {
    const generic = new Error("'writeFile' failed with: an unknown error.");
    expect(classifyWriteFailure(generic, STORAGE_FULL_MARGIN_BYTES - 1)).toBe("storage-full");
    expect(classifyWriteFailure(generic, 5_000_000_000)).toBe("write");
    expect(classifyWriteFailure(generic, null)).toBe("write");
  });

  it("garde la raison dans l'erreur qui arrête la zone", () => {
    const error = new StorageWriteError("storage-full", new Error("ENOSPC"));
    expect(error.reason).toBe("storage-full");
    expect(error).toBeInstanceOf(Error);
  });
});
