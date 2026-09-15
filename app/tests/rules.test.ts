import { beforeEach, describe, expect, it } from "vitest";
import { NOT_OVER, nextOverSpeed, OVER_SPEED_FIXES } from "../src/navigation/car/useSpeedState";
import { rerouteRetryDelayMs } from "../src/navigation/progress";
import { tripListTitle } from "../src/navigation/trip";
import { clearJournal, note, readJournal } from "../src/navigation/journal";
import type { Trip } from "../src/navigation/history";
import { remainingStops, scheduledStep, type TransitStep } from "../src/navigation/transitSteps";
import type { TransitLeg } from "../src/services/transit";

describe("nextOverSpeed — l'indicateur de dépassement ne clignote pas", () => {
  it(`ne passe au rouge qu'après ${OVER_SPEED_FIXES} relevés d'affilée au-dessus`, () => {
    let state = NOT_OVER;
    state = nextOverSpeed(state, { above: true, stale: false });
    expect(state.over).toBe(false);
    state = nextOverSpeed(state, { above: true, stale: false });
    expect(state.over).toBe(true);
  });

  it("oublie un franchissement passager", () => {
    let state = nextOverSpeed(NOT_OVER, { above: true, stale: false });
    state = nextOverSpeed(state, { above: false, stale: false });
    expect(state).toEqual(NOT_OVER);
  });

  it("repasse au vert de la même façon, et s'efface sur un relevé périmé", () => {
    const over = { over: true, streak: 0 };
    expect(nextOverSpeed(over, { above: false, stale: false }).over).toBe(true);
    expect(nextOverSpeed(over, { above: true, stale: true })).toEqual(NOT_OVER);
  });

  it("rend le même objet quand rien ne change : pas de rendu pour rien", () => {
    expect(nextOverSpeed(NOT_OVER, { above: false, stale: false })).toBe(NOT_OVER);
  });
});

describe("rerouteRetryDelayMs — l'attente après un recalcul raté", () => {
  it("double de 5 s en 5 s, jusqu'à une minute", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(rerouteRetryDelayMs)).toEqual([0, 5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });
});

describe("tripListTitle — la date d'un trajet selon la langue", () => {
  const trip = { startedAt: new Date(2026, 8, 14, 8, 32).getTime() } as Trip;

  it("écrit jj/mm/aa en français", () => {
    expect(tripListTitle(trip, "fr-FR")).toBe("14/09/26 · 08:32");
  });

  it("écrit mm/jj/aa en anglais, même avec la locale britannique", () => {
    expect(tripListTitle(trip, "en-GB")).toBe("09/14/26 · 08:32");
  });
});

describe("journal — une queue courte, versée dans l'archive", () => {
  beforeEach(() => clearJournal());

  it("garde tout, dans l'ordre, à travers la bascule de la queue", () => {
    for (let i = 0; i < 600; i++) note("test", { i });
    const entries = readJournal();
    expect(entries).toHaveLength(600);
    expect(entries[599].d).toEqual({ i: 599 });
    // La queue a débordé : elle est vide, et l'archive porte tout.
    expect(JSON.parse(localStorage.getItem("osm-local:nav-journal:queue") ?? "null")).toEqual([]);
    note("test", { i: 600 });
    expect(readJournal()).toHaveLength(601);
    expect(JSON.parse(localStorage.getItem("osm-local:nav-journal:queue") ?? "[]")).toHaveLength(1);
  });

  it("ne garde que les 5 000 dernières entrées", () => {
    for (let i = 0; i < 5_200; i++) note("test", { i });
    const entries = readJournal();
    expect(entries).toHaveLength(5_000);
    expect(entries[0].d).toEqual({ i: 200 });
    expect(entries[4_999].d).toEqual({ i: 5_199 });
  });
});

describe("transports — l'horloge fait avancer le trajet", () => {
  const at = (minutes: number) => new Date(2026, 8, 14, 8, minutes);
  const steps = [at(0), at(5), at(12)].map((when) => ({ at: when }) as TransitStep);

  it("prend la dernière action dont l'heure est passée", () => {
    expect(scheduledStep(steps, at(0).getTime() - 1)).toBe(0);
    expect(scheduledStep(steps, at(7).getTime())).toBe(1);
    expect(scheduledStep(steps, at(12).getTime())).toBe(2);
  });

  it("compte les arrêts qui restent avant la descente, montée exclue", () => {
    const leg = { stops: [at(0), at(2), at(4), at(6)].map((when) => ({ at: when })) } as TransitLeg;
    expect(remainingStops(leg, at(1).getTime())).toBe(3);
    expect(remainingStops(leg, at(5).getTime())).toBe(1);
    expect(remainingStops({ stops: [] } as unknown as TransitLeg, at(5).getTime())).toBeNull();
  });
});
