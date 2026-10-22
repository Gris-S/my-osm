import { afterEach, describe, expect, it, vi } from "vitest";
import { searchPlacesDetailed } from "../src/services/geocode";

// Relecture F-Droid du 21 octobre 2026 : la WebView coincée « hors ligne »
// (`navigator.onLine` faux, `fetch` en échec) alors que le téléphone a du
// réseau. La recherche doit alors passer par le natif, comme les tuiles.

describe("recherche — le secours natif quand la WebView se croit hors ligne", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("interroge Photon par le natif et rend ses lieux", async () => {
    const request = vi.fn(async () => ({
      status: 200,
      headers: { "Content-Type": "application/json" },
      data: {
        features: [
          {
            geometry: { type: "Point", coordinates: [15.4383, 47.0707] },
            properties: { osm_type: "W", osm_id: 1, name: "Hauptplatz", city: "Graz", country: "Austria" },
          },
        ],
      },
    }));
    vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true, Plugins: { CapacitorHttp: { request } } } });
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));

    const { places, degraded } = await searchPlacesDetailed("Hauptplatz");
    expect(request).toHaveBeenCalledOnce();
    expect(places[0]?.name).toBe("Hauptplatz");
    expect(degraded).toBe(false);
  });
});
