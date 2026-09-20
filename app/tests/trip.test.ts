import { describe, expect, it } from "vitest";
import { isTrivialTrip } from "../src/navigation/trip";

// Un guidage lancé puis arrêté aussitôt ne doit laisser aucune trace dans
// l'historique (des « 0 min · 0 m » s'y accumulaient, 18 septembre 2026).
describe("trajet trop court pour être gardé", () => {
  it("écarte un guidage arrêté aussitôt", () => {
    expect(isTrivialTrip({ elapsedSeconds: 0, distanceMeters: 0 })).toBe(true);
  });
  it("écarte un saut de position : 12 km en zéro seconde", () => {
    expect(isTrivialTrip({ elapsedSeconds: 0, distanceMeters: 12_000 })).toBe(true);
  });
  it("écarte une attente sur place", () => {
    expect(isTrivialTrip({ elapsedSeconds: 600, distanceMeters: 20 })).toBe(true);
  });
  it("garde une vraie marche, même courte", () => {
    expect(isTrivialTrip({ elapsedSeconds: 90, distanceMeters: 120 })).toBe(false);
  });
});
