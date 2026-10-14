import { describe, expect, it } from "vitest";
import { journeysFromNavitia, type NavitiaJourney } from "../src/services/transit";
// Vraie réponse de Navitia (IDFM), Châtelet → Chatou - Croissy, 14 octobre 2026, allégée.
import fixture from "./fixtures/navitia-chatelet-chatou.json";

describe("trajets Navitia : montées fantômes", () => {
  const journeys = journeysFromNavitia(fixture as NavitiaJourney[]);
  const lines = (index: number) =>
    journeys[index].legs.filter((leg) => leg.kind === "transit").map((leg) => leg.line?.label);

  it("écarte les montées-descentes sur place et fusionne ce qui ne diffère plus", () => {
    // Cinq propositions : 14 › A, 1 › A, 7 › A (fantômes), A à pied, 4 › A (vraie).
    expect(journeys).toHaveLength(2);
    expect(journeys.map((_, index) => lines(index))).toEqual([["A"], ["4", "A"]]);
  });

  it("recompte les correspondances et garde la marche la plus courte", () => {
    expect(journeys[0].transfers).toBe(0);
    expect(journeys[0].walkingSeconds).toBe(240);
    expect(journeys[1].transfers).toBe(1);
  });

  it("ne laisse aucun tronçon en transport d'un seul arrêt", () => {
    for (const journey of journeys)
      for (const leg of journey.legs) if (leg.kind === "transit") expect(leg.from).not.toBe(leg.to);
  });
});
