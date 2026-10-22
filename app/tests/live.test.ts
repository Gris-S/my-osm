import { describe, expect, it } from "vitest";
import { parseNetworks, parseStations } from "../src/live/bikes";
import { mergeStations, parseChargers, parseOfficial, parsePumperly, readableAddress } from "../src/live/fuel";
import { isStale } from "../src/live/format";
import { liveSearch, normalize, type LiveSearchContext } from "../src/live/search";

// Les modes en direct : la lecture des trois sources, sur des extraits des
// vraies réponses du 22 octobre 2026, et ce que la recherche en propose.

const VELIB_STATION = {
  id: "0003131bffcf527ba3a560fc46d38b6f",
  name: "Argenson - Château",
  latitude: 48.888559314669514,
  longitude: 2.2642001509666447,
  timestamp: "2026-10-22T09:01:27.788746+00:00Z",
  free_bikes: 6,
  empty_slots: 16,
  extra: { uid: "22002", renting: 1, returning: 1, slots: 25, normal_bikes: 3, ebikes: 3 },
};

const OFFICIAL_RECORD = {
  id: 75012020,
  adresse: "238 RUE DE CHARENTON",
  ville: "Paris",
  geom: { lon: 2.38906, lat: 48.83905 },
  gazole_prix: 2.25,
  gazole_maj: "2026-10-22T06:00:00+00:00",
  e10_prix: 1.99,
  e10_maj: "2026-10-22T06:00:00+00:00",
  sp98_prix: 1.99,
  sp98_maj: "2026-10-22T06:00:00+00:00",
  carburants_rupture_temporaire: null,
  carburants_rupture_definitive: "SP95;E85;GPLc",
  horaires_automate_24_24: "Non",
  services_service: ["Carburant additivé"],
};

describe("CityBikes", () => {
  it("sépare vélos mécaniques et électriques, et garde l'état de la station", () => {
    const [s] = parseStations({ network: { stations: [VELIB_STATION] } }, "velib");
    expect(s).toMatchObject({ id: "velib/0003131bffcf527ba3a560fc46d38b6f", mechanical: 3, electric: 3, free: 16, slots: 25, open: true });
    expect(Number.isFinite(s.at)).toBe(true);
  });

  it("compte tout vélo comme mécanique quand le réseau ne détaille pas", () => {
    const [s] = parseStations({ network: { stations: [{ id: "a", name: "A", latitude: 45, longitude: 4, free_bikes: 4, empty_slots: 2 }] } }, "velov");
    expect(s).toMatchObject({ mechanical: 4, electric: 0, slots: null, open: true });
  });

  it("dit fermée une station où l'on ne peut plus prendre de vélo", () => {
    const closed = { ...VELIB_STATION, extra: { ...VELIB_STATION.extra, renting: 0 } };
    expect(parseStations({ network: { stations: [closed] } }, "velib")[0].open).toBe(false);
  });

  it("écarte un réseau sans position", () => {
    const list = parseNetworks({
      networks: [
        { id: "velib", name: "Vélib' Métropole", location: { city: "Paris", country: "FR", latitude: 48.85, longitude: 2.35 } },
        { id: "nowhere", name: "Sans position", location: { city: "?" } },
      ],
    });
    expect(list.map((n) => n.id)).toEqual(["velib"]);
  });
});

