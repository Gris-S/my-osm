import { describe, expect, it } from "vitest";
import { editDistance, normalizeText, textScore } from "../src/search/textMatch";
import { buildDictionaries, matchBrands, matchCategory, wantedLanguages } from "../src/search/dictionaries";
import { photonSearchUrl } from "../src/services/geocode";
import { proximityScale, rankResults } from "../src/search/rank";
import type { Place } from "../src/types";

// La recherche refaite le 3 novembre 2026 (demande explicite : « lente et peu
// précise ») : fautes tolérées, catégories, enseignes, proximité du point
// regardé. Voir `search/` et `hooks/usePlaceSearch.ts`.

const place = (id: string, name: string, lon: number, lat: number, rawType?: string): Place => ({
  id, name, lon, lat, group: rawType ? "health" : null, rawType,
} as Place);

describe("recherche — le texte", () => {
  it("ignore accents, casse et ponctuation", () => {
    expect(normalizeText("  Pâtisserie-Crèmerie L'ÉTOILE ")).toBe("patisserie cremerie l etoile");
  });

  it("compte les fautes, inversions comprises", () => {
    expect(editDistance("boulangerie", "boulangeire")).toBe(1);
    expect(editDistance("pharmacie", "pharmacie")).toBe(0);
    expect(editDistance("abc", "xyzuvw")).toBeGreaterThan(2);
  });

  it("trouve un début de mot, plusieurs mots, une faute sur un mot long", () => {
    expect(textScore("boul mar", "Boulangerie Martin")).toBeGreaterThan(0.7);
    expect(textScore("boulangeire", "Boulangerie Martin")).toBeGreaterThan(0.5);
    expect(textScore("pharmaci", "Pharmacie du Marais")).toBeGreaterThan(0.7);
    expect(textScore("Boulangerie Martin", "Boulangerie Martin")).toBe(1);
  });

  it("refuse un mot court mal tapé et un mot absent", () => {
    expect(textScore("bal", "Boulangerie")).toBe(0);
    expect(textScore("fnac", "Pharmacie du Marais")).toBe(0);
    expect(textScore("boulangerie lyon", "Boulangerie Martin")).toBe(0);
  });
});

describe("recherche — catégories et enseignes", () => {
  const dict = buildDictionaries(
    [
      [["amenity=pharmacy", ["pharmacie", "parapharmacie"]], ["shop=bakery", ["boulangerie"]], ["amenity=bar", ["bar"]], ["amenity=bank", ["banque"]]],
      [["amenity=pharmacy", ["pharmacy", "chemist"]], ["shop=bakery", ["bakery"]]],
    ],
    [["McDonald's", "macdo", "mcdo"], ["Lidl"], ["Lidl Express"], ["Fnac"], ["Decathlon"]]
  );

  it("le nom d'une catégorie l'emporte sur un synonyme ; un synonyme partagé est ambigu", () => {
    const d = buildDictionaries(
      [[["amenity=cafe", ["café", "restaurant", "station"]], ["amenity=restaurant", ["restaurant"]], ["amenity=fuel", ["station-service", "station"]], ["craft=tiler", ["carreleur"]]]],
      [["Carrefour"]]
    );
    expect(matchCategory(d, "restaurant")).toMatchObject({ value: "restaurant" });
    expect(matchCategory(d, "station")).toBeNull();
    expect(matchCategory(d, "carrefour")).toBeNull(); // une enseigne, pas « carreleur » mal tapé
  });

  it("reconnaît une catégorie entière, au pluriel, dans une autre langue", () => {
    expect(matchCategory(dict, "Pharmacies")).toMatchObject({ key: "amenity", value: "pharmacy", exact: true });
    expect(matchCategory(dict, "bakery")).toMatchObject({ value: "bakery", exact: true });
    expect(matchCategory(dict, "bar")).toMatchObject({ value: "bar", exact: true });
  });

  it("comprend une faute sur une catégorie entière, pas sur un mot court", () => {
    expect(matchCategory(dict, "boulangeire")).toMatchObject({ value: "bakery", exact: true });
    expect(matchCategory(dict, "phramacie")).toMatchObject({ value: "pharmacy", exact: true });
    expect(matchCategory(dict, "bra")).toBeNull();
  });

  it("reconnaît un début de catégorie dès quatre lettres, sans le prendre pour la catégorie entière", () => {
    expect(matchCategory(dict, "boulang")).toMatchObject({ value: "bakery", exact: false });
    expect(matchCategory(dict, "ba")).toBeNull();
    expect(matchCategory(dict, "tour eiffel")).toBeNull();
  });

  it("reconnaît une enseigne par son nom, un surnom, ou son début", () => {
    expect(matchBrands(dict, "fnac")).toEqual(["Fnac"]);
    expect(matchBrands(dict, "macdo")).toEqual(["McDonald's"]);
    expect(matchBrands(dict, "lid")).toEqual(["Lidl"]);
    expect(matchBrands(dict, "lidl ex")).toEqual(["Lidl Express"]);
    expect(matchBrands(dict, "decath")).toEqual(["Decathlon"]);
    expect(matchBrands(dict, "x")).toEqual([]);
  });

  it("charge les langues du téléphone puis l'anglais, sans doublon", () => {
    const langs = wantedLanguages(["fr-FR", "de"]);
    expect(langs[0]).toBe("fr");
    expect(langs).toContain("de");
    expect(langs).toContain("en");
    expect(wantedLanguages(["en-US"])).toEqual(["en", "fr"]);
    expect(new Set(langs).size).toBe(langs.length);
  });
});

