import { describe, expect, it } from "vitest";
import { stitch, type BikeRoute } from "../src/services/bikeRouting";

// Valhalla de la FOSSGIS refuse plus de dix points (15 octobre 2026) : un long
// parcours est demandé par morceaux, puis recousu.
const part = (from: number, to: number, source: BikeRoute["source"] = "valhalla"): BikeRoute => ({
  source,
  route: {
    distance: (to - from) * 100,
    duration: (to - from) * 20,
    geometry: { type: "LineString", coordinates: Array.from({ length: to - from + 1 }, (_, i) => [from + i, 0]) },
    legs: Array.from({ length: to - from }, () => ({ steps: [] })),
  },
});

describe("recoudre un parcours vélo demandé par morceaux", () => {
  it("additionne distances, durées et tronçons, sans doubler la jonction", () => {
    const whole = stitch([part(0, 9), part(9, 12)]);
    expect(whole.route.distance).toBe(1200);
    expect(whole.route.duration).toBe(240);
    expect(whole.route.legs).toHaveLength(12);
    expect(whole.route.geometry.coordinates).toHaveLength(13);
    expect(whole.source).toBe("valhalla");
  });

  it("dit le secours dès qu'un morceau en vient", () => {
    expect(stitch([part(0, 9), part(9, 12, "brouter")]).source).toBe("brouter");
  });
});
