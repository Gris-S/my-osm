import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config";
import { overpassUrlsFor } from "../src/services/overpass";
import { isOsmService } from "../src/services/native";

// Overpass Europe (3 novembre 2026) : en tête pour une emprise en Europe, jamais
// ailleurs — il y rendrait une réponse vide, prise pour « aucun lieu ».
describe("Overpass — les instances selon l'endroit", () => {
  const europe = CONFIG.OVERPASS_EUROPE.url;

  it("Overpass Europe d'abord pour Paris, Lyon, Berlin", () => {
    expect(overpassUrlsFor([48.79, 2.37, 48.83, 2.42])[0]).toBe(europe);
    expect(overpassUrlsFor([45.74, 4.8, 45.78, 4.87])[0]).toBe(europe);
    expect(overpassUrlsFor([52.5, 13.3, 52.55, 13.45])[0]).toBe(europe);
  });

  it("les seules instances mondiales à New York, Tokyo, sans emprise, ou à cheval sur la limite", () => {
    expect(overpassUrlsFor([40.7, -74.02, 40.75, -73.95])).toEqual(CONFIG.OVERPASS_URLS);
    expect(overpassUrlsFor([35.6, 139.6, 35.7, 139.8])).toEqual(CONFIG.OVERPASS_URLS);
    expect(overpassUrlsFor()).toEqual(CONFIG.OVERPASS_URLS);
    expect(overpassUrlsFor([35, 2, 36, 3])).not.toContain(europe);
  });

  it("passe par le natif avec notre User-Agent, comme les autres services OSM", () => {
    expect(isOsmService(europe)).toBe(true);
  });
});
