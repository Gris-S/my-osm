import { describe, expect, it } from "vitest";
import { NO_VOICE_MEMORY, maneuverSentence, nextAnnouncement, spokenDistance } from "../src/navigation/voice";
import { gaugeView, trafficSpans } from "../src/navigation/car/carTraffic";
import { corridorBbox, readIncidents } from "../src/navigation/car/incidents";
import { brightnessTarget } from "../src/services/ambientLight";
import { setLang } from "../src/i18n";

// Les phrases sont éprouvées en français, la langue de référence.
setLang("fr");

describe("voice — ce qui se dit, et quand", () => {
  it("dit les distances comme on les dit", () => {
    expect(spokenDistance(287)).toBe("290 mètres");
    expect(spokenDistance(420)).toBe("400 mètres");
    expect(spokenDistance(1040)).toBe("1 kilomètre");
    expect(spokenDistance(2400)).toBe("2,5 kilomètres");
    expect(spokenDistance(12300)).toBe("12 kilomètres");
  });

  it("annonce deux fois une manœuvre : de loin, puis au moment", () => {
    const speed = 13.9; // 50 km/h : 417 m, puis 111 m
    let state = nextAnnouncement(NO_VOICE_MEMORY, { step: 3, distanceMeters: 900, speedMps: speed });
    expect(state.announce).toBeNull();
    state = nextAnnouncement(state.memory, { step: 3, distanceMeters: 410, speedMps: speed });
    expect(state.announce).toEqual({ now: false });
    state = nextAnnouncement(state.memory, { step: 3, distanceMeters: 300, speedMps: speed });
    expect(state.announce).toBeNull();
    state = nextAnnouncement(state.memory, { step: 3, distanceMeters: 100, speedMps: speed });
    expect(state.announce).toEqual({ now: true });
    state = nextAnnouncement(state.memory, { step: 3, distanceMeters: 20, speedMps: speed });
    expect(state.announce).toBeNull();
  });

  it("repart de zéro à la manœuvre suivante, et n'annonce qu'une fois un virage enchaîné", () => {
    const done = { step: 3, said: 2 };
    const state = nextAnnouncement(done, { step: 4, distanceMeters: 60, speedMps: 8 });
    expect(state.announce).toEqual({ now: true });
    expect(nextAnnouncement(state.memory, { step: 4, distanceMeters: 30, speedMps: 8 }).announce).toBeNull();
  });

  it("compose la phrase", () => {
    expect(maneuverSentence("Tournez à gauche", "Rue de Rivoli", 410, false)).toBe("Dans 400 mètres, tournez à gauche, Rue de Rivoli");
    expect(maneuverSentence("Tournez à gauche", "", 30, true)).toBe("Tournez à gauche");
  });
});

// Un tracé droit de 10 km vers l'est, un point tous les kilomètres.
const route = {
  points: Array.from({ length: 11 }, (_, i) => ({ lon: 2 + i * 0.0137, lat: 48 })),
  measures: Array.from({ length: 11 }, (_, i) => i * 1000),
};

describe("jauge des bouchons", () => {
  const traffic = [
    { startIndex: 2, endIndex: 4, level: "jam" as const, incident: null, delaySeconds: 240 },
    { startIndex: 7, endIndex: 8, level: "slow" as const, incident: null, delaySeconds: 30 },
    { startIndex: 5, endIndex: 6, level: null, incident: "closure" as const, delaySeconds: 0 },
  ];
  const spans = trafficSpans({ ...route, traffic });

  it("ne garde que ce qui ralentit, en mètres", () => {
    expect(spans.map((s) => [s.fromMeters, s.toMeters, s.level])).toEqual([
      [2000, 4000, "jam"],
      [7000, 8000, "slow"],
    ]);
  });

  it("montre le prochain bouchon et sa distance", () => {
    const view = gaugeView(spans, 0, 10_000)!;
    expect(view.parts[0]).toEqual({ start: 0.2, size: 0.2, level: "jam" });
    expect(view.next).toEqual({ inside: false, meters: 2000, delaySeconds: 240, level: "jam" });
  });

  it("dit ce qu'il reste quand on est dedans", () => {
    const view = gaugeView(spans, 3000, 10_000)!;
    expect(view.next).toEqual({ inside: true, meters: 1000, delaySeconds: 120, level: "jam" });
    expect(view.parts[0].start).toBe(0);
  });

  it("dessine un ralentissement trop court, mais ne parle que du suivant", () => {
    // Quarante-six mètres de feu rouge, puis le vrai bouchon.
    const view = gaugeView([{ fromMeters: 0, toMeters: 46, level: "slow", delaySeconds: 5 }, ...spans], 0, 10_000)!;
    expect(view.parts).toHaveLength(3);
    expect(view.next).toMatchObject({ inside: false, meters: 2000, level: "jam" });
  });

  it("disparaît quand il n'y a plus rien devant", () => {
    expect(gaugeView(spans, 8500, 10_000)).toBeNull();
  });

  it("décale les mètres d'un parcours épinglé", () => {
    expect(trafficSpans({ ...route, traffic }, 5000)[0].fromMeters).toBe(7000);
  });
});

