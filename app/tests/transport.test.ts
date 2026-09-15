import { describe, expect, it } from "vitest";
import { CircuitBreakers } from "../src/transport/circuitBreaker";
import { createSwr, TtlCache } from "../src/transport/cache";
import { createHttpClient, type NativeHttp } from "../src/transport/httpClient";
import { NoProviderError, TransportOrchestrator, type ProviderLoader } from "../src/transport/orchestrator";
import { ProviderError, isRetryable, type TransportProvider } from "../src/transport/provider";
import { providersFor, REGIONS, resolveRegion, type Region } from "../src/transport/registry";
import { withRetry } from "../src/transport/retry";

describe("registre des régions", () => {
  it("résout la région la plus précise, et le reste du monde ailleurs", () => {
    expect(resolveRegion(2.3522, 48.8566).id).toBe("paris");
    expect(resolveRegion(4.9003, 52.3789).id).toBe("world");
    expect(resolveRegion(139.7671, 35.6812).id).toBe("world");
  });

  it("garde la région active dans sa marge, et la quitte au-delà", () => {
    // Juste à l'est de l'emprise de l'Île-de-France (3,56°), dans les 20 % de marge.
    expect(resolveRegion(3.7, 48.8, "paris").id).toBe("paris");
    expect(resolveRegion(3.7, 48.8, null).id).toBe("world");
    expect(resolveRegion(5.5, 48.8, "paris").id).toBe("world");
  });

  it("classe les fournisseurs par rang, et ne rend que ceux de la capacité", () => {
    const paris = REGIONS.find((region) => region.id === "paris")!;
    expect(providersFor(paris, "departures").map((p) => p.id)).toEqual(["idfm", "transitous"]);
    // En Île-de-France, les arrêts viennent des tuiles d'OSM : aucune source d'arrêts à interroger.
    expect(providersFor(paris, "stops")).toEqual([]);
    const world = REGIONS.find((region) => region.id === "world")!;
    expect(providersFor(world, "stops").map((p) => p.id)).toEqual(["transitous"]);
  });
});

describe("disjoncteurs", () => {
  it("s'ouvrent après N échecs, laissent passer un seul essai après le repos", () => {
    let now = 0;
    const breakers = new CircuitBreakers(() => now);
    const settings = { failures: 3, openMs: 1000 };
    breakers.failure("a", settings);
    breakers.failure("a", settings);
    expect(breakers.allow("a")).toBe(true);
    breakers.failure("a", settings);
    expect(breakers.allow("a")).toBe(false);
    now = 1000;
    expect(breakers.allow("a")).toBe(true); // l'essai
    expect(breakers.allow("a")).toBe(false); // un seul à la fois
    breakers.failure("a", settings); // essai raté : repos à nouveau
    expect(breakers.isOpen("a")).toBe(true);
    now = 2000;
    expect(breakers.allow("a")).toBe(true);
    breakers.success("a");
    expect(breakers.allow("a")).toBe(true);
    expect(breakers.allow("a")).toBe(true);
  });

  it("respectent le repos imposé par la source (429)", () => {
    let now = 0;
    const breakers = new CircuitBreakers(() => now);
    breakers.openFor("b", 30_000);
    expect(breakers.allow("b")).toBe(false);
    now = 30_000;
    expect(breakers.allow("b")).toBe(true);
  });
});