describe("recherche — Photon", () => {
  const near = { lon: 4.8357, lat: 45.764 };

  it("passe le zoom de la vue, borné, et la prime à la notoriété d'un nom", () => {
    const url = new URL(photonSearchUrl("tour eiffel", near, { zoom: 12.4 }));
    expect(url.searchParams.get("zoom")).toBe("12");
    expect(url.searchParams.get("location_bias_scale")).toBe("0.2");
    expect(url.searchParams.get("osm_tag")).toBeNull();
    expect(new URL(photonSearchUrl("x", near, { zoom: 2 })).searchParams.get("zoom")).toBe("5");
    expect(new URL(photonSearchUrl("x", near, { zoom: 20 })).searchParams.get("zoom")).toBe("17");
  });

  it("une catégorie : aucune notoriété, filtre sur son tag, autour du point regardé", () => {
    const url = new URL(photonSearchUrl("pharmacie", near, { zoom: 15, category: { key: "amenity", value: "pharmacy" } }));
    expect(url.searchParams.get("location_bias_scale")).toBe("0");
    expect(url.searchParams.get("osm_tag")).toBe("amenity:pharmacy");
    expect(url.searchParams.get("lat")).toBe("45.76400");
  });
});

describe("recherche — le classement", () => {
  const focus = { lon: 2.3522, lat: 48.8566 };

  it("l'échelle de proximité suit le zoom", () => {
    expect(proximityScale(14)).toBe(2500);
    expect(proximityScale(10)).toBeGreaterThan(proximityScale(14));
  });

  it("une catégorie : ses lieux du plus proche au plus loin, d'où qu'ils viennent, sans doublon", () => {
    const near = place("node/1", "Pharmacie A", 2.353, 48.857, "pharmacy");
    const far = place("node/2", "Pharmacie B", 2.4, 48.9, "pharmacy");
    const unnamedWord = place("node/3", "Maison Martin", 2.3525, 48.8567, "pharmacy");
    const other = place("node/4", "Arrêt Pharmacie", 2.36, 48.86);
    const out = rankResults({
      query: "pharmacie", focus, zoom: 15,
      local: [{ place: far, text: 1, meters: 6000 }],
      remote: [far, other, near],
      category: { value: "pharmacy", places: [unnamedWord, near] },
    });
    expect(out.map((p) => p.id)).toEqual(["node/3", "node/1", "node/2", "node/4"]);
  });

  it("un nom : le lieu proche de la carte passe devant un homonyme lointain, Photon garde ce qui est connu", () => {
    const local = place("node/10", "Boulangerie Martin", 2.3525, 48.8568, "bakery");
    const farNamesake = place("node/11", "Boulangerie Martin", 5.37, 43.29, "bakery");
    const famous = place("way/12", "Tour Eiffel", 2.2945, 48.8584);
    const out = rankResults({
      query: "boulangerie martin", focus, zoom: 14,
      local: [{ place: local, text: 1, meters: 30 }],
      remote: [farNamesake, famous],
    });
    expect(out[0].id).toBe("node/10");
    expect(out.map((p) => p.id)).toContain("way/12");
  });

  it("le même lieu venu de la carte et de Photon ne compte qu'une fois", () => {
    const a = place("node/20", "Café de Flore", 2.3326, 48.854);
    const b = { ...a, id: "poi/2.332600,48.854000" };
    const out = rankResults({ query: "flore", focus, zoom: 14, local: [{ place: b, text: 0.8, meters: 1500 }], remote: [a] });
    expect(out).toHaveLength(1);
  });
});
