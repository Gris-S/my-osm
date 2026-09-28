import { describe, expect, it } from "vitest";
import type { TransitJourney, TransitLeg, TransitStop } from "../src/transport/journeyView";
import { buildTransitSteps, DWELL_MS, resyncStep, type ResyncMemory } from "../src/navigation/transitSteps";
import { compassHeading } from "../src/navigation/compass";

// Un trajet fictif, en ligne droite vers l'est : un point tous les 0,01° de
// longitude, soit environ 730 m — assez pour que rien ne se confonde.
//   marche → A, T1 : A → a1 → B, T2 : B → b1 → b2 → C, T3 : C → c1 → D
const LAT = 48.85;
const at = (x: number) => ({ lon: 2.3 + x * 0.01, lat: LAT });
const t0 = new Date(2026, 8, 28, 10, 0).getTime();
const time = (minutes: number) => new Date(t0 + minutes * 60_000);
const stop = (name: string, x: number, minutes: number): TransitStop => ({ name, ...at(x), at: time(minutes) });
const line = (label: string) => ({ label, color: "#000", textColor: "#fff", mode: "bus" });

const legs: TransitLeg[] = [
  { kind: "walk", departure: time(0), arrival: time(5), durationSeconds: 300, to: "A", geometry: { type: "LineString", coordinates: [[at(-1).lon, LAT], [at(0).lon, LAT]] } },
  { kind: "transit", departure: time(6), arrival: time(12), durationSeconds: 360, from: "A", to: "B", line: line("T1"), stops: [stop("A", 0, 6), stop("a1", 1, 9), stop("B", 2, 12)] },
  { kind: "transit", departure: time(15), arrival: time(25), durationSeconds: 600, from: "B", to: "C", line: line("T2"), stops: [stop("B", 2, 15), stop("b1", 3, 18), stop("b2", 4, 21), stop("C", 5, 25)] },
  { kind: "transit", departure: time(28), arrival: time(34), durationSeconds: 360, from: "C", to: "D", line: line("T3"), stops: [stop("C", 5, 28), stop("c1", 6, 31), stop("D", 7, 34)] },
];
const journey: TransitJourney = {
  id: "essai",
  departure: time(0),
  arrival: time(34),
  durationSeconds: 34 * 60,
  transfers: 2,
  walkingSeconds: 300,
  legs,
} as TransitJourney;
const steps = buildTransitSteps(journey);
// 0 marche → A · 1 monter T1 · 2 descendre T1 à B · 3 monter T2 · 4 descendre T2 à C
// 5 monter T3 · 6 descendre T3 à D · 7 arrivée
const ALIGHT_T2 = 4;
const BOARD_T2 = 3;

/** Rejoue une suite de relevés et rend l'action finale. */
function replay(start: number, fixes: { x: number; s: number }[]): number {
  let index = start;
  let memory: ResyncMemory | null = null;
  for (const fix of fixes) {
    const result = resyncStep(steps, legs, at(fix.x), index, t0 + fix.s * 1000, memory);
    memory = result.memory;
    if (result.index !== null) index = result.index;
  }
  return index;
}

describe("recalage du guidage en transports par le GPS", () => {
  it("le découpage attendu", () => {
    expect(steps.map((s) => s.kind)).toEqual(["walk", "board", "alight", "board", "alight", "board", "alight", "arrive"]);
  });

  it("près du plan, un relevé suffit : arrivé à A, on monte dans T1", () => {
    expect(replay(0, [{ x: 0, s: 0 }])).toBe(1);
  });

  it("dans T1, passer son arrêt intermédiaire mène à sa descente", () => {
    expect(replay(1, [{ x: 1, s: 0 }])).toBe(2);
  });

  it("pris une autre ligne : deux arrêts de T2 passés, le guidage se met sur T2", () => {
    // Le guidage attend encore la marche vers T1 ; on roule dans T2.
    expect(replay(0, [{ x: 3, s: 0 }, { x: 3.5, s: 90 }, { x: 4, s: 180 }])).toBe(ALIGHT_T2);
  });

  it("un seul arrêt de T2 ne suffit pas", () => {
    expect(replay(0, [{ x: 3, s: 0 }, { x: 3.5, s: 20 }])).toBe(0);
  });

  it("arrivé à l'arrêt de T2 par un autre chemin : on s'y recale après l'avoir attendu", () => {
    const wait = DWELL_MS / 1000;
    expect(replay(0, [{ x: 2, s: 0 }, { x: 2, s: wait / 2 }])).toBe(0);
    expect(replay(0, [{ x: 2, s: 0 }, { x: 2, s: wait / 2 }, { x: 2, s: wait + 1 }])).toBe(BOARD_T2);
  });

  it("passer à pied devant un arrêt lointain ne fait pas sauter le trajet", () => {
    expect(replay(0, [{ x: 2, s: 0 }, { x: 2, s: 10 }, { x: 1.5, s: 40 }, { x: 2, s: 45 }])).toBe(0);
  });

  it("deux arrêts dans le mauvais sens ne prouvent rien", () => {
    expect(replay(0, [{ x: 4, s: 0 }, { x: 3, s: 180 }])).toBe(0);
  });

  it("jamais plus d'une action en arrière", () => {
    // Dans T2 (descente à C), revenir près de A ne ramène pas au début.
    expect(replay(ALIGHT_T2, [{ x: 0, s: 0 }, { x: 0, s: 120 }])).toBe(ALIGHT_T2);
  });

  it("le recalage marche aussi vers la ligne suivante, T3", () => {
    expect(replay(1, [{ x: 6, s: 0 }, { x: 6, s: 60 }])).toBe(6);
  });
});

describe("cap de la boussole", () => {
  it("à plat, le haut de l'écran : alpha tourne dans le sens inverse", () => {
    expect(compassHeading(0, 0, 0)).toBeCloseTo(0);
    expect(compassHeading(90, 0, 0)).toBeCloseTo(270);
    expect(compassHeading(270, 0, 0)).toBeCloseTo(90);
  });

  it("tenu droit devant soi, le dos du téléphone", () => {
    expect(compassHeading(0, 90, 0)).toBeCloseTo(0);
    expect(compassHeading(90, 90, 0)).toBeCloseTo(270);
  });

  it("incliné à 45°, les deux directions s'accordent", () => {
    expect(compassHeading(30, 45, 0)).toBeCloseTo(330);
  });
});