describe("cache et stale-while-revalidate", () => {
  it("distingue frais et périmé, et oublie à l'échéance ce qui ne doit pas l'être", () => {
    let now = 0;
    const cache = new TtlCache<string>({ maxEntries: 10, maxStaleMs: 1000, now: () => now });
    cache.set("stale-ok", "a", 100, true);
    cache.set("realtime", "b", 100, false);
    now = 150;
    expect(cache.get("stale-ok")).toMatchObject({ value: "a", fresh: false });
    expect(cache.get("realtime")).toBeUndefined();
    now = 2000;
    expect(cache.get("stale-ok")).toBeUndefined();
  });

  it("évince le moins récemment lu, et oublie une région par préfixe", () => {
    const cache = new TtlCache<number>({ maxEntries: 2 });
    cache.set("paris:a", 1, 1000);
    cache.set("paris:b", 2, 1000);
    cache.get("paris:a");
    cache.set("world:c", 3, 1000);
    expect(cache.get("paris:b")).toBeUndefined();
    cache.deletePrefix("paris:");
    expect(cache.get("paris:a")).toBeUndefined();
    expect(cache.get("world:c")?.value).toBe(3);
  });

  it("sert la valeur périmée tout de suite, rafraîchit derrière, et partage les chargements en vol", async () => {
    let now = 0;
    const cache = new TtlCache<number>({ maxEntries: 10, now: () => now });
    const swr = createSwr(cache);
    let loads = 0;
    const load = async () => ++loads;
    const [first, second] = await Promise.all([swr({ key: "k", ttlMs: 100, load }), swr({ key: "k", ttlMs: 100, load })]);
    expect([first.value, second.value, loads]).toEqual([1, 1, 1]);
    now = 200;
    let revalidated = 0;
    const stale = await swr({ key: "k", ttlMs: 100, load, onRevalidated: (value) => (revalidated = value) });
    expect(stale).toEqual({ value: 1, fresh: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revalidated).toBe(2);
  });
});

describe("reprises", () => {
  it("reprend selon les délais, et s'arrête sur une erreur non reprenable", async () => {
    let calls = 0;
    const value = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new ProviderError("network", "coupé");
        return "ok";
      },
      [10, 20],
      { shouldRetry: isRetryable, sleep: async () => {} }
    );
    expect([value, calls]).toEqual(["ok", 3]);

    let refused = 0;
    await expect(
      withRetry(
        async () => {
          refused += 1;
          throw new ProviderError("http", "introuvable", { status: 404 });
        },
        [10, 20],
        { shouldRetry: isRetryable, sleep: async () => {} }
      )
    ).rejects.toThrow("introuvable");
    expect(refused).toBe(1);
  });
});

describe("client HTTP", () => {
  function fakeNative(respond: (url: string) => { status: number; data: unknown; headers?: Record<string, string> } | Promise<{ status: number; data: unknown; headers?: Record<string, string> }>) {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const native: NativeHttp = {
      request: async (options) => {
        calls.push({ url: options.url, headers: options.headers });
        return respond(options.url);
      },
    };
    return { native, calls };
  }

  it("identifie l'application, lit le JSON et partage deux demandes identiques en vol", async () => {
    const { native, calls } = fakeNative(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { status: 200, data: '{"ok":true}' };
    });
    const client = createHttpClient({ userAgent: "MY-OSM/test (+https://github.com/Gris-S/my-osm)", native });
    const [a, b] = await Promise.all([
      client.getJson({ url: "https://api.example/x", timeoutMs: 1000 }),
      client.getJson({ url: "https://api.example/x", timeoutMs: 1000 }),
    ]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers["User-Agent"]).toBe("MY-OSM/test (+https://github.com/Gris-S/my-osm)");
  });

  it("type la limitation de débit, la taille et l'illisible", async () => {
    const limited = createHttpClient({ userAgent: "t", native: fakeNative(() => ({ status: 429, data: "", headers: { "Retry-After": "30" } })).native });
    await expect(limited.getJson({ url: "https://api.example/a", timeoutMs: 1000 })).rejects.toMatchObject({ kind: "rateLimited", retryAfterMs: 30_000 });
    const big = createHttpClient({ userAgent: "t", maxChars: 10, native: fakeNative(() => ({ status: 200, data: '{"trop":"long"}' })).native });
    await expect(big.getJson({ url: "https://api.example/b", timeoutMs: 1000 })).rejects.toMatchObject({ kind: "tooLarge" });
    const garbled = createHttpClient({ userAgent: "t", native: fakeNative(() => ({ status: 200, data: "<html>" })).native });
    await expect(garbled.getJson({ url: "https://api.example/c", timeoutMs: 1000 })).rejects.toMatchObject({ kind: "parse" });
  });

  it("plafonne les appels simultanés par hôte, et laisse chaque appelant s'annuler seul", async () => {
    let active = 0;
    let peak = 0;
    const { native } = fakeNative(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { status: 200, data: "1" };
    });
    const client = createHttpClient({ userAgent: "t", native, maxPerHost: 2 });
    await Promise.all([1, 2, 3, 4, 5].map((n) => client.getJson({ url: `https://api.example/${n}`, timeoutMs: 1000 })));
    expect(peak).toBe(2);

    const controller = new AbortController();
    const kept = client.getJson({ url: "https://api.example/shared", timeoutMs: 1000 });
    const cancelled = client.getJson({ url: "https://api.example/shared", timeoutMs: 1000, signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await expect(kept).resolves.toBe(1);
  });
});

