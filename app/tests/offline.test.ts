import { describe, expect, it } from "vitest";
import { areaContains, areaTileCounts, areaTiles, tileBbox, type Area } from "../src/services/offline/area";
import { cacheKeyFor, isStyleAssetUrl, tileRefFromUrl } from "../src/services/offline/keys";
import { assetPath, pathOf } from "../src/services/offline/blobStore";
import { countTiles } from "../src/services/offline/tiles";

describe("keys — reconnaître une tuile et la ranger sous une clé stable", () => {
  it("ignore la version datée des tuiles vectorielles", () => {
    const a = tileRefFromUrl("https://tiles.openfreemap.org/planet/20260830_080001_pt/14/8298/5637.pbf");
    const b = tileRefFromUrl("https://tiles.openfreemap.org/planet/20260914_010203_pt/14/8298/5637.pbf");
    expect(a).toEqual({ kind: "vector", z: 14, x: 8298, y: 5637 });
    expect(cacheKeyFor(a!)).toBe(cacheKeyFor(b!));
    expect(pathOf(cacheKeyFor(a!))).toBe("vector/14/8298/5637");
  });

  it("lit Esri dans l'ordre z/y/x", () => {
    expect(
      tileRefFromUrl("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/15/11270/16603"),
    ).toEqual({ kind: "esri", z: 15, y: 11270, x: 16603 });
  });

  it("sépare orthophoto et courbes de niveau de l'IGN par LAYER", () => {
    const base = "https://data.geopf.fr/wmts?SERVICE=WMTS&TILEMATRIX=16&TILEROW=22500&TILECOL=33200";
    expect(tileRefFromUrl(`${base}&LAYER=ORTHOIMAGERY.ORTHOPHOTOS`)?.kind).toBe("ign");
    expect(tileRefFromUrl(`${base}&LAYER=ELEVATION.CONTOUR.LINE`)?.kind).toBe("contour");
  });

  it("reconnaît l'habillage du style, et rien d'autre", () => {
    expect(isStyleAssetUrl("https://tiles.openfreemap.org/fonts/Noto Sans Regular/0-255.pbf")).toBe(true);
    expect(isStyleAssetUrl("https://tiles.openfreemap.org/planet")).toBe(true);
    expect(isStyleAssetUrl("https://api.tomtom.com/routing/1/calculateRoute")).toBe(false);
  });
});

describe("assetPath — la même police, demandée par la carte ou par le téléchargement", () => {
  it("donne le même fichier avec des espaces nus ou encodés", () => {
    const fromMap = assetPath("https://tiles.openfreemap.org/fonts/Noto Sans Regular/0-255.pbf");
    const fromDownload = assetPath("https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf");
    expect(fromMap).toBe(fromDownload);
  });

  it("ne change pas une adresse sans caractère à normaliser", () => {
    expect(assetPath("https://tiles.openfreemap.org/sprites/ofm_f384/ofm@2x.json")).toBe(
      `assets/${encodeURIComponent("https://tiles.openfreemap.org/sprites/ofm_f384/ofm@2x.json")}`,
    );
  });
});

describe("area — le contour d'une zone en tuiles", () => {
  // Un losange autour de Paris : son rectangle englobant compte bien plus de tuiles.
  const diamond: Area = {
    margin: 0,
    geometry: {
      type: "Polygon",
      coordinates: [[[2.35, 48.75], [2.55, 48.85], [2.35, 48.95], [2.15, 48.85], [2.35, 48.75]]],
    },
  };

  it("sait si un point est dedans", () => {
    expect(areaContains(diamond, 2.35, 48.85)).toBe(true);
    expect(areaContains(diamond, 2.53, 48.93)).toBe(false);
  });

  it("compte exactement ce qu'il énumère jusqu'au zoom 12, et moins que le rectangle", () => {
    const z = 12;
    const counts = areaTileCounts(diamond, z);
    const listed = areaTiles(diamond, z, z);
    expect(counts[z]).toBe(listed.length);
    expect(listed.length).toBeLessThan(countTiles([2.15, 48.75, 2.55, 48.95], z, z));
    expect(listed.length).toBeGreaterThan(0);
  });

  it("au-delà du zoom 12, compte large — jamais moins que le téléchargement", () => {
    // Voulu (voir EXACT_COUNT_ZOOM) : l'estimation du poids reste instantanée
    // et pèche par excès ; le téléchargement, lui, énumère exactement.
    const z = 14;
    const counts = areaTileCounts(diamond, z);
    expect(counts[z]).toBeGreaterThanOrEqual(areaTiles(diamond, z, z).length);
    expect(counts[13]).toBeGreaterThanOrEqual(areaTiles(diamond, 13, 13).length);
  });

  it("rend des tuiles qui touchent toutes le contour", () => {
    for (const tile of areaTiles(diamond, 12, 12)) {
      const [w, s, e, n] = tileBbox(tile);
      const touches =
        areaContains(diamond, (w + e) / 2, (s + n) / 2) ||
        [[w, s], [e, s], [e, n], [w, n]].some(([x, y]) => areaContains(diamond, x, y)) ||
        (w <= 2.35 && 2.35 <= e) ||
        (s <= 48.85 && 48.85 <= n);
      expect(touches).toBe(true);
    }
  });
});
