import { describe, expect, it } from "vitest";
import { pickPoi, poiSortKey } from "../src/components/map/poiPick";

// Les pastilles qui se chevauchent : laquelle un toucher désigne. Cas d'origine
// (29 septembre 2026) : le Centre Pompidou et sa boutique, à 8 px l'un de
// l'autre ; toucher le musée ouvrait la boutique.

const museum = { id: "way/55503397", rank: 227, x: 258, y: 506 };
const shop = { id: "node/8676118624", rank: 371, x: 251, y: 503 };

describe("pickPoi", () => {
  it("deux pastilles presque confondues : la plus importante gagne", () => {
    // Touché entre les deux : aucune n'est nettement plus proche.
    expect(pickPoi([shop, museum], 255, 505)?.id).toBe(museum.id);
    // L'ordre renvoyé par MapLibre ne compte plus.
    expect(pickPoi([museum, shop], 255, 505)?.id).toBe(museum.id);
  });

  it("viser le bord visible de la petite pastille la choisit", () => {
    const near = { id: "a", rank: 500, x: 100, y: 100 };
    const important = { id: "b", rank: 10, x: 118, y: 100 };
    expect(pickPoi([important, near], 96, 100)?.id).toBe("a");
  });

  it("rien sous le doigt : rien", () => {
    expect(pickPoi([], 0, 0)).toBeNull();
  });
});

describe("poiSortKey", () => {
  it("s'inverse quand les pastilles se chevauchent, pour mettre l'important dessus", () => {
    expect(poiSortKey(false)).toEqual(["step", ["zoom"], ["get", "rank"], 15, ["-", 0, ["get", "rank"]]]);
    // Recherche d'enseigne : tout est toujours dessiné, donc toujours inversé.
    expect(poiSortKey(true)).toEqual(["-", 0, ["get", "rank"]]);
  });
});
