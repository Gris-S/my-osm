import { describe, expect, it } from "vitest";
import type { TransitJourney, TransitLeg } from "../src/transport/journeyView";
import { getOffTime, retimeLeg } from "../src/navigation/transitSteps";

// Le 14 octobre 2026 : métro 9 prévu à 18 h 58, pris celui d'avant.
const t0 = new Date(2026, 9, 14, 18, 50).getTime();
const time = (minutes: number) => new Date(t0 + minutes * 60_000);
const stop = (name: string, minutes: number) => ({ name, lon: 2.3, lat: 48.85, at: time(minutes) });
const line = { label: "9", color: "#d5c900", textColor: "#000", mode: "Métro" };

const legs: TransitLeg[] = [
  { kind: "walk", departure: time(0), arrival: time(5), durationSeconds: 300, to: "Havre-Caumartin" },
  { kind: "transit", departure: time(8), arrival: time(23), durationSeconds: 900, from: "Havre-Caumartin", to: "Ranelagh", line, stops: [stop("Havre-Caumartin", 8), stop("Alma", 15), stop("Ranelagh", 23)] },
  { kind: "walk", departure: time(23), arrival: time(27), durationSeconds: 240, to: "Arrivée" },
];
const journey = { id: "essai", departure: time(0), arrival: time(27), durationSeconds: 27 * 60, transfers: 0, walkingSeconds: 540, legs } as TransitJourney;

describe("recalage sur le train réellement pris", () => {
  it("décale la ligne, ses arrêts, la marche qui suit et l'arrivée", () => {
    const next = retimeLeg(journey, 1, time(5));
    expect(next.legs[0]).toBe(legs[0]);
    expect(next.legs[1].departure).toEqual(time(5));
    expect(next.legs[1].stops?.map((s) => s.at)).toEqual([time(5), time(12), time(20)]);
    expect(next.legs[2].arrival).toEqual(time(24));
    expect(next.arrival).toEqual(time(24));
  });

  it("laisse son horaire au véhicule suivant", () => {
    const withBus: TransitJourney = {
      ...journey,
      legs: [...legs, { kind: "transit", departure: time(30), arrival: time(40), durationSeconds: 600, line }],
      arrival: time(40),
    };
    const next = retimeLeg(withBus, 1, time(5));
    expect(next.legs[2].arrival).toEqual(time(24));
    expect(next.legs[3].departure).toEqual(time(30));
    expect(next.arrival).toEqual(time(40));
  });
});

describe("l'heure de l'alerte de descente", () => {
  it("au départ de l'avant-dernière station", () => {
    expect(getOffTime(legs[1])).toBe(time(15).getTime());
  });

  it("suit le train réellement pris", () => {
    expect(getOffTime(retimeLeg(journey, 1, time(5)).legs[1])).toBe(time(12).getTime());
  });

  it("sans desserte connue, 90 s avant l'arrivée", () => {
    expect(getOffTime({ ...legs[1], stops: undefined })).toBe(time(23).getTime() - 90_000);
  });
});
