import { describe, expect, it } from "vitest";
import { FILTER_GROUPS, groupFromTags, hasTypeIcon, normalizeGroupId, TYPE_ICONS } from "../src/filters";
import { TILE_GAP_TAGS } from "../src/services/tileGaps";

describe("catégories de l'alimentation (30 septembre 2026)", () => {
  it("range les commerces de bouche à part des épiceries", () => {
    for (const shop of ["cheese", "bakery", "pastry", "butcher", "seafood", "greengrocer", "wine", "alcohol", "chocolate"]) {
      expect(groupFromTags({ shop }), shop).toBe("foodshop");
    }
    for (const shop of ["supermarket", "convenience", "grocery", "health_food", "frozen_food"]) {
      expect(groupFromTags({ shop }), shop).toBe("grocery");
    }
  });

  it("met les salles de sport dans « Sport »", () => {
    expect(groupFromTags({ leisure: "fitness_centre" })).toBe("sport");
    expect(groupFromTags({ leisure: "sports_hall" })).toBe("sport");
  });

  it("reprend un ancien réglage « bakery » sous « foodshop »", () => {
    expect(normalizeGroupId("bakery")).toBe("foodshop");
    expect(normalizeGroupId("foodshop")).toBe("foodshop");
    expect(normalizeGroupId("inconnu")).toBeNull();
    expect(normalizeGroupId(42)).toBeNull();
  });
});

describe("ce que les tuiles ne transportent pas", () => {
  it("chaque valeur demandée à Overpass a une catégorie", () => {
    for (const [key, values] of Object.entries(TILE_GAP_TAGS)) {
      for (const value of values) expect(groupFromTags({ [key]: value }), `${key}=${value}`).not.toBeNull();
    }
  });
});

describe("pictogrammes par type", () => {
  it("ne s'appliquent que dans leur catégorie", () => {
    expect(hasTypeIcon("foodshop", "cheese")).toBe(true);
    expect(hasTypeIcon("grocery", "cheese")).toBe(false);
    expect(hasTypeIcon("foodshop", undefined)).toBe(false);
  });

  it("visent des catégories et des valeurs qui existent", () => {
    const ids = new Set(FILTER_GROUPS.map((g) => g.id));
    for (const entry of TYPE_ICONS) expect(ids.has(entry.group), entry.group).toBe(true);
    // Une valeur de commerce avec pictogramme doit être rangée dans le groupe qui porte ce pictogramme.
    for (const entry of TYPE_ICONS.filter((e) => e.group === "foodshop")) {
      expect(groupFromTags({ shop: entry.value }), entry.value).toBe("foodshop");
    }
  });
});
