import { beforeEach, describe, expect, it, vi } from "vitest";

// Le moteur est remplacé : ces tests portent sur le **partage** du calcul, pas
// sur ce que TomTom répond.
vi.mock("../src/navigation/car/carRoute", () => ({
  getCarRoutes: vi.fn(),
  hasLiveEngine: () => true,
}));

import { cachedCarRoutes } from "../src/navigation/car/carEta";
import { getCarRoutes } from "../src/navigation/car/carRoute";
import { choiceDetail } from "../src/navigation/car/carLabels";
import type { CarRoute } from "../src/navigation/car/carRoute";
import type { LonLat } from "../src/types";

// ---------------------------------------------------------------------------
// Ce que ces tests protègent, et qui ne se voit pas à l'œil : **un départ en
// voiture ne doit pas repayer le calcul que le panneau d'itinéraire vient de
// faire.** C'est toute la justification d'avoir avancé l'appel plutôt que d'en
// ajouter un — sans le partage, afficher la durée avec trafic dans le panneau
// ferait passer un départ de trois appels à quatre sur un palier mensuel.
// ---------------------------------------------------------------------------

const route = (marker: string) => [{ marker } as unknown as CarRoute];
const at = (lon: number): LonLat[] => [
  { lon, lat: 48.86 },
  { lon: lon + 0.02, lat: 48.85 },
];

beforeEach(() => {
  vi.mocked(getCarRoutes).mockReset();
  vi.mocked(getCarRoutes).mockResolvedValue(route("frais"));
});

describe("cachedCarRoutes — le panneau calcule, le départ réutilise", () => {
  // Chaque test emploie des coordonnées qui lui sont propres : le cache vit au
  // niveau du module et ne se remet pas à zéro entre deux tests.
  it("ne paie qu'un appel pour deux demandes identiques", async () => {
    const points = at(2.1);
    const [first, second] = await Promise.all([
      cachedCarRoutes(points, { alternatives: 3 }),
      cachedCarRoutes(points, { alternatives: 3 }),
    ]);
    expect(getCarRoutes).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("resserre aussi une demande faite après coup", async () => {
    const points = at(2.2);
    await cachedCarRoutes(points, { alternatives: 3 });
    await cachedCarRoutes(points, { alternatives: 3 });
    expect(getCarRoutes).toHaveBeenCalledTimes(1);
  });

  it("distingue deux parcours, et le sans-péage du reste", async () => {
    await cachedCarRoutes(at(2.3), { alternatives: 3 });
    await cachedCarRoutes(at(2.4), { alternatives: 3 });
    await cachedCarRoutes(at(2.3), { alternatives: 3, avoidTolls: true });
    expect(getCarRoutes).toHaveBeenCalledTimes(3);
  });

  it("ne transmet pas le signal de celui qui a demandé", async () => {
    // Fermer le panneau ne doit pas interrompre une requête dont le départ,
    // une seconde plus tard, aura besoin : le travail est partagé, pas possédé.
    await cachedCarRoutes(at(2.5), { alternatives: 3, signal: new AbortController().signal });
    expect(vi.mocked(getCarRoutes).mock.calls[0][1]).not.toHaveProperty("signal");
  });

  it("ne garde pas un échec", async () => {
    const points = at(2.6);
    vi.mocked(getCarRoutes).mockRejectedValueOnce(new Error("réseau"));
    await expect(cachedCarRoutes(points, { alternatives: 3 })).rejects.toThrow("réseau");
    // Insister a un sens quand le réseau revient.
    await cachedCarRoutes(points, { alternatives: 3 });
    expect(getCarRoutes).toHaveBeenCalledTimes(2);
  });
});

describe("choiceDetail — la bulle explique sa durée", () => {
  it("se tait quand le moteur ne connaît pas le trafic", () => {
    // OSRM rend `null`, et « zéro » ne voudrait pas dire la même chose : ce
    // serait annoncer une route dégagée.
    expect(choiceDetail({ kind: "free" }, null)).not.toContain("+");
  });

  it("se tait sous la minute", () => {
    expect(choiceDetail({ kind: "free" }, 45)).not.toContain("+");
  });

  it("dit ce que le trafic coûte, sur la ligne du péage", () => {
    const detail = choiceDetail({ kind: "free" }, 9 * 60);
    expect(detail).toContain("+9");
    // Une seule ligne : le péage reste, la mention s'y ajoute.
    expect(detail).toContain(choiceDetail({ kind: "free" }, null));
  });

  it("arrondit à la minute", () => {
    expect(choiceDetail({ kind: "free" }, 283 + 235)).toContain("+9");
  });
});
