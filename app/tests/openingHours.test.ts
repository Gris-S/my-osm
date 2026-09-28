import { describe, expect, it } from "vitest";
import { computeOpenState, weeklyHours } from "../src/utils/openingHours";

// Le McDonald's des Halles, relevé le vendredi 25 septembre 2026 à 21 h 49 :
// affiché « Fermé » alors qu'il fermait à 4 h du matin.
const HALLES = "Mo-Tu 09:00-01:00; We,Su 09:00-02:00; Th 09:00-03:00; Fr-Sa 09:00-04:00";
const at = (day: number, h: number, m = 0) => new Date(2026, 8, day, h, m); // 21 = lundi

describe("horaires qui enjambent minuit", () => {
  it("ouvert le soir, avant minuit", () => {
    const state = computeOpenState(HALLES, at(25, 21, 49));
    expect(state?.isOpen).toBe(true);
    expect(state?.detail).toContain("04:00");
  });

  it("encore ouvert après minuit, sur la plage de la veille", () => {
    expect(computeOpenState(HALLES, at(26, 2, 30))?.isOpen).toBe(true); // samedi 2 h 30
    expect(computeOpenState(HALLES, at(22, 0, 30))?.isOpen).toBe(true); // mardi 0 h 30 (lundi -> 01:00)
  });

  it("fermé entre la fermeture de nuit et l'ouverture", () => {
    const state = computeOpenState(HALLES, at(26, 5, 0));
    expect(state?.isOpen).toBe(false);
    expect(state?.detail).toContain("09:00");
  });

  it("le tableau affiche l'heure de fermeture du lendemain", () => {
    const friday = weeklyHours(HALLES, at(25, 12))?.days[4];
    expect(friday?.hours).toContain("09:00");
    expect(friday?.hours).toContain("04:00");
  });

  it("la notation « 26:00 » d'OSM se lit comme 2 h du matin", () => {
    expect(computeOpenState("Mo-Su 18:00-26:00", at(26, 1))?.isOpen).toBe(true);
  });

  it("les horaires ordinaires ne changent pas", () => {
    const value = "Mo-Fr 09:00-18:00";
    expect(computeOpenState(value, at(25, 12))?.isOpen).toBe(true);
    expect(computeOpenState(value, at(25, 19))?.isOpen).toBe(false);
    expect(computeOpenState(value, at(26, 1))?.isOpen).toBe(false);
    expect(computeOpenState("24/7", at(26, 1))?.isOpen).toBe(true);
  });
});
