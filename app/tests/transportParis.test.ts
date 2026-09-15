import { describe, expect, it } from "vitest";
import { t } from "../src/i18n";
import { MODE_COLORS, toLineDepartures } from "../src/transport/departuresView";
import type { DepartureGroup } from "../src/transport/model";
import { TransportOrchestrator } from "../src/transport/orchestrator";
import { REGIONS } from "../src/transport/registry";

const provenance = { source: "idfm", fetchedAt: 0, attribution: "idfm", originIds: [] };

function group(lineId: string, label: string, destination: string, minutesFromNow: number[], realtime = true, color?: string): DepartureGroup {
  const now = 1_000_000;
  return {
    destination,
    line: { id: lineId, shortName: label, mode: "regional-rail", color, textColor: color ? "#ffffff" : undefined },
    departures: minutesFromNow.map((minutes) => ({
      ...provenance,
      dataQuality: realtime ? ("realtime" as const) : ("scheduled" as const),
      lineId,
      destination,
      scheduledAt: now + minutes * 60000,
      expectedAt: realtime ? now + minutes * 60000 : undefined,
      cancelled: false,
    })),
  };
}

describe("fiche d'un arrêt : du modèle canonique à l'écran (Paris inchangé)", () => {
  it("regroupe par ligne dans l'ordre rendu par la source, destinations comprises", () => {
    const groups = [
      group("paris:line:IDFM:C01742", "A", "Saint-Germain-en-Laye", [0, 4], true, "#eb2132"),
      group("paris:line:IDFM:C01743", "B", "Aéroport CDG", [3], true, "#5091cb"),
      group("paris:line:IDFM:C01742", "A", "Marne-la-Vallée", [2], true, "#eb2132"),
    ];
    const lines = toLineDepartures(groups, 1_000_000);
    expect(lines.map((line) => line.label)).toEqual(["A", "B"]);
    expect(lines[0].groups.map((g) => g.key)).toEqual(["Saint-Germain-en-Laye", "Marne-la-Vallée"]);
    expect(lines[0].groups[0].label).toBe(t("departures.towards", { destination: "Saint-Germain-en-Laye" }));
    expect(lines[0].groups[0].departures.map((d) => d.minutes)).toEqual([0, 4]);
    expect(lines[0].color).toBe("#eb2132");
    expect(lines[0].lineId).toBe("paris:line:IDFM:C01742");
  });

  it("dit si un passage est en temps réel, et donne sa couleur de mode à une ligne qui n'en a pas", () => {
    const [line] = toLineDepartures([group("world:line:x", "12", "Centre", [5], false)], 1_000_000);
    expect(line.groups[0].departures[0].realtime).toBe(false);
    expect(line.color).toBe(MODE_COLORS["regional-rail"].color);
  });
});

describe("orchestrateur : fournisseur déclaré sans adaptateur", () => {
  it("le marque « non pris en charge », sans toucher au disjoncteur ni échouer à sa place", async () => {
    const paris = REGIONS.find((region) => region.id === "paris")!;
    const orchestrator = new TransportOrchestrator({
      loaders: {
        idfm: async () => () => ({ id: "idfm", getDepartures: async () => [] }),
      },
      http: { getJson: async () => ({}) as never },
      hasKey: () => false,
    });
    orchestrator.setRegion(paris);
    const failure = await orchestrator.run("departures", (provider, signal) => provider.getDepartures?.({ id: "s", name: "S", lat: 48.8, lon: 2.3 }, {}, signal)).catch((error) => error);
    expect(failure.attempts.map((attempt: { providerId: string; outcome: string }) => `${attempt.providerId}:${attempt.outcome}`)).toEqual([
      "idfm:skipped-key",
      "transitous:unsupported",
    ]);
  });
});