describe("orchestrateur", () => {
  const region: Region = {
    id: "test",
    name: { fr: "Test", en: "Test" },
    bbox: [0, 0, 10, 10],
    providers: [
      { id: "local", rank: 1, capabilities: ["departures"], needsKey: "idfm" },
      { id: "aggregator", rank: 2, capabilities: ["departures"] },
    ],
  };
  const other: Region = { id: "other", name: { fr: "Autre", en: "Other" }, bbox: [20, 20, 30, 30], providers: [] };
  const noHttp = { getJson: async () => ({}) as never };

  function setup(local: Partial<TransportProvider>, aggregator: Partial<TransportProvider>, hasKey = true) {
    const loads: string[] = [];
    const loaders: Record<string, ProviderLoader> = {
      local: async () => {
        loads.push("local");
        return () => ({ id: "local", ...local });
      },
      aggregator: async () => {
        loads.push("aggregator");
        return () => ({ id: "aggregator", ...aggregator });
      },
    };
    const orchestrator = new TransportOrchestrator({ loaders, http: noHttp, hasKey: () => hasKey, sleep: async () => {}, regions: [region, other] });
    orchestrator.setRegion(region);
    return { orchestrator, loads };
  }
  const departures = (orchestrator: TransportOrchestrator) =>
    orchestrator.run("departures", (provider, signal) => provider.getDepartures?.("stop", {}, signal));

  it("prend le rang 1, puis replie sur le rang 2 quand il échoue", async () => {
    const failing = setup({ getDepartures: async () => Promise.reject(new ProviderError("http", "400", { status: 400 })) }, { getDepartures: async () => [] });
    const result = await departures(failing.orchestrator);
    expect(result.providerId).toBe("aggregator");
    expect(result.attempts.map((a) => a.outcome)).toEqual(["failed", "success"]);

    const fine = setup({ getDepartures: async () => [] }, { getDepartures: async () => [] });
    expect((await departures(fine.orchestrator)).providerId).toBe("local");
    expect(fine.loads).toEqual(["local"]); // le rang 2 n'est jamais chargé s'il ne sert pas
  });

  it("saute un fournisseur sans clé, puis un fournisseur au repos", async () => {
    const keyless = setup({ getDepartures: async () => [] }, { getDepartures: async () => [] }, false);
    expect((await departures(keyless.orchestrator)).attempts[0].outcome).toBe("skipped-key");

    let calls = 0;
    const flaky = setup(
      {
        getDepartures: async () => {
          calls += 1;
          throw new ProviderError("http", "400", { status: 400 });
        },
      },
      { getDepartures: async () => [] }
    );
    for (let i = 0; i < 3; i++) await departures(flaky.orchestrator);
    const afterBreak = await departures(flaky.orchestrator);
    expect(afterBreak.attempts[0].outcome).toBe("skipped-breaker");
    expect(calls).toBe(3);
  });

  it("annule les requêtes en vol et décharge les fournisseurs quand la région change", async () => {
    let disposed = false;
    const { orchestrator } = setup(
      {
        getDepartures: (_id, _options, signal) =>
          new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
        dispose: () => (disposed = true),
      },
      {}
    );
    const pending = departures(orchestrator);
    await new Promise((resolve) => setTimeout(resolve, 0));
    orchestrator.setRegion(other);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disposed).toBe(true);
  });

  it("dit clairement quand aucune source ne peut répondre", async () => {
    const { orchestrator } = setup(
      { getDepartures: async () => Promise.reject(new ProviderError("http", "400", { status: 400 })) },
      { getDepartures: async () => Promise.reject(new ProviderError("http", "400", { status: 400 })) }
    );
    await expect(departures(orchestrator)).rejects.toBeInstanceOf(NoProviderError);
  });
});