describe("incidents du couloir", () => {
  const feature = (lon: number, lat: number, iconCategory: number) => ({
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: { iconCategory },
  });

  it("garde l'accident et la panne sur le tracé, devant", () => {
    const found = readIncidents(
      {
        incidents: [
          feature(2.0685, 48, 1), // sur le tracé, à 5 km
          feature(2.0959, 48.0001, 14), // sur le tracé, à 7 km
          feature(2.0685, 48.01, 1), // un kilomètre à côté
          feature(2.0137, 48, 1), // derrière
          feature(2.1096, 48, 6), // un bouchon : l'itinéraire le dit déjà
          { geometry: { type: "LineString", coordinates: [[2.1233, 48], [2.13, 48]] }, properties: { iconCategory: 3 } },
        ],
      },
      route,
      3000,
    );
    expect(found.map((i) => i.kind)).toEqual(["accident", "breakdown", "incident"]);
  });

  it("mesure l'emprise du couloir", () => {
    const corridor = corridorBbox(route, 0, 10_000)!;
    expect(corridor.bbox[0]).toBeCloseTo(1.995, 3);
    expect(corridor.km2).toBeGreaterThan(5);
    expect(corridor.km2).toBeLessThan(20);
  });
});

describe("thème automatique en voiture", () => {
  it("garde le clair dans une pièce éclairée, hors voiture", () => {
    expect(brightnessTarget(20, false).target).toBe("light");
  });
  it("passe au sombre dans un tunnel éclairé, en voiture, en moins d'une seconde", () => {
    const { target, delayMs } = brightnessTarget(20, true);
    expect(target).toBe("dark");
    expect(delayMs).toBeLessThan(1000);
  });
  it("revient au clair en plein jour", () => {
    expect(brightnessTarget(800, true).target).toBe("light");
  });
});

describe("marge sur la durée en voiture", async () => {
  const { withMargin } = await import("../src/navigation/car/carLabels");
  it("ajoute trois minutes à vingt, cinq à partir de trente-cinq", () => {
    expect(withMargin(20 * 60) - 20 * 60).toBe(180);
    expect(withMargin(35 * 60) - 35 * 60).toBe(300);
    expect(withMargin(4 * 3600) - 4 * 3600).toBe(300);
  });
  it("s'efface à l'approche de l'arrivée", () => {
    expect(withMargin(120) - 120).toBe(18);
    expect(withMargin(0)).toBe(0);
  });
});

describe("choix de la voix", async () => {
  const { installedVoices } = await import("../src/navigation/voice");
  const brut = [
    { name: "fr-fr-x-star08-local", locale: "fr-FR", network: false, installed: false },
    { name: "fr-fr-x-frb-local", locale: "fr-FR", network: false, installed: true },
    { name: "fr-fr-x-frb-network", locale: "fr-FR", network: true, installed: true },
    { name: "fr-FR-language", locale: "fr-FR", network: false, installed: true },
    { name: "es-es-x-eea-local", locale: "es-ES", network: false, installed: false },
    { name: "en-gb-x-gba-local", locale: "en-GB", network: false, installed: true },
  ];
  it("ne garde que les voix déjà téléchargées, sans réseau, rangées par langue", () => {
    expect(installedVoices(brut).map((v) => v.name)).toEqual(["en-gb-x-gba-local", "fr-fr-x-frb-local"]);
  });
});

describe("la voix parle sa langue", async () => {
  const { inLanguage, navText } = await import("../src/navigation/strings");
  const { spokenLanguageOf } = await import("../src/navigation/voice");
  const { carManeuverAction } = await import("../src/navigation/car/carManeuver");
  const gauche = { kind: "turn", modifier: "left", road: "", street: "" } as unknown as Parameters<typeof carManeuverAction>[0];

  it("compose en italien une manœuvre, interface en français", () => {
    const phrase = inLanguage("it", () => maneuverSentence(navText("car.left"), "Via Roma", 410, false));
    expect(phrase).toBe("Tra 400 metri, gira a sinistra, Via Roma");
    // Et rend la langue de l'interface en sortant.
    expect(navText("car.left")).toBe("Tournez à gauche");
  });

  it("met les distances allemandes au datif et garde la virgule hors de l'anglais", () => {
    expect(inLanguage("de", () => spokenDistance(2400))).toBe("2,5 Kilometern");
    expect(inLanguage("en", () => spokenDistance(2400))).toBe("2.5 kilometres");
    expect(inLanguage("es", () => spokenDistance(300))).toBe("300 metros");
  });

  it("suit la langue jusque dans les libellés de manœuvre", () => {
    void gauche;
    expect(inLanguage("pt", () => navText("car.uturn"))).toBe("Faça inversão de marcha");
    expect(inLanguage("en", () => navText("car.uturn"))).toBe("Make a U-turn");
  });

  it("ne reconnaît que les langues qu'on sait écrire", () => {
    expect(spokenLanguageOf("it-IT")).toBe("it");
    expect(spokenLanguageOf("fr-CA")).toBe("fr");
    expect(spokenLanguageOf("pl-PL")).toBeNull();
  });
});
