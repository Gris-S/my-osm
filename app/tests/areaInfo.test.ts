import { describe, expect, it } from "vitest";
import { areaKm2, sameArea } from "../src/services/areaInfo";
import { parseWikipediaTag, wikiKey } from "../src/services/wikipedia";

describe("fiche d'une ville ou d'un quartier", () => {
  it("un contour n'est retenu que s'il désigne le lieu touché", () => {
    expect(sameArea("Charonne", "Quartier de Charonne")).toBe(true);
    expect(sameArea("14e Arrondissement", "Paris 14e Arrondissement")).toBe(true);
    expect(sameArea("Saint-Maur-des-Fossés", "Saint-Maur-des-Fosses")).toBe(true);
    // Mesuré : au point de « Le Marais », Nominatim rend une autre division.
    expect(sameArea("Le Marais", "Quartier des Archives")).toBe(false);
    expect(sameArea("", "Paris")).toBe(false);
  });

  it("la surface d'un contour, trous retranchés", () => {
    // Un carré de 0,01° à la latitude de Paris : 1,112 km × 0,732 km.
    const square = (lon: number, lat: number, d: number) => [
      [lon, lat],
      [lon + d, lat],
      [lon + d, lat + d],
      [lon, lat + d],
      [lon, lat],
    ];
    const plain = areaKm2({ type: "Polygon", coordinates: [square(2.3, 48.85, 0.01)] });
    expect(plain).toBeGreaterThan(0.8);
    expect(plain).toBeLessThan(0.83);
    const holed = areaKm2({ type: "Polygon", coordinates: [square(2.3, 48.85, 0.01), square(2.302, 48.852, 0.005)] });
    expect(holed).toBeCloseTo(plain * 0.75, 2);
  });
});

describe("références Wikipédia", () => {
  it("la balise wikipedia d'OSM", () => {
    expect(parseWikipediaTag("fr:Musée du Louvre")).toEqual({ lang: "fr", title: "Musée du Louvre" });
    expect(parseWikipediaTag("en:Louvre")).toEqual({ lang: "en", title: "Louvre" });
    expect(parseWikipediaTag("Louvre")).toBeNull();
    expect(parseWikipediaTag(undefined)).toBeNull();
  });

  it("une même clé pour la fiche et pour la zone, par langue", () => {
    expect(wikiKey({ wikidata: "Q19675" }, "fr")).toBe("wiki:v1:fr:Q19675");
    expect(wikiKey({ wikidata: "Q19675", wikipedia: "fr:Musée du Louvre" }, "en")).toBe("wiki:v1:en:Q19675");
    expect(wikiKey({ wikipedia: "fr:Tour Eiffel" }, "fr")).toBe("wiki:v1:fr:Tour Eiffel");
    expect(wikiKey({}, "fr")).toBeNull();
  });
});

describe("titres Wikidata", () => {
  it("un identifiant inconnu ne fait pas perdre tout le lot", async () => {
    const { vi } = await import("vitest");
    const { wikidataTitles } = await import("../src/services/wikipedia");
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const ids = new URL(String(input)).searchParams.get("ids") ?? "";
      seen.push(ids);
      // Comme Wikidata (vérifié) : un seul inconnu, et tout le lot est refusé.
      if (ids.includes("Q999999999999")) {
        return new Response(JSON.stringify({ error: { code: "no-such-entity", id: "Q999999999999" } }));
      }
      const entities = Object.fromEntries(ids.split("|").map((id) => [id, { sitelinks: { frwiki: { title: `Titre ${id}` } } }]));
      return new Response(JSON.stringify({ entities }));
    });
    const titles = await wikidataTitles(["Q243", "Q999999999999", "Q19675"], ["fr"]);
    expect(titles.get("Q243")?.fr).toBe("Titre Q243");
    expect(titles.get("Q19675")?.fr).toBe("Titre Q19675");
    expect(titles.has("Q999999999999")).toBe(false);
    expect(seen).toEqual(["Q243|Q999999999999|Q19675", "Q243|Q19675"]);
    vi.unstubAllGlobals();
  });
});
