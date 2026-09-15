import { describe, expect, it } from "vitest";
import type { Place } from "../src/types";
import type { TransitMode } from "../src/transport/model";
import { dedupeStations, groupStops, mergeTransitousStops, similarNames, stationToPlace, type RawStop } from "../src/transport/stopsMerge";
import { tileBounds, tilesForBbox } from "../src/transport/tiles";

const stop = (stopId: string, name: string, lat: number, lon: number, modes: TransitMode[], parentId?: string): RawStop => ({
  stopId,
  parentId,
  name,
  lat,
  lon,
  modes,
});

describe("tuiles XYZ", () => {
  it("retrouve la tuile z15 de Châtelet et son emprise", () => {
    const [tile] = tilesForBbox([48.8615, 2.3465, 48.8623, 2.3473], 15);
    expect(tile).toEqual({ z: 15, x: 16597, y: 11272 });
    const [west, south, east, north] = tileBounds(tile);
    expect(west).toBeLessThan(2.3469);
    expect(east).toBeGreaterThan(2.3469);
    expect(south).toBeLessThan(48.8619);
    expect(north).toBeGreaterThan(48.8619);
  });

  it("classe les tuiles d'une vue de la plus proche du centre à la plus lointaine", () => {
    const [west, south, east, north] = tileBounds({ z: 15, x: 16597, y: 11272 });
    // Une vue centrée sur la tuile, qui déborde un peu sur ses voisines.
    const margin = (east - west) * 0.3;
    const tiles = tilesForBbox([south - margin, west - margin, north + margin, east + margin], 15);
    expect(tiles).toHaveLength(9);
    expect(tiles[0]).toEqual({ z: 15, x: 16597, y: 11272 });
  });
});

describe("un marqueur par station", () => {
  it("compare les noms sans le préfixe de ville ni les mots génériques", () => {
    expect(similarNames("Amsterdam, Centraal Station", "Amsterdam Centraal")).toBe(true);
    expect(similarNames("Genève, gare Cornavin", "Gare Cornavin")).toBe(true);
    expect(similarNames("Genève, Mercier", "Genève")).toBe(false);
    expect(similarNames("Gare du Nord", "Gare de Lyon")).toBe(false);
  });

  it("réunit les quais d'une station sous leur parent (relevé de Genève Cornavin)", () => {
    const parent = "Parentch:1:sloid:87057";
    const stations = groupStops(
      [
        stop("q1", "Genève, gare Cornavin", 46.2099, 6.14295, ["tram", "bus"], parent),
        stop("q2", "Genève, gare Cornavin", 46.2104, 6.14363, ["bus"], parent),
        stop("q3", "Genève, gare Cornavin", 46.20958, 6.14184, ["tram"], parent),
        stop("p1", "Genève, Prairie", 46.2085, 6.1356, ["bus"], "Parentch:1:sloid:92890"),
      ],
      "world",
      0
    );
    expect(stations).toHaveLength(2);
    const cornavin = stations.find((station) => station.originIds[0] === parent)!;
    expect(cornavin.quays).toHaveLength(3);
    expect(cornavin.modes.sort()).toEqual(["bus", "tram"]);
    expect(stationToPlace(cornavin)).toMatchObject({ id: `transitous/${parent}`, group: "transport", rawType: "tram_stop" });
  });

  it("fond deux flux qui décrivent la même gare, pas deux gares voisines", () => {
    const stations = dedupeStations([
      ...groupStops([stop("ns1", "Amsterdam Centraal", 52.3789, 4.9003, ["rail"]), stop("ns2", "Amsterdam Centraal", 52.3790, 4.9001, ["rail"])], "world", 0),
      ...groupStops([stop("gvb1", "Amsterdam, Centraal Station", 52.3781, 4.8998, ["tram"])], "world", 0),
      ...groupStops([stop("far", "Amsterdam, Nieuwmarkt", 52.3725, 4.9005, ["metro"])], "world", 0),
    ]);
    expect(stations.map((station) => station.name)).toEqual(["Amsterdam Centraal", "Amsterdam, Nieuwmarkt"]);
    expect(stations[0].quays).toHaveLength(3);
    expect(stations[0].modes.sort()).toEqual(["rail", "tram"]);
  });

  it("ne dessine que ce qu'OSM n'a pas, dans la vue", () => {
    const osm: Place[] = [
      { id: "node/1", name: "Gare Cornavin", group: "transport", rawType: "station", lat: 46.2102, lon: 6.1424 },
      { id: "node/2", name: "Boulangerie", group: "food", lat: 46.205, lon: 6.14 },
    ];
    const transitous: Place[] = [
      { id: "transitous/a", name: "Genève, gare Cornavin", group: "transport", rawType: "station", lat: 46.2099, lon: 6.1429 },
      { id: "transitous/b", name: "Genève, Prairie", group: "transport", rawType: "bus_stop", lat: 46.2085, lon: 6.1356 },
      { id: "transitous/c", name: "Hors vue", group: "transport", rawType: "bus_stop", lat: 46.3, lon: 6.3 },
      // À 30 m d'un arrêt d'OSM, quel que soit son nom : c'est le même poteau.
      { id: "transitous/d", name: "Autre nom", group: "transport", rawType: "bus_stop", lat: 46.21045, lon: 6.1426 },
    ];
    const merged = mergeTransitousStops(osm, transitous, [46.2, 6.13, 46.22, 6.15]);
    expect(merged.map((place) => place.id)).toEqual(["node/1", "node/2", "transitous/b"]);
  });
});
