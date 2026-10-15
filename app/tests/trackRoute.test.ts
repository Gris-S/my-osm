import { describe, expect, it } from "vitest";
import { trackFrom, trackNavRoute } from "../src/navigation/trackRoute";
import { maneuverText } from "../src/navigation/maneuver";

// Une trace en L : 1 km vers l'est, puis 1 km vers le nord.
const east = Array.from({ length: 11 }, (_, i) => ({ lon: 2 + i * 0.00137, lat: 48.8 }));
const north = Array.from({ length: 10 }, (_, i) => ({ lon: east[10].lon, lat: 48.8 + (i + 1) * 0.0009 }));
const track = [...east, ...north];

describe("le guidage sur une trace", () => {
  it("dit les consignes du fichier, à leur place sur la trace", () => {
    const route = trackNavRoute(track, [{ lon: east[10].lon, lat: 48.8001, name: "Tournez à gauche sur Rue de B" }, { ...north[9], name: "End" }], "walking", null);
    expect(route.steps.map((step) => step.maneuver.type)).toEqual(["depart", "turn", "arrive"]);
    const turn = route.steps[1];
    expect(maneuverText(turn.maneuver)).toBe("Tournez à gauche sur Rue de B");
    expect(turn.maneuver.modifier).toBe("left");
    expect(turn.atMeters).toBeGreaterThan(980);
    expect(turn.atMeters).toBeLessThan(1030);
    expect(route.points).toHaveLength(track.length);
  });

  it("sans consignes, lit les virages de la trace", () => {
    const route = trackNavRoute(track, [], "cycling", null);
    const turns = route.steps.filter((step) => step.maneuver.type === "turn");
    expect(turns).toHaveLength(1);
    expect(turns[0].maneuver.modifier).toBe("left");
    // À vélo, 15 km/h : 2 km en 8 minutes environ.
    expect(route.durationSeconds).toBeGreaterThan(400);
    expect(route.durationSeconds).toBeLessThan(560);
  });

  it("rejoint la trace au plus près après un écart", () => {
    const rest = trackFrom(track, { lon: east[5].lon, lat: 48.801 });
    expect(rest.length).toBeLessThan(track.length);
    expect(rest[0].lon).toBeCloseTo(east[5].lon, 3);
    expect(rest[rest.length - 1]).toEqual(north[9]);
  });
});