describe("prix des carburants", () => {
  it("lit les prix, leurs dates, les ruptures et les carburants non vendus du flux officiel", () => {
    const [s] = parseOfficial({ results: [OFFICIAL_RECORD] });
    expect(s.id).toBe("fr/75012020");
    expect(Object.keys(s.prices).sort()).toEqual(["e10", "gazole", "sp98"]);
    expect(s.prices.e10).toMatchObject({ price: 1.99, currency: "EUR" });
    expect(s.notSold).toEqual(["sp95", "e85", "gplc"]);
    expect(s.shortage).toEqual([]);
    expect(s.services).toEqual(["Carburant additivé"]);
  });

  it("reconnaît une station de Pumperly par son identifiant officiel", () => {
    const pumperly = parsePumperly(
      {
        features: [
          {
            geometry: { coordinates: [2.38906, 48.83905] },
            properties: { externalId: "75012020", country: "FR", price: 1.99, currency: "EUR", reportedAt: "2026-10-22T10:53:09.087Z", brand: null },
          },
        ],
      },
      "e10",
    );
    expect(pumperly[0].id).toBe("fr/75012020");
  });

  const official = () => parseOfficial({ results: [OFFICIAL_RECORD] });
  const pumperlyAt = (price: number, at: string) =>
    parsePumperly(
      { features: [{ geometry: { coordinates: [2.38906, 48.83905] }, properties: { externalId: "75012020", country: "FR", price, currency: "EUR", reportedAt: at } }] },
      "e10",
    );

  it("à prix égal, garde la date officielle : Pumperly date du jour de sa collecte", () => {
    const [merged] = mergeStations(official(), pumperlyAt(1.99, "2026-10-22T10:53:09Z"), "e10");
    expect(merged.prices.e10?.at).toBe(Date.parse("2026-10-22T06:00:00+00:00"));
  });

  it("à prix différent, le plus récent l'emporte", () => {
    const [newer] = mergeStations(official(), pumperlyAt(1.95, "2026-10-22T10:53:09Z"), "e10");
    expect(newer.prices.e10?.price).toBe(1.95);
    const [older] = mergeStations(official(), pumperlyAt(1.95, "2026-10-20T10:00:00Z"), "e10");
    expect(older.prices.e10?.price).toBe(1.99);
  });

  it("ajoute les stations que seul Pumperly connaît (à l'étranger)", () => {
    const abroad = parsePumperly(
      { features: [{ geometry: { coordinates: [-3.7, 40.4] }, properties: { externalId: "123", country: "ES", price: 1.459, currency: "EUR", reportedAt: "2026-10-22T06:00:00Z", brand: "REPSOL" } }] },
      "e10",
    );
    const merged = mergeStations(official(), abroad, "e10");
    expect(merged.map((s) => s.id)).toEqual(["fr/75012020", "es/123"]);
    expect(merged[1].brand).toBe("REPSOL");
  });

  it("lit la puissance des bornes", () => {
    const [c] = parseChargers({
      features: [{ geometry: { coordinates: [2.487477, 48.793445] }, properties: { externalId: "ocm-198502", name: "Metropolis - Citadine", address: "Place d'Adamville", powerKw: 22 } }],
    });
    expect(c).toMatchObject({ id: "ocm-198502", powerKw: 22 });
  });

  it("écrit en casse ordinaire une adresse en capitales", () => {
    expect(readableAddress("238 RUE DE CHARENTON")).toBe("238 Rue de Charenton");
    expect(readableAddress("85 RUE JEANNE D'ARC")).toBe("85 Rue Jeanne d'Arc");
    expect(readableAddress("32 rue de Reuilly")).toBe("32 rue de Reuilly");
  });

  it("signale un prix de plus de sept jours", () => {
    const now = Date.parse("2026-10-22T12:00:00Z");
    expect(isStale(Date.parse("2026-09-22T07:49:34Z"), now)).toBe(true);
    expect(isStale(Date.parse("2026-10-21T07:31:00Z"), now)).toBe(false);
  });
});

describe("recherche", () => {
  const networks = parseNetworks({
    networks: [
      { id: "velib", name: "Vélib' Métropole", location: { city: "Paris", country: "FR", latitude: 48.8566, longitude: 2.3522 } },
      { id: "velov", name: "Vélo'v", location: { city: "Lyon", country: "FR", latitude: 45.76, longitude: 4.84 } },
    ],
  });
  const ctx: LiveSearchContext = { bikes: true, fuel: true, electric: false, networks, items: [], near: { lon: 2.35, lat: 48.85 } };

  it("ignore accents, apostrophes et casse", () => {
    expect(normalize("Vélo'v")).toBe("velov");
  });

  it("propose toutes les stations-service pour « essence » et « station service »", () => {
    expect(liveSearch("essence", ctx)[0]).toEqual({ kind: "all", target: "fuel" });
    expect(liveSearch("Station service", ctx)[0]).toEqual({ kind: "all", target: "fuel" });
  });

  it("propose les bornes pour « borne », et à la place des prix pour l'électrique", () => {
    expect(liveSearch("borne", ctx)[0]).toEqual({ kind: "all", target: "chargers" });
    expect(liveSearch("essence", { ...ctx, electric: true }).map((r) => r.kind === "all" && r.target)).toEqual(["chargers"]);
  });

  it("« vélib » montre les vélos d'ici, « vélo'v » le réseau de Lyon", () => {
    expect(liveSearch("vélib", ctx)[0]).toEqual({ kind: "all", target: "bikes" });
    const velov = liveSearch("vélo'v", ctx);
    expect(velov).toHaveLength(1);
    expect(velov[0]).toMatchObject({ kind: "network", network: { id: "velov", city: "Lyon" } });
  });

  it("dit qu'un mode est éteint plutôt que de ne rien proposer", () => {
    expect(liveSearch("vélo", { ...ctx, bikes: false })).toEqual([{ kind: "off", mode: "bikes" }]);
    expect(liveSearch("essence", { ...ctx, fuel: false })).toEqual([{ kind: "off", mode: "fuel" }]);
  });

  it("ne propose rien pour une recherche ordinaire", () => {
    expect(liveSearch("boulangerie", ctx)).toEqual([]);
  });
});
