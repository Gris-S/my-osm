import { describe, expect, it } from "vitest";
import { buildTransitSteps, connectionTo, exitWanted } from "../src/navigation/transitSteps";
import type { TransitJourney, TransitLeg, TransitLine } from "../src/transport/journeyView";

// La sortie de station ne se dit qu'en allant dehors (capture d'Auber,
// 18 septembre 2026). Les cas sont ceux mesurés sur Navitia le 19 septembre.

const rer: TransitLine = { label: "A", color: "#e3051c", textColor: "#fff", mode: "RER" };
const metro: TransitLine = { label: "9", color: "#d5c900", textColor: "#000", mode: "Métro" };
const bus: TransitLine = { label: "111", color: "#d282be", textColor: "#fff", mode: "Bus" };

let clock = Date.UTC(2026, 8, 18, 18, 0);
function leg(kind: "walk" | "transit", line?: TransitLine, connection?: boolean): TransitLeg {
  const departure = new Date(clock);
  clock += 5 * 60_000;
  return { kind, departure, arrival: new Date(clock), durationSeconds: 300, from: "A", to: "B", line, connection };
}

function journey(legs: TransitLeg[]): TransitJourney {
  return {
    id: "t",
    departure: legs[0].departure,
    arrival: legs[legs.length - 1].arrival,
    durationSeconds: 0,
    transfers: 0,
    walkingSeconds: 0,
    legs,
  };
}

/** `exitWanted` à la première descente du trajet. */
function atFirstAlight(legs: TransitLeg[]): boolean {
  const steps = buildTransitSteps(journey(legs));
  return exitWanted(steps, steps.findIndex((step) => step.kind === "alight"), legs);
}

describe("sortie de station", () => {
  it("se tait sur une correspondance déclarée vers un mode fermé (Auber → Havre-Caumartin)", () => {
    expect(atFirstAlight([leg("transit", rer), leg("walk", undefined, true), leg("transit", metro)])).toBe(false);
  });

  it("se tait sur une correspondance dans la même station, sans marche", () => {
    expect(atFirstAlight([leg("transit", metro), leg("transit", metro)])).toBe(false);
  });

  it("se dit quand la marche vers le métro suivant passe par la rue (Concorde → Madeleine)", () => {
    expect(atFirstAlight([leg("transit", metro), leg("walk", undefined, false), leg("transit", metro)])).toBe(true);
  });

  it("se dit vers un bus, même par une correspondance déclarée", () => {
    expect(atFirstAlight([leg("transit", rer), leg("walk", undefined, true), leg("transit", bus)])).toBe(true);
  });

  it("se dit à la dernière descente, vers la destination", () => {
    expect(atFirstAlight([leg("transit", metro), leg("walk", undefined, false)])).toBe(true);
  });

  it("ne se dit jamais en descendant d'un bus", () => {
    expect(atFirstAlight([leg("transit", bus), leg("walk", undefined, false)])).toBe(false);
  });

  it("suit la règle des modes quand la source ne dit pas le type de marche", () => {
    expect(atFirstAlight([leg("transit", rer), leg("walk"), leg("transit", metro)])).toBe(false);
  });
});

describe("indication de correspondance", () => {
  const first = (legs: TransitLeg[]) => {
    const steps = buildTransitSteps(journey(legs));
    return connectionTo(steps, steps.findIndex((step) => step.kind === "alight"), legs);
  };

  it("nomme la ligne à rejoindre quand on reste dans la station (Auber → 9)", () => {
    expect(first([leg("transit", rer), leg("walk", undefined, true), leg("transit", metro)])?.label).toBe("9");
  });

  it("se tait quand une sortie se dit", () => {
    expect(first([leg("transit", metro), leg("walk", undefined, false), leg("transit", metro)])).toBeNull();
    expect(first([leg("transit", rer), leg("walk", undefined, true), leg("transit", bus)])).toBeNull();
  });
});
