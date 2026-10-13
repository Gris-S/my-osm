import { describe, expect, it } from "vitest";
import { buildTransitSteps, scheduledStep } from "../src/navigation/transitSteps";
import { anchoredStep, boardingGate, strayed } from "../src/navigation/transitGuide";
import type { TransitJourney } from "../src/transport/journeyView";

// Le trajet du 8 octobre 2026 : quatre minutes de marche vers l'est jusqu'à
// l'arrêt, puis un bus qui continue vers l'est.
const t = (minute: number) => new Date(2026, 9, 8, 18, minute);
const lat = 48.85;
const stop = { lon: 2.404, lat };
const line = { label: "111", color: "#c8f", textColor: "#000", mode: "Bus" };
const journey: TransitJourney = {
  id: "j",
  departure: t(47),
  arrival: t(58),
  durationSeconds: 660,
  transfers: 0,
  walkingSeconds: 240,
  legs: [
    {
      kind: "walk",
      departure: t(47),
      arrival: t(51),
      durationSeconds: 240,
      to: "Bourbaki",
      geometry: { type: "LineString", coordinates: [[2.4, lat], [2.404, lat]] },
    },
    {
      kind: "transit",
      departure: t(51),
      arrival: t(58),
      durationSeconds: 420,
      from: "Bourbaki",
      to: "Rue des Remises",
      line,
      stops: [
        { name: "Bourbaki", ...stop, at: t(51) },
        { name: "Rue des Remises", lon: 2.43, lat, at: t(58) },
      ],
      geometry: { type: "LineString", coordinates: [[2.404, lat], [2.43, lat]] },
    },
  ],
};
const steps = buildTransitSteps(journey);
// 0 marche · 1 monter · 2 descendre · 3 arrivée
const [WALK, BOARD, ALIGHT] = [0, 1, 2];

describe("anchoredStep — un recalage est une position, pas un décalage", () => {
  it("ne dépasse pas la descente quand l'horaire rattrape un recalage en avance", () => {
    // 18 h 48 : reconnu à l'arrêt, l'horaire en est à la marche.
    const anchor = { index: BOARD, scheduled: scheduledStep(steps, t(48).getTime()) };
    expect(anchoredStep(WALK, anchor)).toBe(BOARD);
    // 18 h 52 : le bus est parti à l'horaire. Avant, on sautait à l'arrivée.
    expect(anchoredStep(scheduledStep(steps, t(52).getTime()), anchor)).toBe(ALIGHT);
  });

  it("garde le retard d'un recalage en arrière", () => {
    expect(anchoredStep(3, { index: 1, scheduled: 2 })).toBe(2);
  });

  it("suit l'horaire sans recalage", () => {
    expect(anchoredStep(2, null)).toBe(2);
  });
});

describe("boardingGate — pas dans le bus tant qu'on est sur le trottoir", () => {
  it("reste sur la marche si l'on n'a pas atteint l'arrêt à l'heure du départ", () => {
    const gate = boardingGate(steps, journey.legs, ALIGHT, { lon: 2.401, lat }, null);
    expect(gate).toMatchObject({ index: WALK, hold: "walking" });
  });

  it("reste sur la montée si l'on attend encore à l'arrêt", () => {
    const gate = boardingGate(steps, journey.legs, ALIGHT, { lon: 2.4041, lat }, null);
    expect(gate).toMatchObject({ index: BOARD, hold: "waiting" });
  });

  it("passe à la descente dès qu'on roule sur la ligne, et s'en souvient", () => {
    const riding = boardingGate(steps, journey.legs, ALIGHT, { lon: 2.41, lat }, null);
    expect(riding).toMatchObject({ index: ALIGHT, hold: null });
    // Un relevé isolé à côté de la ligne ne fait pas redescendre.
    const after = boardingGate(steps, journey.legs, ALIGHT, { lon: 2.41, lat: lat + 0.01 }, riding.memory);
    expect(after).toMatchObject({ index: ALIGHT, hold: null });
  });

  it("laisse passer l'horaire sans relevé (sous terre)", () => {
    expect(boardingGate(steps, journey.legs, ALIGHT, null, null)).toMatchObject({ index: ALIGHT, hold: null });
  });

  it("se fie à l'horaire si l'on a atteint l'arrêt puis qu'on est ailleurs", () => {
    const waiting = boardingGate(steps, journey.legs, BOARD, { lon: 2.4041, lat }, null);
    const gate = boardingGate(steps, journey.legs, ALIGHT, { lon: 2.41, lat: lat + 0.01 }, waiting.memory);
    expect(gate).toMatchObject({ index: ALIGHT, hold: null });
  });
});

