import { afterEach, describe, expect, it, vi } from "vitest";
import { reverseGeocode } from "../src/services/geocode";

// Nommer un clic sur la carte : Photon d'abord, la BAN en relais s'il tarde.
// Le réseau est simulé ; chaque service répond après `ms`, ou échoue.

type Reply = { ms: number; fail?: boolean; empty?: boolean };

const photonBody = {
  features: [
    {
      geometry: { coordinates: [2.36, 48.853] },
      properties: { osm_type: "N", osm_id: 42, name: "Café Photon", osm_key: "amenity", osm_value: "cafe" },
    },
  ],
};
const banBody = {
  features: [{ geometry: { coordinates: [2.36, 48.853] }, properties: { id: "75104_1", name: "12 Rue de la BAN", postcode: "75004", city: "Paris" } }],
};

function network(photon: Reply, ban: Reply) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const isPhoton = url.includes("photon");
    calls.push(isPhoton ? "photon" : "ban");
    const reply = isPhoton ? photon : ban;
    const body = reply.empty ? { features: [] } : isPhoton ? photonBody : banBody;
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (reply.fail) reject(new TypeError("réseau"));
        else resolve(new Response(JSON.stringify(body), { status: 200 }));
      }, reply.ms);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("abandon", "AbortError"));
      });
    });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

async function timed() {
  const t0 = Date.now();
  const place = await reverseGeocode(2.36, 48.853);
  return { place, ms: Date.now() - t0 };
}

describe("géocodage inverse d'un clic sur la carte", () => {
  it("Photon rapide : sa réponse, et la BAN n'est pas appelée", async () => {
    const calls = network({ ms: 50 }, { ms: 50 });
    const { place } = await timed();
    expect(place?.name).toBe("Café Photon");
    expect(calls).toEqual(["photon"]);
  });

  it("Photon lent (3,9 s, mesuré) : la BAN répond bien avant", async () => {
    network({ ms: 3900 }, { ms: 80 });
    const { place, ms } = await timed();
    expect(place?.name).toBe("12 Rue de la BAN");
    expect(ms).toBeLessThan(1200);
  });

  it("Photon en panne : la BAN est appelée aussitôt", async () => {
    network({ ms: 20, fail: true }, { ms: 50 });
    const { place, ms } = await timed();
    expect(place?.name).toBe("12 Rue de la BAN");
    expect(ms).toBeLessThan(400);
  });

  it("Photon ne trouve rien : la BAN prend le relais", async () => {
    network({ ms: 20, empty: true }, { ms: 50 });
    expect((await timed()).place?.name).toBe("12 Rue de la BAN");
  });

  it("personne ne trouve rien : null, sans attendre le délai maximal", async () => {
    network({ ms: 20, empty: true }, { ms: 30, empty: true });
    const { place, ms } = await timed();
    expect(place).toBeNull();
    expect(ms).toBeLessThan(400);
  });
});