describe("strayed — a-t-on quitté le plan ?", () => {
  it("non sur le chemin à pied, oui à deux cents mètres", () => {
    expect(strayed(steps, journey.legs, WALK, { lon: 2.402, lat: lat + 0.0003 })).toBe(false);
    expect(strayed(steps, journey.legs, WALK, { lon: 2.402, lat: lat + 0.002 })).toBe(true);
  });
  it("tolère un tracé de ligne approximatif, pas un autre quartier", () => {
    expect(strayed(steps, journey.legs, ALIGHT, { lon: 2.42, lat: lat + 0.002 })).toBe(false);
    expect(strayed(steps, journey.legs, ALIGHT, { lon: 2.42, lat: lat + 0.006 })).toBe(true);
  });
  it("ne dit rien en attendant sur le quai", () => {
    expect(strayed(steps, journey.legs, BOARD, { lon: 2.5, lat })).toBe(false);
  });
});

describe("fiche d'un arrêt — le passage du trajet suivi", async () => {
  const { boardingAt, sameLineLabel } = await import("../src/transport/journeyFocus");
  it("reconnaît l'arrêt de montée, à deux cents mètres près", () => {
    expect(boardingAt(journey, { lon: 2.4045, lat })).toMatchObject({ label: "111", departure: t(51) });
    expect(boardingAt(journey, { lon: 2.42, lat })).toBeNull();
    expect(boardingAt(null, stop)).toBeNull();
  });
  it("compare les indices de ligne sans la casse", () => {
    expect(sameLineLabel(" a ", "A")).toBe(true);
    expect(sameLineLabel("11", "111")).toBe(false);
  });
});

describe("boardingGate — monté avant l'horaire", () => {
  it("passe à la descente si l'on roule alors que l'horaire attend encore", () => {
    const atStop = boardingGate(steps, journey.legs, BOARD, { lon: 2.4041, lat }, null);
    const rolling = boardingGate(steps, journey.legs, BOARD, { lon: 2.41, lat }, atStop.memory);
    expect(rolling).toMatchObject({ index: ALIGHT, hold: null });
  });
  it("n'y passe pas pour qui longe la ligne sans être passé par l'arrêt", () => {
    expect(boardingGate(steps, journey.legs, BOARD, { lon: 2.41, lat }, null)).toMatchObject({ index: BOARD });
  });
});

describe("ridePosition — le point bleu sur la ligne des stations", async () => {
  const { ridePosition } = await import("../src/navigation/transitGuide");
  const leg = {
    ...journey.legs[1],
    stops: [
      { name: "Bourbaki", lon: 2.404, lat, at: t(51) },
      { name: "Milieu", lon: 2.417, lat, at: t(55) },
      { name: "Rue des Remises", lon: 2.43, lat, at: t(58) },
    ],
  };
  it("suit l'horaire sous terre", () => {
    expect(ridePosition(leg, t(50).getTime(), null)).toBe(0);
    expect(ridePosition(leg, t(53).getTime(), null)).toBeCloseTo(0.5);
    expect(ridePosition(leg, t(55).getTime(), null)).toBe(1);
    expect(ridePosition(leg, t(59).getTime(), null)).toBe(2);
  });
  it("suit le GPS quand on est sur la ligne, même si l'horaire dit autre chose", () => {
    // Trois quarts du premier tronçon, alors que l'horaire n'a pas démarré.
    expect(ridePosition(leg, t(50).getTime(), { lon: 2.41375, lat })).toBeCloseTo(0.75, 1);
    expect(ridePosition(leg, t(50).getTime(), { lon: 2.4235, lat })).toBeCloseTo(1.5, 1);
  });
  it("revient à l'horaire si le relevé est loin de la ligne", () => {
    expect(ridePosition(leg, t(53).getTime(), { lon: 2.41, lat: lat + 0.01 })).toBeCloseTo(0.5);
  });
  it("ne dit rien sans desserte", () => {
    expect(ridePosition({ ...leg, stops: undefined }, t(53).getTime(), null)).toBeNull();
  });
});
